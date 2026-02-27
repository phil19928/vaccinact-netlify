import { forwardFeedbackToWebhook } from "./betaFeedbackDelivery.js";
import { auditOfficineMatrix } from "./officineMatrix.js";

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

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
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

export function buildOfficineMatrixMonitorStatus(
  matrix = {},
  {
    nowIso = new Date().toISOString(),
    maxSourceAgeDays = 180,
    staleSourceAlertThreshold = 0,
    requireReadyForRegulatorySignoff = true
  } = {}
) {
  const effectiveNowIso = toTrimmedString(nowIso) || new Date().toISOString();
  const effectiveMaxSourceAgeDays = parsePositiveInteger(maxSourceAgeDays, 180);
  const effectiveStaleThreshold = Number.isFinite(Number(staleSourceAlertThreshold))
    ? Math.max(Number(staleSourceAlertThreshold), 0)
    : 0;
  const effectiveRequireReady = parseBoolean(requireReadyForRegulatorySignoff, true);

  const audit = auditOfficineMatrix(matrix, {
    nowIso: effectiveNowIso,
    maxSourceAgeDays: effectiveMaxSourceAgeDays
  });
  const summary = audit?.summary || {};
  const alertReasons = [];

  if ((Number(summary.stale_source_references_count) || 0) > effectiveStaleThreshold) {
    alertReasons.push(
      `Sources stale detectees: ${summary.stale_source_references_count} (> seuil ${effectiveStaleThreshold}).`
    );
  }
  if ((Number(summary.missing_source_catalog_refs_count) || 0) > 0) {
    alertReasons.push(
      `References de matrice sans source catalog: ${summary.missing_source_catalog_refs_count}.`
    );
  }
  if ((Number(summary.entries_missing_references_count) || 0) > 0) {
    alertReasons.push(
      `Entrees de matrice sans references explicites: ${summary.entries_missing_references_count}.`
    );
  }
  if ((Number(summary.confirmed_entries_without_confirmed_reference_count) || 0) > 0) {
    alertReasons.push(
      `Entrees confirmees sans reference confirmee: ${summary.confirmed_entries_without_confirmed_reference_count}.`
    );
  }
  if (effectiveRequireReady && !audit.ready_for_regulatory_signoff) {
    alertReasons.push("Matrice non prete pour validation reglementaire.");
  }

  const status = alertReasons.length > 0 ? "alert" : "ok";
  return {
    generated_at_iso: effectiveNowIso,
    status,
    ok: status === "ok",
    thresholds: {
      max_source_age_days: effectiveMaxSourceAgeDays,
      stale_source_alert_threshold: effectiveStaleThreshold,
      require_ready_for_regulatory_signoff: effectiveRequireReady
    },
    alert_reasons: alertReasons,
    audit
  };
}

function buildMonitorEntries(monitor = {}) {
  return [
    ...(Array.isArray(monitor?.audit?.stale_source_references)
      ? monitor.audit.stale_source_references.map((item) => ({
          category: "stale_source_reference",
          ...item
        }))
      : []),
    ...(Array.isArray(monitor?.audit?.missing_source_catalog_references)
      ? monitor.audit.missing_source_catalog_references.map((item) => ({
          category: "missing_source_catalog_reference",
          ...item
        }))
      : [])
  ];
}

export function buildOfficineMatrixSlackPayload(
  monitor = {},
  {
    opsEnvironment = "",
    dashboardUrl = "",
    runbookUrl = "",
    nowIso = new Date().toISOString()
  } = {}
) {
  const monitorStatus = String(monitor?.status || "alert");
  const summary = monitor?.audit?.summary || {};
  const alertReasons = Array.isArray(monitor?.alert_reasons) ? monitor.alert_reasons : [];
  const staleCount = Number(summary.stale_source_references_count || 0);
  const missingCatalogCount = Number(summary.missing_source_catalog_refs_count || 0);
  const missingRefsCount = Number(summary.entries_missing_references_count || 0);
  const readyFlag = monitor?.audit?.ready_for_regulatory_signoff ? "yes" : "no";
  const envLabel = toTrimmedString(opsEnvironment) || "production";
  const statusLabel = monitorStatus === "ok" ? "OK" : "ALERT";
  const generatedAtIso = toTrimmedString(nowIso) || new Date().toISOString();
  const links = [];
  if (toTrimmedString(dashboardUrl)) links.push(`<${toTrimmedString(dashboardUrl)}|Dashboard>`);
  if (toTrimmedString(runbookUrl)) links.push(`<${toTrimmedString(runbookUrl)}|Runbook>`);
  const reasonsText =
    alertReasons.length > 0
      ? alertReasons.map((reason, index) => `${index + 1}. ${reason}`).join("\n")
      : "Aucune raison d alerte active.";
  const linksText = links.length > 0 ? `\nLiens: ${links.join(" | ")}` : "";
  const text = [
    `[VaccinAct][${envLabel}] officine-matrix-monitor ${statusLabel}`,
    `stale=${staleCount}`,
    `missing_catalog=${missingCatalogCount}`,
    `missing_refs=${missingRefsCount}`,
    `ready=${readyFlag}`
  ].join(" | ");

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*VaccinAct Officine Matrix Monitor* (${envLabel})\nStatus: *${statusLabel}*`
        }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Stale sources*\n${staleCount}` },
          { type: "mrkdwn", text: `*Missing source catalog*\n${missingCatalogCount}` },
          { type: "mrkdwn", text: `*Entries missing refs*\n${missingRefsCount}` },
          { type: "mrkdwn", text: `*Ready for signoff*\n${readyFlag}` }
        ]
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Alert reasons*\n${reasonsText}${linksText}`
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `generated_at_iso=${generatedAtIso}`
          }
        ]
      }
    ]
  };
}

export async function sendOfficineMatrixMonitorSlackAlert({
  webhookUrl = "",
  payload = {},
  requestId = "",
  maxAttempts = 3,
  retryBaseDelayMs = 300,
  timeoutMs = 5000,
  fetchImpl = globalThis.fetch,
  waitImpl = wait
} = {}) {
  const normalizedWebhookUrl = toTrimmedString(webhookUrl);
  if (!normalizedWebhookUrl) {
    return {
      enabled: false
    };
  }

  if (typeof fetchImpl !== "function") {
    return {
      enabled: true,
      ok: false,
      error: "Fetch API is not available in this runtime."
    };
  }

  const effectiveAttempts = parsePositiveInteger(maxAttempts, 3);
  const effectiveRetryBaseDelayMs = parsePositiveInteger(retryBaseDelayMs, 300);
  const effectiveTimeoutMs = parsePositiveInteger(timeoutMs, 5000);
  const attempts = [];
  const payloadJson = JSON.stringify(payload || {});

  for (let attempt = 1; attempt <= effectiveAttempts; attempt += 1) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutHandle = setTimeout(() => {
      if (controller) controller.abort();
    }, effectiveTimeoutMs);

    try {
      const response = await fetchImpl(normalizedWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestId ? { "X-VaccinAct-Request-Id": requestId } : {})
        },
        body: payloadJson,
        ...(controller ? { signal: controller.signal } : {})
      });

      clearTimeout(timeoutHandle);
      attempts.push({
        attempt,
        status: response.status,
        ok: response.ok
      });

      if (response.ok) {
        return {
          enabled: true,
          ok: true,
          mode: "slack",
          status: response.status,
          attempts
        };
      }

      if (!shouldRetryStatus(response.status) || attempt >= effectiveAttempts) {
        return {
          enabled: true,
          ok: false,
          mode: "slack",
          status: response.status,
          attempts
        };
      }
    } catch (error) {
      clearTimeout(timeoutHandle);
      attempts.push({
        attempt,
        ok: false,
        error: String(error)
      });

      if (attempt >= effectiveAttempts) {
        return {
          enabled: true,
          ok: false,
          mode: "slack",
          attempts,
          error: String(error)
        };
      }
    }

    const delayMs = effectiveRetryBaseDelayMs * 2 ** (attempt - 1);
    await waitImpl(delayMs);
  }

  return {
    enabled: true,
    ok: false,
    mode: "slack",
    attempts,
    error: "Unexpected Slack delivery termination."
  };
}

export async function deliverOfficineMatrixMonitorAlert({
  monitor = {},
  webhookUrl = "",
  webhookSecret = "",
  deliveryMode = "signed_webhook",
  sendOnOk = false,
  eventName = "officine_matrix_monitor",
  opsEnvironment = "",
  dashboardUrl = "",
  runbookUrl = "",
  requestId = "",
  nowIso = new Date().toISOString(),
  source = "vaccinact-netlify-officine-matrix-monitor",
  forwarder = forwardFeedbackToWebhook,
  slackSender = sendOfficineMatrixMonitorSlackAlert
} = {}) {
  const normalizedWebhookUrl = toTrimmedString(webhookUrl);
  if (!normalizedWebhookUrl) {
    return {
      enabled: false
    };
  }

  const monitorStatus = String(monitor?.status || "alert");
  const shouldSendOnOk = parseBoolean(sendOnOk, false);
  if (monitorStatus === "ok" && !shouldSendOnOk) {
    return {
      enabled: true,
      skipped: true,
      reason: "monitor_ok_and_send_on_ok_disabled"
    };
  }

  const sentAtIso = toTrimmedString(nowIso) || new Date().toISOString();
  const batchId = `officine-matrix-monitor:${sentAtIso.slice(0, 10)}`;
  const summary = monitor?.audit?.summary || {};
  const goNoGo = {
    status: monitor?.ok ? "go" : "no_go"
  };
  const archive = {
    monitor_status: monitorStatus,
    ready_for_regulatory_signoff: Boolean(monitor?.audit?.ready_for_regulatory_signoff),
    thresholds: monitor?.thresholds || {}
  };
  const entries = buildMonitorEntries(monitor);
  const effectiveDeliveryMode = parseDeliveryMode(deliveryMode, "signed_webhook");

  if (effectiveDeliveryMode === "slack") {
    const slackPayload = buildOfficineMatrixSlackPayload(monitor, {
      opsEnvironment,
      dashboardUrl,
      runbookUrl,
      nowIso: sentAtIso
    });
    return slackSender({
      webhookUrl: normalizedWebhookUrl,
      payload: slackPayload,
      requestId
    });
  }

  return forwarder({
    webhookUrl: normalizedWebhookUrl,
    webhookSecret,
    entries,
    summary: {
      monitor_status: monitorStatus,
      ...summary
    },
    goNoGo,
    archive,
    source,
    eventName,
    extraPayload: {
      monitor
    },
    batchId,
    idempotencyKey: `vaccinact-officine-matrix-monitor:${batchId}`,
    requestId,
    nowIso: sentAtIso
  });
}
