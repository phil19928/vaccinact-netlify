import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { handler } from "../../beta-feedback-dual-readiness.js";
import { persistFeedbackBatchToPrimaryStore } from "../betaFeedbackPrimaryStore.js";

async function createTempSqlitePath() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vaccinact-dual-readiness-"));
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

test("beta-feedback-dual-readiness returns 400 when primary mode is not dual", async () => {
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

test("beta-feedback-dual-readiness returns ready when dual snapshot meets thresholds", async () => {
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
        entries: [{ site_id: "officine-a", utility_score: 5, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfr_ready_001",
        nowIso: "2026-02-26T10:00:00.000Z",
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-b", utility_score: 4, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfr_ready_002",
        nowIso: "2026-02-26T11:00:00.000Z",
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });

      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: {
          min_events: "2",
          min_synced_rate: "0.9",
          max_degraded_rate: "0.1",
          max_disabled_rate: "0",
          now_iso: "2026-02-26T12:00:00.000Z"
        },
        body: null
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 200);
      assert.equal(payload.readiness.status, "ready");
      assert.equal(payload.readiness.ready, true);
    }
  );
});

test("beta-feedback-dual-readiness returns 503 when fail_on_not_ready is enabled", async () => {
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
        entries: [{ site_id: "officine-a", utility_score: 5, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfr_not_ready_001",
        nowIso: "2026-02-26T10:00:00.000Z",
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-b", utility_score: 4, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfr_not_ready_002",
        nowIso: "2026-02-26T11:00:00.000Z",
        forwarder: async () => ({ enabled: true, ok: false, status: 503, error: "Service Unavailable" })
      });

      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: {
          min_events: "2",
          min_synced_rate: "1.0",
          max_degraded_rate: "0",
          max_disabled_rate: "0",
          fail_on_not_ready: "1",
          now_iso: "2026-02-26T12:00:00.000Z"
        },
        body: null
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 503);
      assert.equal(payload.readiness.status, "not_ready");
      assert.equal(payload.readiness.ready, false);
    }
  );
});
