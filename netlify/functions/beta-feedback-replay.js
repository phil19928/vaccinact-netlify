import {
  loadArchivedFeedbackBatches,
  replayArchivedFeedbackBatches,
  selectReplayBatches
} from "./lib/betaFeedbackReplay.js";

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "oui"].includes(normalized)) return true;
  if (["0", "false", "no", "non"].includes(normalized)) return false;
  return defaultValue;
}

function normalizeTarget(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "primary_store" || normalized === "webhook" || normalized === "both") {
    return normalized;
  }
  return "primary_store";
}

function buildReplayTargets(target, env) {
  const targets = [];
  if (target === "primary_store" || target === "both") {
    targets.push({
      name: "primary_store",
      webhookUrl: env.BETA_FEEDBACK_PRIMARY_STORE_URL,
      webhookSecret: env.BETA_FEEDBACK_PRIMARY_STORE_SECRET,
      source: "vaccinact-netlify-beta-feedback-replay-primary",
      eventName: "beta_feedback_replay_store_batch",
      maxAttempts: env.BETA_FEEDBACK_PRIMARY_STORE_MAX_ATTEMPTS,
      retryBaseDelayMs: env.BETA_FEEDBACK_PRIMARY_STORE_RETRY_BASE_DELAY_MS,
      timeoutMs: env.BETA_FEEDBACK_PRIMARY_STORE_TIMEOUT_MS
    });
  }
  if (target === "webhook" || target === "both") {
    targets.push({
      name: "webhook",
      webhookUrl: env.BETA_FEEDBACK_WEBHOOK_URL,
      webhookSecret: env.BETA_FEEDBACK_WEBHOOK_SECRET,
      source: "vaccinact-netlify-beta-feedback-replay-webhook",
      eventName: "beta_feedback_replay_webhook_batch",
      maxAttempts: env.BETA_FEEDBACK_WEBHOOK_MAX_ATTEMPTS,
      retryBaseDelayMs: env.BETA_FEEDBACK_WEBHOOK_RETRY_BASE_DELAY_MS,
      timeoutMs: env.BETA_FEEDBACK_WEBHOOK_TIMEOUT_MS
    });
  }
  return targets;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const query = event.queryStringParameters || {};

    const target = normalizeTarget(body.target ?? query.target);
    const maxBatches = body.max_batches ?? query.max_batches ?? 20;
    const fromIso = body.from_iso ?? query.from_iso ?? "";
    const dryRun = parseBoolean(body.dry_run ?? query.dry_run, false);

    const archive = await loadArchivedFeedbackBatches(process.env.BETA_FEEDBACK_ARCHIVE_PATH);
    if (!archive.enabled || archive.error) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Archive not available.",
          archive
        })
      };
    }

    const selectedBatches = selectReplayBatches({
      batches: archive.batches,
      maxBatches,
      fromIso
    });
    const requestId =
      event?.headers?.["x-nf-request-id"] ||
      event?.headers?.["X-Nf-Request-Id"] ||
      event?.headers?.["x-request-id"] ||
      event?.headers?.["X-Request-Id"] ||
      "";

    const replay = await replayArchivedFeedbackBatches({
      batches: selectedBatches,
      targets: buildReplayTargets(target, process.env),
      requestId,
      dryRun
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replay_request: {
          target,
          max_batches: Number(maxBatches) || 20,
          from_iso: fromIso || "",
          dry_run: dryRun
        },
        archive: {
          archive_path: archive.archive_path,
          total_batches: archive.total_batches,
          total_entries: archive.total_entries,
          parse_errors: archive.parse_errors
        },
        selected_batches: selectedBatches.length,
        replay
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
