import fs from "node:fs/promises";

import {
  DEFAULT_GO_NO_GO_THRESHOLDS,
  evaluateGoNoGo,
  summarizeFeedback,
  summarizeFeedbackBySite
} from "./betaFeedback.js";

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function parseIsoDate(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

function readEntriesFromArchiveRecord(record) {
  if (!record || typeof record !== "object") return [];
  const entries = Array.isArray(record.entries) ? record.entries : [];
  return entries.filter((entry) => entry && typeof entry === "object");
}

export async function loadArchivedFeedbackEntries(archivePath) {
  const normalizedArchivePath = String(archivePath || "").trim();
  if (!normalizedArchivePath) {
    return {
      enabled: false,
      archive_path: "",
      total_batches: 0,
      total_entries: 0,
      parse_errors: 0,
      entries: []
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
      entries: [],
      error: String(error)
    };
  }

  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  let parseErrors = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      entries.push(...readEntriesFromArchiveRecord(parsed));
    } catch (error) {
      parseErrors += 1;
    }
  }

  return {
    enabled: true,
    archive_path: normalizedArchivePath,
    total_batches: lines.length,
    total_entries: entries.length,
    parse_errors: parseErrors,
    entries
  };
}

export function buildFeedbackReport({
  entries = [],
  windowDays = 7,
  nowIso = new Date().toISOString(),
  thresholds = DEFAULT_GO_NO_GO_THRESHOLDS
} = {}) {
  const effectiveWindowDays = parsePositiveInteger(windowDays, 7);
  const nowDate = parseIsoDate(nowIso) || new Date();
  const cutoffDate = new Date(nowDate);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - effectiveWindowDays);

  const windowEntries = entries.filter((entry) => {
    const recordedAt = parseIsoDate(entry?.recorded_at_iso);
    if (!recordedAt) return true;
    return recordedAt >= cutoffDate;
  });

  const summary = summarizeFeedback(windowEntries);
  return {
    generated_at_iso: nowDate.toISOString(),
    window_days: effectiveWindowDays,
    total_entries_all_time: entries.length,
    total_entries_window: windowEntries.length,
    summary,
    go_no_go: evaluateGoNoGo(summary, thresholds),
    by_site: summarizeFeedbackBySite(windowEntries, thresholds)
  };
}
