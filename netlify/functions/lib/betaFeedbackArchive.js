import fs from "node:fs/promises";
import path from "node:path";

async function ensureParentDirectory(filePath) {
  const directoryPath = path.dirname(filePath);
  await fs.mkdir(directoryPath, { recursive: true });
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseIsoDate(value) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function applyArchiveRetention({
  archivePath,
  retentionDays,
  retentionMaxBatches,
  nowIso
} = {}) {
  const parsedRetentionDays = parsePositiveInteger(retentionDays);
  const parsedRetentionMaxBatches = parsePositiveInteger(retentionMaxBatches);
  if (!parsedRetentionDays && !parsedRetentionMaxBatches) {
    return {
      enabled: false
    };
  }

  const nowDate = parseIsoDate(nowIso) || new Date();
  const cutoffDate = parsedRetentionDays
    ? new Date(nowDate.getTime() - parsedRetentionDays * 24 * 60 * 60 * 1000)
    : null;

  let raw = "";
  try {
    raw = await fs.readFile(archivePath, "utf8");
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      error: String(error),
      retention_days: parsedRetentionDays,
      retention_max_batches: parsedRetentionMaxBatches
    };
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let parseErrors = 0;
  const parsedLines = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const archivedAt = parseIsoDate(parsed?.archived_at_iso);
      parsedLines.push({ parsed, archivedAt });
    } catch (error) {
      parseErrors += 1;
    }
  }

  let retained = parsedLines;
  if (cutoffDate) {
    retained = retained.filter((record) => !record.archivedAt || record.archivedAt >= cutoffDate);
  }
  if (parsedRetentionMaxBatches && retained.length > parsedRetentionMaxBatches) {
    retained = retained.slice(-parsedRetentionMaxBatches);
  }

  const serialized = retained.map((record) => JSON.stringify(record.parsed));
  try {
    const nextText = serialized.length > 0 ? `${serialized.join("\n")}\n` : "";
    await fs.writeFile(archivePath, nextText, "utf8");
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      error: String(error),
      retention_days: parsedRetentionDays,
      retention_max_batches: parsedRetentionMaxBatches
    };
  }

  return {
    enabled: true,
    ok: true,
    retention_days: parsedRetentionDays,
    retention_max_batches: parsedRetentionMaxBatches,
    total_batches_before: lines.length,
    total_batches_after: serialized.length,
    pruned_batches: Math.max(lines.length - serialized.length, 0),
    dropped_parse_error_lines: parseErrors
  };
}

export async function archiveFeedbackBatch({
  entries = [],
  summary = {},
  archivePath = "",
  batchId = "",
  retentionDays,
  retentionMaxBatches,
  nowIso
} = {}) {
  const normalizedArchivePath = String(archivePath || "").trim();
  if (!normalizedArchivePath) {
    return { enabled: false };
  }

  try {
    const archivedAtIso = String(nowIso || "").trim() || new Date().toISOString();
    await ensureParentDirectory(normalizedArchivePath);
    const line = JSON.stringify({
      archived_at_iso: archivedAtIso,
      ...(String(batchId || "").trim() ? { batch_id: String(batchId).trim() } : {}),
      summary,
      entries
    });
    await fs.appendFile(normalizedArchivePath, `${line}\n`, "utf8");
    const retention = await applyArchiveRetention({
      archivePath: normalizedArchivePath,
      retentionDays,
      retentionMaxBatches,
      nowIso: archivedAtIso
    });

    return {
      enabled: true,
      ok: true,
      path: normalizedArchivePath,
      written_entries: entries.length,
      retention
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      path: normalizedArchivePath,
      error: String(error)
    };
  }
}
