import fs from "node:fs/promises";
import path from "node:path";

import { forwardFeedbackToWebhook } from "./betaFeedbackDelivery.js";

let cachedDatabaseSyncCtor;

async function getDatabaseSyncCtor() {
  if (cachedDatabaseSyncCtor !== undefined) return cachedDatabaseSyncCtor;
  try {
    const sqliteModule = await import("node:sqlite");
    cachedDatabaseSyncCtor = sqliteModule?.DatabaseSync || null;
  } catch {
    cachedDatabaseSyncCtor = null;
  }
  return cachedDatabaseSyncCtor;
}

function toTrimmedString(value) {
  return String(value || "").trim();
}

function toNullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableBooleanAsInt(value) {
  if (typeof value !== "boolean") return null;
  return value ? 1 : 0;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "oui"].includes(normalized)) return true;
  if (["0", "false", "no", "non"].includes(normalized)) return false;
  return defaultValue;
}

function parseIsoDate(value) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCompactUtcTimestamp(value) {
  const parsedDate = parseIsoDate(value) || new Date();
  return parsedDate.toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "Z");
}

function escapeSqliteString(value) {
  return String(value || "").replaceAll("'", "''");
}

async function ensureParentDirectory(filePath) {
  const directoryPath = path.dirname(filePath);
  await fs.mkdir(directoryPath, { recursive: true });
}

function initializeSqliteSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS feedback_batches (
      batch_id TEXT PRIMARY KEY,
      stored_at_iso TEXT NOT NULL,
      source TEXT NOT NULL,
      request_id TEXT,
      summary_json TEXT NOT NULL,
      go_no_go_json TEXT NOT NULL,
      archive_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      entry_index INTEGER NOT NULL,
      entry_json TEXT NOT NULL,
      site_id TEXT,
      utility_score REAL,
      reuse_intent TEXT,
      major_corrections_count INTEGER,
      form_completion_seconds REAL,
      form_completed INTEGER,
      stored_at_iso TEXT NOT NULL,
      UNIQUE(batch_id, entry_index),
      FOREIGN KEY(batch_id) REFERENCES feedback_batches(batch_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_entries_batch_id
      ON feedback_entries(batch_id);

    CREATE TABLE IF NOT EXISTS feedback_replication_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      event_at_iso TEXT NOT NULL,
      mode TEXT NOT NULL,
      replication_status TEXT NOT NULL,
      strict_replication INTEGER,
      primary_ok INTEGER,
      replica_http_enabled INTEGER,
      replica_http_ok INTEGER,
      replica_http_status INTEGER,
      replica_http_error TEXT,
      request_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_replication_events_event_at
      ON feedback_replication_events(event_at_iso DESC);

    CREATE INDEX IF NOT EXISTS idx_feedback_replication_events_batch_id
      ON feedback_replication_events(batch_id);
  `);
}

function collectSqliteCounts(database) {
  const batches = database
    .prepare(
      `
        SELECT
          COUNT(*) AS total_batches,
          MIN(stored_at_iso) AS first_stored_at_iso,
          MAX(stored_at_iso) AS last_stored_at_iso
        FROM feedback_batches
      `
    )
    .get();
  const entries = database.prepare("SELECT COUNT(*) AS total_entries FROM feedback_entries").get();
  return {
    total_batches: Number(batches?.total_batches || 0),
    total_entries: Number(entries?.total_entries || 0),
    first_stored_at_iso: batches?.first_stored_at_iso || null,
    last_stored_at_iso: batches?.last_stored_at_iso || null
  };
}

function buildWindowStartIso({ nowIso, windowDays, fallbackWindowDays = 7 }) {
  const parsedWindowDays = parsePositiveInteger(windowDays) || fallbackWindowDays;
  const nowDate = parseIsoDate(nowIso) || new Date();
  const windowStartDate = new Date(nowDate.getTime() - parsedWindowDays * 24 * 60 * 60 * 1000);
  return {
    window_days: parsedWindowDays,
    window_start_iso: windowStartDate.toISOString(),
    now_iso: nowDate.toISOString()
  };
}

function collectDualReplicationSnapshot({ database, nowIso, windowDays = 7 }) {
  const window = buildWindowStartIso({
    nowIso,
    windowDays,
    fallbackWindowDays: 7
  });
  const aggregated = database
    .prepare(
      `
        SELECT
          COUNT(*) AS total_events,
          SUM(CASE WHEN replication_status = 'synced' THEN 1 ELSE 0 END) AS synced_events,
          SUM(CASE WHEN replication_status = 'degraded' THEN 1 ELSE 0 END) AS degraded_events,
          SUM(CASE WHEN replication_status = 'disabled' THEN 1 ELSE 0 END) AS disabled_events,
          SUM(CASE WHEN strict_replication = 1 THEN 1 ELSE 0 END) AS strict_events,
          MAX(event_at_iso) AS last_event_at_iso
        FROM feedback_replication_events
        WHERE event_at_iso >= ?
          AND event_at_iso <= ?
      `
    )
    .get(window.window_start_iso, window.now_iso);

  const totalEvents = Number(aggregated?.total_events || 0);
  const syncedEvents = Number(aggregated?.synced_events || 0);
  const degradedEvents = Number(aggregated?.degraded_events || 0);
  const disabledEvents = Number(aggregated?.disabled_events || 0);
  const strictEvents = Number(aggregated?.strict_events || 0);
  const safeRate = (value) => (totalEvents > 0 ? Number(value) / totalEvents : 0);

  const lastDegradedEvent = database
    .prepare(
      `
        SELECT
          batch_id,
          event_at_iso,
          replica_http_status,
          replica_http_error
        FROM feedback_replication_events
        WHERE event_at_iso >= ?
          AND event_at_iso <= ?
          AND replication_status = 'degraded'
        ORDER BY event_at_iso DESC
        LIMIT 1
      `
    )
    .get(window.window_start_iso, window.now_iso);

  return {
    ...window,
    total_events: totalEvents,
    synced_events: syncedEvents,
    degraded_events: degradedEvents,
    disabled_events: disabledEvents,
    strict_events: strictEvents,
    synced_rate: safeRate(syncedEvents),
    degraded_rate: safeRate(degradedEvents),
    disabled_rate: safeRate(disabledEvents),
    last_event_at_iso: aggregated?.last_event_at_iso || null,
    last_degraded_event: lastDegradedEvent
      ? {
          batch_id: lastDegradedEvent.batch_id,
          event_at_iso: lastDegradedEvent.event_at_iso,
          replica_http_status: lastDegradedEvent.replica_http_status,
          replica_http_error: lastDegradedEvent.replica_http_error
        }
      : null
  };
}

async function appendDualReplicationEventToSqlite({
  sqlitePath = "",
  batchId = "",
  nowIso = new Date().toISOString(),
  requestId = "",
  replicationStatus = "degraded",
  strictReplication = false,
  primaryOk = false,
  replicaHttp = {}
} = {}) {
  const normalizedPath = toTrimmedString(sqlitePath);
  if (!normalizedPath) {
    return {
      enabled: false,
      error: "Missing sqlite path for dual replication event logging."
    };
  }
  const DatabaseSync = await getDatabaseSyncCtor();
  if (!DatabaseSync) {
    return {
      enabled: true,
      ok: false,
      path: normalizedPath,
      error: "SQLite runtime unavailable (node:sqlite not supported in this environment)."
    };
  }

  let database;
  try {
    await ensureParentDirectory(normalizedPath);
    database = new DatabaseSync(normalizedPath);
    initializeSqliteSchema(database);

    const eventAtIso = toTrimmedString(nowIso) || new Date().toISOString();
    const normalizedReplicationStatus = toTrimmedString(replicationStatus) || "degraded";
    const replicaEnabled = Boolean(replicaHttp?.enabled);
    const replicaOk = Boolean(replicaHttp?.enabled && replicaHttp?.ok);
    const replicaStatusCode = toNullableNumber(replicaHttp?.status);
    const replicaError = toTrimmedString(replicaHttp?.error) || null;

    database
      .prepare(
        `
          INSERT INTO feedback_replication_events (
            batch_id,
            event_at_iso,
            mode,
            replication_status,
            strict_replication,
            primary_ok,
            replica_http_enabled,
            replica_http_ok,
            replica_http_status,
            replica_http_error,
            request_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        toTrimmedString(batchId) || "unknown_batch",
        eventAtIso,
        "dual",
        normalizedReplicationStatus,
        toNullableBooleanAsInt(Boolean(strictReplication)),
        toNullableBooleanAsInt(Boolean(primaryOk)),
        toNullableBooleanAsInt(replicaEnabled),
        toNullableBooleanAsInt(replicaOk),
        replicaStatusCode,
        replicaError,
        toTrimmedString(requestId) || null
      );

    database.close();
    return {
      enabled: true,
      ok: true,
      path: normalizedPath,
      batch_id: toTrimmedString(batchId) || "unknown_batch",
      replication_status: normalizedReplicationStatus
    };
  } catch (error) {
    if (database) {
      try {
        database.close();
      } catch {
        // ignore close errors
      }
    }
    return {
      enabled: true,
      ok: false,
      path: normalizedPath,
      error: String(error)
    };
  }
}

function applySqliteRetention({ database, retentionDays, retentionMaxBatches, nowIso }) {
  const parsedRetentionDays = parsePositiveInteger(retentionDays);
  const parsedRetentionMaxBatches = parsePositiveInteger(retentionMaxBatches);
  if (!parsedRetentionDays && !parsedRetentionMaxBatches) {
    return { enabled: false };
  }

  const nowDate = parseIsoDate(nowIso) || new Date();
  let prunedByDays = 0;
  let prunedByCount = 0;
  let cutoffIso = null;

  if (parsedRetentionDays) {
    const cutoffDate = new Date(nowDate.getTime() - parsedRetentionDays * 24 * 60 * 60 * 1000);
    cutoffIso = cutoffDate.toISOString();
    const deleteByDaysResult = database
      .prepare(
        `
          DELETE FROM feedback_batches
          WHERE batch_id IN (
            SELECT batch_id
            FROM feedback_batches
            WHERE stored_at_iso < ?
          )
        `
      )
      .run(cutoffIso);
    prunedByDays = Number(deleteByDaysResult?.changes || 0);
  }

  if (parsedRetentionMaxBatches) {
    const deleteByCountResult = database
      .prepare(
        `
          DELETE FROM feedback_batches
          WHERE batch_id IN (
            SELECT batch_id
            FROM feedback_batches
            ORDER BY stored_at_iso DESC, batch_id DESC
            LIMIT -1 OFFSET ?
          )
        `
      )
      .run(parsedRetentionMaxBatches);
    prunedByCount = Number(deleteByCountResult?.changes || 0);
  }

  return {
    enabled: true,
    ok: true,
    retention_days: parsedRetentionDays,
    retention_max_batches: parsedRetentionMaxBatches,
    cutoff_iso: cutoffIso,
    pruned_by_days: prunedByDays,
    pruned_by_max_batches: prunedByCount,
    pruned_total: prunedByDays + prunedByCount
  };
}

async function rotateBackupFiles({ backupDirectoryPath, backupMaxFiles }) {
  const parsedBackupMaxFiles = parsePositiveInteger(backupMaxFiles);
  if (!parsedBackupMaxFiles) {
    return {
      backup_max_files: null,
      removed_files: 0
    };
  }

  const directoryEntries = await fs.readdir(backupDirectoryPath, { withFileTypes: true });
  const sqliteFiles = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => entry.name)
    .sort();

  if (sqliteFiles.length <= parsedBackupMaxFiles) {
    return {
      backup_max_files: parsedBackupMaxFiles,
      removed_files: 0
    };
  }

  const filesToDelete = sqliteFiles.slice(0, sqliteFiles.length - parsedBackupMaxFiles);
  await Promise.all(filesToDelete.map((fileName) => fs.rm(path.join(backupDirectoryPath, fileName), { force: true })));
  return {
    backup_max_files: parsedBackupMaxFiles,
    removed_files: filesToDelete.length,
    removed_file_names: filesToDelete
  };
}

async function createSqliteBackup({
  database,
  sqlitePath,
  backupDirectoryPath,
  backupMaxFiles,
  batchId,
  nowIso
}) {
  const normalizedBackupDirectoryPath = toTrimmedString(backupDirectoryPath);
  if (!normalizedBackupDirectoryPath) {
    return { enabled: false };
  }

  const timestamp = formatCompactUtcTimestamp(nowIso);
  const normalizedBatchId = toTrimmedString(batchId) || "batch";
  const backupFileName = `beta-feedback-primary-${timestamp}-${normalizedBatchId}.sqlite`;
  const backupPath = path.join(normalizedBackupDirectoryPath, backupFileName);

  try {
    await fs.mkdir(normalizedBackupDirectoryPath, { recursive: true });
    database.exec("PRAGMA wal_checkpoint(PASSIVE)");
    database.exec(`VACUUM main INTO '${escapeSqliteString(backupPath)}'`);
    const rotated = await rotateBackupFiles({
      backupDirectoryPath: normalizedBackupDirectoryPath,
      backupMaxFiles
    });

    return {
      enabled: true,
      ok: true,
      backup_directory_path: normalizedBackupDirectoryPath,
      backup_path: backupPath,
      ...rotated
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      backup_directory_path: normalizedBackupDirectoryPath,
      backup_path: backupPath,
      error: String(error)
    };
  }
}

async function collectSqliteHealthSnapshot({ database, sqlitePath }) {
  const normalizedPath = toTrimmedString(sqlitePath);
  const counts = collectSqliteCounts(database);
  let databaseSizeBytes = null;
  let walSizeBytes = null;

  try {
    const dbStats = await fs.stat(normalizedPath);
    databaseSizeBytes = Number(dbStats?.size || 0);
  } catch {
    databaseSizeBytes = null;
  }

  try {
    const walStats = await fs.stat(`${normalizedPath}-wal`);
    walSizeBytes = Number(walStats?.size || 0);
  } catch {
    walSizeBytes = 0;
  }

  return {
    path: normalizedPath,
    database_size_bytes: databaseSizeBytes,
    wal_size_bytes: walSizeBytes,
    ...counts
  };
}

async function storeFeedbackBatchInSqlite({
  sqlitePath = "",
  entries = [],
  summary = {},
  goNoGo = {},
  archive = {},
  source = "vaccinact-netlify-beta-feedback-primary",
  batchId = "",
  requestId = "",
  nowIso = new Date().toISOString(),
  retentionDays = null,
  retentionMaxBatches = null,
  backupDirectoryPath = "",
  backupMaxFiles = null
} = {}) {
  const normalizedPath = toTrimmedString(sqlitePath);
  const normalizedBatchId = toTrimmedString(batchId);

  if (!normalizedPath) {
    return {
      enabled: true,
      mode: "sqlite",
      ok: false,
      error: "Missing sqlite path for primary store."
    };
  }

  if (!normalizedBatchId) {
    return {
      enabled: true,
      mode: "sqlite",
      ok: false,
      error: "Missing batch_id for sqlite primary store idempotency."
    };
  }
  const DatabaseSync = await getDatabaseSyncCtor();
  if (!DatabaseSync) {
    return {
      enabled: true,
      mode: "sqlite",
      ok: false,
      error: "SQLite runtime unavailable (node:sqlite not supported in this environment)."
    };
  }

  await ensureParentDirectory(normalizedPath);

  const storedAtIso = toTrimmedString(nowIso) || new Date().toISOString();
  const payload = {
    source,
    stored_at_iso: storedAtIso,
    batch_id: normalizedBatchId,
    summary,
    go_no_go: goNoGo,
    archive,
    entries
  };

  let database;
  let insertedBatch = false;
  let insertedEntries = 0;

  try {
    database = new DatabaseSync(normalizedPath);
    initializeSqliteSchema(database);

    database.exec("BEGIN IMMEDIATE TRANSACTION");

    const insertBatchStatement = database.prepare(`
      INSERT INTO feedback_batches (
        batch_id,
        stored_at_iso,
        source,
        request_id,
        summary_json,
        go_no_go_json,
        archive_json,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id) DO NOTHING
    `);

    const insertBatchResult = insertBatchStatement.run(
      normalizedBatchId,
      storedAtIso,
      toTrimmedString(source) || "vaccinact-netlify-beta-feedback-primary",
      toTrimmedString(requestId) || null,
      JSON.stringify(summary || {}),
      JSON.stringify(goNoGo || {}),
      JSON.stringify(archive || {}),
      JSON.stringify(payload)
    );
    insertedBatch = Number(insertBatchResult?.changes || 0) > 0;

    const insertEntryStatement = database.prepare(`
      INSERT INTO feedback_entries (
        batch_id,
        entry_index,
        entry_json,
        site_id,
        utility_score,
        reuse_intent,
        major_corrections_count,
        form_completion_seconds,
        form_completed,
        stored_at_iso
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id, entry_index) DO NOTHING
    `);

    entries.forEach((entry, index) => {
      const metrics = entry?.submission_metrics || {};
      const insertEntryResult = insertEntryStatement.run(
        normalizedBatchId,
        index,
        JSON.stringify(entry || {}),
        toTrimmedString(entry?.site_id) || null,
        toNullableNumber(entry?.utility_score),
        toTrimmedString(entry?.reuse_intent) || null,
        toNullableNumber(entry?.major_corrections_count),
        toNullableNumber(metrics?.form_completion_seconds),
        toNullableBooleanAsInt(metrics?.form_completed),
        storedAtIso
      );
      insertedEntries += Number(insertEntryResult?.changes || 0);
    });

    database.exec("COMMIT");
    let retention = { enabled: false };
    try {
      retention = applySqliteRetention({
        database,
        retentionDays,
        retentionMaxBatches,
        nowIso: storedAtIso
      });
    } catch (error) {
      retention = {
        enabled: true,
        ok: false,
        error: String(error)
      };
    }

    let backup = { enabled: false };
    if (insertedBatch) {
      backup = await createSqliteBackup({
        database,
        sqlitePath: normalizedPath,
        backupDirectoryPath,
        backupMaxFiles,
        batchId: normalizedBatchId,
        nowIso: storedAtIso
      });
    }

    const health = await collectSqliteHealthSnapshot({
      database,
      sqlitePath: normalizedPath
    });

    database.close();

    return {
      enabled: true,
      mode: "sqlite",
      ok: true,
      path: normalizedPath,
      batch_id: normalizedBatchId,
      inserted_batch: insertedBatch,
      inserted_entries: insertedEntries,
      duplicate_batch: !insertedBatch,
      retention,
      backup,
      health
    };
  } catch (error) {
    if (database) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      try {
        database.close();
      } catch {
        // ignore close errors
      }
    }

    return {
      enabled: true,
      mode: "sqlite",
      ok: false,
      path: normalizedPath,
      batch_id: normalizedBatchId,
      error: String(error)
    };
  }
}

function resolvePrimaryStoreMode({ mode, sqlitePath, webhookUrl }) {
  const normalizedMode = toTrimmedString(mode).toLowerCase();
  if (normalizedMode === "sqlite" || normalizedMode === "http" || normalizedMode === "dual") {
    return normalizedMode;
  }
  if (toTrimmedString(sqlitePath) && toTrimmedString(webhookUrl)) return "dual";
  if (toTrimmedString(sqlitePath)) return "sqlite";
  if (toTrimmedString(webhookUrl)) return "http";
  return "http";
}

export async function inspectPrimaryStore({
  mode = "",
  sqlitePath = "",
  webhookUrl = "",
  dualWindowDays = 7,
  nowIso = new Date().toISOString()
} = {}) {
  const effectiveMode = resolvePrimaryStoreMode({ mode, sqlitePath, webhookUrl });
  if (effectiveMode === "http") {
    return {
      enabled: Boolean(toTrimmedString(webhookUrl)),
      mode: "http",
      ok: true
    };
  }

  const normalizedPath = toTrimmedString(sqlitePath);
  if (!normalizedPath) {
    return {
      enabled: true,
      mode: effectiveMode,
      ok: false,
      error: "Missing sqlite path for primary store inspection.",
      ...(effectiveMode === "dual"
        ? {
            replica_http: {
              enabled: Boolean(toTrimmedString(webhookUrl))
            }
          }
        : {})
    };
  }
  const DatabaseSync = await getDatabaseSyncCtor();
  if (!DatabaseSync) {
    return {
      enabled: true,
      mode: effectiveMode,
      ok: false,
      path: normalizedPath,
      error: "SQLite runtime unavailable (node:sqlite not supported in this environment).",
      ...(effectiveMode === "dual"
        ? {
            replica_http: {
              enabled: Boolean(toTrimmedString(webhookUrl))
            }
          }
        : {})
    };
  }

  let database;
  try {
    database = new DatabaseSync(normalizedPath);
    initializeSqliteSchema(database);
    const health = await collectSqliteHealthSnapshot({
      database,
      sqlitePath: normalizedPath
    });
    const dualReplication =
      effectiveMode === "dual"
        ? collectDualReplicationSnapshot({
            database,
            nowIso,
            windowDays: dualWindowDays
          })
        : null;
    database.close();
    return {
      enabled: true,
      mode: effectiveMode,
      ok: true,
      health,
      ...(dualReplication
        ? {
            dual_replication: dualReplication
          }
        : {}),
      ...(effectiveMode === "dual"
        ? {
            replica_http: {
              enabled: Boolean(toTrimmedString(webhookUrl))
            }
          }
        : {})
    };
  } catch (error) {
    if (database) {
      try {
        database.close();
      } catch {
        // ignore close errors
      }
    }
    return {
      enabled: true,
      mode: effectiveMode,
      ok: false,
      path: normalizedPath,
      error: String(error),
      ...(effectiveMode === "dual"
        ? {
            replica_http: {
              enabled: Boolean(toTrimmedString(webhookUrl))
            }
          }
        : {})
    };
  }
}

export async function persistFeedbackBatchToPrimaryStore({
  mode = "",
  sqlitePath = "",
  webhookUrl = "",
  webhookSecret = "",
  entries = [],
  summary = {},
  goNoGo = {},
  archive = {},
  source = "vaccinact-netlify-beta-feedback-primary",
  eventName = "beta_feedback_store_batch",
  extraPayload = {},
  batchId = "",
  idempotencyKey = "",
  requestId = "",
  nowIso = new Date().toISOString(),
  maxAttempts = 3,
  retryBaseDelayMs = 300,
  timeoutMs = 5000,
  forwarder = forwardFeedbackToWebhook,
  retentionDays = null,
  retentionMaxBatches = null,
  backupDirectoryPath = "",
  backupMaxFiles = null,
  dualWriteStrict = false
} = {}) {
  const effectiveMode = resolvePrimaryStoreMode({ mode, sqlitePath, webhookUrl });
  const forwardHttpStore = () =>
    forwarder({
      webhookUrl,
      webhookSecret,
      entries,
      summary,
      goNoGo,
      archive,
      source,
      eventName,
      extraPayload,
      batchId,
      idempotencyKey,
      requestId,
      nowIso,
      maxAttempts,
      retryBaseDelayMs,
      timeoutMs
    });

  if (effectiveMode === "sqlite") {
    return storeFeedbackBatchInSqlite({
      sqlitePath,
      entries,
      summary,
      goNoGo,
      archive,
      source,
      batchId,
      requestId,
      nowIso,
      retentionDays,
      retentionMaxBatches,
      backupDirectoryPath,
      backupMaxFiles
    });
  }

  if (effectiveMode === "dual") {
    const [primaryStore, replicaHttp] = await Promise.all([
      storeFeedbackBatchInSqlite({
        sqlitePath,
        entries,
        summary,
        goNoGo,
        archive,
        source,
        batchId,
        requestId,
        nowIso,
        retentionDays,
        retentionMaxBatches,
        backupDirectoryPath,
        backupMaxFiles
      }),
      forwardHttpStore()
    ]);
    const strictReplication = parseBoolean(dualWriteStrict, false);
    const primaryOk = Boolean(primaryStore?.ok);
    const replicaOk = Boolean(replicaHttp?.enabled && replicaHttp?.ok);
    const replicationStatus = !replicaHttp?.enabled ? "disabled" : replicaHttp?.ok ? "synced" : "degraded";
    const replicationEvent = await appendDualReplicationEventToSqlite({
      sqlitePath,
      batchId,
      nowIso,
      requestId,
      replicationStatus,
      strictReplication,
      primaryOk,
      replicaHttp
    });

    return {
      enabled: true,
      mode: "dual",
      ok: strictReplication ? primaryOk && replicaOk : primaryOk,
      strict_replication: strictReplication,
      replication_status: replicationStatus,
      primary: primaryStore,
      replica_http: replicaHttp,
      replication_event: replicationEvent
    };
  }

  return forwardHttpStore();
}
