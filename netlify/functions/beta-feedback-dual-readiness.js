import { evaluateDualPilotReadiness } from "./lib/betaFeedbackDualPilot.js";
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
    const nowIso = String(body.now_iso ?? query.now_iso ?? new Date().toISOString());
    const windowDays = parsePositiveInteger(
      body.window_days ?? query.window_days ?? process.env.BETA_FEEDBACK_DUAL_PILOT_WINDOW_DAYS,
      7
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
    const failOnNotReady = parseBoolean(
      body.fail_on_not_ready ??
        query.fail_on_not_ready ??
        process.env.BETA_FEEDBACK_DUAL_PILOT_FAIL_ON_NOT_READY,
      false
    );

    const primaryStore = await inspectPrimaryStore({
      mode: process.env.BETA_FEEDBACK_PRIMARY_STORE_MODE,
      sqlitePath: process.env.BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH,
      webhookUrl: process.env.BETA_FEEDBACK_PRIMARY_STORE_URL,
      dualWindowDays: windowDays,
      nowIso
    });

    if (String(primaryStore?.mode || "") !== "dual") {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Primary store mode is not dual. Dual pilot readiness is not applicable.",
          primary_store: primaryStore
        })
      };
    }

    if (!primaryStore?.ok || !primaryStore?.dual_replication) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Dual replication snapshot unavailable.",
          primary_store: primaryStore
        })
      };
    }

    const readiness = evaluateDualPilotReadiness(primaryStore.dual_replication, {
      nowIso,
      minEvents,
      minSyncedRate,
      maxDegradedRate,
      maxDisabledRate
    });
    const statusCode = failOnNotReady && !readiness.ready ? 503 : 200;

    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary_store: primaryStore,
        readiness
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
