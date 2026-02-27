function toNullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function parseRate(value, fallbackValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallbackValue;
  return parsed;
}

function toIsoNow(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

export function evaluateDualPilotReadiness(
  dualReplication = {},
  {
    nowIso = new Date().toISOString(),
    minEvents = 40,
    minSyncedRate = 0.98,
    maxDegradedRate = 0.02,
    maxDisabledRate = 0
  } = {}
) {
  const generatedAtIso = toIsoNow(nowIso);
  const totalEvents = Number(dualReplication?.total_events || 0);
  const syncedRate = Number(dualReplication?.synced_rate || 0);
  const degradedRate = Number(dualReplication?.degraded_rate || 0);
  const disabledRate = Number(dualReplication?.disabled_rate || 0);
  const effectiveThresholds = {
    min_events: parsePositiveInteger(minEvents, 40),
    min_synced_rate: parseRate(minSyncedRate, 0.98),
    max_degraded_rate: parseRate(maxDegradedRate, 0.02),
    max_disabled_rate: parseRate(maxDisabledRate, 0)
  };

  const reasons = [];
  if (totalEvents < effectiveThresholds.min_events) {
    reasons.push(
      `Volume dual insuffisant: ${totalEvents} event(s) < seuil ${effectiveThresholds.min_events}.`
    );
    return {
      generated_at_iso: generatedAtIso,
      status: "insufficient_data",
      ready: false,
      thresholds: effectiveThresholds,
      metrics: {
        total_events: totalEvents,
        synced_rate: syncedRate,
        degraded_rate: degradedRate,
        disabled_rate: disabledRate
      },
      reasons
    };
  }

  if (syncedRate < effectiveThresholds.min_synced_rate) {
    reasons.push(
      `Synced rate insuffisant: ${syncedRate.toFixed(4)} < seuil ${effectiveThresholds.min_synced_rate.toFixed(4)}.`
    );
  }
  if (degradedRate > effectiveThresholds.max_degraded_rate) {
    reasons.push(
      `Degraded rate au-dessus du seuil: ${degradedRate.toFixed(4)} > ${effectiveThresholds.max_degraded_rate.toFixed(4)}.`
    );
  }
  if (disabledRate > effectiveThresholds.max_disabled_rate) {
    reasons.push(
      `Disabled rate au-dessus du seuil: ${disabledRate.toFixed(4)} > ${effectiveThresholds.max_disabled_rate.toFixed(4)}.`
    );
  }

  const ready = reasons.length === 0;
  return {
    generated_at_iso: generatedAtIso,
    status: ready ? "ready" : "not_ready",
    ready,
    thresholds: effectiveThresholds,
    metrics: {
      total_events: totalEvents,
      synced_rate: syncedRate,
      degraded_rate: degradedRate,
      disabled_rate: disabledRate,
      last_event_at_iso: dualReplication?.last_event_at_iso || null,
      last_degraded_event: dualReplication?.last_degraded_event || null,
      strict_events: toNullableNumber(dualReplication?.strict_events)
    },
    reasons
  };
}

export function evaluateDualPilotCanaryGate(
  readinessWindows = [],
  {
    nowIso = new Date().toISOString(),
    requiredConsecutiveWindows = 2,
    windowDays = 7
  } = {}
) {
  const generatedAtIso = toIsoNow(nowIso);
  const requiredWindows = parsePositiveInteger(requiredConsecutiveWindows, 2);
  const effectiveWindowDays = parsePositiveInteger(windowDays, 7);
  const windows = Array.isArray(readinessWindows)
    ? readinessWindows.filter((item) => item && typeof item === "object")
    : [];
  const evaluatedWindows = windows.slice(0, requiredWindows);
  const reasons = [];

  if (evaluatedWindows.length < requiredWindows) {
    reasons.push(
      `Fenetres dual insuffisantes: ${evaluatedWindows.length} < ${requiredWindows}.`
    );
    return {
      generated_at_iso: generatedAtIso,
      status: "insufficient_data",
      canary_allowed: false,
      required_consecutive_windows: requiredWindows,
      window_days: effectiveWindowDays,
      evaluated_windows_count: evaluatedWindows.length,
      reasons
    };
  }

  const insufficientDataWindows = evaluatedWindows.filter(
    (item) => String(item?.status || "") === "insufficient_data"
  );
  if (insufficientDataWindows.length > 0) {
    reasons.push(
      `${insufficientDataWindows.length} fenetre(s) avec volume insuffisant sur ${requiredWindows}.`
    );
    return {
      generated_at_iso: generatedAtIso,
      status: "blocked_insufficient_data",
      canary_allowed: false,
      required_consecutive_windows: requiredWindows,
      window_days: effectiveWindowDays,
      evaluated_windows_count: evaluatedWindows.length,
      reasons
    };
  }

  const nonReadyWindows = evaluatedWindows.filter((item) => !Boolean(item?.ready));
  if (nonReadyWindows.length > 0) {
    reasons.push(
      `${nonReadyWindows.length} fenetre(s) non ready sur ${requiredWindows}.`
    );
    return {
      generated_at_iso: generatedAtIso,
      status: "blocked_not_ready",
      canary_allowed: false,
      required_consecutive_windows: requiredWindows,
      window_days: effectiveWindowDays,
      evaluated_windows_count: evaluatedWindows.length,
      reasons
    };
  }

  return {
    generated_at_iso: generatedAtIso,
    status: "ready",
    canary_allowed: true,
    required_consecutive_windows: requiredWindows,
    window_days: effectiveWindowDays,
    evaluated_windows_count: evaluatedWindows.length,
    reasons
  };
}
