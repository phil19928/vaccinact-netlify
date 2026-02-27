#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function toTrimmedString(value) {
  return String(value || "").trim();
}

function parseCliOptions(argv = []) {
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rest] = arg.slice(2).split("=");
    const key = toTrimmedString(rawKey);
    const value = rest.join("=");
    if (key) options[key] = value === "" ? "1" : value;
  }
  return options;
}

function toIsoNow(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function compactUtcTimestamp(value) {
  return toIsoNow(value).replace(/[-:.]/g, "").replace("T", "_").replace("Z", "Z");
}

async function requestJson({ method = "GET", url = "", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw_body: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const nowIso = toIsoNow(new Date().toISOString());
  const baseUrl = toTrimmedString(
    options.base_url || process.env.VACCINACT_LOCAL_BASE_URL || "http://localhost:8888/.netlify/functions"
  );
  const forcedMonitorNowIso = toTrimmedString(
    options.monitor_now_iso || process.env.OPS_DRILL_MONITOR_NOW_ISO || "2027-12-31T00:00:00.000Z"
  );
  const proofDir = toTrimmedString(
    options.proof_dir || process.env.OPS_DRILL_PROOF_DIR || "_bmad-output/brainstorming"
  );
  const drillId =
    toTrimmedString(options.drill_id || process.env.OPS_DRILL_ID) ||
    `sev1_officine_${compactUtcTimestamp(nowIso)}`;

  const receiverUrl = `${baseUrl}/ops-drill-receiver`;
  const webhookUrl = `${receiverUrl}?drill_id=${encodeURIComponent(drillId)}`;
  const monitorQuery = new URLSearchParams({
    send_webhook: "1",
    send_webhook_on_ok: "0",
    fail_on_alert: "0",
    delivery_mode: "signed_webhook",
    webhook_url: webhookUrl,
    now_iso: forcedMonitorNowIso,
    max_source_age_days: "30",
    stale_source_alert_threshold: "0",
    require_ready_for_regulatory_signoff: "1",
    ops_environment: "local-drill",
    dashboard_url: "http://localhost:8888/dashboard/officine-matrix",
    runbook_url:
      "http://localhost:8888/_bmad-output/brainstorming/officine-matrix-monitor-runbook-2026-02-26.md"
  });
  const monitorUrl = `${baseUrl}/officine-matrix-monitor?${monitorQuery.toString()}`;

  await requestJson({
    method: "DELETE",
    url: `${receiverUrl}?drill_id=${encodeURIComponent(drillId)}`
  });

  const monitor = await requestJson({
    method: "GET",
    url: monitorUrl
  });
  if (!monitor.ok) {
    throw new Error(`Monitor request failed (${monitor.status}): ${JSON.stringify(monitor.payload)}`);
  }
  if (String(monitor.payload?.monitor?.status || "") !== "alert") {
    throw new Error(
      `Expected monitor.status=alert for SEV-1 drill, got ${monitor.payload?.monitor?.status || "unknown"}`
    );
  }
  if (!monitor.payload?.delivery?.ok) {
    throw new Error(
      `Expected successful webhook delivery during drill, got ${JSON.stringify(monitor.payload?.delivery || {})}`
    );
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });

  const receipts = await requestJson({
    method: "GET",
    url: `${receiverUrl}?drill_id=${encodeURIComponent(drillId)}&limit=5`
  });
  if (!receipts.ok) {
    throw new Error(`Receipt query failed (${receipts.status}): ${JSON.stringify(receipts.payload)}`);
  }
  const totalReceipts = Number(receipts.payload?.total_receipts || 0);
  if (totalReceipts < 1) {
    throw new Error("No receipt found for drill webhook delivery.");
  }

  const proof = {
    generated_at_iso: nowIso,
    drill_id: drillId,
    mode: "SEV-1 simulated",
    monitor_request: {
      url: monitorUrl,
      monitor_now_iso: forcedMonitorNowIso
    },
    monitor_response: {
      status: monitor.status,
      monitor_status: monitor.payload?.monitor?.status,
      alert_reasons: monitor.payload?.monitor?.alert_reasons || [],
      delivery: monitor.payload?.delivery || {}
    },
    receiver_proof: {
      total_receipts: totalReceipts,
      latest_receipt: Array.isArray(receipts.payload?.receipts)
        ? receipts.payload.receipts[0] || null
        : null
    }
  };

  await fs.mkdir(proofDir, { recursive: true });
  const proofFileName = `ops-sev1-drill-proof-${compactUtcTimestamp(nowIso)}.json`;
  const proofPath = path.join(proofDir, proofFileName);
  await fs.writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    drill_id: drillId,
    proof_path: proofPath,
    receipts: totalReceipts
  }));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: String(error)
    })
  );
  process.exitCode = 1;
});
