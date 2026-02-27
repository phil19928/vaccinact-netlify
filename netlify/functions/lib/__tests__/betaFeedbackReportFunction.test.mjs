import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { handler } from "../../beta-feedback-report.js";
import { persistFeedbackBatchToPrimaryStore } from "../betaFeedbackPrimaryStore.js";

async function createTempPaths() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vaccinact-beta-report-fn-"));
  return {
    sqlitePath: path.join(directory, "beta-feedback.sqlite"),
    archivePath: path.join(directory, "beta-feedback.ndjson")
  };
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

function daysAgoIso(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(days || 0));
  return date.toISOString();
}

async function writeArchive(archivePath) {
  const now = new Date().toISOString();
  const batch = {
    archived_at_iso: now,
    summary: { total_entries: 1 },
    entries: [
      {
        recorded_at_iso: now,
        site_id: "officine-a",
        utility_score: 4,
        reuse_intent: "yes",
        major_corrections_count: 0,
        submission_metrics: {
          form_completion_seconds: 120,
          form_completed: true,
          quick_history_entries_count: 1,
          required_core_completed: true
        }
      }
    ]
  };
  await fs.writeFile(archivePath, `${JSON.stringify(batch)}\n`, "utf8");
}

test("beta-feedback-report includes dual_pilot_readiness and dual_canary_gate when dual mode is configured", async () => {
  const { sqlitePath, archivePath } = await createTempPaths();
  await writeArchive(archivePath);

  await withEnv(
    {
      BETA_FEEDBACK_ARCHIVE_PATH: archivePath,
      BETA_FEEDBACK_PRIMARY_STORE_MODE: "dual",
      BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH: sqlitePath,
      BETA_FEEDBACK_PRIMARY_STORE_URL: "https://example.test/primary",
      BETA_FEEDBACK_DUAL_PILOT_MIN_EVENTS: "1",
      BETA_FEEDBACK_DUAL_PILOT_MIN_SYNCED_RATE: "1",
      BETA_FEEDBACK_DUAL_PILOT_MAX_DEGRADED_RATE: "0",
      BETA_FEEDBACK_DUAL_PILOT_MAX_DISABLED_RATE: "0",
      BETA_FEEDBACK_DUAL_CANARY_REQUIRED_WINDOWS: "2"
    },
    async () => {
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-current", utility_score: 5, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfr_fn_ready_current",
        nowIso: daysAgoIso(1),
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-previous", utility_score: 4, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfr_fn_ready_previous",
        nowIso: daysAgoIso(4),
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });

      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: {
          dual_window_days: "3",
          dual_canary_required_windows: "2"
        },
        body: null
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 200);
      assert.ok(payload.dual_pilot_readiness);
      assert.equal(payload.dual_pilot_readiness.status, "ready");
      assert.ok(payload.dual_canary_gate);
      assert.equal(payload.dual_canary_gate.status, "ready");
      assert.equal(payload.dual_canary_gate.canary_allowed, true);
      assert.equal(Array.isArray(payload.dual_canary_gate.windows), true);
      assert.equal(payload.dual_canary_gate.windows.length, 2);
    }
  );
});

test("beta-feedback-report marks dual_canary_gate as blocked_insufficient_data when previous window has no events", async () => {
  const { sqlitePath, archivePath } = await createTempPaths();
  await writeArchive(archivePath);

  await withEnv(
    {
      BETA_FEEDBACK_ARCHIVE_PATH: archivePath,
      BETA_FEEDBACK_PRIMARY_STORE_MODE: "dual",
      BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH: sqlitePath,
      BETA_FEEDBACK_PRIMARY_STORE_URL: "https://example.test/primary",
      BETA_FEEDBACK_DUAL_PILOT_MIN_EVENTS: "1",
      BETA_FEEDBACK_DUAL_PILOT_MIN_SYNCED_RATE: "1",
      BETA_FEEDBACK_DUAL_PILOT_MAX_DEGRADED_RATE: "0",
      BETA_FEEDBACK_DUAL_PILOT_MAX_DISABLED_RATE: "0",
      BETA_FEEDBACK_DUAL_CANARY_REQUIRED_WINDOWS: "2"
    },
    async () => {
      await persistFeedbackBatchToPrimaryStore({
        mode: "dual",
        sqlitePath,
        webhookUrl: "https://example.test/primary",
        entries: [{ site_id: "officine-current", utility_score: 5, reuse_intent: "yes" }],
        summary: { total_entries: 1 },
        batchId: "bfr_fn_blocked_current",
        nowIso: daysAgoIso(1),
        forwarder: async () => ({ enabled: true, ok: true, status: 202 })
      });

      const response = await handler({
        httpMethod: "GET",
        queryStringParameters: {
          dual_window_days: "3",
          dual_canary_required_windows: "2"
        },
        body: null
      });
      const payload = JSON.parse(response.body);

      assert.equal(response.statusCode, 200);
      assert.ok(payload.dual_pilot_readiness);
      assert.equal(payload.dual_pilot_readiness.status, "ready");
      assert.ok(payload.dual_canary_gate);
      assert.equal(payload.dual_canary_gate.status, "blocked_insufficient_data");
      assert.equal(payload.dual_canary_gate.canary_allowed, false);
    }
  );
});
