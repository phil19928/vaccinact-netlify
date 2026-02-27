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

test("Reference case: HPV catch-up with one prior dose", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 23,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Gardasil 9", administration_date_iso: "2024-05-10" }]
  });

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(output.action_now.some((action) => action.vaccine_name === "HPV"));
  assert.ok(output.action_next.some((action) => action.vaccine_name === "HPV"));
});

test("Reference case: senior patient triggers pneumococcal recommendation", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 72,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  const pneumo = output.action_now.find((action) => action.vaccine_name === "Pneumocoque");
  assert.ok(pneumo);
  assert.equal(pneumo.officine_administration_status, "allowed");
  assert.equal(output.meta.coverage_status, "partial");
  assert.ok(!output.limitations.some((line) => line.includes("Administrabilite officine a confirmer")));
});

test("Reference case: pregnancy + immunodepression + incomplete history is fail-safe", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 34,
      sex: "F",
      pregnancy_status: "oui",
      risk_flags: { immunodepression: true }
    },
    vaccine_history_entries: [{ product_name: "Gardasil 9", administration_date_iso: "" }]
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.cautions.some((caution) => caution.title === "Grossesse + immunodepression"));
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
});

test("Reference case: unknown product triggers caution and needs_more_info", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 48,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Produit Inconnu", administration_date_iso: "2025-01-10" }]
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.cautions.some((caution) => caution.title === "Produits non reconnus"));
});

test("Reference case: severe allergy is always surfaced as safety caution", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 64,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: { allergie_severe: true }
    },
    vaccine_history_entries: []
  });

  assert.ok(output.cautions.some((caution) => caution.title.includes("Allergie severe")));
  assert.ok(output.limitations.some((line) => line.includes("allergie severe")));
});

test("Reference case: missing exact age forces needs_more_info", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: null,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.hypotheses_assumed.some((line) => line.includes("age exact non renseigne")));
});

test("Reference case: zona recommendation appears for >=65 with no zona history", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 68,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  assert.ok(output.action_now.some((action) => action.vaccine_name === "Zona"));
  assert.ok(output.action_next.some((action) => action.vaccine_name === "Zona"));
});

test("Reference case: HepB catch-up appears for young adult without history", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 22,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  assert.ok(output.action_now.some((action) => action.vaccine_name === "HepB"));
  assert.ok(output.action_next.some((action) => action.vaccine_name === "HepB"));
});

test("Reference case: ROR catch-up appears for adult <=45 without history", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 30,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  assert.ok(output.action_now.some((action) => action.vaccine_name === "ROR"));
  assert.ok(output.action_next.some((action) => action.vaccine_name === "ROR"));
});

test("Reference case: Covid-19 recommendation is allowed in officine matrix", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Comirnaty", administration_date_iso: "2025-08-30" }]
  });

  const covidNow = output.action_now.find((action) => action.vaccine_name === "Covid-19");
  assert.ok(covidNow);
  assert.equal(covidNow.officine_administration_status, "allowed");
});

test("Reference case: pregnancy profile schedules Covid-19 booster and keeps officine allowed status", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 30,
      sex: "F",
      pregnancy_status: "oui",
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

test("Reference case: cancer_en_cours profile triggers risk-based plan (Pneumocoque + Covid schedule)", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 40,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: { cancer_en_cours: true }
    },
    vaccine_history_entries: [{ product_name: "Comirnaty", administration_date_iso: "2025-10-01" }]
  });

  const pneumoNow = output.action_now.find((action) => action.vaccine_name === "Pneumocoque");
  const covidNow = output.action_now.find((action) => action.vaccine_name === "Covid-19");
  const covidNext = output.action_next.find((action) => action.vaccine_name === "Covid-19");

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(pneumoNow);
  assert.equal(pneumoNow.officine_administration_status, "allowed");
  assert.ok(!covidNow);
  assert.ok(covidNext);
  assert.equal(covidNext.proposed_date_iso, "2026-03-30");
  assert.equal(covidNext.officine_administration_status, "allowed");
});

test("Reference case: pregnancy without immunodepression does not trigger combo caution", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 30,
      sex: "F",
      pregnancy_status: "oui",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  assert.ok(!output.cautions.some((caution) => caution.title === "Grossesse + immunodepression"));
});

test("Reference case: mapped product with missing date is flagged as incomplete history", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 24,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Gardasil 9", administration_date_iso: "" }]
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
});

test("Reference case: undated ROR history stays actionable in fail-safe mode", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 30,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Priorix", administration_date_iso: "" }]
  });

  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(rorNow);
  assert.equal(rorNow.rule_id, "RULE-ROR-CORE-004");
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.limitations.some((line) => line.includes("verification manuelle necessaire")));
});

test("Reference case: undated Zona history stays actionable in fail-safe mode", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Shingrix", administration_date_iso: "" }]
  });

  const zonaNow = output.action_now.find((action) => action.vaccine_name === "Zona");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(zonaNow);
  assert.equal(zonaNow.rule_id, "RULE-ZONA-CORE-004");
  assert.equal(zonaNow.officine_administration_status, "allowed");
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.limitations.some((line) => line.includes("Zona: verification manuelle necessaire")));
});

test("Reference case: invalid string age is treated as missing age", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: "abc",
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.hypotheses_assumed.some((line) => line.includes("age exact non renseigne")));
});

test("Reference case: duplicate same-day history entries are deduplicated in dosing logic", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-01-20",
    patient: {
      age_years: 30,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [
      { product_name: "Priorix", administration_date_iso: "2026-01-01" },
      { product_name: "Priorix", administration_date_iso: "2026-01-01" }
    ]
  });

  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  const rorNext = output.action_next.find((action) => action.vaccine_name === "ROR");
  assert.ok(!rorNow);
  assert.ok(rorNext);
  assert.equal(rorNext.proposed_date_iso, "2026-01-29");
  assert.equal(output.meta.decision_status, "ready");
});

test("Reference case: duplicate same-day HepB entries are deduplicated in dosing logic", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 20,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [
      { product_name: "Engerix B10", administration_date_iso: "2026-01-01" },
      { product_name: "Engerix B10", administration_date_iso: "2026-01-01" }
    ]
  });

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(output.action_now.some((action) => action.vaccine_name === "HepB"));
});

test("Reference case: VRS product is covered by deterministic engine", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Abrysvo", administration_date_iso: "2026-01-10" }]
  });

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(!output.action_now.some((action) => action.vaccine_name === "VRS"));
  assert.ok(!output.limitations.some((line) => line.includes("Antigenes hors couverture") && line.includes("VRS")));
  assert.ok(output.limitations.some((line) => line.includes("schema simplifie considere couvert")));
});

test("Reference case: undated VRS history stays actionable in fail-safe mode for eligible senior", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Abrysvo", administration_date_iso: "" }]
  });

  const vrsNow = output.action_now.find((action) => action.vaccine_name === "VRS");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(vrsNow);
  assert.equal(vrsNow.rule_id, "RULE-VRS-CORE-003");
  assert.equal(vrsNow.officine_administration_status, "allowed");
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.limitations.some((line) => line.includes("VRS: historique non date")));
});

test("Reference case: meningococcal products are covered by deterministic engine", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 18,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Bexsero", administration_date_iso: "2026-01-20" }]
  });

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(output.action_now.some((action) => action.vaccine_name === "Meningocoque ACWY"));
  assert.ok(output.action_now.some((action) => action.vaccine_name === "Meningocoque B"));
  assert.ok(!output.limitations.some((line) => line.includes("Antigenes hors couverture") && line.includes("Meningocoque")));
});

test("Reference case: meningococcal B undated history keeps actionable output with caution", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 18,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Bexsero", administration_date_iso: "" }]
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.action_now.some((action) => action.vaccine_name === "Meningocoque B"));
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.limitations.some((line) => line.includes("Meningocoque B: date de dose precedente manquante")));
});

test("Reference case: meningococcal B undated history outside age/risk scope triggers verification-only action", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 30,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Bexsero", administration_date_iso: "" }]
  });

  const menBNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque B");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(menBNow);
  assert.equal(menBNow.rule_id, "RULE-MEN-B-CORE-005");
  assert.equal(menBNow.officine_administration_status, "allowed");
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.limitations.some((line) => line.includes("historique non date hors perimetre age/risque")));
});

test("Reference case: dTcaPolio reminder appears at age milestone and is covered by deterministic engine", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 45,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Boostrixtetra", administration_date_iso: "2014-01-01" }]
  });

  const dtcaNow = output.action_now.find((action) => action.vaccine_name === "dTcaPolio");
  assert.equal(output.meta.decision_status, "ready");
  assert.ok(dtcaNow);
  assert.equal(dtcaNow.officine_administration_status, "allowed");
  assert.ok(!output.limitations.some((line) => line.includes("Antigenes hors couverture") && line.includes("dTcaPolio")));
});

test("Reference case: dTcaPolio reminder appears outside age milestone when interval is exceeded", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 46,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Boostrixtetra", administration_date_iso: "2014-01-01" }]
  });

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(output.action_now.some((action) => action.vaccine_name === "dTcaPolio"));
  assert.ok(output.limitations.some((line) => line.includes("hors jalon age")));
});

test("Reference case: dTcaPolio due under age 11 is kept clinically but blocked in officine", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 10,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Boostrixtetra", administration_date_iso: "2014-01-01" }]
  });

  const dtcaNow = output.action_now.find((action) => action.vaccine_name === "dTcaPolio");
  assert.equal(output.meta.decision_status, "ready");
  assert.ok(dtcaNow);
  assert.equal(dtcaNow.officine_administration_status, "not_allowed");
  assert.ok(
    (dtcaNow.officine_administration_conditions_applied || []).some((line) =>
      line.includes("seuil minimal officine 11 ans")
    )
  );
  assert.ok(
    output.limitations.some(
      (line) => line.includes("Actes non autorises en officine") && line.includes("Age 10 ans")
    )
  );
});

test("Reference case: VRS pregnancy pathway is officine-allowed for adult profile", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 30,
      sex: "F",
      pregnancy_status: "oui",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  const vrsNow = output.action_now.find((action) => action.vaccine_name === "VRS");
  assert.equal(output.meta.decision_status, "ready");
  assert.ok(vrsNow);
  assert.equal(vrsNow.rule_id, "RULE-VRS-CORE-001");
  assert.equal(vrsNow.officine_administration_status, "allowed");
});

test("Reference case: pneumococcal multi-product sequence (PCV+PPSV) avoids redundant action", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [
      { product_name: "Prevenar13", administration_date_iso: "2025-01-10" },
      { product_name: "Pneumovax", administration_date_iso: "2026-01-10" }
    ]
  });

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(!output.action_now.some((action) => action.vaccine_name === "Pneumocoque"));
  assert.ok(!output.action_next.some((action) => action.vaccine_name === "Pneumocoque"));
  assert.ok(output.limitations.some((line) => line.includes("sequence conjugue + polysaccharidique detectee")));
});

test("Reference case: pneumococcal covered sequence with unknown product remains fail-safe and actionable", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [
      { product_name: "Prevenar20", administration_date_iso: "2025-01-10" },
      { product_name: "Pneumovax", administration_date_iso: "2026-01-10" },
      { product_name: "Produit Inconnu", administration_date_iso: "2025-06-01" }
    ]
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(!output.action_now.some((action) => action.vaccine_name === "Pneumocoque"));
  assert.ok(!output.action_next.some((action) => action.vaccine_name === "Pneumocoque"));
  assert.ok(output.action_now.some((action) => action.vaccine_name === "Covid-19"));
  assert.ok(output.cautions.some((caution) => caution.title === "Produits non reconnus"));
  assert.ok(output.limitations.some((line) => line.includes("Au moins un nom commercial n a pas pu etre mappe")));
  assert.ok(
    output.limitations.some((line) =>
      line.includes("Pneumocoque: dose conjuguee large couverture detectee")
    )
  );
});

test("Reference case: undated broad-coverage pneumococcal dose stays actionable in fail-safe mode", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 70,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Prevenar20", administration_date_iso: "" }]
  });

  const pneumoNow = output.action_now.find((action) => action.vaccine_name === "Pneumocoque");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(pneumoNow);
  assert.equal(pneumoNow.rule_id, "RULE-PNEUMO-CORE-006");
  assert.equal(pneumoNow.officine_administration_status, "allowed");
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(
    output.limitations.some((line) =>
      line.includes("dose conjuguee large couverture detectee sans date")
    )
  );
});

test("Reference case: multi-product mixed history keeps coherent multi-domain catch-up plan", () => {
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

test("Reference case: noisy multi-product history keeps actionability with fail-safe flags", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 27,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: { immunodepression: true }
    },
    vaccine_history_entries: [
      { product_name: "Gardasil 9", administration_date_iso: "2024-06-10" },
      { product_name: "Produit Inconnu", administration_date_iso: "2025-03-11" },
      { product_name: "Engerix B10", administration_date_iso: "" }
    ]
  });

  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  const hepBNow = output.action_now.find((action) => action.vaccine_name === "HepB");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.action_now.some((action) => action.vaccine_name === "Pneumocoque"));
  assert.ok(output.action_now.some((action) => action.vaccine_name === "Covid-19"));
  assert.ok(hepBNow);
  assert.ok(output.cautions.some((caution) => caution.title === "Produits non reconnus"));
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.limitations.some((line) => line.includes("Au moins un nom commercial n a pas pu etre mappe")));
  assert.ok(output.limitations.some((line) => line.includes("Historique vaccinal incomplet: date(s) manquante(s)")));
  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "not_allowed");
});

test("Reference case: under-11 immunodepressed profile keeps Covid allowed and blocks other officine acts", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 10,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: { immunodepression: true }
    },
    vaccine_history_entries: []
  });

  const covidNow = output.action_now.find((action) => action.vaccine_name === "Covid-19");
  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  const hepbNow = output.action_now.find((action) => action.vaccine_name === "HepB");
  const pneumoNow = output.action_now.find((action) => action.vaccine_name === "Pneumocoque");

  assert.ok(covidNow);
  assert.equal(covidNow.officine_administration_status, "allowed");

  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "not_allowed");
  assert.ok(
    (rorNow.officine_administration_conditions_applied || []).some((line) =>
      line.includes("Vaccin vivant attenue")
    )
  );
  assert.ok(
    (rorNow.officine_administration_conditions_applied || []).some((line) =>
      line.includes("seuil minimal officine 11 ans")
    )
  );

  assert.ok(hepbNow);
  assert.equal(hepbNow.officine_administration_status, "not_allowed");
  assert.ok(
    (hepbNow.officine_administration_conditions_applied || []).some((line) =>
      line.includes("seuil minimal officine 11 ans")
    )
  );

  assert.ok(pneumoNow);
  assert.equal(pneumoNow.officine_administration_status, "not_allowed");
  assert.ok(
    output.limitations.some(
      (line) => line.includes("Actes non autorises en officine") && line.includes("Age 10 ans")
    )
  );
});

test("Reference case: Covid officine boundary at age 5 is allowed", () => {
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
  assert.equal(output.meta.decision_status, "ready");
  assert.ok(covidNow);
  assert.equal(covidNow.officine_administration_status, "allowed");
  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "not_allowed");
  assert.ok(
    output.limitations.some(
      (line) => line.includes("Actes non autorises en officine") && line.includes("Age 5 ans")
    )
  );
});

test("Reference case: age 4 has no Covid recommendation and keeps ROR age restriction", () => {
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
  assert.equal(output.meta.decision_status, "ready");
  assert.ok(!covidNow);
  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "not_allowed");
  assert.ok(
    output.limitations.some(
      (line) => line.includes("Actes non autorises en officine") && line.includes("Age 4 ans")
    )
  );
});

test("Reference case: age 11 boundary unlocks officine eligibility for ROR and HepB", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 11,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  const hepbNow = output.action_now.find((action) => action.vaccine_name === "HepB");
  const covidNow = output.action_now.find((action) => action.vaccine_name === "Covid-19");

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(rorNow);
  assert.ok(hepbNow);
  assert.ok(covidNow);
  assert.equal(rorNow.officine_administration_status, "allowed");
  assert.equal(hepbNow.officine_administration_status, "allowed");
  assert.equal(covidNow.officine_administration_status, "allowed");
  assert.ok(
    !output.limitations.some(
      (line) => line.includes("Actes non autorises en officine") && line.includes("Age 11 ans")
    )
  );
});

test("Reference case: age 24 keeps meningococcal ACWY/B catch-up active and officine-allowed", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 24,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  const menAcwyNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque ACWY");
  const menBNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque B");

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(menAcwyNow);
  assert.ok(menBNow);
  assert.equal(menAcwyNow.officine_administration_status, "allowed");
  assert.equal(menBNow.officine_administration_status, "allowed");
});

test("Reference case: age 25 without risk does not trigger meningococcal ACWY/B catch-up", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 25,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(!output.action_now.some((action) => action.vaccine_name === "Meningocoque ACWY"));
  assert.ok(!output.action_now.some((action) => action.vaccine_name === "Meningocoque B"));
  assert.ok(
    output.limitations.some((line) => line.includes("Meningocoque ACWY: non declenche sans age 11-24"))
  );
  assert.ok(
    output.limitations.some((line) => line.includes("Meningocoque B: non declenche sans age 15-24"))
  );
});

test("Reference case: age 25 with cancer_en_cours reactivates meningococcal ACWY/B catch-up", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 25,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {
        cancer_en_cours: true
      }
    },
    vaccine_history_entries: []
  });

  const menAcwyNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque ACWY");
  const menBNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque B");
  const menBNext = output.action_next.find((action) => action.vaccine_name === "Meningocoque B");

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(menAcwyNow);
  assert.ok(menBNow);
  assert.ok(menBNext);
  assert.equal(menAcwyNow.officine_administration_status, "allowed");
  assert.equal(menBNow.officine_administration_status, "allowed");
});

test("Reference case: under-11 risk profile keeps meningococcal actions but marks them not_allowed in officine", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 10,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {
        cancer_en_cours: true
      }
    },
    vaccine_history_entries: []
  });

  const menAcwyNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque ACWY");
  const menBNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque B");
  const menBNext = output.action_next.find((action) => action.vaccine_name === "Meningocoque B");

  assert.equal(output.meta.decision_status, "ready");
  assert.ok(menAcwyNow);
  assert.ok(menBNow);
  assert.ok(menBNext);
  assert.equal(menAcwyNow.officine_administration_status, "not_allowed");
  assert.equal(menBNow.officine_administration_status, "not_allowed");
  assert.equal(menBNext.officine_administration_status, "not_allowed");
  assert.ok(
    (menAcwyNow.officine_administration_conditions_applied || []).some((line) =>
      line.includes("seuil minimal officine 11 ans")
    )
  );
  assert.ok(
    (menBNow.officine_administration_conditions_applied || []).some((line) =>
      line.includes("seuil minimal officine 11 ans")
    )
  );
});

test("Reference case: undated meningococcal ACWY history stays actionable and officine-allowed at age 11", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 11,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Nimenrix", administration_date_iso: "" }]
  });

  const menAcwyNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque ACWY");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(menAcwyNow);
  assert.equal(menAcwyNow.rule_id, "RULE-MEN-ACWY-CORE-002");
  assert.equal(menAcwyNow.officine_administration_status, "allowed");
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.limitations.some((line) => line.includes("Meningocoque ACWY: date de dose precedente manquante")));
});

test("Reference case: undated meningococcal ACWY history outside age/risk scope triggers verification-only action", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 25,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Nimenrix", administration_date_iso: "" }]
  });

  const menAcwyNow = output.action_now.find((action) => action.vaccine_name === "Meningocoque ACWY");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(menAcwyNow);
  assert.equal(menAcwyNow.rule_id, "RULE-MEN-ACWY-CORE-003");
  assert.equal(menAcwyNow.officine_administration_status, "allowed");
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incomplet"));
  assert.ok(output.limitations.some((line) => line.includes("historique non date hors perimetre age/risque")));
});

test("Reference case: future-dated history entry triggers needs_more_info and caution", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 30,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Priorix", administration_date_iso: "2026-03-10" }]
  });

  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "allowed");
  assert.ok(output.limitations.some((line) => line.includes("date(s) futures")));
  assert.ok(output.limitations.some((line) => line.includes("exclues du calcul de schema")));
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incoherent"));
});

test("Reference case: future-dated HepB history keeps fail-safe status but does not block initiation plan", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 20,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: [{ product_name: "Engerix B10", administration_date_iso: "2026-03-10" }]
  });

  const hepBInitNow = output.action_now.find((action) => action.vaccine_name === "HepB" && action.rule_id === "RULE-HEPB-CORE-001");
  const hepBDose2Now = output.action_now.find((action) => action.vaccine_name === "HepB" && action.rule_id === "RULE-HEPB-CORE-004");
  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(hepBInitNow);
  assert.equal(hepBInitNow.officine_administration_status, "allowed");
  assert.ok(!hepBDose2Now);
  assert.ok(output.limitations.some((line) => line.includes("Engerix B10")));
  assert.ok(output.limitations.some((line) => line.includes("exclues du calcul de schema")));
  assert.ok(output.cautions.some((caution) => caution.title === "Historique vaccinal incoherent"));
});

test("Reference case: incoherent pregnancy/sex switches decision to needs_more_info", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 32,
      sex: "M",
      pregnancy_status: "oui",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  assert.equal(output.meta.decision_status, "needs_more_info");
  assert.ok(output.cautions.some((caution) => caution.title === "Incoherence sexe/grossesse"));
  assert.ok(output.limitations.some((line) => line.includes("sexe/grossesse")));
});

test("Reference case: under-11 patient gets not_allowed officine status for ROR (age restriction)", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 10,
      sex: "F",
      pregnancy_status: "non",
      risk_flags: {}
    },
    vaccine_history_entries: []
  });

  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "not_allowed");
  assert.ok(
    (rorNow.officine_administration_conditions_applied || []).some((line) =>
      line.includes("seuil minimal officine 11 ans")
    )
  );
  assert.ok(
    output.limitations.some(
      (line) => line.includes("Actes non autorises en officine") && line.includes("Age 10 ans")
    )
  );
});

test("Reference case: ROR + immunodepression gets not_allowed officine status", () => {
  const output = runDeterministicPipeline({
    diagnostic_date_iso: "2026-02-26",
    patient: {
      age_years: 30,
      sex: "M",
      pregnancy_status: "non",
      risk_flags: { immunodepression: true }
    },
    vaccine_history_entries: []
  });

  const rorNow = output.action_now.find((action) => action.vaccine_name === "ROR");
  assert.ok(rorNow);
  assert.equal(rorNow.officine_administration_status, "not_allowed");
  assert.ok(
    output.limitations.some(
      (line) => line.includes("Actes non autorises en officine") && line.includes("Vaccin vivant attenue")
    )
  );
});
