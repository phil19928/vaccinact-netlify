import {
  buildFeedbackBatchIdentity,
  evaluateGoNoGo,
  normalizeFeedbackEntry,
  summarizeFeedback
} from "./lib/betaFeedback.js";
import { archiveFeedbackBatch } from "./lib/betaFeedbackArchive.js";
import { forwardFeedbackToWebhook } from "./lib/betaFeedbackDelivery.js";
import { persistFeedbackBatchToPrimaryStore } from "./lib/betaFeedbackPrimaryStore.js";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    let rawEntries = [];

    if (Array.isArray(body.entries)) {
      rawEntries = body.entries;
    } else if (body.entry && typeof body.entry === "object") {
      rawEntries = [body.entry];
    } else if (body && typeof body === "object" && body.utility_score !== undefined) {
      rawEntries = [body];
    }

    if (rawEntries.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No feedback entries provided." })
      };
    }

    const accepted = [];
    const rejected = [];

    rawEntries.forEach((entry, index) => {
      const normalized = normalizeFeedbackEntry(entry);
      if (normalized.valid) {
        accepted.push(normalized.normalized);
      } else {
        rejected.push({
          index,
          error: normalized.error
        });
      }
    });

    if (accepted.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "All entries rejected.",
          rejected
        })
      };
    }

    const summary = summarizeFeedback(accepted);
    const goNoGo = evaluateGoNoGo(summary);
    const batchId = buildFeedbackBatchIdentity({
      entries: accepted,
      summary
    });
    const archive = await archiveFeedbackBatch({
      entries: accepted,
      summary,
      archivePath: process.env.BETA_FEEDBACK_ARCHIVE_PATH,
      batchId,
      retentionDays: process.env.BETA_FEEDBACK_RETENTION_DAYS,
      retentionMaxBatches: process.env.BETA_FEEDBACK_RETENTION_MAX_BATCHES
    });
    const nowIso = new Date().toISOString();

    const requestId =
      event?.headers?.["x-nf-request-id"] ||
      event?.headers?.["X-Nf-Request-Id"] ||
      event?.headers?.["x-request-id"] ||
      event?.headers?.["X-Request-Id"] ||
      "";
    const primaryStore = await persistFeedbackBatchToPrimaryStore({
      mode: process.env.BETA_FEEDBACK_PRIMARY_STORE_MODE,
      sqlitePath: process.env.BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH,
      webhookUrl: process.env.BETA_FEEDBACK_PRIMARY_STORE_URL,
      webhookSecret: process.env.BETA_FEEDBACK_PRIMARY_STORE_SECRET,
      entries: accepted,
      summary,
      goNoGo,
      archive,
      source: "vaccinact-netlify-beta-feedback-primary",
      eventName: "beta_feedback_store_batch",
      batchId,
      idempotencyKey: `vaccinact-beta-feedback:primary_store:${batchId}`,
      extraPayload: {
        ingest: {
          accepted_count: accepted.length,
          rejected_count: rejected.length
        }
      },
      requestId,
      nowIso,
      maxAttempts: process.env.BETA_FEEDBACK_PRIMARY_STORE_MAX_ATTEMPTS,
      retryBaseDelayMs: process.env.BETA_FEEDBACK_PRIMARY_STORE_RETRY_BASE_DELAY_MS,
      timeoutMs: process.env.BETA_FEEDBACK_PRIMARY_STORE_TIMEOUT_MS,
      retentionDays: process.env.BETA_FEEDBACK_PRIMARY_STORE_RETENTION_DAYS,
      retentionMaxBatches: process.env.BETA_FEEDBACK_PRIMARY_STORE_RETENTION_MAX_BATCHES,
      backupDirectoryPath: process.env.BETA_FEEDBACK_PRIMARY_STORE_BACKUP_DIR,
      backupMaxFiles: process.env.BETA_FEEDBACK_PRIMARY_STORE_BACKUP_MAX_FILES,
      dualWriteStrict: process.env.BETA_FEEDBACK_PRIMARY_STORE_DUAL_WRITE_STRICT
    });
    const webhook = await forwardFeedbackToWebhook({
      webhookUrl: process.env.BETA_FEEDBACK_WEBHOOK_URL,
      webhookSecret: process.env.BETA_FEEDBACK_WEBHOOK_SECRET,
      entries: accepted,
      summary,
      goNoGo,
      archive,
      batchId,
      idempotencyKey: `vaccinact-beta-feedback:webhook:${batchId}`,
      requestId,
      nowIso,
      maxAttempts: process.env.BETA_FEEDBACK_WEBHOOK_MAX_ATTEMPTS,
      retryBaseDelayMs: process.env.BETA_FEEDBACK_WEBHOOK_RETRY_BASE_DELAY_MS,
      timeoutMs: process.env.BETA_FEEDBACK_WEBHOOK_TIMEOUT_MS
    });

    console.info("beta_feedback_ingestion", {
      accepted_count: accepted.length,
      rejected_count: rejected.length,
      batch_id: batchId,
      summary,
      go_no_go: goNoGo,
      archive,
      primary_store: primaryStore,
      webhook,
      entries: accepted
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accepted_count: accepted.length,
        rejected_count: rejected.length,
        rejected,
        batch_id: batchId,
        summary,
        go_no_go: goNoGo,
        archive,
        primary_store: primaryStore,
        webhook
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: String(error)
      })
    };
  }
};
