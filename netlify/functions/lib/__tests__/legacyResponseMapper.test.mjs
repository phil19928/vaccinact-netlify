import test from "node:test";
import assert from "node:assert/strict";

import { mapDeterministicToLegacyResponse, toLegacySource } from "../legacyResponseMapper.js";

test("toLegacySource returns fallback source for empty ref", () => {
  const source = toLegacySource(null, "Fallback");
  assert.equal(source.page, 0);
  assert.equal(source.section_hint, "Fallback");
  assert.ok(source.snippet.includes("Source interne"));
});

test("mapDeterministicToLegacyResponse maps deterministic actions and status", () => {
  const mapped = mapDeterministicToLegacyResponse({
    diagnosticDate: "2026-02-26",
    patient: { patient_age_years: 40 },
    deterministic: {
      meta: {
        rules_version: "v2.0.0",
        coverage_status: "partial",
        decision_status: "needs_more_info",
        source_document: "Calendrier des vaccinations et recommandations vaccinales (Dec. 2025)",
        version: "deterministic-v2.0.0"
      },
      action_now: [
        {
          vaccine_name: "Pneumocoque",
          rationale: "Patient en groupe de recommandation age/risque.",
          officine_administration_status: "to_confirm",
          officine_administration_source: "Reglementation a consolider",
          officine_administration_note: "Statut provisoire en attente.",
          references: [
            { source_id: "calendrier-2025-pneumocoque", section_hint: "Indications", rule_id: "RULE-PNEUMO-CORE-001" }
          ]
        }
      ],
      action_next: [],
      cautions: [
        {
          title: "Historique vaccinal incomplet",
          severity: "precaution",
          details: "Date manquante",
          references: [{ source_id: "safety-guardrail", section_hint: "Qualite", rule_id: "SAFE-INCOMPLETE-HISTORY-001" }]
        }
      ],
      limitations: ["Historique incomplet"],
      references: [{ source_id: "calendrier-2025-pneumocoque", section_hint: "Indications", rule_id: "RULE-PNEUMO-CORE-001" }]
    }
  });

  assert.equal(mapped.meta.diagnostic_date_iso, "2026-02-26");
  assert.equal(mapped.recommended_vaccines.length, 1);
  assert.equal(mapped.recommended_vaccines[0].allowed_in_pharmacy, "to_confirm");
  assert.ok(mapped.recommended_vaccines[0].vigilance_points.some((item) => item.includes("Statut provisoire")));
  assert.ok(mapped.recommended_vaccines[0].sources.length >= 2);
  assert.ok(mapped.gp_report.bullets.some((line) => line.includes("Decision status: needs_more_info")));
  assert.equal(mapped.contraindications_and_precautions.length, 1);
  assert.equal(mapped.limitations[0], "Historique incomplet");
});
