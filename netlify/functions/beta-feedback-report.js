import { buildFeedbackReport, loadArchivedFeedbackEntries } from "./lib/betaFeedbackReport.js";
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

    const queryWindowDays = event.queryStringParameters?.window_days;
    const queryDualWindowDays = event.queryStringParameters?.dual_window_days;
    const queryDualCanaryRequiredWindows = event.queryStringParameters?.dual_canary_required_windows;
    const body = event.body ? JSON.parse(event.body) : {};
    const bodyWindowDays = body?.window_days;
    const bodyDualWindowDays = body?.dual_window_days;
    const bodyDualCanaryRequiredWindows = body?.dual_canary_required_windows;
    const windowDays = bodyWindowDays ?? queryWindowDays ?? 7;
    const dualWindowDays = bodyDualWindowDays ?? queryDualWindowDays ?? 7;
    const effectiveDualWindowDays = parsePositiveInteger(dualWindowDays, 7);
    const nowIso = new Date().toISOString();
    const dualCanaryRequiredWindows = parsePositiveInteger(
      bodyDualCanaryRequiredWindows ??
        queryDualCanaryRequiredWindows ??
        process.env.BETA_FEEDBACK_DUAL_CANARY_REQUIRED_WINDOWS,
      2
    );

    const archiveData = await loadArchivedFeedbackEntries(process.env.BETA_FEEDBACK_ARCHIVE_PATH);
    if (!archiveData.enabled || archiveData.error) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Archive not available.",
          archive: archiveData
        })
      };
    }

    const report = buildFeedbackReport({
      entries: archiveData.entries,
      windowDays
    });
    const primaryStore = await inspectPrimaryStore({
      mode: process.env.BETA_FEEDBACK_PRIMARY_STORE_MODE,
      sqlitePath: process.env.BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH,
      webhookUrl: process.env.BETA_FEEDBACK_PRIMARY_STORE_URL,
      dualWindowDays: effectiveDualWindowDays,
      nowIso
    });
    const dualPilotReadiness =
      primaryStore?.mode === "dual" && primaryStore?.dual_replication
        ? evaluateDualPilotReadiness(primaryStore.dual_replication, {
            nowIso,
            minEvents: process.env.BETA_FEEDBACK_DUAL_PILOT_MIN_EVENTS,
            minSyncedRate: process.env.BETA_FEEDBACK_DUAL_PILOT_MIN_SYNCED_RATE,
            maxDegradedRate: process.env.BETA_FEEDBACK_DUAL_PILOT_MAX_DEGRADED_RATE,
            maxDisabledRate: process.env.BETA_FEEDBACK_DUAL_PILOT_MAX_DISABLED_RATE
          })
        : null;
    const dualCanaryGate =
      primaryStore?.mode === "dual" && primaryStore?.dual_replication
        ? await (async () => {
            const windows = [];
            for (let index = 0; index < dualCanaryRequiredWindows; index += 1) {
              const windowNowIso = shiftIsoByDays(nowIso, -index * effectiveDualWindowDays);
              const windowPrimaryStore =
                index === 0
                  ? primaryStore
                  : await inspectPrimaryStore({
                      mode: process.env.BETA_FEEDBACK_PRIMARY_STORE_MODE,
                      sqlitePath: process.env.BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH,
                      webhookUrl: process.env.BETA_FEEDBACK_PRIMARY_STORE_URL,
                      dualWindowDays: effectiveDualWindowDays,
                      nowIso: windowNowIso
                    });

              if (!windowPrimaryStore?.ok || !windowPrimaryStore?.dual_replication) {
                return {
                  status: "unavailable",
                  canary_allowed: false,
                  error: "Dual replication snapshot unavailable for one or more canary windows.",
                  failed_window_index: index
                };
              }

              const readiness = evaluateDualPilotReadiness(windowPrimaryStore.dual_replication, {
                nowIso: windowNowIso,
                minEvents: process.env.BETA_FEEDBACK_DUAL_PILOT_MIN_EVENTS,
                minSyncedRate: process.env.BETA_FEEDBACK_DUAL_PILOT_MIN_SYNCED_RATE,
                maxDegradedRate: process.env.BETA_FEEDBACK_DUAL_PILOT_MAX_DEGRADED_RATE,
                maxDisabledRate: process.env.BETA_FEEDBACK_DUAL_PILOT_MAX_DISABLED_RATE
              });
              windows.push({
                window_index: index,
                window_label: index === 0 ? "current" : `previous_${index}`,
                evaluated_at_iso: windowNowIso,
                readiness
              });
            }

            return {
              ...evaluateDualPilotCanaryGate(
                windows.map((window) => window.readiness),
                {
                  nowIso,
                  requiredConsecutiveWindows: dualCanaryRequiredWindows,
                  windowDays: effectiveDualWindowDays
                }
              ),
              windows
            };
          })()
        : null;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        archive: {
          archive_path: archiveData.archive_path,
          total_batches: archiveData.total_batches,
          total_entries: archiveData.total_entries,
          parse_errors: archiveData.parse_errors
        },
        primary_store: primaryStore,
        ...(dualPilotReadiness
          ? {
              dual_pilot_readiness: dualPilotReadiness
            }
          : {}),
        ...(dualCanaryGate
          ? {
              dual_canary_gate: dualCanaryGate
            }
          : {}),
        report
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
