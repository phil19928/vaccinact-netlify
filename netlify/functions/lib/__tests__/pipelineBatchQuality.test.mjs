import test from "node:test";
import assert from "node:assert/strict";

import dictionary from "../../data/product-dictionary.v1.json" with { type: "json" };
import matrixData from "../../data/officine-matrix.v1.json" with { type: "json" };
import { normalizeInputV2 } from "../normalizeInput.js";
import { resolveProductEntries } from "../productDictionary.js";
import { evaluateRules } from "../rulesEngine.js";
import { applySafetyGuardrails } from "../safetyGuardrails.js";
import { applyOfficineMatrix, collectOfficineMatrixLimitations } from "../officineMatrix.js";
import { composeDeterministicOutput } from "../composeOutput.js";

function runDeterministicPipeline(v2Input) {
  const normalized = normalizeInputV2(v2Input);
  const resolved = resolveProductEntries(normalized.vaccine_history_entries, dictionary);
  let engine = evaluateRules({ normalizedInput: normalized, resolvedHistory: resolved, rulesVersion: "v2.0.0" });
  engine = applySafetyGuardrails(engine, normalized, { resolvedHistory: resolved });
  const officineContext = {
    patientAgeYears: normalized?.patient?.age_years,
    riskFlags: normalized?.patient?.risk_flags
  };
  engine.action_now = applyOfficineMatrix(engine.action_now, matrixData, officineContext);
  engine.action_next = applyOfficineMatrix(engine.action_next, matrixData, officineContext);
  const officineLimitations = collectOfficineMatrixLimitations([...(engine.action_now || []), ...(engine.action_next || [])]);
  if (officineLimitations.length > 0) {
    engine.limitations = [...new Set([...(engine.limitations || []), ...officineLimitations])];
  }
  return composeDeterministicOutput({
    engineResult: engine,
    diagnosticDateIso: normalized.diagnostic_date_iso || "2026-02-26"
  });
}

function assertActionIntegrity(action) {
  assert.ok(String(action?.vaccine_name || "").length > 0);
  assert.ok(Array.isArray(action?.references));
  assert.ok((action?.references || []).length >= 1);
  assert.ok(["allowed", "not_allowed", "to_confirm"].includes(String(action?.officine_administration_status || "")));
}

test("Batch quality: multi-product history produces mixed catch-up plan", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 24,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [
      { product_name: "Gardasil 9", administration_date_iso: "2024-05-10" },
      { product_name: "Engerix B10", administration_date_iso: "2025-01-01" },
      { product_name: "Priorix", administration_date_iso: "2025-12-01" },
      { product_name: "Comirnaty", administration_date_iso: "2025-10-01" }
    ]
  });

  const actionNowVaccines = new Set(output.action_now.map((action) => action.vaccine_name));
  const actionNextVaccines = new Set(output.action_next.map((action) => action.vaccine_name));

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(actionNowVaccines.has("HPV"));
  assert.ok(actionNowVaccines.has("HepB"));
  assert.ok(actionNowVaccines.has("ROR"));
  assert.ok(actionNowVaccines.has("Meningocoque ACWY"));
  assert.ok(actionNowVaccines.has("Meningocoque B"));
  assert.ok(actionNextVaccines.has("HPV"));
  assert.ok(actionNextVaccines.has("HepB"));
  assert.ok(actionNextVaccines.has("Meningocoque B"));
  assert.ok(!output.cautions.some((caution) => caution.title === "Produits non reconnus"));
});

test("Batch quality: noisy adolescent record remains actionable but marked needs_more_info", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 12,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: { immunodepression: true }
    },
    vaccine_history_entries: [
      { product_name: "Produit Inconnu", administration_date_iso: "2025-01-10" },
      { product_name: "Priorix", administration_date_iso: "" }
    ]
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.cautions.some((caution) => caution.title === "Immunodepression"));
  assert.ok(output.cautions.some((caution) => caution.title === "Produits non reconnus"));
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.action_now.some((action) => action.vaccine_name === "HPV"));
  assert.ok(output.action_now.some((action) => action.vaccine_name === "Pneumocoque"));
  output.action_now.forEach(assertActionIntegrity);
  output.action_next.forEach(assertActionIntegrity);
});

test("Batch quality: Covid officine boundary at age 5 is allowed", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 5,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  const covidNow = output.action_now.find((action) => action.vaccine_name === "Covid-19");
  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  assert.ok(covidNow);
  assert.equal(covidNow.officine_administration_status, "allowed");
  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "not_allowed");
  assert.ok(output.limitations.some((line) => line.includes("Actes non autorises en officine") && line.includes("Age 5 ans")));
});

test("Batch quality: age 4 has no Covid recommendation and keeps ROR age restriction", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 4,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  const covidNow = output.action_now.find((action) => action.vaccine_name === "Covid-19");
  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  assert.ok(!covidNow);
  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "not_allowed");
  assert.ok(output.limitations.some((line) => line.includes("Actes non autorises en officine") && line.includes("Age 4 ans")));
});

test("Batch quality: high-priority Covid profile schedules next booster when interval is not reached", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Comirnaty", administration_date_iso: "2025-10-01" }]
  });

  const covidNow = output.action_now.find((action) => action.vaccine_name === "Covid-19");
  const covidNext = output.action_next.find((action) => action.vaccine_name === "Covid-19");
  assert.ok(!covidNow);
  assert.ok(covidNext);
  assert.equal(covidNext.proposed_date_iso, "2026-03-30");
  assert.equal(covidNext.officine_administration_status, "allowed");
});

test("Batch quality: conjugate-only pneumococcal history schedules complementary dose when interval not reached", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Prevenar13", administration_date_iso: "2026-02-10" }]
  });

  const pneumoNow = output.action_now.find((action) => action.vaccine_name === "Pneumocoque");
  const pneumoNext = output.action_next.find((action) => action.vaccine_name === "Pneumocoque");
  assert.ok(!pneumoNow);
  assert.ok(pneumoNext);
  assert.equal(pneumoNext.proposed_date_iso, "2026-04-07");
  assert.equal(pneumoNext.officine_administration_status, "allowed");
});

test("Batch quality: broad-coverage pneumococcal history does not trigger redundant action", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 72,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Prevenar 20", administration_date_iso: "2025-11-01" }]
  });

  assert.ok(!output.action_now.some((action) => action.vaccine_name === "Pneumocoque"));
  assert.ok(!output.action_next.some((action) => action.vaccine_name === "Pneumocoque"));
  assert.ok(output.limitations.some((line) => line.includes("dose conjuguee large couverture detectee")));
});

test("Batch quality: lot execution keeps action integrity across heterogeneous cases", () => {
  const batchCases = [
    {
      diagnostic_date_iso: "2026-02-26",
      patient: { age_years: 67, sex: "F", pregnancy_status: "non", risk_flags: { dialyse_ou_ir: true } },
      vaccine_history_entries: [
        { product_name: "Prevenar 20", administration_date_iso: "2025-09-01" },
        { product_name: "Shingrix", administration_date_iso: "2025-12-20" },
        { product_name: "Boostrixtetra", administration_date_iso: "2015-01-01" }
      ]
    },
    {
      diagnostic_date_iso: "2026-02-26",
      patient: { age_years: 18, sex: "M", pregnancy_status: "non", risk_flags: {} },
      vaccine_history_entries: [
        { product_name: "Nimenrix", administration_date_iso: "2024-06-01" },
        { product_name: "Bexsero", administration_date_iso: "2025-01-01" }
      ]
    },
    {
      diagnostic_date_iso: "2026-02-26",
      patient: { age_years: 75, sex: "M", pregnancy_status: "non", risk_flags: {} },
      vaccine_history_entries: [{ product_name: "Comirnaty", administration_date_iso: "2023-10-01" }]
    }
  ];

  batchCases.forEach((input) => {
    const output = runDeterministicPipeline(input);
    output.action_now.forEach(assertActionIntegrity);
    output.action_next.forEach(assertActionIntegrity);
    assert.ok(["ready", "needs_more_info"].includes(output.meta.decision_status));
  });
});
