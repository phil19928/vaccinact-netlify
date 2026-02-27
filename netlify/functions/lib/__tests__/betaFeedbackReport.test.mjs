import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildFeedbackReport, loadArchivedFeedbackEntries } from "../betaFeedbackReport.js";

test("loadArchivedFeedbackEntries parses archive batches", async () => {
  const tempPath = path.join(
    os.tmpdir(),
    `vaccinact-feedback-report-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`
  );

  try {
    const batch1 = {
      archived_at_iso: "2026-02-20T10:00:00.000Z",
      summary: { total_entries: 1 },
      entries: [
        {
          recorded_at_iso: "2026-02-20T09:00:00.000Z",
          site_id: "officine-1",
          utility_score: 4,
          reuse_intent: "yes",
          major_corrections_count: 0,
          submission_metrics: { form_completion_seconds: 130, form_completed: true }
        }
      ]
    };
    const batch2 = {
      archived_at_iso: "2026-02-21T10:00:00.000Z",
      summary: { total_entries: 1 },
      entries: [
        {
          recorded_at_iso: "2026-02-21T09:00:00.000Z",
          site_id: "officine-2",
          utility_score: 5,
          reuse_intent: "yes",
          major_corrections_count: 0,
          submission_metrics: { form_completion_seconds: 120, form_completed: true }
        }
      ]
    };
    await fs.writeFile(tempPath, `${JSON.stringify(batch1)}\n${JSON.stringify(batch2)}\n`, "utf8");

    const loaded = await loadArchivedFeedbackEntries(tempPath);
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.total_batches, 2);
    assert.equal(loaded.total_entries, 2);
    assert.equal(loaded.entries.length, 2);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
});

test("buildFeedbackReport filters by window and computes go/no-go", () => {
  const report = buildFeedbackReport({
    nowIso: "2026-02-26T00:00:00.000Z",
    windowDays: 7,
    entries: [
      {
        recorded_at_iso: "2026-02-25T09:00:00.000Z",
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
      },
      {
        recorded_at_iso: "2026-02-10T09:00:00.000Z",
        site_id: "officine-a",
        utility_score: 4,
        reuse_intent: "yes",
        major_corrections_count: 0,
        submission_metrics: {
          form_completion_seconds: 130,
          form_completed: true,
          quick_history_entries_count: 0,
          required_core_completed: false
        }
      }
    ]
  });

  assert.equal(report.total_entries_all_time, 2);
  assert.equal(report.total_entries_window, 1);
  assert.equal(report.summary.total_entries, 1);
  assert.equal(report.summary.required_core_completion_rate, 1);
  assert.equal(report.summary.quick_history_usage_rate, 1);
  assert.equal(report.summary.avg_quick_history_entries_count, 1);
  assert.equal(report.by_site.length, 1);
  assert.equal(report.by_site[0].site_id, "officine-a");
});
