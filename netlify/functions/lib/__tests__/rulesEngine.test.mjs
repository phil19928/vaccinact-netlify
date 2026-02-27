import test from "node:test";
import assert from "node:assert/strict";

import dictionary from "../../data/product-dictionary.v1.json" with { type: "json" };
import { resolveProductEntries } from "../productDictionary.js";
import { evaluateRules } from "../rulesEngine.js";

test("HPV catch-up is generated for age 23 with one prior dose", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Gardasil 9", administration_date_iso: "2024-01-10", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 23,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.equal(result.meta.rules_version, "v2.0.0");
  assert.equal(result.meta.coverage_status, "partial");
  assert.ok(result.action_now.some((a) => a.vaccine_name === "HPV"));
  assert.ok(result.action_next.some((a) => a.vaccine_name === "HPV"));

  const hpvNext = result.action_next.find((a) => a.vaccine_name === "HPV");
  assert.equal(hpvNext.min_interval_days, 56);
  assert.equal(hpvNext.proposed_date_iso, "2026-04-23");
});

test("Pneumococcal recommendation is generated for age 70 without prior dose", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const pneumoNow = result.action_now.find((a) => a.vaccine_name === "Pneumocoque");
  assert.ok(pneumoNow);
  assert.equal(pneumoNow.rule_id, "RULE-PNEUMO-CORE-001");
});

test("Pneumococcal recommendation is generated under 65 when immunodepression is true", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {
          immunodepression: true
        }
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const pneumoNow = result.action_now.find((a) => a.vaccine_name === "Pneumocoque");
  assert.ok(pneumoNow);
  assert.equal(pneumoNow.rule_id, "RULE-PNEUMO-CORE-001");
});

test("Pneumococcal recommendation is generated under 65 when cancer_en_cours is true", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {
          cancer_en_cours: true
        }
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const pneumoNow = result.action_now.find((a) => a.vaccine_name === "Pneumocoque");
  assert.ok(pneumoNow);
  assert.equal(pneumoNow.rule_id, "RULE-PNEUMO-CORE-001");
});

test("Pneumococcal history with Prevenar20 is treated as covered in simplified sequence", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Prevenar 20", administration_date_iso: "2025-11-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 71,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.ok(!result.action_now.some((a) => a.vaccine_name === "Pneumocoque"));
  assert.ok(
    result.limitations.some((line) => line.includes("Pneumocoque: dose conjuguee large couverture detectee"))
  );
});

test("Pneumococcal history with undated Prevenar20 stays actionable with manual verification", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Prevenar 20", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 71,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const pneumoNow = result.action_now.find((a) => a.vaccine_name === "Pneumocoque");
  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(pneumoNow);
  assert.equal(pneumoNow.rule_id, "RULE-PNEUMO-CORE-006");
  assert.ok(
    result.limitations.some((line) =>
      line.includes("dose conjuguee large couverture detectee sans date")
    )
  );
});

test("Pneumococcal history with conjugate-only dose triggers complementary PPSV23 when interval reached", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Prevenar13", administration_date_iso: "2025-10-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 67,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const pneumoNow = result.action_now.find((a) => a.vaccine_name === "Pneumocoque");
  assert.ok(pneumoNow);
  assert.equal(pneumoNow.rule_id, "RULE-PNEUMO-CORE-003");
  assert.ok(!result.action_next.some((a) => a.vaccine_name === "Pneumocoque"));
});

test("Pneumococcal history with conjugate-only recent dose schedules complementary PPSV23", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Prevenar13", administration_date_iso: "2026-02-10", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 67,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.ok(!result.action_now.some((a) => a.vaccine_name === "Pneumocoque"));
  const pneumoNext = result.action_next.find((a) => a.vaccine_name === "Pneumocoque");
  assert.ok(pneumoNext);
  assert.equal(pneumoNext.rule_id, "RULE-PNEUMO-CORE-003");
  assert.equal(pneumoNext.proposed_date_iso, "2026-04-07");
});

test("Pneumococcal history with PPSV23-only dose triggers conjugate catch-up when interval reached", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Pneumovax", administration_date_iso: "2024-12-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 67,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const pneumoNow = result.action_now.find((a) => a.vaccine_name === "Pneumocoque");
  assert.ok(pneumoNow);
  assert.equal(pneumoNow.rule_id, "RULE-PNEUMO-CORE-005");
});

test("Pneumococcal history with recent PPSV23-only dose schedules conjugate catch-up", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Pneumovax", administration_date_iso: "2026-01-10", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.ok(!result.action_now.some((a) => a.vaccine_name === "Pneumocoque"));
  const pneumoNext = result.action_next.find((a) => a.vaccine_name === "Pneumocoque");
  assert.ok(pneumoNext);
  assert.equal(pneumoNext.rule_id, "RULE-PNEUMO-CORE-005");
  assert.equal(pneumoNext.proposed_date_iso, "2027-01-10");
});

test("HepB initiation is generated for age 20 without prior dose", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const hepBNow = result.action_now.find((a) => a.vaccine_name === "HepB");
  const hepBNext = result.action_next.filter((a) => a.vaccine_name === "HepB");
  assert.ok(hepBNow);
  assert.equal(hepBNow.rule_id, "RULE-HEPB-CORE-001");
  assert.equal(hepBNext.length, 2);
  assert.ok(hepBNext.some((a) => a.rule_id === "RULE-HEPB-CORE-002"));
  assert.ok(hepBNext.some((a) => a.rule_id === "RULE-HEPB-CORE-003"));
});

test("HepB initiation is generated outside age bracket when cancer_en_cours is true", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {
          cancer_en_cours: true
        }
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const hepBNow = result.action_now.find((a) => a.vaccine_name === "HepB");
  const hepBNext = result.action_next.filter((a) => a.vaccine_name === "HepB");
  assert.ok(hepBNow);
  assert.equal(hepBNow.rule_id, "RULE-HEPB-CORE-001");
  assert.equal(hepBNext.length, 2);
});

test("HepB dose 2 is due now when one prior dose date is old enough", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Engerix B10", administration_date_iso: "2025-12-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const hepBNow = result.action_now.find((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-004");
  assert.ok(hepBNow);
});

test("HepB dose 2 is due now at exact 30-day interval boundary", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Engerix B10", administration_date_iso: "2026-01-27", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const hepBNow = result.action_now.find((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-004");
  assert.ok(hepBNow);
});

test("HepB dose 3 is due now at exact 150-day interval boundary after dose 2", () => {
  const resolvedHistory = resolveProductEntries(
    [
      { product_name: "Engerix B10", administration_date_iso: "2025-03-01", source: "declaratif" },
      { product_name: "Engerix B10", administration_date_iso: "2025-09-29", source: "declaratif" }
    ],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const hepBNow = result.action_now.find((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-006");
  assert.ok(hepBNow);
});

test("HepB with one undated prior dose remains actionable with manual verification", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Engerix B10", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const hepBNow = result.action_now.find((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-007");
  assert.ok(hepBNow);
  assert.ok(result.limitations.some((line) => line.includes("date de dose precedente manquante")));
});

test("HepB with two undated prior doses remains actionable for dose 3 with manual verification", () => {
  const resolvedHistory = resolveProductEntries(
    [
      { product_name: "Engerix B10", administration_date_iso: "", source: "declaratif" },
      { product_name: "HBvaxpro", administration_date_iso: "", source: "declaratif" }
    ],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const hepBNow = result.action_now.find((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-008");
  assert.ok(hepBNow);
  assert.ok(result.limitations.some((line) => line.includes("date de dose precedente manquante")));
});

test("ROR recommendation is generated for age 30 without prior dose", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const rorNow = result.action_now.find((a) => a.vaccine_name === "ROR");
  const rorNext = result.action_next.find((a) => a.vaccine_name === "ROR");
  assert.ok(rorNow);
  assert.ok(rorNext);
  assert.equal(rorNow.rule_id, "RULE-ROR-CORE-001");
  assert.equal(rorNext.rule_id, "RULE-ROR-CORE-002");
  assert.equal(rorNext.min_interval_days, 28);
});

test("ROR dose 2 is due now when one prior dose date is old enough", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Priorix", administration_date_iso: "2026-01-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const rorNow = result.action_now.find((a) => a.vaccine_name === "ROR" && a.rule_id === "RULE-ROR-CORE-003");
  assert.ok(rorNow);
});

test("ROR dose 2 is due now at exact 28-day interval boundary", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Priorix", administration_date_iso: "2026-01-29", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const rorNow = result.action_now.find((a) => a.vaccine_name === "ROR" && a.rule_id === "RULE-ROR-CORE-003");
  assert.ok(rorNow);
});

test("ROR with one undated prior dose remains actionable with manual verification", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Priorix", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const rorNow = result.action_now.find((a) => a.vaccine_name === "ROR" && a.rule_id === "RULE-ROR-CORE-004");
  assert.ok(rorNow);
  assert.ok(result.limitations.some((line) => line.includes("date de dose precedente manquante")));
});

test("Covid-19 initial recommendation is generated when no prior dose is found", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const covidNow = result.action_now.find((a) => a.vaccine_name === "Covid-19");
  assert.ok(covidNow);
  assert.equal(covidNow.rule_id, "RULE-COVID-CORE-001");
});

test("Covid-19 booster is scheduled for high-priority profile when 6-month interval is not reached", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Comirnaty", administration_date_iso: "2025-10-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const covidNow = result.action_now.find((a) => a.vaccine_name === "Covid-19");
  const covidNext = result.action_next.find((a) => a.vaccine_name === "Covid-19" && a.rule_id === "RULE-COVID-CORE-003");
  assert.ok(!covidNow);
  assert.ok(covidNext);
  assert.equal(covidNext.proposed_date_iso, "2026-03-30");
});

test("Covid-19 booster recommendation is generated at exact 6-month interval boundary", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Comirnaty", administration_date_iso: "2025-08-30", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const covidNow = result.action_now.find(
    (a) => a.vaccine_name === "Covid-19" && a.rule_id === "RULE-COVID-CORE-002"
  );
  assert.ok(covidNow);
  assert.ok(!result.action_next.some((a) => a.vaccine_name === "Covid-19"));
});

test("Covid-19 high-priority profile with undated prior dose remains actionable with limitation", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Comirnaty", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const covidNow = result.action_now.find(
    (a) => a.vaccine_name === "Covid-19" && a.rule_id === "RULE-COVID-CORE-002"
  );
  assert.ok(covidNow);
  assert.ok(result.limitations.some((line) => line.includes("date de derniere dose manquante")));
});

test("Covid-19 booster is scheduled for cancer_en_cours high-priority profile when interval is not reached", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Comirnaty", administration_date_iso: "2025-10-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {
          cancer_en_cours: true
        }
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const covidNow = result.action_now.find((a) => a.vaccine_name === "Covid-19");
  const covidNext = result.action_next.find((a) => a.vaccine_name === "Covid-19" && a.rule_id === "RULE-COVID-CORE-003");
  assert.ok(!covidNow);
  assert.ok(covidNext);
  assert.equal(covidNext.proposed_date_iso, "2026-03-30");
});

test("Covid-19 pregnancy profile is treated as high-priority and schedules booster when interval is not reached", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Comirnaty", administration_date_iso: "2025-10-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "F",
        pregnancy_status: "oui",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const covidNow = result.action_now.find((a) => a.vaccine_name === "Covid-19");
  const covidNext = result.action_next.find((a) => a.vaccine_name === "Covid-19" && a.rule_id === "RULE-COVID-CORE-003");
  assert.ok(!covidNow);
  assert.ok(covidNext);
  assert.equal(covidNext.proposed_date_iso, "2026-03-30");
});

test("Covid-19 pregnancy profile gets booster due now at exact 6-month interval boundary", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Comirnaty", administration_date_iso: "2025-08-30", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "F",
        pregnancy_status: "oui",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const covidNow = result.action_now.find(
    (a) => a.vaccine_name === "Covid-19" && a.rule_id === "RULE-COVID-CORE-002"
  );
  assert.ok(covidNow);
  assert.ok(!result.action_next.some((a) => a.vaccine_name === "Covid-19"));
});

test("Zona recommendation is generated for age 70 without prior dose", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const zonaNow = result.action_now.find((a) => a.vaccine_name === "Zona");
  const zonaNext = result.action_next.find((a) => a.vaccine_name === "Zona");
  assert.ok(zonaNow);
  assert.ok(zonaNext);
  assert.equal(zonaNow.rule_id, "RULE-ZONA-CORE-001");
  assert.equal(zonaNext.rule_id, "RULE-ZONA-CORE-002");
  assert.equal(zonaNext.min_interval_days, 60);
});

test("Zona recommendation is generated for cancer_en_cours profile >=18", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {
          cancer_en_cours: true
        }
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const zonaNow = result.action_now.find((a) => a.vaccine_name === "Zona");
  const zonaNext = result.action_next.find((a) => a.vaccine_name === "Zona");
  assert.ok(zonaNow);
  assert.ok(zonaNext);
});

test("Zona dose 2 is scheduled when one prior dose exists but interval not reached", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Shingrix", administration_date_iso: "2026-02-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.ok(!result.action_now.some((a) => a.vaccine_name === "Zona" && a.rule_id === "RULE-ZONA-CORE-003"));
  const zonaNext = result.action_next.find((a) => a.vaccine_name === "Zona" && a.rule_id === "RULE-ZONA-CORE-003");
  assert.ok(zonaNext);
  assert.equal(zonaNext.proposed_date_iso, "2026-04-02");
});

test("Zona dose 2 is due now at exact 60-day interval boundary", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Shingrix", administration_date_iso: "2025-12-28", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const zonaNow = result.action_now.find((a) => a.vaccine_name === "Zona" && a.rule_id === "RULE-ZONA-CORE-003");
  assert.ok(zonaNow);
});

test("Zona with one undated prior dose remains actionable with manual verification", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Shingrix", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const zonaNow = result.action_now.find((a) => a.vaccine_name === "Zona" && a.rule_id === "RULE-ZONA-CORE-004");
  assert.ok(zonaNow);
  assert.ok(result.limitations.some((line) => line.includes("date de dose precedente manquante")));
});

test("Meningococcal ACWY recommendation is generated for age 18 without prior dose", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 18,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const menAcwyNow = result.action_now.find((a) => a.vaccine_name === "Meningocoque ACWY");
  assert.ok(menAcwyNow);
  assert.equal(menAcwyNow.rule_id, "RULE-MEN-ACWY-CORE-001");
});

test("Meningococcal ACWY recommendation is generated outside age bracket when cancer_en_cours is true", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {
          cancer_en_cours: true
        }
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const menAcwyNow = result.action_now.find((a) => a.vaccine_name === "Meningocoque ACWY");
  assert.ok(menAcwyNow);
  assert.equal(menAcwyNow.rule_id, "RULE-MEN-ACWY-CORE-001");
});

test("Meningococcal ACWY with undated prior dose remains actionable with manual verification", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Nimenrix", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 18,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const menAcwyNow = result.action_now.find(
    (a) => a.vaccine_name === "Meningocoque ACWY" && a.rule_id === "RULE-MEN-ACWY-CORE-002"
  );
  assert.ok(menAcwyNow);
  assert.ok(result.limitations.some((line) => line.includes("date de dose precedente manquante")));
});

test("Meningococcal ACWY with undated prior dose outside age/risk scope triggers verification action", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Nimenrix", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 25,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const menAcwyNow = result.action_now.find(
    (a) => a.vaccine_name === "Meningocoque ACWY" && a.rule_id === "RULE-MEN-ACWY-CORE-003"
  );
  assert.ok(menAcwyNow);
  assert.ok(result.limitations.some((line) => line.includes("hors perimetre age/risque")));
});

test("Meningococcal B recommendation is generated outside age bracket when cancer_en_cours is true", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {
          cancer_en_cours: true
        }
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const menBNow = result.action_now.find((a) => a.vaccine_name === "Meningocoque B");
  const menBNext = result.action_next.find((a) => a.vaccine_name === "Meningocoque B");
  assert.ok(menBNow);
  assert.ok(menBNext);
  assert.equal(menBNow.rule_id, "RULE-MEN-B-CORE-001");
  assert.equal(menBNext.rule_id, "RULE-MEN-B-CORE-002");
});

test("Meningococcal B dose 2 is due now when one prior dose date is old enough", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Bexsero", administration_date_iso: "2026-01-20", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 18,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const menBNow = result.action_now.find((a) => a.vaccine_name === "Meningocoque B" && a.rule_id === "RULE-MEN-B-CORE-003");
  assert.ok(menBNow);
});

test("Meningococcal B with undated prior dose remains actionable with manual verification", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Bexsero", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 18,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const menBNow = result.action_now.find((a) => a.vaccine_name === "Meningocoque B" && a.rule_id === "RULE-MEN-B-CORE-004");
  assert.ok(menBNow);
  assert.ok(result.limitations.some((line) => line.includes("date de dose precedente manquante")));
});

test("Meningococcal B with undated prior dose outside age/risk scope triggers verification action", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Bexsero", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const menBNow = result.action_now.find((a) => a.vaccine_name === "Meningocoque B");
  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(menBNow);
  assert.equal(menBNow.rule_id, "RULE-MEN-B-CORE-005");
  assert.ok(result.limitations.some((line) => line.includes("historique non date hors perimetre age/risque")));
});

test("Supported meningococcal antigens do not trigger out-of-coverage limitation", () => {
  const resolvedHistory = resolveProductEntries(
    [
      { product_name: "Nimenrix", administration_date_iso: "2025-06-10", source: "declaratif" },
      { product_name: "Bexsero", administration_date_iso: "2025-12-15", source: "declaratif" }
    ],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.equal(result.meta.decision_status, "ready");
  assert.ok(!result.limitations.some((line) => line.includes("Antigenes hors couverture moteur") && line.includes("Meningocoque")));
});

test("dTcaPolio reminder is generated at age 25 milestone without dated history", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 25,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const dtcaNow = result.action_now.find((a) => a.vaccine_name === "dTcaPolio" && a.rule_id === "RULE-DTCAPOLIO-CORE-001");
  assert.ok(dtcaNow);
});

test("dTcaPolio reminder is due now when 10-year interval is exceeded at milestone", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Boostrixtetra", administration_date_iso: "2014-01-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 45,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const dtcaNow = result.action_now.find((a) => a.vaccine_name === "dTcaPolio" && a.rule_id === "RULE-DTCAPOLIO-CORE-002");
  assert.ok(dtcaNow);
});

test("dTcaPolio reminder is scheduled when 10-year interval is not yet reached at milestone", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Boostrixtetra", administration_date_iso: "2020-01-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 45,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.ok(!result.action_now.some((a) => a.vaccine_name === "dTcaPolio" && a.rule_id === "RULE-DTCAPOLIO-CORE-002"));
  const dtcaNext = result.action_next.find((a) => a.vaccine_name === "dTcaPolio" && a.rule_id === "RULE-DTCAPOLIO-CORE-003");
  assert.ok(dtcaNext);
  assert.equal(dtcaNext.proposed_date_iso, "2029-12-29");
});

test("dTcaPolio reminder is due now outside milestone when 10-year interval is exceeded", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Boostrixtetra", administration_date_iso: "2014-01-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 46,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const dtcaNow = result.action_now.find((a) => a.vaccine_name === "dTcaPolio" && a.rule_id === "RULE-DTCAPOLIO-CORE-002");
  assert.ok(dtcaNow);
  assert.ok(result.limitations.some((line) => line.includes("hors jalon age")));
});

test("dTcaPolio reminder is scheduled outside milestone when 10-year interval is not yet reached", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Boostrixtetra", administration_date_iso: "2020-01-01", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 46,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.ok(!result.action_now.some((a) => a.vaccine_name === "dTcaPolio" && a.rule_id === "RULE-DTCAPOLIO-CORE-002"));
  const dtcaNext = result.action_next.find((a) => a.vaccine_name === "dTcaPolio" && a.rule_id === "RULE-DTCAPOLIO-CORE-003");
  assert.ok(dtcaNext);
  assert.equal(dtcaNext.proposed_date_iso, "2029-12-29");
  assert.ok(result.limitations.some((line) => line.includes("hors jalon age")));
});

test("dTcaPolio pregnancy evaluation is generated for pregnant female profile", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 31,
        sex: "F",
        pregnancy_status: "oui",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const dtcaNow = result.action_now.find((a) => a.vaccine_name === "dTcaPolio" && a.rule_id === "RULE-DTCAPOLIO-CORE-004");
  assert.ok(dtcaNow);
});

test("Supported dTcaPolio antigen does not trigger out-of-coverage limitation", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Boostrixtetra", administration_date_iso: "2025-12-10", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 35,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.equal(result.meta.decision_status, "ready");
  assert.ok(!result.limitations.some((line) => line.includes("Antigenes hors couverture moteur") && line.includes("dTcaPolio")));
});

test("Duplicate same-day ROR entries are deduplicated and do not mark the schema complete", () => {
  const resolvedHistory = resolveProductEntries(
    [
      { product_name: "Priorix", administration_date_iso: "2026-01-01", source: "declaratif" },
      { product_name: "Priorix", administration_date_iso: "2026-01-01", source: "declaratif" }
    ],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-01-20",
      patient: {
        age_years: 30,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.ok(!result.action_now.some((a) => a.vaccine_name === "ROR" && a.rule_id === "RULE-ROR-CORE-003"));
  const rorNext = result.action_next.find((a) => a.vaccine_name === "ROR" && a.rule_id === "RULE-ROR-CORE-003");
  assert.ok(rorNext);
  assert.equal(rorNext.proposed_date_iso, "2026-01-29");
});

test("Duplicate same-day HepB entries are deduplicated and keep dose 2 workflow", () => {
  const resolvedHistory = resolveProductEntries(
    [
      { product_name: "Engerix B10", administration_date_iso: "2026-01-01", source: "declaratif" },
      { product_name: "Engerix B10", administration_date_iso: "2026-01-01", source: "declaratif" }
    ],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const hepBNowDose2 = result.action_now.find((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-004");
  assert.ok(hepBNowDose2);
});

test("Supported VRS antigen is handled without out-of-coverage limitation", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Abrysvo", administration_date_iso: "2026-01-10", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.equal(result.meta.decision_status, "ready");
  assert.ok(!result.action_now.some((a) => a.vaccine_name === "VRS"));
  assert.ok(!result.limitations.some((line) => line.includes("Antigenes hors couverture") && line.includes("VRS")));
  assert.ok(result.limitations.some((line) => line.includes("schema simplifie considere couvert")));
});

test("VRS with undated prior dose in eligible profile stays actionable with manual verification", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Abrysvo", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const vrsNow = result.action_now.find((a) => a.vaccine_name === "VRS" && a.rule_id === "RULE-VRS-CORE-003");
  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(vrsNow);
  assert.ok(result.limitations.some((line) => line.includes("VRS: historique non date")));
});

test("VRS with undated prior dose outside eligible profile does not auto-close schema", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Abrysvo", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 40,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(!result.action_now.some((a) => a.vaccine_name === "VRS"));
  assert.ok(result.limitations.some((line) => line.includes("hors profil prioritaire")));
});

test("VRS pregnancy pathway is generated for pregnant female without VRS history", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "F",
        pregnancy_status: "oui",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  const vrsNow = result.action_now.find((a) => a.vaccine_name === "VRS" && a.rule_id === "RULE-VRS-CORE-001");
  assert.ok(vrsNow);
});

test("Mixed multi-antigen entry keeps supported HepB logic and flags unsupported antigen", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [
      {
        product_name: "Produit mixte test",
        administration_date_iso: "2025-12-01",
        resolution_status: "resolved",
        resolved_product_id: "combo-test",
        antigens: ["HepB", "Dengue"]
      }
    ],
    rulesVersion: "v2.0.0"
  });

  assert.ok(result.action_now.some((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-004"));
  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(result.limitations.some((line) => line.includes("Dengue")));
});

test("Unsupported mapped antigen keeps out-of-coverage limitation on unknown domain", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 70,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [
      {
        product_name: "Produit test dengue",
        administration_date_iso: "2026-01-10",
        resolution_status: "resolved",
        resolved_product_id: "dengue-test",
        antigens: ["Dengue"]
      }
    ],
    rulesVersion: "v2.0.0"
  });

  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(result.limitations.some((line) => line.includes("Antigenes hors couverture")));
  assert.ok(result.limitations.some((line) => line.includes("Dengue")));
});

test("Future-dated resolved history marks decision as needs_more_info", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Priorix", administration_date_iso: "2026-03-10", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 30,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const rorNow = result.action_now.find((a) => a.vaccine_name === "ROR" && a.rule_id === "RULE-ROR-CORE-001");
  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(rorNow);
  assert.ok(result.limitations.some((line) => line.includes("date(s) futures")));
  assert.ok(result.limitations.some((line) => line.includes("exclues du calcul de schema")));
  assert.ok(result.limitations.some((line) => line.includes("Priorix")));
});

test("Future-dated HepB entry is ignored for dosing logic and keeps initiation actionable", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Engerix B10", administration_date_iso: "2026-03-10", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 20,
        sex: "M",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  const hepBInitNow = result.action_now.find((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-001");
  const hepBDose2Now = result.action_now.find((a) => a.vaccine_name === "HepB" && a.rule_id === "RULE-HEPB-CORE-004");
  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(hepBInitNow);
  assert.ok(!hepBDose2Now);
  assert.ok(result.limitations.some((line) => line.includes("Engerix B10")));
  assert.ok(result.limitations.some((line) => line.includes("exclues du calcul de schema")));
});

test("Combined scenario marks needs_more_info when pregnancy + immunodepression + incomplete history", () => {
  const resolvedHistory = resolveProductEntries(
    [{ product_name: "Gardasil 9", administration_date_iso: "", source: "declaratif" }],
    dictionary
  );

  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: 32,
        sex: "F",
        pregnancy_status: "oui",
        risk_flags: {
          immunodepression: true
        }
      }
    },
    resolvedHistory,
    rulesVersion: "v2.0.0"
  });

  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(result.action_now.some((a) => a.vaccine_name === "Pneumocoque"));
  assert.ok(result.limitations.some((item) => item.includes("Historique vaccinal incomplet")));
});

test("Missing age sets decision_status to needs_more_info", () => {
  const result = evaluateRules({
    normalizedInput: {
      diagnostic_date_iso: "2026-02-26",
      patient: {
        age_years: null,
        sex: "F",
        pregnancy_status: "non",
        risk_flags: {}
      }
    },
    resolvedHistory: [],
    rulesVersion: "v2.0.0"
  });

  assert.equal(result.meta.decision_status, "needs_more_info");
  assert.ok(result.hypotheses_assumed.some((line) => line.includes("age exact non renseigne")));
});
