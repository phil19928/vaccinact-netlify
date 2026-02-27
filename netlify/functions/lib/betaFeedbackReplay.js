import fs from "node:fs/promises";

import { buildFeedbackBatchIdentity, evaluateGoNoGo, summarizeFeedback } from "./betaFeedback.js";
import { forwardFeedbackToWebhook } from "./betaFeedbackDelivery.js";

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function parseIsoDate(value) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeBatchSummary(batch) {
  const summary = batch?.summary;
  if (summary && typeof summary === "object" && Number.isFinite(summary.total_entries)) {
    return summary;
  }
  return summarizeFeedback(Array.isArray(batch?.entries) ? batch.entries : []);
}

export async function loadArchivedFeedbackBatches(archivePath) {
  const normalizedArchivePath = String(archivePath || "").trim();
  if (!normalizedArchivePath) {
    return {
      enabled: false,
      archive_path: "",
      total_batches: 0,
      total_entries: 0,
      parse_errors: 0,
      batches: []
    };
  }

  let rawText = "";
  try {
    rawText = await fs.readFile(normalizedArchivePath, "utf8");
  } catch (error) {
    return {
      enabled: true,
      archive_path: normalizedArchivePath,
      total_batches: 0,
      total_entries: 0,
      parse_errors: 0,
      batches: [],
      error: String(error)
    };
  }

  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const batches = [];
  let parseErrors = 0;
  let totalEntries = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const entries = Array.isArray(parsed?.entries)
        ? parsed.entries.filter((entry) => entry && typeof entry === "object")
        : [];
      batches.push({
        archived_at_iso: parsed?.archived_at_iso || "",
        batch_id: String(parsed?.batch_id || "").trim(),
        summary: parsed?.summary && typeof parsed.summary === "object" ? parsed.summary : {},
        entries
      });
      totalEntries += entries.length;
    } catch (error) {
      parseErrors += 1;
    }
  }

  return {
    enabled: true,
    archive_path: normalizedArchivePath,
    total_batches: batches.length,
    total_entries: totalEntries,
    parse_errors: parseErrors,
    batches
  };
}

export function selectReplayBatches({ batches = [], maxBatches = 20, fromIso = "" } = {}) {
  const effectiveMaxBatches = parsePositiveInteger(maxBatches, 20);
  const fromDate = parseIsoDate(fromIso);

  let filtered = batches.filter((batch) => batch && typeof batch === "object");
  if (fromDate) {
    filtered = filtered.filter((batch) => {
      const archivedAtDate = parseIsoDate(batch?.archived_at_iso);
      if (!archivedAtDate) return true;
      return archivedAtDate >= fromDate;
    });
  }

  if (filtered.length <= effectiveMaxBatches) return filtered;
  return filtered.slice(-effectiveMaxBatches);
}

export async function replayArchivedFeedbackBatches({
  batches = [],
  targets = [],
  requestId = "",
  dryRun = false,
  nowIso = new Date().toISOString(),
  deliverFn = forwardFeedbackToWebhook
} = {}) {
  const targetConfigs = targets
    .filter((target) => target && typeof target === "object")
    .map((target) => ({
      name: String(target.name || "target"),
      webhookUrl: String(target.webhookUrl || "").trim(),
      webhookSecret: String(target.webhookSecret || "").trim(),
      source: String(target.source || "vaccinact-netlify-beta-feedback-replay"),
      eventName: String(target.eventName || "beta_feedback_replay_batch"),
      maxAttempts: target.maxAttempts,
      retryBaseDelayMs: target.retryBaseDelayMs,
      timeoutMs: target.timeoutMs
    }));

  const targetSummary = {};
  for (const target of targetConfigs) {
    targetSummary[target.name] = {
      enabled: Boolean(target.webhookUrl),
      attempted: 0,
      succeeded: 0,
      failed: 0,
      disabled: target.webhookUrl ? 0 : 1
    };
  }

  const replayedBatches = [];
  let totalEntries = 0;
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const entries = Array.isArray(batch?.entries) ? batch.entries : [];
    const summary = normalizeBatchSummary(batch);
    const batchId = String(batch?.batch_id || "").trim() || buildFeedbackBatchIdentity({ entries, summary });
    const goNoGo = evaluateGoNoGo(summary);
    totalEntries += entries.length;

    const deliveries = [];
    for (const target of targetConfigs) {
      const summaryBucket = targetSummary[target.name];
      if (!target.webhookUrl) {
        deliveries.push({
          target: target.name,
          enabled: false
        });
        continue;
      }

      if (dryRun) {
        deliveries.push({
          target: target.name,
          enabled: true,
          skipped: true
        });
        continue;
      }

      summaryBucket.attempted += 1;
      const delivery = await deliverFn({
        webhookUrl: target.webhookUrl,
        webhookSecret: target.webhookSecret,
        entries,
        summary,
        goNoGo,
        archive: {
          replay: true,
          batch_id: batchId,
          archived_at_iso: batch?.archived_at_iso || ""
        },
        source: target.source,
        eventName: target.eventName,
        batchId,
        idempotencyKey: `vaccinact-beta-feedback:${target.name}:${batchId}`,
        requestId,
        nowIso,
        maxAttempts: target.maxAttempts,
        retryBaseDelayMs: target.retryBaseDelayMs,
        timeoutMs: target.timeoutMs
      });

      if (delivery?.ok) {
        summaryBucket.succeeded += 1;
      } else {
        summaryBucket.failed += 1;
      }

      deliveries.push({
        target: target.name,
        ...delivery
      });
    }

    replayedBatches.push({
      index,
      archived_at_iso: batch?.archived_at_iso || "",
      batch_id: batchId,
      entries_count: entries.length,
      summary,
      go_no_go: goNoGo,
      deliveries
    });
  }

  return {
    dry_run: Boolean(dryRun),
    total_batches: replayedBatches.length,
    total_entries: totalEntries,
    targets: targetSummary,
    batches: replayedBatches
  };
}
