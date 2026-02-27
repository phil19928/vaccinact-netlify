import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadArchivedFeedbackBatches,
  replayArchivedFeedbackBatches,
  selectReplayBatches
} from "../betaFeedbackReplay.js";

function createTempArchivePath() {
  return path.join(
    os.tmpdir(),
    `vaccinact-beta-feedback-replay-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`
  );
}

test("loadArchivedFeedbackBatches parses NDJSON and counts parse errors", async () => {
  const tempPath = createTempArchivePath();
  try {
    await fs.writeFile(
      tempPath,
      [
        JSON.stringify({
          archived_at_iso: "2026-02-20T10:00:00.000Z",
          batch_id: "bfb_archive_001",
          summary: { total_entries: 1, avg_utility_score: 4 },
          entries: [{ utility_score: 4, reuse_intent: "yes" }]
        }),
        "{invalid-json}",
        JSON.stringify({
          archived_at_iso: "2026-02-21T10:00:00.000Z",
          entries: [{ utility_score: 5, reuse_intent: "yes" }]
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const loaded = await loadArchivedFeedbackBatches(tempPath);
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.total_batches, 2);
    assert.equal(loaded.total_entries, 2);
    assert.equal(loaded.parse_errors, 1);
    assert.equal(loaded.batches[0].batch_id, "bfb_archive_001");
  } finally {
    await fs.rm(tempPath, { force: true });
  }
});

test("selectReplayBatches filters by fromIso and maxBatches", () => {
  const selected = selectReplayBatches({
    batches: [
      { archived_at_iso: "2026-02-20T10:00:00.000Z", entries: [{ id: 1 }] },
      { archived_at_iso: "2026-02-21T10:00:00.000Z", entries: [{ id: 2 }] },
      { archived_at_iso: "2026-02-22T10:00:00.000Z", entries: [{ id: 3 }] }
    ],
    fromIso: "2026-02-21T00:00:00.000Z",
    maxBatches: 1
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].archived_at_iso, "2026-02-22T10:00:00.000Z");
});

test("replayArchivedFeedbackBatches supports dry-run mode", async () => {
  const replay = await replayArchivedFeedbackBatches({
    dryRun: true,
    batches: [
      {
        archived_at_iso: "2026-02-20T10:00:00.000Z",
        batch_id: "bfb_replay_001",
        summary: {
          total_entries: 1,
          avg_utility_score: 4,
          completion_rate: 1,
          avg_form_completion_seconds: 120,
          reuse_yes_rate: 1,
          major_corrections_rate: 0
        },
        entries: [{ utility_score: 4, reuse_intent: "yes" }]
      }
    ],
    targets: [
      { name: "primary_store", webhookUrl: "https://example.test/store" }
    ]
  });

  assert.equal(replay.dry_run, true);
  assert.equal(replay.total_batches, 1);
  assert.equal(replay.targets.primary_store.enabled, true);
  assert.equal(replay.targets.primary_store.attempted, 0);
  assert.equal(replay.batches[0].deliveries[0].skipped, true);
});

test("replayArchivedFeedbackBatches delivers to enabled targets", async () => {
  const calls = [];
  const replay = await replayArchivedFeedbackBatches({
    dryRun: false,
    nowIso: "2026-02-26T12:00:00.000Z",
    batches: [
      {
        archived_at_iso: "2026-02-20T10:00:00.000Z",
        batch_id: "bfb_replay_001",
        summary: {
          total_entries: 1,
          avg_utility_score: 4,
          completion_rate: 1,
          avg_form_completion_seconds: 120,
          reuse_yes_rate: 1,
          major_corrections_rate: 0
        },
        entries: [{ utility_score: 4, reuse_intent: "yes" }]
      }
    ],
    targets: [
      {
        name: "primary_store",
        webhookUrl: "https://example.test/store",
        source: "vaccinact-test",
        eventName: "beta_feedback_replay_store_batch"
      }
    ],
    deliverFn: async (params) => {
      calls.push(params);
      return { enabled: true, ok: true, status: 202, attempts: [{ attempt: 1, ok: true, status: 202 }] };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].webhookUrl, "https://example.test/store");
  assert.equal(calls[0].eventName, "beta_feedback_replay_store_batch");
  assert.equal(calls[0].source, "vaccinact-test");
  assert.equal(calls[0].batchId, "bfb_replay_001");
  assert.equal(calls[0].idempotencyKey, "vaccinact-beta-feedback:primary_store:bfb_replay_001");
  assert.equal(replay.targets.primary_store.attempted, 1);
  assert.equal(replay.targets.primary_store.succeeded, 1);
  assert.equal(replay.targets.primary_store.failed, 0);
  assert.equal(replay.batches[0].deliveries[0].ok, true);
  assert.equal(replay.batches[0].batch_id, "bfb_replay_001");
});
