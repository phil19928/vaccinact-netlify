import crypto from "node:crypto";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function toTrimmedString(value) {
  return String(value || "").trim();
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
}

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function computeWebhookSignature({ secret, sentAtIso, payloadJson }) {
  const key = toTrimmedString(secret);
  if (!key) return "";
  const message = `${sentAtIso}.${payloadJson}`;
  return crypto.createHmac("sha256", key).update(message).digest("hex");
}

export async function forwardFeedbackToWebhook({
  webhookUrl = "",
  webhookSecret = "",
  entries = [],
  summary = {},
  goNoGo = {},
  archive = {},
  source = "vaccinact-netlify-beta-feedback",
  eventName = "beta_feedback_batch",
  extraPayload = {},
  batchId = "",
  idempotencyKey = "",
  requestId = "",
  nowIso = new Date().toISOString(),
  maxAttempts = 3,
  retryBaseDelayMs = 300,
  timeoutMs = 5000,
  fetchImpl = globalThis.fetch,
  waitImpl = wait
} = {}) {
  const normalizedUrl = toTrimmedString(webhookUrl);
  if (!normalizedUrl) {
    return {
      enabled: false
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      enabled: true,
      ok: false,
      error: "Fetch API is not available in this runtime."
    };
  }

  const sentAtIso = toTrimmedString(nowIso) || new Date().toISOString();
  const normalizedBatchId = toTrimmedString(batchId);
  const normalizedIdempotencyKey =
    toTrimmedString(idempotencyKey) ||
    (normalizedBatchId ? `vaccinact-beta-feedback:${normalizedBatchId}` : "");
  const payload = {
    source,
    sent_at_iso: sentAtIso,
    ...(normalizedBatchId ? { batch_id: normalizedBatchId } : {}),
    summary,
    go_no_go: goNoGo,
    archive,
    entries,
    ...((extraPayload && typeof extraPayload === "object") ? extraPayload : {})
  };
  const payloadJson = JSON.stringify(payload);
  const signature = computeWebhookSignature({
    secret: webhookSecret,
    sentAtIso,
    payloadJson
  });

  const effectiveAttempts = parsePositiveInteger(maxAttempts, 3);
  const effectiveRetryBaseDelayMs = parsePositiveInteger(retryBaseDelayMs, 300);
  const effectiveTimeoutMs = parsePositiveInteger(timeoutMs, 5000);
  const attempts = [];

  for (let attempt = 1; attempt <= effectiveAttempts; attempt += 1) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutHandle = setTimeout(() => {
      if (controller) controller.abort();
    }, effectiveTimeoutMs);

    try {
      const response = await fetchImpl(normalizedUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-VaccinAct-Event": toTrimmedString(eventName) || "beta_feedback_batch",
          "X-VaccinAct-Sent-At": sentAtIso,
          ...(normalizedBatchId ? { "X-VaccinAct-Batch-Id": normalizedBatchId } : {}),
          ...(normalizedIdempotencyKey ? { "Idempotency-Key": normalizedIdempotencyKey } : {}),
          ...(requestId ? { "X-VaccinAct-Request-Id": requestId } : {}),
          ...(signature
            ? {
                "X-VaccinAct-Signature-Alg": "hmac-sha256",
                "X-VaccinAct-Signature": signature
              }
            : {})
        },
        body: payloadJson,
        ...(controller ? { signal: controller.signal } : {})
      });

      clearTimeout(timeoutHandle);
      attempts.push({
        attempt,
        status: response.status,
        ok: response.ok
      });

      if (response.ok) {
        return {
          enabled: true,
          ok: true,
          status: response.status,
          attempts
        };
      }

      if (!shouldRetryStatus(response.status) || attempt >= effectiveAttempts) {
        return {
          enabled: true,
          ok: false,
          status: response.status,
          attempts
        };
      }
    } catch (error) {
      clearTimeout(timeoutHandle);
      attempts.push({
        attempt,
        ok: false,
        error: String(error)
      });

      if (attempt >= effectiveAttempts) {
        return {
          enabled: true,
          ok: false,
          attempts,
          error: String(error)
        };
      }
    }

    const delayMs = effectiveRetryBaseDelayMs * 2 ** (attempt - 1);
    await waitImpl(delayMs);
  }

  return {
    enabled: true,
    ok: false,
    attempts,
    error: "Unexpected webhook delivery termination."
  };
}
