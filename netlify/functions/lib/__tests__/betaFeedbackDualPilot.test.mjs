import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateDualPilotCanaryGate,
  evaluateDualPilotReadiness
} from "../betaFeedbackDualPilot.js";

test("evaluateDualPilotReadiness returns insufficient_data when total events are below threshold", () => {
  const result = evaluateDualPilotReadiness(
    {
      total_events: 12,
      synced_rate: 1,
      degraded_rate: 0,
      disabled_rate: 0
    },
    {
      nowIso: "2026-02-26T12:00:00.000Z",
      minEvents: 40
    }
  );

  assert.equal(result.ready, false);
  assert.equal(result.status, "insufficient_data");
  assert.ok(result.reasons.some((line) => line.includes("Volume dual insuffisant")));
});

test("evaluateDualPilotReadiness returns ready when all thresholds are met", () => {
  const result = evaluateDualPilotReadiness(
    {
      total_events: 80,
      synced_rate: 0.99,
      degraded_rate: 0.01,
      disabled_rate: 0,
      last_event_at_iso: "2026-02-26T10:00:00.000Z"
    },
    {
      nowIso: "2026-02-26T12:00:00.000Z",
      minEvents: 40,
      minSyncedRate: 0.98,
      maxDegradedRate: 0.02,
      maxDisabledRate: 0
    }
  );

  assert.equal(result.ready, true);
  assert.equal(result.status, "ready");
  assert.equal(result.reasons.length, 0);
});

test("evaluateDualPilotReadiness returns not_ready when rates breach thresholds", () => {
  const result = evaluateDualPilotReadiness(
    {
      total_events: 50,
      synced_rate: 0.9,
      degraded_rate: 0.08,
      disabled_rate: 0.02
    },
    {
      nowIso: "2026-02-26T12:00:00.000Z",
      minEvents: 40,
      minSyncedRate: 0.98,
      maxDegradedRate: 0.02,
      maxDisabledRate: 0
    }
  );

  assert.equal(result.ready, false);
  assert.equal(result.status, "not_ready");
  assert.ok(result.reasons.some((line) => line.includes("Synced rate insuffisant")));
  assert.ok(result.reasons.some((line) => line.includes("Degraded rate au-dessus du seuil")));
  assert.ok(result.reasons.some((line) => line.includes("Disabled rate au-dessus du seuil")));
});

test("evaluateDualPilotCanaryGate returns ready when required consecutive windows are ready", () => {
  const gate = evaluateDualPilotCanaryGate(
    [
      { status: "ready", ready: true },
      { status: "ready", ready: true }
    ],
    {
      nowIso: "2026-02-26T12:00:00.000Z",
      requiredConsecutiveWindows: 2,
      windowDays: 7
    }
  );

  assert.equal(gate.status, "ready");
  assert.equal(gate.canary_allowed, true);
  assert.equal(gate.reasons.length, 0);
});

test("evaluateDualPilotCanaryGate blocks when at least one window is not_ready", () => {
  const gate = evaluateDualPilotCanaryGate(
    [
      { status: "ready", ready: true },
      { status: "not_ready", ready: false }
    ],
    {
      nowIso: "2026-02-26T12:00:00.000Z",
      requiredConsecutiveWindows: 2,
      windowDays: 7
    }
  );

  assert.equal(gate.status, "blocked_not_ready");
  assert.equal(gate.canary_allowed, false);
  assert.ok(gate.reasons.some((line) => line.includes("non ready")));
});

test("evaluateDualPilotCanaryGate blocks on insufficient_data windows", () => {
  const gate = evaluateDualPilotCanaryGate(
    [
      { status: "ready", ready: true },
      { status: "insufficient_data", ready: false }
    ],
    {
      nowIso: "2026-02-26T12:00:00.000Z",
      requiredConsecutiveWindows: 2,
      windowDays: 7
    }
  );

  assert.equal(gate.status, "blocked_insufficient_data");
  assert.equal(gate.canary_allowed, false);
});
