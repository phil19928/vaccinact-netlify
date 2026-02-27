import officineMatrixData from "./data/officine-matrix.v1.json" with { type: "json" };
import {
  buildOfficineMatrixMonitorStatus,
  deliverOfficineMatrixMonitorAlert
} from "./lib/officineMatrixMonitor.js";

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function parseBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === "") return fallbackValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "oui"].includes(normalized)) return true;
  if (["0", "false", "no", "non"].includes(normalized)) return false;
  return fallbackValue;
}

function toTrimmedString(value) {
  return String(value || "").trim();
}

function parseDeliveryMode(value, fallbackValue = "signed_webhook") {
  const normalized = toTrimmedString(value).toLowerCase();
  if (["slack", "slack_webhook", "slack_incoming"].includes(normalized)) return "slack";
  if (
    ["signed_webhook", "generic", "webhook", "vaccinact_json", "signed_json"].includes(normalized)
  ) {
    return "signed_webhook";
  }
  return fallbackValue;
}

export const config = {
  schedule: "0 7 * * *"
};

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
    const maxSourceAgeDays = parsePositiveInteger(
      body.max_source_age_days ??
        query.max_source_age_days ??
        process.env.OFFICINE_MATRIX_MONITOR_MAX_SOURCE_AGE_DAYS,
      180
    );
    const staleSourceAlertThreshold = Number(
      body.stale_source_alert_threshold ??
        query.stale_source_alert_threshold ??
        process.env.OFFICINE_MATRIX_MONITOR_STALE_SOURCE_ALERT_THRESHOLD ??
        0
    );
    const requireReadyForRegulatorySignoff = parseBoolean(
      body.require_ready_for_regulatory_signoff ??
        query.require_ready_for_regulatory_signoff ??
        process.env.OFFICINE_MATRIX_MONITOR_REQUIRE_READY_FOR_REGULATORY_SIGNOFF,
      true
    );
    const sendWebhook = parseBoolean(
      body.send_webhook ?? query.send_webhook ?? process.env.OFFICINE_MATRIX_MONITOR_SEND_WEBHOOK,
      true
    );
    const sendWebhookOnOk = parseBoolean(
      body.send_webhook_on_ok ??
        query.send_webhook_on_ok ??
        process.env.OFFICINE_MATRIX_MONITOR_SEND_WEBHOOK_ON_OK,
      false
    );
    const deliveryMode = parseDeliveryMode(
      body.delivery_mode ??
        query.delivery_mode ??
        process.env.OFFICINE_MATRIX_MONITOR_DELIVERY_MODE,
      "signed_webhook"
    );
    const failOnAlert = parseBoolean(
      body.fail_on_alert ?? query.fail_on_alert ?? process.env.OFFICINE_MATRIX_MONITOR_FAIL_ON_ALERT,
      false
    );
    const webhookUrl = toTrimmedString(
      body.webhook_url ??
        query.webhook_url ??
        (deliveryMode === "slack"
          ? process.env.OFFICINE_MATRIX_MONITOR_SLACK_WEBHOOK_URL
          : process.env.OFFICINE_MATRIX_MONITOR_WEBHOOK_URL) ??
        process.env.OFFICINE_MATRIX_MONITOR_WEBHOOK_URL
    );
    const opsEnvironment = toTrimmedString(
      body.ops_environment ??
        query.ops_environment ??
        process.env.OFFICINE_MATRIX_MONITOR_OPS_ENVIRONMENT
    );
    const dashboardUrl = toTrimmedString(
      body.dashboard_url ?? query.dashboard_url ?? process.env.OFFICINE_MATRIX_MONITOR_DASHBOARD_URL
    );
    const runbookUrl = toTrimmedString(
      body.runbook_url ?? query.runbook_url ?? process.env.OFFICINE_MATRIX_MONITOR_RUNBOOK_URL
    );

    const monitor = buildOfficineMatrixMonitorStatus(officineMatrixData, {
      nowIso,
      maxSourceAgeDays,
      staleSourceAlertThreshold,
      requireReadyForRegulatorySignoff
    });

    const requestId =
      event?.headers?.["x-nf-request-id"] ||
      event?.headers?.["X-Nf-Request-Id"] ||
      event?.headers?.["x-request-id"] ||
      event?.headers?.["X-Request-Id"] ||
      "";
    const delivery = sendWebhook
      ? await deliverOfficineMatrixMonitorAlert({
          monitor,
          webhookUrl,
          webhookSecret: process.env.OFFICINE_MATRIX_MONITOR_WEBHOOK_SECRET,
          deliveryMode,
          sendOnOk: sendWebhookOnOk,
          eventName: String(
            process.env.OFFICINE_MATRIX_MONITOR_EVENT_NAME || "officine_matrix_monitor"
          ),
          opsEnvironment,
          dashboardUrl,
          runbookUrl,
          requestId,
          nowIso
        })
      : {
          enabled: false
        };

    const statusCode = failOnAlert && !monitor.ok ? 503 : 200;
    return {
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monitor,
        config: {
          send_webhook: sendWebhook,
          delivery_mode: deliveryMode
        },
        delivery
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
