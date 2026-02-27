import test from "node:test";
import assert from "node:assert/strict";

import { buildFallbackV2FromLegacy, normalizeIncomingPayload } from "../legacyPatient.js";

test("normalizeIncomingPayload merges v2 values and fills required defaults", () => {
  const requiredFields = [
    "patient_age_range",
    "patient_sex",
    "contraindications_check_immunosuppressive_or_immunodepression",
    "contraindications_check_severe_allergy_anaphylaxis_history"
  ];

  const output = normalizeIncomingPayload(
    {
      patient: {
        patient_sex: "",
        patient_chronic_conditions_summary: ""
      },
      patient_v2: {
        patient: {
          age_years: 31,
          sex: "F",
          pregnancy_status: "non",
          risk_flags: {
            immunodepression: true,
            allergie_severe: true,
            vih: true
          }
        },
        vaccine_history_entries: [
          { product_name: "Gardasil 9", administration_date_iso: "2025-01-10", source: "declaratif" }
        ]
      }
    },
    requiredFields
  );

  assert.equal(output.patient_age_years, 31);
  assert.equal(output.patient_age_range, "26-45");
  assert.equal(output.patient_sex, "F");
  assert.equal(output.contraindications_check_immunosuppressive_or_immunodepression, "oui");
  assert.equal(output.contraindications_check_severe_allergy_anaphylaxis_history, "oui");
  assert.ok(output.patient_chronic_conditions_summary.includes("immunodépression"));
  assert.ok(output.patient_chronic_conditions_summary.includes("VIH"));
  assert.equal(output.vax_history_doses_count_per_vaccine, "Gardasil 9: 1");
  assert.equal(output.vax_history_last_injection_date_per_vaccine, "Gardasil 9: 2025-01-10");
});

test("buildFallbackV2FromLegacy maps legacy patient fields into v2 shape", () => {
  const fallback = buildFallbackV2FromLegacy(
    {
      patient_age_years: 67,
      patient_sex: "M",
      patient_pregnancy_status_or_project: "non",
      patient_chronic_conditions_summary: "VIH, insuffisance renale, cancer, asplenie",
      contraindications_check_immunosuppressive_or_immunodepression: "oui",
      contraindications_check_severe_allergy_anaphylaxis_history: "oui",
      vaccine_history_entries: [{ product_name: "Prevenar20", administration_date_iso: "2024-03-01" }]
    },
    "2026-02-26"
  );

  assert.equal(fallback.diagnostic_date_iso, "2026-02-26");
  assert.equal(fallback.patient.age_years, 67);
  assert.equal(fallback.patient.sex, "M");
  assert.equal(fallback.patient.risk_flags.immunodepression, true);
  assert.equal(fallback.patient.risk_flags.vih, true);
  assert.equal(fallback.patient.risk_flags.dialyse_ou_ir, true);
  assert.equal(fallback.patient.risk_flags.cancer_en_cours, true);
  assert.equal(fallback.patient.risk_flags.asplenie, true);
  assert.equal(fallback.patient.risk_flags.allergie_severe, true);
  assert.equal(fallback.vaccine_history_entries.length, 1);
});
