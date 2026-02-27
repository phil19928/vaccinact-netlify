import test from "node:test";
import assert from "node:assert/strict";

import { computeWebhookSignature, forwardFeedbackToWebhook } from "../betaFeedbackDelivery.js";

test("forwardFeedbackToWebhook returns disabled when URL is missing", async () => {
  const result = await forwardFeedbackToWebhook({
    webhookUrl: "",
    entries: [{ utility_score: 4 }],
    summary: { total_entries: 1 }
  });

  assert.equal(result.enabled, false);
});

test("forwardFeedbackToWebhook posts payload with signature headers", async () => {
  const calls = [];
  const nowIso = "2026-02-26T12:00:00.000Z";
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { status: 200, ok: true };
  };

  const result = await forwardFeedbackToWebhook({
    webhookUrl: "https://example.test/webhook",
    webhookSecret: "top-secret",
    entries: [{ utility_score: 5, reuse_intent: "yes" }],
    summary: { total_entries: 1, avg_utility_score: 5 },
    goNoGo: { status: "insufficient_data" },
    archive: { enabled: true, ok: true },
    batchId: "bfb_test_001",
    requestId: "req-123",
    nowIso,
    fetchImpl
  });

  assert.equal(result.enabled, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.attempts.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");

  const body = calls[0].options.body;
  const parsedBody = JSON.parse(body);
  assert.equal(parsedBody.source, "vaccinact-netlify-beta-feedback");
  assert.equal(parsedBody.sent_at_iso, nowIso);
  assert.equal(parsedBody.batch_id, "bfb_test_001");
  assert.equal(parsedBody.go_no_go.status, "insufficient_data");

  const expectedSignature = computeWebhookSignature({
    secret: "top-secret",
    sentAtIso: nowIso,
    payloadJson: body
  });
  assert.equal(calls[0].options.headers["X-VaccinAct-Event"], "beta_feedback_batch");
  assert.equal(calls[0].options.headers["X-VaccinAct-Batch-Id"], "bfb_test_001");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "vaccinact-beta-feedback:bfb_test_001");
  assert.equal(calls[0].options.headers["X-VaccinAct-Signature"], expectedSignature);
  assert.equal(calls[0].options.headers["X-VaccinAct-Request-Id"], "req-123");
});

test("forwardFeedbackToWebhook allows overriding idempotency key", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { status: 200, ok: true };
  };

  const result = await forwardFeedbackToWebhook({
    webhookUrl: "https://example.test/webhook",
    entries: [{ utility_score: 5, reuse_intent: "yes" }],
    summary: { total_entries: 1, avg_utility_score: 5 },
    batchId: "bfb_test_002",
    idempotencyKey: "custom-idempotency-key",
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["X-VaccinAct-Batch-Id"], "bfb_test_002");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "custom-idempotency-key");
});

test("forwardFeedbackToWebhook allows overriding event name", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { status: 200, ok: true };
  };

  const result = await forwardFeedbackToWebhook({
    webhookUrl: "https://example.test/webhook",
    entries: [{ utility_score: 5, reuse_intent: "yes" }],
    summary: { total_entries: 1, avg_utility_score: 5 },
    eventName: "beta_feedback_store_batch",
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["X-VaccinAct-Event"], "beta_feedback_store_batch");
});

test("forwardFeedbackToWebhook retries on retryable status and then succeeds", async () => {
  let callCount = 0;
  const waits = [];
  const fetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) return { status: 503, ok: false };
    return { status: 202, ok: true };
  };

  const result = await forwardFeedbackToWebhook({
    webhookUrl: "https://example.test/webhook",
    entries: [{ utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    maxAttempts: 3,
    retryBaseDelayMs: 50,
    fetchImpl,
    waitImpl: async (delayMs) => {
      waits.push(delayMs);
    }
  });

  assert.equal(callCount, 2);
  assert.equal(result.enabled, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(result.attempts.length, 2);
  assert.equal(waits.length, 1);
  assert.equal(waits[0], 50);
});

test("forwardFeedbackToWebhook does not retry on non-retryable status", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return { status: 400, ok: false };
  };

  const result = await forwardFeedbackToWebhook({
    webhookUrl: "https://example.test/webhook",
    entries: [{ utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    maxAttempts: 4,
    fetchImpl
  });

  assert.equal(callCount, 1);
  assert.equal(result.enabled, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.attempts.length, 1);
});

test("forwardFeedbackToWebhook retries after network error and succeeds", async () => {
  let callCount = 0;
  const waits = [];
  const fetchImpl = async () => {
    callCount += 1;
    if (callCount === 1) throw new Error("temporary network error");
    return { status: 200, ok: true };
  };

  const result = await forwardFeedbackToWebhook({
    webhookUrl: "https://example.test/webhook",
    entries: [{ utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    maxAttempts: 2,
    retryBaseDelayMs: 40,
    fetchImpl,
    waitImpl: async (delayMs) => {
      waits.push(delayMs);
    }
  });

  assert.equal(callCount, 2);
  assert.equal(result.enabled, true);
  assert.equal(result.ok, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].error.includes("temporary network error"), true);
  assert.equal(waits.length, 1);
  assert.equal(waits[0], 40);
});
