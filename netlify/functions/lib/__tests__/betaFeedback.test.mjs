import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFeedbackBatchIdentity,
  evaluateGoNoGo,
  normalizeFeedbackEntry,
  summarizeFeedback,
  summarizeFeedbackBySite
} from "../betaFeedback.js";

test("normalizeFeedbackEntry accepts valid entry", () => {
  const normalized = normalizeFeedbackEntry({
    site_id: "officine-01",
    utility_score: 4,
    reuse_intent: "oui",
    major_corrections_count: 1,
    submission_metrics: {
      form_completion_seconds: 135,
      form_completed: true,
      quick_history_entries_count: 2,
      required_core_completed: true
    }
  });

  assert.equal(normalized.valid, true);
  assert.equal(normalized.normalized.site_id, "officine-01");
  assert.equal(normalized.normalized.utility_score, 4);
  assert.equal(normalized.normalized.reuse_intent, "yes");
  assert.equal(normalized.normalized.major_corrections_count, 1);
});

test("normalizeFeedbackEntry rejects invalid utility score", () => {
  const normalized = normalizeFeedbackEntry({
    utility_score: 9,
    reuse_intent: "yes"
  });
  assert.equal(normalized.valid, false);
});

test("summarizeFeedback computes aggregate metrics", () => {
  const summary = summarizeFeedback([
    {
      utility_score: 4,
      reuse_intent: "yes",
      major_corrections_count: 0,
      submission_metrics: {
        form_completion_seconds: 120,
        quick_history_entries_count: 2,
        required_core_completed: true
      }
    },
    {
      utility_score: 5,
      reuse_intent: "no",
      major_corrections_count: 2,
      submission_metrics: {
        form_completion_seconds: 150,
        quick_history_entries_count: 0,
        required_core_completed: false
      }
    }
  ]);

  assert.equal(summary.total_entries, 2);
  assert.equal(summary.avg_utility_score, 4.5);
  assert.equal(summary.reuse_yes_rate, 0.5);
  assert.equal(summary.completion_rate, 0);
  assert.equal(summary.avg_form_completion_seconds, 135);
  assert.equal(summary.major_corrections_rate, 0.5);
  assert.equal(summary.required_core_completion_rate, 0.5);
  assert.equal(summary.quick_history_usage_rate, 0.5);
  assert.equal(summary.avg_quick_history_entries_count, 1);
  assert.equal(summary.timed_submission_rate, 1);
});

test("evaluateGoNoGo returns go when all thresholds are met", () => {
  const goNoGo = evaluateGoNoGo({
    total_entries: 20,
    avg_form_completion_seconds: 120,
    completion_rate: 0.9,
    avg_utility_score: 4.2,
    reuse_yes_rate: 0.75,
    major_corrections_rate: 0.05
  });

  assert.equal(goNoGo.status, "go");
  assert.equal(goNoGo.checks.avg_utility_score.passed, true);
  assert.equal(goNoGo.checks.major_corrections_rate.passed, true);
});

test("summarizeFeedbackBySite groups entries and computes site-level statuses", () => {
  const grouped = summarizeFeedbackBySite([
    {
      site_id: "officine-a",
      utility_score: 4,
      reuse_intent: "yes",
      major_corrections_count: 0,
      submission_metrics: {
        form_completion_seconds: 120,
        form_completed: true
      }
    },
    {
      site_id: "officine-a",
      utility_score: 4,
      reuse_intent: "yes",
      major_corrections_count: 0,
      submission_metrics: {
        form_completion_seconds: 130,
        form_completed: true
      }
    },
    {
      site_id: "officine-b",
      utility_score: 2,
      reuse_intent: "no",
      major_corrections_count: 2,
      submission_metrics: {
        form_completion_seconds: 300,
        form_completed: false
      }
    }
  ], {
    min_total_entries: 1,
    max_avg_form_completion_seconds: 150,
    min_completion_rate: 0.85,
    min_avg_utility_score: 4,
    min_reuse_yes_rate: 0.7,
    max_major_corrections_rate: 0.1
  });

  assert.equal(grouped.length, 2);
  const siteA = grouped.find((item) => item.site_id === "officine-a");
  const siteB = grouped.find((item) => item.site_id === "officine-b");
  assert.ok(siteA);
  assert.ok(siteB);
  assert.equal(siteA.go_no_go.status, "go");
  assert.equal(siteB.go_no_go.status, "no_go");
});

test("evaluateGoNoGo returns insufficient_data when total entries are below threshold", () => {
  const goNoGo = evaluateGoNoGo({
    total_entries: 12,
    avg_form_completion_seconds: 120,
    completion_rate: 0.95,
    avg_utility_score: 4.5,
    reuse_yes_rate: 0.8,
    major_corrections_rate: 0.05
  });

  assert.equal(goNoGo.status, "insufficient_data");
  assert.equal(goNoGo.checks.total_entries.passed, false);
});

test("buildFeedbackBatchIdentity is stable for equivalent objects with different key order", () => {
  const entriesA = [
    {
      utility_score: 4,
      reuse_intent: "yes",
      submission_metrics: {
        form_completed: true,
        form_completion_seconds: 120
      }
    }
  ];
  const entriesB = [
    {
      reuse_intent: "yes",
      utility_score: 4,
      submission_metrics: {
        form_completion_seconds: 120,
        form_completed: true
      }
    }
  ];

  const summaryA = {
    total_entries: 1,
    avg_utility_score: 4
  };
  const summaryB = {
    avg_utility_score: 4,
    total_entries: 1
  };

  const idA = buildFeedbackBatchIdentity({ entries: entriesA, summary: summaryA });
  const idB = buildFeedbackBatchIdentity({ entries: entriesB, summary: summaryB });

  assert.equal(idA, idB);
  assert.equal(idA.startsWith("bfb_"), true);
});

test("buildFeedbackBatchIdentity changes when entries change", () => {
  const idA = buildFeedbackBatchIdentity({
    entries: [{ utility_score: 4, reuse_intent: "yes" }],
    summary: { total_entries: 1, avg_utility_score: 4 }
  });
  const idB = buildFeedbackBatchIdentity({
    entries: [{ utility_score: 5, reuse_intent: "yes" }],
    summary: { total_entries: 1, avg_utility_score: 5 }
  });

  assert.notEqual(idA, idB);
});
