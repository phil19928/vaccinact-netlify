import test from "node:test";
import assert from "node:assert/strict";

import matrixData from "../../data/officine-matrix.v1.json" with { type: "json" };
import { applyOfficineMatrix, auditOfficineMatrix, collectOfficineMatrixLimitations } from "../officineMatrix.js";

test("applyOfficineMatrix maps status and source when vaccine is listed", () => {
  const actions = [{ vaccine_name: "Covid-19", label: "Administrer dose Covid-19" }];
  const mapped = applyOfficineMatrix(actions, matrixData);

  assert.equal(mapped[0].officine_administration_status, "allowed");
  assert.equal(mapped[0].officine_administration_review_status, "confirmed");
  assert.equal(mapped[0].officine_administration_rules_version, "v2.0.0");
  assert.ok(mapped[0].officine_administration_source.includes("Calendrier vaccinal 2025"));
  assert.ok(mapped[0].officine_administration_note.length > 0);
  assert.ok(Array.isArray(mapped[0].officine_administration_references));
  assert.ok(mapped[0].officine_administration_references.length >= 1);
  assert.ok((mapped[0].references || []).some((ref) => ref.rule_id === "OFF-COVID-001"));
  assert.equal(mapped[0].officine_administration_source_status, "confirmed");
  assert.equal(mapped[0].officine_administration_source_catalog_version, "v1.0.0");
  assert.ok((mapped[0].officine_administration_references || []).some((ref) => ref.source_title.includes("Calendrier vaccinal 2025")));
});

test("applyOfficineMatrix defaults to to_confirm when vaccine is missing", () => {
  const actions = [{ vaccine_name: "Dengue", label: "Administrer dose Dengue" }];
  const mapped = applyOfficineMatrix(actions, matrixData);

  assert.equal(mapped[0].officine_administration_status, "to_confirm");
  assert.equal(mapped[0].officine_administration_review_status, "to_confirm");
  assert.equal(mapped[0].officine_administration_source, "not_specified");
  assert.ok((mapped[0].references || []).some((ref) => String(ref.rule_id || "").includes("OFF-MISSING-DENGUE")));
  assert.equal(mapped[0].officine_administration_source_status, "to_confirm");
});

test("collectOfficineMatrixLimitations lists unresolved vaccines once", () => {
  const actions = [
    { vaccine_name: "Pneumocoque", officine_administration_status: "to_confirm" },
    { vaccine_name: "Pneumocoque", officine_administration_status: "to_confirm" },
    { vaccine_name: "Covid-19", officine_administration_status: "allowed" }
  ];

  const limitations = collectOfficineMatrixLimitations(actions);
  assert.equal(limitations.length, 1);
  assert.ok(limitations[0].includes("Pneumocoque"));
  assert.ok(!limitations[0].includes("Covid-19"));
});

test("collectOfficineMatrixLimitations includes not_allowed vaccines and merged reasons", () => {
  const actions = [
    {
      vaccine_name: "HPV",
      officine_administration_status: "not_allowed",
      officine_administration_conditions_applied: ["Age 10 ans < seuil minimal officine 11 ans."]
    },
    {
      vaccine_name: "ROR",
      officine_administration_status: "not_allowed",
      officine_administration_conditions_applied: [
        "Vaccin vivant attenue: prescription officinale non autorisee chez les personnes immunodeprimees."
      ]
    },
    {
      vaccine_name: "ROR",
      officine_administration_status: "not_allowed",
      officine_administration_conditions_applied: [
        "Vaccin vivant attenue: prescription officinale non autorisee chez les personnes immunodeprimees."
      ]
    }
  ];

  const limitations = collectOfficineMatrixLimitations(actions);
  assert.equal(limitations.length, 1);
  assert.ok(limitations[0].includes("Actes non autorises en officine"));
  assert.ok(limitations[0].includes("HPV"));
  assert.ok(limitations[0].includes("ROR"));
  assert.ok(limitations[0].includes("Age 10 ans < seuil minimal officine 11 ans."));
});

test("applyOfficineMatrix maps confirmed legal entry when vaccine is listed in matrix", () => {
  const actions = [{ vaccine_name: "Meningocoque ACWY", label: "Administrer dose MenACWY" }];
  const mapped = applyOfficineMatrix(actions, matrixData);

  assert.equal(mapped[0].officine_administration_status, "allowed");
  assert.ok(mapped[0].officine_administration_source.includes("Arrete du 8 aout 2023"));
  assert.ok((mapped[0].officine_administration_references || []).some((ref) => ref.rule_id === "OFF-MEN-ACWY-REG-001"));
  assert.ok((mapped[0].officine_administration_references || []).some((ref) => ref.source_id === "officine-reglementation-men-acwy"));
});

test("applyOfficineMatrix maps dTcaPolio entry with confirmed allowed status", () => {
  const actions = [{ vaccine_name: "dTcaPolio", label: "Administrer rappel dTcaPolio" }];
  const mapped = applyOfficineMatrix(actions, matrixData);

  assert.equal(mapped[0].officine_administration_status, "allowed");
  assert.ok(mapped[0].officine_administration_source.includes("Arrete du 8 aout 2023"));
  assert.ok((mapped[0].officine_administration_references || []).some((ref) => ref.rule_id === "OFF-DTCAPOLIO-REG-001"));
});

test("applyOfficineMatrix maps VRS entry with confirmed allowed status", () => {
  const actions = [{ vaccine_name: "VRS", label: "Administrer dose VRS" }];
  const mapped = applyOfficineMatrix(actions, matrixData);

  assert.equal(mapped[0].officine_administration_status, "allowed");
  assert.ok(mapped[0].officine_administration_source.includes("Arrete du 8 aout 2023"));
  assert.ok((mapped[0].officine_administration_references || []).some((ref) => ref.rule_id === "OFF-VRS-REG-001"));
});

test("applyOfficineMatrix downgrades to not_allowed when patient age is below officine threshold", () => {
  const actions = [{ vaccine_name: "HPV", label: "Administrer dose HPV" }];
  const mapped = applyOfficineMatrix(actions, matrixData, {
    patientAgeYears: 10,
    riskFlags: {}
  });

  assert.equal(mapped[0].officine_administration_base_status, "allowed");
  assert.equal(mapped[0].officine_administration_status, "not_allowed");
  assert.ok((mapped[0].officine_administration_conditions_applied || []).some((line) => line.includes("seuil minimal officine 11")));
});

test("applyOfficineMatrix applies ROR immunodepression restriction", () => {
  const actions = [{ vaccine_name: "ROR", label: "Administrer dose ROR" }];
  const mapped = applyOfficineMatrix(actions, matrixData, {
    patientAgeYears: 30,
    riskFlags: { immunodepression: true }
  });

  assert.equal(mapped[0].officine_administration_base_status, "allowed");
  assert.equal(mapped[0].officine_administration_status, "not_allowed");
  assert.ok((mapped[0].officine_administration_conditions_applied || []).some((line) => line.includes("Vaccin vivant attenue")));
});

test("auditOfficineMatrix returns consolidation metrics and no missing source mappings", () => {
  const audit = auditOfficineMatrix(matrixData, {
    nowIso: "2026-02-26T12:00:00.000Z",
    maxSourceAgeDays: 365
  });

  assert.equal(audit.matrix_rules_version, "v2.0.0");
  assert.equal(audit.sources_catalog_version, "v1.0.0");
  assert.equal(audit.summary.total_entries, 10);
  assert.equal(audit.summary.status_breakdown.allowed, 10);
  assert.equal(audit.summary.status_breakdown.to_confirm || 0, 0);
  assert.equal(audit.summary.missing_source_catalog_refs_count, 0);
  assert.equal(audit.summary.stale_source_references_count, 0);
  assert.equal(audit.ready_for_regulatory_signoff, true);
});

test("auditOfficineMatrix detects stale confirmed source references", () => {
  const audit = auditOfficineMatrix(matrixData, {
    nowIso: "2027-12-31T00:00:00.000Z",
    maxSourceAgeDays: 30
  });

  assert.ok(audit.summary.stale_source_references_count >= 1);
  assert.ok(
    audit.stale_source_references.some(
      (item) => item.source_id === "calendrier-2025-officine" && item.rule_id === "OFF-COVID-001"
    )
  );
});
