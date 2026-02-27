import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { archiveFeedbackBatch } from "../betaFeedbackArchive.js";

function createTempArchivePath() {
  return path.join(
    os.tmpdir(),
    `vaccinact-beta-feedback-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`
  );
}

async function readArchiveRecords(archivePath) {
  const raw = await fs.readFile(archivePath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("archiveFeedbackBatch returns disabled when archivePath is missing", async () => {
  const result = await archiveFeedbackBatch({
    entries: [{ utility_score: 4 }],
    summary: { total_entries: 1 },
    archivePath: ""
  });

  assert.equal(result.enabled, false);
});

test("archiveFeedbackBatch writes one NDJSON line when archivePath is provided", async () => {
  const tempPath = createTempArchivePath();

  try {
    const result = await archiveFeedbackBatch({
      entries: [{ utility_score: 5, reuse_intent: "yes" }],
      summary: { total_entries: 1, avg_utility_score: 5 },
      archivePath: tempPath,
      batchId: "bfb_test_001"
    });

    assert.equal(result.enabled, true);
    assert.equal(result.ok, true);
    assert.equal(result.written_entries, 1);

    const records = await readArchiveRecords(tempPath);
    assert.equal(records.length, 1);
    const parsed = records[0];
    assert.equal(parsed.batch_id, "bfb_test_001");
    assert.equal(parsed.summary.total_entries, 1);
    assert.equal(parsed.entries.length, 1);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
});

test("archiveFeedbackBatch applies retentionDays and prunes old batches", async () => {
  const tempPath = createTempArchivePath();

  try {
    await fs.writeFile(
      tempPath,
      `${JSON.stringify({
        archived_at_iso: "2026-01-01T10:00:00.000Z",
        summary: { total_entries: 1 },
        entries: [{ utility_score: 3 }]
      })}\n`,
      "utf8"
    );

    const result = await archiveFeedbackBatch({
      entries: [{ utility_score: 5, reuse_intent: "yes" }],
      summary: { total_entries: 1, avg_utility_score: 5 },
      archivePath: tempPath,
      retentionDays: 7,
      nowIso: "2026-02-26T12:00:00.000Z"
    });

    assert.equal(result.enabled, true);
    assert.equal(result.ok, true);
    assert.equal(result.retention.enabled, true);
    assert.equal(result.retention.ok, true);
    assert.equal(result.retention.pruned_batches, 1);

    const records = await readArchiveRecords(tempPath);
    assert.equal(records.length, 1);
    assert.equal(records[0].archived_at_iso, "2026-02-26T12:00:00.000Z");
  } finally {
    await fs.rm(tempPath, { force: true });
  }
});

test("archiveFeedbackBatch applies retentionMaxBatches and keeps most recent batches", async () => {
  const tempPath = createTempArchivePath();

  try {
    await fs.writeFile(
      tempPath,
      [
        JSON.stringify({
          archived_at_iso: "2026-02-20T08:00:00.000Z",
          summary: { total_entries: 1 },
          entries: [{ utility_score: 3 }]
        }),
        JSON.stringify({
          archived_at_iso: "2026-02-21T08:00:00.000Z",
          summary: { total_entries: 1 },
          entries: [{ utility_score: 4 }]
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const result = await archiveFeedbackBatch({
      entries: [{ utility_score: 5, reuse_intent: "yes" }],
      summary: { total_entries: 1, avg_utility_score: 5 },
      archivePath: tempPath,
      retentionMaxBatches: 2,
      nowIso: "2026-02-26T12:00:00.000Z"
    });

    assert.equal(result.enabled, true);
    assert.equal(result.ok, true);
    assert.equal(result.retention.enabled, true);
    assert.equal(result.retention.ok, true);
    assert.equal(result.retention.total_batches_before, 3);
    assert.equal(result.retention.total_batches_after, 2);
    assert.equal(result.retention.pruned_batches, 1);

    const records = await readArchiveRecords(tempPath);
    assert.equal(records.length, 2);
    assert.equal(records[0].archived_at_iso, "2026-02-21T08:00:00.000Z");
    assert.equal(records[1].archived_at_iso, "2026-02-26T12:00:00.000Z");
  } finally {
    await fs.rm(tempPath, { force: true });
  }
});
