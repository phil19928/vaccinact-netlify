#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function toTrimmedString(value) {
  return String(value || "").trim();
}

function parseBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === "") return fallbackValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "oui"].includes(normalized)) return true;
  if (["0", "false", "no", "non"].includes(normalized)) return false;
  return fallbackValue;
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

async function requestJson(url) {
  const response = await fetch(url, { method: "GET" });
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

function buildRecommendation({ readiness = {}, gate = {} } = {}) {
  if (gate?.status === "ready" && gate?.canary_allowed) {
    return {
      decision: "eligible_for_http_canary",
      rationale: "Dual pilot gate is ready on required consecutive windows."
    };
  }

  if (readiness?.status === "insufficient_data" || gate?.status === "insufficient_data") {
    return {
      decision: "collect_more_dual_events",
      rationale: "Dual pilot volume is insufficient for a canary decision."
    };
  }

  if (gate?.status === "blocked_insufficient_data") {
    return {
      decision: "wait_previous_windows",
      rationale: "At least one previous window does not have enough events yet."
    };
  }

  if (gate?.status === "blocked_not_ready" || readiness?.status === "not_ready") {
    return {
      decision: "stay_in_dual_investigate_replication",
      rationale: "Replication thresholds are not met on one or more evaluated windows."
    };
  }

  return {
    decision: "not_applicable_or_unavailable",
    rationale: "Dual readiness/gate data unavailable or primary mode is not dual."
  };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const nowIso = toIsoNow(new Date().toISOString());
  const baseUrl = toTrimmedString(
    options.base_url || process.env.VACCINACT_LOCAL_BASE_URL || "http://localhost:8888/.netlify/functions"
  );
  const proofDir = toTrimmedString(
    options.proof_dir || process.env.DUAL_PILOT_PROOF_DIR || "_bmad-output/brainstorming"
  );
  const windowDays = toTrimmedString(options.window_days || process.env.BETA_FEEDBACK_DUAL_PILOT_WINDOW_DAYS || "7");
  const requiredWindows = toTrimmedString(
    options.required_windows || process.env.BETA_FEEDBACK_DUAL_CANARY_REQUIRED_WINDOWS || "2"
  );
  const failOnBlocked = parseBoolean(
    options.fail_on_blocked || process.env.DUAL_PILOT_DECISION_FAIL_ON_BLOCKED,
    false
  );

  const readinessUrl = `${baseUrl}/beta-feedback-dual-readiness?window_days=${encodeURIComponent(windowDays)}`;
  const canaryUrl =
    `${baseUrl}/beta-feedback-dual-canary-gate` +
    `?window_days=${encodeURIComponent(windowDays)}` +
    `&required_windows=${encodeURIComponent(requiredWindows)}`;

  const [readinessResponse, canaryResponse] = await Promise.all([
    requestJson(readinessUrl),
    requestJson(canaryUrl)
  ]);

  const readiness = readinessResponse.payload?.readiness || null;
  const gate = canaryResponse.payload?.gate || null;
  const recommendation = buildRecommendation({ readiness, gate });

  const proof = {
    generated_at_iso: nowIso,
    endpoints: {
      readiness_url: readinessUrl,
      canary_url: canaryUrl
    },
    readiness_response: readinessResponse,
    canary_response: canaryResponse,
    recommendation
  };

  await fs.mkdir(proofDir, { recursive: true });
  const proofPath = path.join(
    proofDir,
    `dual-pilot-decision-proof-${compactUtcTimestamp(nowIso)}.json`
  );
  await fs.writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

  const output = {
    ok: true,
    recommendation: recommendation.decision,
    proof_path: proofPath
  };
  console.log(JSON.stringify(output));

  if (
    failOnBlocked &&
    recommendation.decision !== "eligible_for_http_canary"
  ) {
    process.exitCode = 1;
  }
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
