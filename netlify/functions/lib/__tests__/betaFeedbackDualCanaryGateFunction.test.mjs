import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { handler } from "../../beta-feedback-dual-canary-gate.js";
import { persistFeedbackBatchToPrimaryStore } from "../betaFeedbackPrimaryStore.js";

async function createTempSqlitePath() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vaccinact-dual-canary-"));
  return path.join(directory, "beta-feedback.sqlite");
}

function withEnv(patch, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("beta-feedback-dual-canary-gate returns 400 when primary mode is not dual", async () => {
  await withEnv(
    {
      BETA_FEEDBACK_PRIMARY_STORE_MODE: "http",
      BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH: "",
      BETA_FEEDBACK_PRIMARY_STORE_URL: ""
    },
    async () => {
      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: {},
        body: null
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 400);
      assert.ok(payload.error.includes("not dual"));
    }
  );
});

test("beta-feedback-dual-canary-gate returns ready when two consecutive windows are ready", async () => {
  const sqlitePath = await createTempSqlitePath();
  await withEnv(
    {
      BETA_FEEDBACK_PRIMARY_STORE_MODE: "dual",
      BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH: sqlitePath,
      BETA_FEEDBACK_PRIMARY_STORE_URL: "https://example.test/primary"
    },
    async () => {
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-prev", utility_score: 5, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfc_ready_prev",
        nowIso: "2026-02-22T09:00:00.000Z",
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-current", utility_score: 4, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfc_ready_current",
        nowIso: "2026-02-24T09:00:00.000Z",
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });

      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: {
          now_iso: "2026-02-26T12:00:00.000Z",
          window_days: "3",
          required_windows: "2",
          min_events: "1",
          min_synced_rate: "1",
          max_degraded_rate: "0",
          max_disabled_rate: "0"
        },
        body: null
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 200);
      assert.equal(payload.gate.status, "ready");
      assert.equal(payload.gate.canary_allowed, true);
      assert.equal(payload.windows.length, 2);
      assert.equal(payload.windows[0].readiness.status, "ready");
      assert.equal(payload.windows[1].readiness.status, "ready");
    }
  );
});

test("beta-feedback-dual-canary-gate returns 503 when fail_on_blocked is enabled and one window is not ready", async () => {
  const sqlitePath = await createTempSqlitePath();
  await withEnv(
    {
      BETA_FEEDBACK_PRIMARY_STORE_MODE: "dual",
      BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH: sqlitePath,
      BETA_FEEDBACK_PRIMARY_STORE_URL: "https://example.test/primary"
    },
    async () => {
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-prev", utility_score: 5, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfc_blocked_prev",
        nowIso: "2026-02-22T09:00:00.000Z",
        forwarder: async () => ({ enabled: true, ok: false, status: 503, error: "Service Unavailable" })
      });
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-current", utility_score: 4, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfc_blocked_current",
        nowIso: "2026-02-24T09:00:00.000Z",
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });

      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: {
          now_iso: "2026-02-26T12:00:00.000Z",
          window_days: "3",
          required_windows: "2",
          min_events: "1",
          min_synced_rate: "1",
          max_degraded_rate: "0",
          max_disabled_rate: "0",
          fail_on_blocked: "1"
        },
        body: null
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 503);
      assert.equal(payload.gate.status, "blocked_not_ready");
      assert.equal(payload.gate.canary_allowed, false);
    }
  );
});
