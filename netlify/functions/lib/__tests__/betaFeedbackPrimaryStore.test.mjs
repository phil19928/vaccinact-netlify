import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  inspectPrimaryStore,
  persistFeedbackBatchToPrimaryStore
} from "../betaFeedbackPrimaryStore.js";

async function createTempSqlitePath() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vaccinact-primary-store-"));
  return path.join(directory, "beta-feedback.sqlite");
}

test("persistFeedbackBatchToPrimaryStore stores batch transactionally in sqlite mode", async () => {
  const sqlitePath = await createTempSqlitePath();

  const result = await persistFeedbackBatchToPrimaryStore({
    mode: "sqlite",
    sqlitePath,
    entries: [
      {
        site_id: "officine-a",
        utility_score: 4,
        reuse_intent: "yes",
        major_corrections_count: 0,
        submission_metrics: { form_completion_seconds: 120, form_completed: true }
      },
      {
        site_id: "officine-b",
        utility_score: 5,
        reuse_intent: "yes",
        major_corrections_count: 0,
        submission_metrics: { form_completion_seconds: 140, form_completed: true }
      }
    ],
    summary: { total_entries: 2, avg_utility_score: 4.5 },
    goNoGo: { status: "insufficient_data" },
    archive: { enabled: true, ok: true },
    batchId: "bfb_sqlite_001",
    requestId: "req-1",
    nowIso: "2026-02-26T12:00:00.000Z"
  });

  assert.equal(result.enabled, true);
  assert.equal(result.mode, "sqlite");
  assert.equal(result.ok, true);
  assert.equal(result.inserted_batch, true);
  assert.equal(result.inserted_entries, 2);

  const database = new DatabaseSync(sqlitePath);
  const batchCount = database.prepare("SELECT COUNT(*) AS count FROM feedback_batches").get();
  const entryCount = database.prepare("SELECT COUNT(*) AS count FROM feedback_entries").get();
  database.close();

  assert.equal(batchCount.count, 1);
  assert.equal(entryCount.count, 2);
});

test("persistFeedbackBatchToPrimaryStore is idempotent for duplicate batch_id in sqlite mode", async () => {
  const sqlitePath = await createTempSqlitePath();
  const payload = {
    mode: "sqlite",
    sqlitePath,
    entries: [
      {
        site_id: "officine-a",
        utility_score: 4,
        reuse_intent: "yes",
        major_corrections_count: 0,
        submission_metrics: { form_completion_seconds: 120, form_completed: true }
      }
    ],
    summary: { total_entries: 1, avg_utility_score: 4 },
    goNoGo: { status: "insufficient_data" },
    archive: { enabled: true, ok: true },
    batchId: "bfb_sqlite_002",
    requestId: "req-2",
    nowIso: "2026-02-26T12:00:00.000Z"
  };

  const first = await persistFeedbackBatchToPrimaryStore(payload);
  const second = await persistFeedbackBatchToPrimaryStore(payload);

  assert.equal(first.ok, true);
  assert.equal(first.inserted_batch, true);
  assert.equal(first.inserted_entries, 1);
  assert.equal(second.ok, true);
  assert.equal(second.inserted_batch, false);
  assert.equal(second.duplicate_batch, true);
  assert.equal(second.inserted_entries, 0);

  const database = new DatabaseSync(sqlitePath);
  const batchCount = database.prepare("SELECT COUNT(*) AS count FROM feedback_batches").get();
  const entryCount = database.prepare("SELECT COUNT(*) AS count FROM feedback_entries").get();
  database.close();

  assert.equal(batchCount.count, 1);
  assert.equal(entryCount.count, 1);
});

test("persistFeedbackBatchToPrimaryStore delegates to HTTP forwarder in http mode", async () => {
  let called = false;
  const result = await persistFeedbackBatchToPrimaryStore({
    mode: "http",
    webhookUrl: "https://example.test/primary",
    entries: [{ utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_http_001",
    forwarder: async () => {
      called = true;
      return { enabled: true, ok: true, status: 202 };
    }
  });

  assert.equal(called, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
});

test("persistFeedbackBatchToPrimaryStore applies sqlite retention_max_batches", async () => {
  const sqlitePath = await createTempSqlitePath();

  await persistFeedbackBatchToPrimaryStore({
    mode: "sqlite",
    sqlitePath,
    entries: [{ site_id: "officine-a", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_retention_001",
    nowIso: "2026-02-26T08:00:00.000Z",
    retentionMaxBatches: 2
  });
  await persistFeedbackBatchToPrimaryStore({
    mode: "sqlite",
    sqlitePath,
    entries: [{ site_id: "officine-b", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_retention_002",
    nowIso: "2026-02-26T09:00:00.000Z",
    retentionMaxBatches: 2
  });
  const third = await persistFeedbackBatchToPrimaryStore({
    mode: "sqlite",
    sqlitePath,
    entries: [{ site_id: "officine-c", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_retention_003",
    nowIso: "2026-02-26T10:00:00.000Z",
    retentionMaxBatches: 2
  });

  assert.equal(third.ok, true);
  assert.equal(third.retention.enabled, true);
  assert.equal(third.retention.retention_max_batches, 2);
  assert.equal(third.retention.pruned_total, 1);

  const database = new DatabaseSync(sqlitePath);
  const batchIds = database
    .prepare("SELECT batch_id FROM feedback_batches ORDER BY stored_at_iso ASC")
    .all()
    .map((row) => row.batch_id);
  database.close();

  assert.deepEqual(batchIds, ["bfb_retention_002", "bfb_retention_003"]);
});

test("persistFeedbackBatchToPrimaryStore creates and rotates sqlite backups", async () => {
  const sqlitePath = await createTempSqlitePath();
  const backupDirectoryPath = path.join(path.dirname(sqlitePath), "backups");

  const first = await persistFeedbackBatchToPrimaryStore({
    mode: "sqlite",
    sqlitePath,
    entries: [{ site_id: "officine-a", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_backup_001",
    nowIso: "2026-02-26T11:00:00.000Z",
    backupDirectoryPath,
    backupMaxFiles: 1
  });
  const second = await persistFeedbackBatchToPrimaryStore({
    mode: "sqlite",
    sqlitePath,
    entries: [{ site_id: "officine-b", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_backup_002",
    nowIso: "2026-02-26T12:00:00.000Z",
    backupDirectoryPath,
    backupMaxFiles: 1
  });

  assert.equal(first.backup.enabled, true);
  assert.equal(first.backup.ok, true);
  assert.equal(second.backup.enabled, true);
  assert.equal(second.backup.ok, true);
  assert.equal(second.backup.backup_max_files, 1);
  assert.equal(second.backup.removed_files, 1);

  const backupFiles = (await fs.readdir(backupDirectoryPath)).filter((name) => name.endsWith(".sqlite"));
  assert.equal(backupFiles.length, 1);
});

test("inspectPrimaryStore returns sqlite health snapshot", async () => {
  const sqlitePath = await createTempSqlitePath();

  await persistFeedbackBatchToPrimaryStore({
    mode: "sqlite",
    sqlitePath,
    entries: [{ site_id: "officine-a", utility_score: 5, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_inspect_001",
    nowIso: "2026-02-26T13:00:00.000Z"
  });

  const inspected = await inspectPrimaryStore({
    mode: "sqlite",
    sqlitePath
  });

  assert.equal(inspected.ok, true);
  assert.equal(inspected.mode, "sqlite");
  assert.equal(inspected.health.total_batches, 1);
  assert.equal(inspected.health.total_entries, 1);
  assert.equal(typeof inspected.health.database_size_bytes, "number");
});

test("persistFeedbackBatchToPrimaryStore supports dual mode with synced replication", async () => {
  const sqlitePath = await createTempSqlitePath();
  let forwarderCalls = 0;

  const result = await persistFeedbackBatchToPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    entries: [{ site_id: "officine-a", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_dual_001",
    nowIso: "2026-02-26T14:00:00.000Z",
    forwarder: async () => {
      forwarderCalls += 1;
      return { enabled: true, ok: true, status: 202 };
    }
  });

  assert.equal(forwarderCalls, 1);
  assert.equal(result.mode, "dual");
  assert.equal(result.ok, true);
  assert.equal(result.replication_status, "synced");
  assert.equal(result.primary.ok, true);
  assert.equal(result.replica_http.ok, true);
  assert.equal(result.replication_event.ok, true);

  const database = new DatabaseSync(sqlitePath);
  const batchCount = database.prepare("SELECT COUNT(*) AS count FROM feedback_batches").get();
  const replicationEvents = database
    .prepare("SELECT COUNT(*) AS count FROM feedback_replication_events")
    .get();
  database.close();

  assert.equal(batchCount.count, 1);
  assert.equal(replicationEvents.count, 1);
});

test("persistFeedbackBatchToPrimaryStore dual mode is degraded but keeps primary success when strict mode is off", async () => {
  const sqlitePath = await createTempSqlitePath();
  const result = await persistFeedbackBatchToPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    entries: [{ site_id: "officine-a", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_dual_002",
    nowIso: "2026-02-26T15:00:00.000Z",
    forwarder: async () => ({ enabled: true, ok: false, status: 503, error: "Service Unavailable" })
  });

  assert.equal(result.mode, "dual");
  assert.equal(result.strict_replication, false);
  assert.equal(result.replication_status, "degraded");
  assert.equal(result.primary.ok, true);
  assert.equal(result.replica_http.ok, false);
  assert.equal(result.ok, true);
  assert.equal(result.replication_event.ok, true);
});

test("persistFeedbackBatchToPrimaryStore dual mode fails when strict replication is enabled and HTTP replication fails", async () => {
  const sqlitePath = await createTempSqlitePath();
  const result = await persistFeedbackBatchToPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    entries: [{ site_id: "officine-a", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_dual_003",
    nowIso: "2026-02-26T16:00:00.000Z",
    dualWriteStrict: true,
    forwarder: async () => ({ enabled: true, ok: false, status: 500, error: "Internal Error" })
  });

  assert.equal(result.mode, "dual");
  assert.equal(result.strict_replication, true);
  assert.equal(result.replication_status, "degraded");
  assert.equal(result.primary.ok, true);
  assert.equal(result.replica_http.ok, false);
  assert.equal(result.ok, false);
  assert.equal(result.replication_event.ok, true);
});

test("inspectPrimaryStore returns dual mode health with replica metadata", async () => {
  const sqlitePath = await createTempSqlitePath();

  await persistFeedbackBatchToPrimaryStore({
    mode: "sqlite",
    sqlitePath,
    entries: [{ site_id: "officine-a", utility_score: 5, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_inspect_dual_001",
    nowIso: "2026-02-26T17:00:00.000Z"
  });

  const inspected = await inspectPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary"
  });

  assert.equal(inspected.ok, true);
  assert.equal(inspected.mode, "dual");
  assert.equal(inspected.health.total_batches, 1);
  assert.equal(inspected.replica_http.enabled, true);
  assert.equal(inspected.dual_replication.total_events, 0);
  assert.equal(inspected.dual_replication.window_days, 7);
});

test("inspectPrimaryStore dual mode returns replication snapshot after dual writes", async () => {
  const sqlitePath = await createTempSqlitePath();

  await persistFeedbackBatchToPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    entries: [{ site_id: "officine-a", utility_score: 5, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_inspect_dual_replication_001",
    nowIso: "2026-02-26T18:00:00.000Z",
    forwarder: async () => ({ enabled: true, ok: true, status: 202 })
  });
  await persistFeedbackBatchToPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    entries: [{ site_id: "officine-b", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_inspect_dual_replication_002",
    nowIso: "2026-02-26T19:00:00.000Z",
    forwarder: async () => ({ enabled: true, ok: false, status: 503, error: "Service Unavailable" })
  });

  const inspected = await inspectPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    dualWindowDays: 7,
    nowIso: "2026-02-27T00:00:00.000Z"
  });

  assert.equal(inspected.ok, true);
  assert.equal(inspected.mode, "dual");
  assert.equal(inspected.dual_replication.total_events, 2);
  assert.equal(inspected.dual_replication.synced_events, 1);
  assert.equal(inspected.dual_replication.degraded_events, 1);
  assert.equal(inspected.dual_replication.synced_rate, 0.5);
  assert.equal(inspected.dual_replication.degraded_rate, 0.5);
});

test("inspectPrimaryStore dual snapshot applies upper bound at now_iso", async () => {
  const sqlitePath = await createTempSqlitePath();

  await persistFeedbackBatchToPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    entries: [{ site_id: "officine-a", utility_score: 5, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_inspect_dual_bound_001",
    nowIso: "2026-02-23T10:00:00.000Z",
    forwarder: async () => ({ enabled: true, ok: true, status: 202 })
  });
  await persistFeedbackBatchToPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    entries: [{ site_id: "officine-b", utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1 },
    batchId: "bfb_inspect_dual_bound_002",
    nowIso: "2026-02-26T10:00:00.000Z",
    forwarder: async () => ({ enabled: true, ok: true, status: 202 })
  });

  const inspectedOldWindow = await inspectPrimaryStore({
    mode: "dual",
    sqlitePath,
    webhookUrl: "https://example.test/primary",
    dualWindowDays: 3,
    nowIso: "2026-02-24T00:00:00.000Z"
  });

  assert.equal(inspectedOldWindow.ok, true);
  assert.equal(inspectedOldWindow.dual_replication.total_events, 1);
  assert.equal(inspectedOldWindow.dual_replication.synced_events, 1);
  assert.equal(inspectedOldWindow.dual_replication.last_event_at_iso, "2026-02-23T10:00:00.000Z");
});
