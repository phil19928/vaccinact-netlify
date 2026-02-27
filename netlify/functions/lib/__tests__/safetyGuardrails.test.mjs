import test from "node:test";
import assert from "node:assert/strict";

import { applySafetyGuardrails } from "../safetyGuardrails.js";

test("applySafetyGuardrails adds allergy precaution", () => {
  const result = applySafetyGuardrails(
    {
      cautions: [],
      limitations: []
    },
    {
      patient: {
        risk_flags: {
          allergie_severe: true
        }
      }
    }
  );

  const allergyCaution = result.cautions.find((c) => c.title.includes("Allergie"));
  assert.ok(allergyCaution);
  assert.ok(Array.isArray(allergyCaution.references));
  assert.equal(allergyCaution.references[0].rule_id, "SAFE-ANAPHYLAXIS-001");
  assert.ok(result.limitations.some((l) => l.includes("allergie severe")));
});

test("applySafetyGuardrails flags unknown products", () => {
  const result = applySafetyGuardrails(
    {
      cautions: [],
      limitations: []
    },
    {
      patient: { risk_flags: {} }
    },
    {
      resolvedHistory: [
        { product_name: "Produit X", resolution_status: "unknown_product" }
      ]
    }
  );

  assert.ok(result.cautions.some((c) => c.title === "Produits non reconnus"));
  assert.ok(result.limitations.some((l) => l.includes("nom commercial")));
});

test("applySafetyGuardrails adds immunodepression precaution", () => {
  const result = applySafetyGuardrails(
    {
      cautions: [],
      limitations: []
    },
    {
      patient: {
        risk_flags: {
          immunodepression: true
        }
      }
    }
  );

  const caution = result.cautions.find((c) => c.title === "Immunodepression");
  assert.ok(caution);
  assert.ok(Array.isArray(caution.references));
  assert.equal(caution.references[0].rule_id, "SAFE-IMMUNODEP-001");
});

test("applySafetyGuardrails adds cancer_en_cours precaution", () => {
  const result = applySafetyGuardrails(
    {
      cautions: [],
      limitations: []
    },
    {
      patient: {
        risk_flags: {
          cancer_en_cours: true
        }
      }
    }
  );

  const caution = result.cautions.find((c) => c.title === "Cancer en cours");
  assert.ok(caution);
  assert.ok(Array.isArray(caution.references));
  assert.equal(caution.references[0].rule_id, "SAFE-CANCER-001");
  assert.ok(result.limitations.some((l) => l.includes("Cancer en cours")));
});

test("applySafetyGuardrails handles combined immunodepression and unknown product", () => {
  const result = applySafetyGuardrails(
    {
      cautions: [],
      limitations: []
    },
    {
      patient: {
        risk_flags: {
          immunodepression: true
        }
      }
    },
    {
      resolvedHistory: [
        { product_name: "Produit Mix", resolution_status: "unknown_product" }
      ]
    }
  );

  assert.ok(result.cautions.some((c) => c.title === "Immunodepression"));
  assert.ok(result.cautions.some((c) => c.title === "Produits non reconnus"));
  assert.ok(result.limitations.some((l) => l.includes("nom commercial")));
});

test("applySafetyGuardrails flags combined pregnancy + immunodepression + incomplete history", () => {
  const result = applySafetyGuardrails(
    {
      cautions: [],
      limitations: []
    },
    {
      patient: {
        pregnancy_status: "oui",
        risk_flags: {
          immunodepression: true
        }
      }
    },
    {
      resolvedHistory: [
        {
          product_name: "Gardasil 9",
          resolution_status: "resolved",
          administration_date_iso: ""
        }
      ]
    }
  );

  assert.ok(result.cautions.some((c) => c.title === "Grossesse + immunodepression"));
  assert.ok(result.cautions.some((c) => c.title === "Historique vaccinal incomplet"));
  assert.ok(result.limitations.some((l) => l.includes("grossesse/immunodepression")));
  assert.ok(result.limitations.some((l) => l.includes("dates de dose")));
});

test("applySafetyGuardrails flags future-dated resolved history", () => {
  const result = applySafetyGuardrails(
    {
      cautions: [],
      limitations: []
    },
    {
      diagnostic_date_iso: "2026-02-26",
      patient: { risk_flags: {} }
    },
    {
      resolvedHistory: [
        {
          product_name: "Priorix",
          resolution_status: "resolved",
          administration_date_iso: "2026-03-10"
        }
      ]
    }
  );

  const caution = result.cautions.find((c) => c.title === "Historique vaccinal incoherent");
  assert.ok(caution);
  assert.ok(Array.isArray(caution.references));
  assert.equal(caution.references[0].rule_id, "SAFE-FUTURE-HISTORY-001");
  assert.ok(result.limitations.some((l) => l.includes("dans le futur")));
});

test("applySafetyGuardrails flags incoherent pregnancy/sex combination and sets needs_more_info", () => {
  const result = applySafetyGuardrails(
    {
      meta: { decision_status: "ready" },
      cautions: [],
      limitations: []
    },
    {
      patient: {
        age_years: 32,
        sex: "M",
        pregnancy_status: "oui",
        risk_flags: {}
      }
    }
  );

  const caution = result.cautions.find((c) => c.title === "Incoherence sexe/grossesse");
  assert.ok(caution);
  assert.equal(caution.references[0].rule_id, "SAFE-PREG-SEX-001");
  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(result.limitations.some((l) => l.includes("sexe/grossesse")));
});

test("applySafetyGuardrails flags implausible age and sets needs_more_info", () => {
  const result = applySafetyGuardrails(
    {
      meta: { decision_status: "ready" },
      cautions: [],
      limitations: []
    },
    {
      patient: {
        age_years: 130,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    }
  );

  const caution = result.cautions.find((c) => c.title === "Age incoherent");
  assert.ok(caution);
  assert.equal(caution.references[0].rule_id, "SAFE-AGE-RANGE-001");
  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(result.limitations.some((l) => l.includes("age hors plage")));
});
