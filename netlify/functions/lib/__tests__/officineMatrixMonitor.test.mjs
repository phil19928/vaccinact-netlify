import test from "node:test";
import assert from "node:assert/strict";

import matrixData from "../../data/officine-matrix.v1.json" with { type: "json" };
import {
  buildOfficineMatrixMonitorStatus,
  buildOfficineMatrixSlackPayload,
  deliverOfficineMatrixMonitorAlert
} from "../officineMatrixMonitor.js";

test("buildOfficineMatrixMonitorStatus returns ok when matrix is fresh and consolidated", () => {
  const monitor = buildOfficineMatrixMonitorStatus(matrixData, {
    nowIso: "2026-02-26T12:00:00.000Z",
    maxSourceAgeDays: 365,
    staleSourceAlertThreshold: 0,
    requireReadyForRegulatorySignoff: true
  });

  assert.equal(monitor.ok, true);
  assert.equal(monitor.status, "ok");
  assert.equal(monitor.audit.ready_for_regulatory_signoff, true);
  assert.equal(monitor.alert_reasons.length, 0);
});

test("buildOfficineMatrixMonitorStatus alerts when stale source references exceed threshold", () => {
  const monitor = buildOfficineMatrixMonitorStatus(matrixData, {
    nowIso: "2027-12-31T00:00:00.000Z",
    maxSourceAgeDays: 30,
    staleSourceAlertThreshold: 0
  });

  assert.equal(monitor.ok, false);
  assert.equal(monitor.status, "alert");
  assert.ok(monitor.alert_reasons.some((line) => line.includes("Sources stale detectees")));
});

test("buildOfficineMatrixMonitorStatus can tolerate non-ready matrix if requireReady is disabled", () => {
  const customMatrix = structuredClone(matrixData);
  customMatrix.entries.hpv.status = "to_confirm";
  customMatrix.entries.hpv.review_status = "to_confirm";
  customMatrix.entries.hpv.references[0].status = "to_confirm";

  const monitor = buildOfficineMatrixMonitorStatus(customMatrix, {
    nowIso: "2026-02-26T12:00:00.000Z",
    requireReadyForRegulatorySignoff: false
  });

  assert.equal(monitor.ok, true);
  assert.equal(monitor.status, "ok");
  assert.equal(monitor.audit.ready_for_regulatory_signoff, false);
});

test("deliverOfficineMatrixMonitorAlert skips when webhook URL is missing", async () => {
  const monitor = buildOfficineMatrixMonitorStatus(matrixData, {
    nowIso: "2026-02-26T12:00:00.000Z"
  });
  const delivery = await deliverOfficineMatrixMonitorAlert({
    monitor,
    webhookUrl: ""
  });

  assert.equal(delivery.enabled, false);
});

test("deliverOfficineMatrixMonitorAlert skips ok state when sendOnOk is false", async () => {
  const monitor = buildOfficineMatrixMonitorStatus(matrixData, {
    nowIso: "2026-02-26T12:00:00.000Z"
  });
  const delivery = await deliverOfficineMatrixMonitorAlert({
    monitor,
    webhookUrl: "https://example.test/officine-monitor",
    sendOnOk: false
  });

  assert.equal(delivery.enabled, true);
  assert.equal(delivery.skipped, true);
});

test("deliverOfficineMatrixMonitorAlert forwards alert payload when monitor is in alert state", async () => {
  const monitor = buildOfficineMatrixMonitorStatus(matrixData, {
    nowIso: "2027-12-31T00:00:00.000Z",
    maxSourceAgeDays: 30
  });

  let capturedPayload = null;
  const delivery = await deliverOfficineMatrixMonitorAlert({
    monitor,
    webhookUrl: "https://example.test/officine-monitor",
    nowIso: "2027-12-31T00:00:00.000Z",
    forwarder: async (payload) => {
      capturedPayload = payload;
      return { enabled: true, ok: true, status: 202 };
    }
  });

  assert.equal(delivery.ok, true);
  assert.ok(capturedPayload);
  assert.equal(capturedPayload.eventName, "officine_matrix_monitor");
  assert.equal(capturedPayload.summary.monitor_status, "alert");
  assert.ok(Array.isArray(capturedPayload.entries));
  assert.ok(capturedPayload.entries.some((entry) => entry.category === "stale_source_reference"));
});

test("buildOfficineMatrixSlackPayload includes status, reasons and ops links", () => {
  const monitor = buildOfficineMatrixMonitorStatus(matrixData, {
    nowIso: "2027-12-31T00:00:00.000Z",
    maxSourceAgeDays: 30
  });

  const payload = buildOfficineMatrixSlackPayload(monitor, {
    opsEnvironment: "staging",
    dashboardUrl: "https://ops.example/dashboard",
    runbookUrl: "https://ops.example/runbook",
    nowIso: "2027-12-31T00:00:00.000Z"
  });

  assert.ok(payload.text.includes("[staging]"));
  assert.ok(payload.text.includes("ALERT"));
  assert.ok(Array.isArray(payload.blocks));
  assert.ok(payload.blocks.some((block) => String(block?.text?.text || "").includes("Runbook")));
});

test("deliverOfficineMatrixMonitorAlert uses slack mode when requested", async () => {
  const monitor = buildOfficineMatrixMonitorStatus(matrixData, {
    nowIso: "2027-12-31T00:00:00.000Z",
    maxSourceAgeDays: 30
  });

  let capturedSlackDelivery = null;
  const delivery = await deliverOfficineMatrixMonitorAlert({
    monitor,
    webhookUrl: "https://hooks.slack.test/services/a/b/c",
    deliveryMode: "slack",
    opsEnvironment: "prod",
    dashboardUrl: "https://ops.example/dashboard",
    runbookUrl: "https://ops.example/runbook",
    slackSender: async (payload) => {
      capturedSlackDelivery = payload;
      return { enabled: true, ok: true, mode: "slack", status: 200 };
    },
    forwarder: async () => {
      throw new Error("forwarder should not be called in slack mode");
    }
  });

  assert.equal(delivery.enabled, true);
  assert.equal(delivery.mode, "slack");
  assert.ok(capturedSlackDelivery);
  assert.ok(capturedSlackDelivery.payload.text.includes("ALERT"));
  assert.ok(
    capturedSlackDelivery.payload.blocks.some((block) =>
      String(block?.text?.text || "").includes("ops.example/runbook")
    )
  );
});
