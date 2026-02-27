import crypto from "node:crypto";

function toFiniteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeReuseIntent(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "yes" || normalized === "oui") return "yes";
  if (normalized === "no" || normalized === "non") return "no";
  return "";
}

function normalizeSiteId(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "unknown";
  return normalized.slice(0, 64);
}

export const DEFAULT_GO_NO_GO_THRESHOLDS = {
  min_total_entries: 20,
  max_avg_form_completion_seconds: 150,
  min_completion_rate: 0.85,
  min_avg_utility_score: 4,
  min_reuse_yes_rate: 0.7,
  max_major_corrections_rate: 0.1
};

export function normalizeFeedbackEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object") {
    return { valid: false, error: "Entry must be an object." };
  }

  const utilityScore = toFiniteNumber(rawEntry.utility_score);
  if (!utilityScore || utilityScore < 1 || utilityScore > 5) {
    return { valid: false, error: "utility_score must be between 1 and 5." };
  }

  const reuseIntent = normalizeReuseIntent(rawEntry.reuse_intent);
  if (!reuseIntent) {
    return { valid: false, error: "reuse_intent must be yes/no." };
  }

  const metrics = rawEntry.submission_metrics && typeof rawEntry.submission_metrics === "object"
    ? rawEntry.submission_metrics
    : {};

  const formCompletionSeconds = toFiniteNumber(metrics.form_completion_seconds);
  const normalized = {
    recorded_at_iso: rawEntry.recorded_at_iso || new Date().toISOString(),
    site_id: normalizeSiteId(rawEntry.site_id || rawEntry.officine_id || rawEntry.pharmacy_id),
    diagnostic_meta: {
      diagnostic_date_iso: rawEntry.diagnostic_meta?.diagnostic_date_iso || "",
      version: rawEntry.diagnostic_meta?.version || ""
    },
    submission_metrics: {
      form_completion_seconds: formCompletionSeconds && formCompletionSeconds > 0 ? Math.round(formCompletionSeconds) : null,
      form_completed: Boolean(metrics.form_completed),
      quick_history_entries_count: toNonNegativeInteger(metrics.quick_history_entries_count, 0),
      required_core_completed: Boolean(metrics.required_core_completed)
    },
    utility_score: utilityScore,
    reuse_intent: reuseIntent,
    major_corrections_count: toNonNegativeInteger(rawEntry.major_corrections_count, 0)
  };

  return { valid: true, normalized };
}

function safeAverage(total, count) {
  if (!count) return null;
  return Number((total / count).toFixed(2));
}

export function summarizeFeedback(entries = []) {
  const total = entries.length;
  if (total === 0) {
    return {
      total_entries: 0,
      avg_utility_score: null,
      reuse_yes_rate: null,
      completion_rate: null,
      avg_form_completion_seconds: null,
      major_corrections_rate: null,
      required_core_completion_rate: null,
      quick_history_usage_rate: null,
      avg_quick_history_entries_count: null,
      timed_submission_rate: null
    };
  }

  let utilitySum = 0;
  let reuseYesCount = 0;
  let completedCount = 0;
  let completionSum = 0;
  let completionCount = 0;
  let majorCorrectionCount = 0;
  let requiredCoreCompletedCount = 0;
  let quickHistoryUsageCount = 0;
  let quickHistoryEntriesSum = 0;

  for (const entry of entries) {
    utilitySum += Number(entry.utility_score || 0);
    if (entry.reuse_intent === "yes") reuseYesCount += 1;
    if (entry.submission_metrics?.form_completed) completedCount += 1;
    if (entry.submission_metrics?.required_core_completed) requiredCoreCompletedCount += 1;

    const completion = toFiniteNumber(entry.submission_metrics?.form_completion_seconds);
    if (completion && completion > 0) {
      completionSum += completion;
      completionCount += 1;
    }

    const quickHistoryEntriesCount = toNonNegativeInteger(
      entry.submission_metrics?.quick_history_entries_count,
      0
    );
    quickHistoryEntriesSum += quickHistoryEntriesCount;
    if (quickHistoryEntriesCount > 0) {
      quickHistoryUsageCount += 1;
    }

    if (Number(entry.major_corrections_count || 0) > 0) {
      majorCorrectionCount += 1;
    }
  }

  return {
    total_entries: total,
    avg_utility_score: safeAverage(utilitySum, total),
    reuse_yes_rate: safeAverage(reuseYesCount, total),
    completion_rate: safeAverage(completedCount, total),
    avg_form_completion_seconds: safeAverage(completionSum, completionCount),
    major_corrections_rate: safeAverage(majorCorrectionCount, total),
    required_core_completion_rate: safeAverage(requiredCoreCompletedCount, total),
    quick_history_usage_rate: safeAverage(quickHistoryUsageCount, total),
    avg_quick_history_entries_count: safeAverage(quickHistoryEntriesSum, total),
    timed_submission_rate: safeAverage(completionCount, total)
  };
}

export function evaluateGoNoGo(summary = {}, thresholds = DEFAULT_GO_NO_GO_THRESHOLDS) {
  const checks = {
    total_entries: {
      value: summary.total_entries,
      target: `>= ${thresholds.min_total_entries}`,
      passed:
        typeof summary.total_entries === "number" &&
        summary.total_entries >= thresholds.min_total_entries
    },
    avg_form_completion_seconds: {
      value: summary.avg_form_completion_seconds,
      target: `<= ${thresholds.max_avg_form_completion_seconds}`,
      passed:
        typeof summary.avg_form_completion_seconds === "number" &&
        summary.avg_form_completion_seconds <= thresholds.max_avg_form_completion_seconds
    },
    completion_rate: {
      value: summary.completion_rate,
      target: `>= ${thresholds.min_completion_rate}`,
      passed:
        typeof summary.completion_rate === "number" &&
        summary.completion_rate >= thresholds.min_completion_rate
    },
    avg_utility_score: {
      value: summary.avg_utility_score,
      target: `>= ${thresholds.min_avg_utility_score}`,
      passed:
        typeof summary.avg_utility_score === "number" &&
        summary.avg_utility_score >= thresholds.min_avg_utility_score
    },
    reuse_yes_rate: {
      value: summary.reuse_yes_rate,
      target: `>= ${thresholds.min_reuse_yes_rate}`,
      passed:
        typeof summary.reuse_yes_rate === "number" &&
        summary.reuse_yes_rate >= thresholds.min_reuse_yes_rate
    },
    major_corrections_rate: {
      value: summary.major_corrections_rate,
      target: `<= ${thresholds.max_major_corrections_rate}`,
      passed:
        typeof summary.major_corrections_rate === "number" &&
        summary.major_corrections_rate <= thresholds.max_major_corrections_rate
    }
  };

  const checkValues = Object.values(checks);
  const hasMissingData = checkValues.some((check) => typeof check.value !== "number");
  const allPassed = checkValues.every((check) => check.passed);

  let status = "no_go";
  if (!checks.total_entries.passed) {
    status = "insufficient_data";
  } else if (hasMissingData) {
    status = "review_required";
  } else if (allPassed) {
    status = "go";
  }

  return {
    status,
    thresholds,
    checks
  };
}

export function summarizeFeedbackBySite(entries = [], thresholds = DEFAULT_GO_NO_GO_THRESHOLDS) {
  const groups = new Map();

  for (const entry of entries) {
    const siteId = normalizeSiteId(entry.site_id);
    if (!groups.has(siteId)) {
      groups.set(siteId, []);
    }
    groups.get(siteId).push(entry);
  }

  return [...groups.entries()]
    .map(([site_id, siteEntries]) => {
      const summary = summarizeFeedback(siteEntries);
      return {
        site_id,
        summary,
        go_no_go: evaluateGoNoGo(summary, thresholds)
      };
    })
    .sort((a, b) => a.site_id.localeCompare(b.site_id));
}

function canonicalizeForHash(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForHash(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = canonicalizeForHash(value[key]);
        return acc;
      }, {});
  }

  return value;
}

export function buildFeedbackBatchIdentity({ entries = [], summary = {} } = {}) {
  const payload = canonicalizeForHash({
    kind: "beta_feedback_batch_v1",
    entries: Array.isArray(entries) ? entries : [],
    summary: summary && typeof summary === "object" ? summary : {}
  });
  const serialized = JSON.stringify(payload);
  const hash = crypto.createHash("sha256").update(serialized).digest("hex");
  return `bfb_${hash.slice(0, 24)}`;
}
