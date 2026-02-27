import {
  evaluateDualPilotCanaryGate,
  evaluateDualPilotReadiness
} from "./lib/betaFeedbackDualPilot.js";
import { inspectPrimaryStore } from "./lib/betaFeedbackPrimaryStore.js";

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

function parseBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === "") return fallbackValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "oui"].includes(normalized)) return true;
  if (["0", "false", "no", "non"].includes(normalized)) return false;
  return fallbackValue;
}

function parseIsoNow(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function shiftIsoByDays(baseIso, daysDelta) {
  const baseDate = new Date(parseIsoNow(baseIso));
  baseDate.setUTCDate(baseDate.getUTCDate() + Number(daysDelta || 0));
  return baseDate.toISOString();
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    const query = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};
    const nowIso = parseIsoNow(body.now_iso ?? query.now_iso ?? new Date().toISOString());
    const windowDays = parsePositiveInteger(
      body.window_days ?? query.window_days ?? process.env.BETA_FEEDBACK_DUAL_PILOT_WINDOW_DAYS,
      7
    );
    const requiredWindows = parsePositiveInteger(
      body.required_windows ??
        query.required_windows ??
        process.env.BETA_FEEDBACK_DUAL_CANARY_REQUIRED_WINDOWS,
      2
    );
    const minEvents = parsePositiveInteger(
      body.min_events ?? query.min_events ?? process.env.BETA_FEEDBACK_DUAL_PILOT_MIN_EVENTS,
      40
    );
    const minSyncedRate = parseRate(
      body.min_synced_rate ??
        query.min_synced_rate ??
        process.env.BETA_FEEDBACK_DUAL_PILOT_MIN_SYNCED_RATE,
      0.98
    );
    const maxDegradedRate = parseRate(
      body.max_degraded_rate ??
        query.max_degraded_rate ??
        process.env.BETA_FEEDBACK_DUAL_PILOT_MAX_DEGRADED_RATE,
      0.02
    );
    const maxDisabledRate = parseRate(
      body.max_disabled_rate ??
        query.max_disabled_rate ??
        process.env.BETA_FEEDBACK_DUAL_PILOT_MAX_DISABLED_RATE,
      0
    );
    const failOnBlocked = parseBoolean(
      body.fail_on_blocked ??
        query.fail_on_blocked ??
        process.env.BETA_FEEDBACK_DUAL_CANARY_FAIL_ON_BLOCKED,
      false
    );

    const currentPrimaryStore = await inspectPrimaryStore({
      mode: process.env.BETA_FEEDBACK_PRIMARY_STORE_MODE,
      sqlitePath: process.env.BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH,
      webhookUrl: process.env.BETA_FEEDBACK_PRIMARY_STORE_URL,
      dualWindowDays: windowDays,
      nowIso
    });

    if (String(currentPrimaryStore?.mode || "") !== "dual") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Primary store mode is not dual. Canary gate is not applicable.",
          primary_store: currentPrimaryStore
        })
      };
    }

    const windows = [];
    for (let index = 0; index < requiredWindows; index += 1) {
      const windowNowIso = shiftIsoByDays(nowIso, -index * windowDays);
      const primaryStore =
        index === 0
          ? currentPrimaryStore
          : await inspectPrimaryStore({
              mode: process.env.BETA_FEEDBACK_PRIMARY_STORE_MODE,
              sqlitePath: process.env.BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH,
              webhookUrl: process.env.BETA_FEEDBACK_PRIMARY_STORE_URL,
              dualWindowDays: windowDays,
              nowIso: windowNowIso
            });

      if (!primaryStore?.ok || !primaryStore?.dual_replication) {
        return {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Dual replication snapshot unavailable for canary gate evaluation.",
            window_index: index,
            primary_store: primaryStore
          })
        };
      }

      const readiness = evaluateDualPilotReadiness(primaryStore.dual_replication, {
        nowIso: windowNowIso,
        minEvents,
        minSyncedRate,
        maxDegradedRate,
        maxDisabledRate
      });

      windows.push({
        window_index: index,
        window_label: index === 0 ? "current" : `previous_${index}`,
        evaluated_at_iso: windowNowIso,
        dual_replication: primaryStore.dual_replication,
        readiness
      });
    }

    const gate = evaluateDualPilotCanaryGate(
      windows.map((window) => window.readiness),
      {
        nowIso,
        requiredConsecutiveWindows: requiredWindows,
        windowDays
      }
    );
    const statusCode = failOnBlocked && !gate.canary_allowed ? 503 : 200;

    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary_store: {
          mode: currentPrimaryStore.mode,
          ok: currentPrimaryStore.ok,
          replica_http: currentPrimaryStore.replica_http || null
        },
        windows,
        gate
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: String(error)
      })
    };
  }
};
