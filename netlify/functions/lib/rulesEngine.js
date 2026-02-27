function getDoseEventIdentity(entry) {
  const resolvedProductId = String(entry?.resolved_product_id || "").trim().toLowerCase();
  if (resolvedProductId) return resolvedProductId;

  const productName = String(entry?.product_name || "").trim().toLowerCase();
  if (productName) return productName;

  return "unknown_product";
}

const SUPPORTED_ANTIGENS = new Set([
  "HPV",
  "Pneumocoque",
  "HepB",
  "ROR",
  "Covid19",
  "Zona",
  "dTcaPolio",
  "VRS",
  "Meningocoque_ACWY",
  "Meningocoque_B"
]);

const PNEUMO_CONJUGATE_PRODUCT_IDS = new Set([
  "prevenar13",
  "prevenar20",
  "vaxneuvance",
  "capvaxive"
]);
const PNEUMO_POLYSACCHARIDE_PRODUCT_IDS = new Set(["pneumovax"]);
const PNEUMO_BROAD_COVERAGE_PRODUCT_IDS = new Set(["prevenar20", "capvaxive"]);

function getAntigenDoseEvents(resolvedHistory = [], antigen) {
  const seen = new Set();
  const events = [];

  for (const entry of resolvedHistory) {
    if (!Array.isArray(entry?.antigens) || !entry.antigens.includes(antigen)) {
      continue;
    }

    const rawDateIso = String(entry?.administration_date_iso || "").trim();
    const administrationDateIso = isIsoDate(rawDateIso) ? rawDateIso : "";
    const eventKey = administrationDateIso
      ? `${antigen}|${administrationDateIso}`
      : `${antigen}|undated|${getDoseEventIdentity(entry)}`;

    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    events.push({
      administration_date_iso: administrationDateIso,
      is_dated: Boolean(administrationDateIso)
    });
  }

  return events;
}

function getResolvedAntigenEntries(resolvedHistory = [], antigen) {
  const seen = new Set();
  const entries = [];

  for (const entry of resolvedHistory) {
    if (!Array.isArray(entry?.antigens) || !entry.antigens.includes(antigen)) {
      continue;
    }

    const rawDateIso = String(entry?.administration_date_iso || "").trim();
    const administrationDateIso = isIsoDate(rawDateIso) ? rawDateIso : "";
    const resolvedProductId = String(entry?.resolved_product_id || "").trim().toLowerCase();
    const eventIdentity = getDoseEventIdentity(entry);
    const eventKey = administrationDateIso
      ? `${antigen}|${administrationDateIso}|${resolvedProductId || eventIdentity}`
      : `${antigen}|undated|${resolvedProductId || eventIdentity}`;

    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    entries.push({
      resolved_product_id: resolvedProductId,
      administration_date_iso: administrationDateIso
    });
  }

  return entries;
}

function collectOutOfCoverageAntigens(resolvedHistory = []) {
  const unsupported = new Set();
  for (const entry of resolvedHistory) {
    if (entry?.resolution_status !== "resolved") continue;
    if (!Array.isArray(entry?.antigens)) continue;
    for (const antigen of entry.antigens) {
      const normalized = String(antigen || "").trim();
      if (normalized && !SUPPORTED_ANTIGENS.has(normalized)) {
        unsupported.add(normalized);
      }
    }
  }
  return [...unsupported].sort();
}

function countAntigenDoses(resolvedHistory, antigen) {
  return getAntigenDoseEvents(resolvedHistory, antigen).length;
}

function getAntigenDoseDates(resolvedHistory, antigen) {
  return getAntigenDoseEvents(resolvedHistory, antigen)
    .filter((event) => event.is_dated)
    .map((event) => event.administration_date_iso)
    .sort();
}

function hasMappedHighRiskCondition(riskFlags = {}) {
  return Boolean(
    riskFlags?.immunodepression ||
    riskFlags?.cancer_en_cours ||
    riskFlags?.dialyse_ou_ir ||
    riskFlags?.vih ||
    riskFlags?.asplenie
  );
}

function parseAgeYears(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isIsoDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

function collectIncompleteHistoryEntries(resolvedHistory = []) {
  return resolvedHistory.filter(
    (entry) =>
      entry?.resolution_status === "resolved" &&
      entry?.product_name &&
      !isIsoDate(entry?.administration_date_iso)
  );
}

function collectFutureHistoryEntries(resolvedHistory = [], diagnosticDateIso = "") {
  if (!isIsoDate(diagnosticDateIso)) return [];
  return resolvedHistory.filter(
    (entry) =>
      entry?.resolution_status === "resolved" &&
      entry?.product_name &&
      isIsoDate(entry?.administration_date_iso) &&
      String(entry.administration_date_iso).trim() > diagnosticDateIso
  );
}

function filterFutureHistoryFromDosing(resolvedHistory = [], diagnosticDateIso = "") {
  if (!isIsoDate(diagnosticDateIso)) return resolvedHistory;
  return resolvedHistory.filter(
    (entry) =>
      !(
        entry?.resolution_status === "resolved" &&
        isIsoDate(entry?.administration_date_iso) &&
        String(entry.administration_date_iso).trim() > diagnosticDateIso
      )
  );
}

function addDays(dateIso, days) {
  if (!dateIso || !Number.isFinite(days)) return "";
  const date = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function evaluateHpvRule({ ageYears, diagnosticDateIso, resolvedHistory }) {
  const hpvDoseCount = countAntigenDoses(resolvedHistory, "HPV");
  if (!Number.isFinite(ageYears)) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["HPV non evalue: age exact manquant pour appliquer la regle."]
    };
  }

  if (ageYears < 11 || ageYears > 26) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["HPV hors perimetre age cible 11-26 pour le moteur v2.0.0."]
    };
  }

  const targetDoses = ageYears <= 19 ? 2 : 3;
  if (hpvDoseCount >= targetDoses) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["HPV: schema cible considere complet selon les donnees disponibles."]
    };
  }

  const nextDoseNumber = hpvDoseCount + 1;
  const actionNow = {
    vaccine_name: "HPV",
    label: `Administrer dose HPV ${nextDoseNumber}`,
    rationale: "Rattrapage HPV requis selon age et doses historiques.",
    rule_id: "RULE-HPV-CORE-001",
    references: [
      {
        source_id: "calendrier-2025-hpv",
        section_hint: "HPV rattrapage",
        rule_id: "RULE-HPV-CORE-001"
      }
    ]
  };

  const actionNext = [];
  if (nextDoseNumber < targetDoses) {
    const minIntervalDays = 56;
    actionNext.push({
      vaccine_name: "HPV",
      label: `Programmer dose HPV ${nextDoseNumber + 1}`,
      dose_number: nextDoseNumber + 1,
      min_interval_days: minIntervalDays,
      proposed_date_iso: addDays(diagnosticDateIso, minIntervalDays),
      notes: "Intervalle minimal applique: 8 semaines.",
      rule_id: "RULE-HPV-CORE-002",
      references: [
        {
          source_id: "calendrier-2025-hpv",
          section_hint: "HPV intervalles",
          rule_id: "RULE-HPV-CORE-002"
        }
      ]
    });
  }

  return {
    action_now: [actionNow],
    action_next: actionNext,
    limitations: []
  };
}

function evaluatePneumococcalRule({ ageYears, diagnosticDateIso, riskFlags, resolvedHistory }) {
  const hasRiskFactor = hasMappedHighRiskCondition(riskFlags);
  const pneumoEntries = getResolvedAntigenEntries(resolvedHistory, "Pneumocoque");
  const eligibleByAge = Number.isFinite(ageYears) && ageYears >= 65;

  if (!eligibleByAge && !hasRiskFactor) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["Pneumocoque: non declenche sans age >=65 ou risque explicitement cartographie."]
    };
  }

  const hasConjugateDose = pneumoEntries.some((entry) =>
    PNEUMO_CONJUGATE_PRODUCT_IDS.has(entry.resolved_product_id)
  );
  const hasPolysaccharideDose = pneumoEntries.some((entry) =>
    PNEUMO_POLYSACCHARIDE_PRODUCT_IDS.has(entry.resolved_product_id)
  );
  const hasBroadCoverageConjugateDose = pneumoEntries.some((entry) =>
    PNEUMO_BROAD_COVERAGE_PRODUCT_IDS.has(entry.resolved_product_id)
  );
  const hasDatedBroadCoverageConjugateDose = pneumoEntries.some(
    (entry) =>
      PNEUMO_BROAD_COVERAGE_PRODUCT_IDS.has(entry.resolved_product_id) &&
      Boolean(entry.administration_date_iso)
  );

  const conjugateDoseDates = pneumoEntries
    .filter((entry) => PNEUMO_CONJUGATE_PRODUCT_IDS.has(entry.resolved_product_id) && entry.administration_date_iso)
    .map((entry) => entry.administration_date_iso)
    .sort();
  const polysaccharideDoseDates = pneumoEntries
    .filter((entry) => PNEUMO_POLYSACCHARIDE_PRODUCT_IDS.has(entry.resolved_product_id) && entry.administration_date_iso)
    .map((entry) => entry.administration_date_iso)
    .sort();
  const lastConjugateDoseDateIso = conjugateDoseDates.length > 0 ? conjugateDoseDates[conjugateDoseDates.length - 1] : "";
  const lastPolysaccharideDoseDateIso =
    polysaccharideDoseDates.length > 0 ? polysaccharideDoseDates[polysaccharideDoseDates.length - 1] : "";

  if (hasBroadCoverageConjugateDose) {
    if (!hasDatedBroadCoverageConjugateDose) {
      return {
        action_now: [
          {
            vaccine_name: "Pneumocoque",
            label: "Verifier historique pneumocoque large couverture",
            rationale:
              "Dose large couverture (PCV20/Capvaxive) detectee sans date exploitable: verification documentaire necessaire avant conclusion schema couvert.",
            rule_id: "RULE-PNEUMO-CORE-006",
            references: [
              {
                source_id: "calendrier-2025-pneumocoque",
                section_hint: "Sequences pneumocoque conjuguees",
                rule_id: "RULE-PNEUMO-CORE-006"
              }
            ]
          }
        ],
        action_next: [],
        limitations: [
          "Pneumocoque: dose conjuguee large couverture detectee sans date, verification manuelle requise avant conclusion schema couvert."
        ]
      };
    }

    return {
      action_now: [],
      action_next: [],
      limitations: [
        "Pneumocoque: dose conjuguee large couverture detectee (PCV20/Capvaxive), schema considere couvert dans cette version."
      ]
    };
  }

  if (hasConjugateDose && hasPolysaccharideDose) {
    return {
      action_now: [],
      action_next: [],
      limitations: [
        "Pneumocoque: sequence conjugue + polysaccharidique detectee, strategie de rappels ulterieurs a confirmer."
      ]
    };
  }

  if (hasConjugateDose && !hasPolysaccharideDose) {
    if (!lastConjugateDoseDateIso) {
      return {
        action_now: [
          {
            vaccine_name: "Pneumocoque",
            label: "Evaluer puis administrer dose complementaire pneumocoque (PPSV23)",
            rationale: "Dose conjuguee historique detectee sans date exploitable pour calculer l intervalle.",
            rule_id: "RULE-PNEUMO-CORE-002",
            references: [
              {
                source_id: "calendrier-2025-pneumocoque",
                section_hint: "Sequences PCV puis PPSV",
                rule_id: "RULE-PNEUMO-CORE-002"
              }
            ]
          }
        ],
        action_next: [],
        limitations: ["Pneumocoque: date dose conjuguee manquante, intervalle minimal vers PPSV23 non calculable."]
      };
    }

    const minIntervalDays = 56;
    const earliestPpsvDateIso = addDays(lastConjugateDoseDateIso, minIntervalDays);
    const doseDueNow = earliestPpsvDateIso && earliestPpsvDateIso <= diagnosticDateIso;
    const complementAction = {
      vaccine_name: "Pneumocoque",
      label: "Administrer dose complementaire pneumocoque (PPSV23)",
      dose_number: 2,
      min_interval_days: minIntervalDays,
      proposed_date_iso: earliestPpsvDateIso,
      notes: "Sequence simplifiee: PPSV23 a >=8 semaines apres la derniere dose PCV.",
      rule_id: "RULE-PNEUMO-CORE-003",
      references: [
        {
          source_id: "calendrier-2025-pneumocoque",
          section_hint: "Sequences PCV puis PPSV",
          rule_id: "RULE-PNEUMO-CORE-003"
        }
      ]
    };

    return {
      action_now: doseDueNow
        ? [
            {
              vaccine_name: "Pneumocoque",
              label: "Administrer dose complementaire pneumocoque (PPSV23)",
              rationale: "Dose complementaire due selon intervalle minimal simplifie apres dose PCV.",
              rule_id: "RULE-PNEUMO-CORE-003",
              references: complementAction.references
            }
          ]
        : [],
      action_next: doseDueNow ? [] : [complementAction],
      limitations: [
        "Pneumocoque: sequence simplifiee conjugue -> polysaccharidique (PPSV23 >=8 semaines) dans cette version."
      ]
    };
  }

  if (!hasConjugateDose && hasPolysaccharideDose) {
    if (!lastPolysaccharideDoseDateIso) {
      return {
        action_now: [
          {
            vaccine_name: "Pneumocoque",
            label: "Evaluer puis administrer dose conjuguee pneumocoque (PCV20/Capvaxive)",
            rationale: "Dose PPSV23 historique detectee sans date exploitable pour calculer l intervalle.",
            rule_id: "RULE-PNEUMO-CORE-004",
            references: [
              {
                source_id: "calendrier-2025-pneumocoque",
                section_hint: "Sequences PPSV puis PCV",
                rule_id: "RULE-PNEUMO-CORE-004"
              }
            ]
          }
        ],
        action_next: [],
        limitations: ["Pneumocoque: date dose PPSV23 manquante, intervalle minimal vers PCV20 non calculable."]
      };
    }

    const minIntervalDays = 365;
    const earliestConjugateDateIso = addDays(lastPolysaccharideDoseDateIso, minIntervalDays);
    const doseDueNow = earliestConjugateDateIso && earliestConjugateDateIso <= diagnosticDateIso;
    const conjugateAction = {
      vaccine_name: "Pneumocoque",
      label: "Administrer dose conjuguee pneumocoque (PCV20/Capvaxive)",
      dose_number: 2,
      min_interval_days: minIntervalDays,
      proposed_date_iso: earliestConjugateDateIso,
      notes: "Sequence simplifiee: PCV20/Capvaxive a >=1 an apres PPSV23.",
      rule_id: "RULE-PNEUMO-CORE-005",
      references: [
        {
          source_id: "calendrier-2025-pneumocoque",
          section_hint: "Sequences PPSV puis PCV",
          rule_id: "RULE-PNEUMO-CORE-005"
        }
      ]
    };

    return {
      action_now: doseDueNow
        ? [
            {
              vaccine_name: "Pneumocoque",
              label: "Administrer dose conjuguee pneumocoque (PCV20/Capvaxive)",
              rationale: "Dose conjuguee due selon intervalle minimal simplifie apres PPSV23.",
              rule_id: "RULE-PNEUMO-CORE-005",
              references: conjugateAction.references
            }
          ]
        : [],
      action_next: doseDueNow ? [] : [conjugateAction],
      limitations: [
        "Pneumocoque: sequence simplifiee polysaccharidique -> conjuguee (PCV20/Capvaxive >=1 an) dans cette version."
      ]
    };
  }

  return {
    action_now: [
      {
        vaccine_name: "Pneumocoque",
        label: "Administrer dose pneumocoque conjuguee (PCV20/Capvaxive)",
        rationale: "Patient en groupe de recommandation age/risque.",
        rule_id: "RULE-PNEUMO-CORE-001",
        references: [
          {
            source_id: "calendrier-2025-pneumocoque",
            section_hint: "Indications pneumocoque",
            rule_id: "RULE-PNEUMO-CORE-001"
          }
        ]
      }
    ],
    action_next: [],
    limitations: ["Pneumocoque: sequence produit simplifiee (conjugue puis complement eventuel) dans cette version."]
  };
}

function evaluateHepBRule({ ageYears, diagnosticDateIso, riskFlags, resolvedHistory }) {
  const hepBDoseCount = countAntigenDoses(resolvedHistory, "HepB");
  const hepBDoseDates = getAntigenDoseDates(resolvedHistory, "HepB");
  const lastDoseDateIso = hepBDoseDates.length > 0 ? hepBDoseDates[hepBDoseDates.length - 1] : "";

  const eligibleByAge = Number.isFinite(ageYears) && ageYears >= 11 && ageYears <= 25;
  const eligibleByRisk = hasMappedHighRiskCondition(riskFlags);

  if (!eligibleByAge && !eligibleByRisk && hepBDoseCount === 0) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["HepB: non declenche sans age 11-25 ou facteur de risque cartographie."]
    };
  }

  if (hepBDoseCount >= 3) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["HepB: schema considere complet (>=3 doses) selon historique disponible."]
    };
  }

  if (hepBDoseCount === 0) {
    return {
      action_now: [
        {
          vaccine_name: "HepB",
          label: "Administrer dose HepB 1",
          rationale: "Initiation schema HepB recommandee selon eligibilite age/risque.",
          rule_id: "RULE-HEPB-CORE-001",
          references: [
            {
              source_id: "calendrier-2025-hepb",
              section_hint: "Indications HepB",
              rule_id: "RULE-HEPB-CORE-001"
            }
          ]
        }
      ],
      action_next: [
        {
          vaccine_name: "HepB",
          label: "Programmer dose HepB 2",
          dose_number: 2,
          min_interval_days: 30,
          proposed_date_iso: addDays(diagnosticDateIso, 30),
          notes: "Schema simplifie 0-1-6 mois: dose 2 a >=1 mois.",
          rule_id: "RULE-HEPB-CORE-002",
          references: [
            {
              source_id: "calendrier-2025-hepb",
              section_hint: "Intervalles HepB",
              rule_id: "RULE-HEPB-CORE-002"
            }
          ]
        },
        {
          vaccine_name: "HepB",
          label: "Programmer dose HepB 3",
          dose_number: 3,
          min_interval_days: 180,
          proposed_date_iso: addDays(diagnosticDateIso, 180),
          notes: "Schema simplifie 0-1-6 mois: dose 3 a >=6 mois.",
          rule_id: "RULE-HEPB-CORE-003",
          references: [
            {
              source_id: "calendrier-2025-hepb",
              section_hint: "Intervalles HepB",
              rule_id: "RULE-HEPB-CORE-003"
            }
          ]
        }
      ],
      limitations: ["HepB: schema simplifie 0-1-6 mois dans cette version."]
    };
  }

  if (!lastDoseDateIso) {
    if (hepBDoseCount === 1) {
      return {
        action_now: [
          {
            vaccine_name: "HepB",
            label: "Evaluer puis administrer dose HepB 2",
            rationale: "Date precedente manquante: verification manuelle requise avant validation temporelle.",
            rule_id: "RULE-HEPB-CORE-007",
            references: [
              {
                source_id: "calendrier-2025-hepb",
                section_hint: "Intervalles HepB",
                rule_id: "RULE-HEPB-CORE-007"
              }
            ]
          }
        ],
        action_next: [],
        limitations: [
          "HepB: date de dose precedente manquante, impossible de positionner le rattrapage temporel.",
          "HepB: verification manuelle necessaire avant validation definitive de la dose 2."
        ]
      };
    }

    if (hepBDoseCount === 2) {
      return {
        action_now: [
          {
            vaccine_name: "HepB",
            label: "Evaluer puis administrer dose HepB 3",
            rationale: "Date precedente manquante: verification manuelle requise avant validation temporelle.",
            rule_id: "RULE-HEPB-CORE-008",
            references: [
              {
                source_id: "calendrier-2025-hepb",
                section_hint: "Intervalles HepB",
                rule_id: "RULE-HEPB-CORE-008"
              }
            ]
          }
        ],
        action_next: [],
        limitations: [
          "HepB: date de dose precedente manquante, impossible de positionner le rattrapage temporel.",
          "HepB: verification manuelle necessaire avant validation definitive de la dose 3."
        ]
      };
    }

    return {
      action_now: [],
      action_next: [],
      limitations: ["HepB: date de dose precedente manquante, impossible de positionner le rattrapage temporel."]
    };
  }

  if (hepBDoseCount === 1) {
    const earliestDose2Date = addDays(lastDoseDateIso, 30);
    const dose2DueNow = earliestDose2Date && earliestDose2Date <= diagnosticDateIso;

    const dose2Action = {
      vaccine_name: "HepB",
      label: "Administrer dose HepB 2",
      dose_number: 2,
      min_interval_days: 30,
      proposed_date_iso: earliestDose2Date,
      notes: "Dose 2 selon intervalle minimal simplifie de 1 mois.",
      rule_id: "RULE-HEPB-CORE-004",
      references: [
        {
          source_id: "calendrier-2025-hepb",
          section_hint: "Intervalles HepB",
          rule_id: "RULE-HEPB-CORE-004"
        }
      ]
    };

    const dose3Action = {
      vaccine_name: "HepB",
      label: "Programmer dose HepB 3",
      dose_number: 3,
      min_interval_days: 180,
      proposed_date_iso: addDays(lastDoseDateIso, 180),
      notes: "Positionnement dose 3 simplifie depuis la dose 1.",
      rule_id: "RULE-HEPB-CORE-005",
      references: [
        {
          source_id: "calendrier-2025-hepb",
          section_hint: "Intervalles HepB",
          rule_id: "RULE-HEPB-CORE-005"
        }
      ]
    };

    return {
      action_now: dose2DueNow
        ? [
            {
              vaccine_name: "HepB",
              label: "Administrer dose HepB 2",
              rationale: "Dose 2 due selon intervalle minimal simplifie.",
              rule_id: "RULE-HEPB-CORE-004",
              references: dose2Action.references
            }
          ]
        : [],
      action_next: dose2DueNow ? [dose3Action] : [dose2Action, dose3Action],
      limitations: ["HepB: schema simplifie 0-1-6 mois dans cette version."]
    };
  }

  const earliestDose3Date = addDays(lastDoseDateIso, 150);
  const dose3DueNow = earliestDose3Date && earliestDose3Date <= diagnosticDateIso;
  const dose3Action = {
    vaccine_name: "HepB",
    label: "Administrer dose HepB 3",
    dose_number: 3,
    min_interval_days: 150,
    proposed_date_iso: earliestDose3Date,
    notes: "Dose 3 selon intervalle simplifie >=5 mois apres dose 2.",
    rule_id: "RULE-HEPB-CORE-006",
    references: [
      {
        source_id: "calendrier-2025-hepb",
        section_hint: "Intervalles HepB",
        rule_id: "RULE-HEPB-CORE-006"
      }
    ]
  };

  return {
    action_now: dose3DueNow
      ? [
          {
            vaccine_name: "HepB",
            label: "Administrer dose HepB 3",
            rationale: "Dose 3 due selon intervalle minimal simplifie.",
            rule_id: "RULE-HEPB-CORE-006",
            references: dose3Action.references
          }
        ]
      : [],
    action_next: dose3DueNow ? [] : [dose3Action],
    limitations: ["HepB: schema simplifie 0-1-6 mois dans cette version."]
  };
}

function evaluateRorRule({ ageYears, diagnosticDateIso, resolvedHistory }) {
  const rorDoseCount = countAntigenDoses(resolvedHistory, "ROR");
  const rorDoseDates = getAntigenDoseDates(resolvedHistory, "ROR");
  const lastDoseDateIso = rorDoseDates.length > 0 ? rorDoseDates[rorDoseDates.length - 1] : "";

  if (!Number.isFinite(ageYears) || ageYears < 1) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["ROR non evalue: age insuffisant ou manquant."]
    };
  }

  if (ageYears > 45) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["ROR: rattrapage non declenche hors perimetre age simplifie (<=45 ans)."]
    };
  }

  if (rorDoseCount >= 2) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["ROR: schema 2 doses considere complet selon historique disponible."]
    };
  }

  if (rorDoseCount === 0) {
    return {
      action_now: [
        {
          vaccine_name: "ROR",
          label: "Administrer dose ROR 1",
          rationale: "Rattrapage ROR requis selon perimetre age simplifie.",
          rule_id: "RULE-ROR-CORE-001",
          references: [
            {
              source_id: "calendrier-2025-ror",
              section_hint: "Rattrapage ROR",
              rule_id: "RULE-ROR-CORE-001"
            }
          ]
        }
      ],
      action_next: [
        {
          vaccine_name: "ROR",
          label: "Programmer dose ROR 2",
          dose_number: 2,
          min_interval_days: 28,
          proposed_date_iso: addDays(diagnosticDateIso, 28),
          notes: "Intervalle minimal simplifie: 4 semaines.",
          rule_id: "RULE-ROR-CORE-002",
          references: [
            {
              source_id: "calendrier-2025-ror",
              section_hint: "Intervalles ROR",
              rule_id: "RULE-ROR-CORE-002"
            }
          ]
        }
      ],
      limitations: ["ROR: schema simplifie a 2 doses dans cette version."]
    };
  }

  if (!lastDoseDateIso) {
    return {
      action_now: [
        {
          vaccine_name: "ROR",
          label: "Evaluer puis administrer dose ROR 2",
          rationale: "Date precedente manquante: verification manuelle requise avant validation temporelle.",
          rule_id: "RULE-ROR-CORE-004",
          references: [
            {
              source_id: "calendrier-2025-ror",
              section_hint: "Intervalles ROR",
              rule_id: "RULE-ROR-CORE-004"
            }
          ]
        }
      ],
      action_next: [],
      limitations: [
        "ROR: date de dose precedente manquante, impossible de positionner dose 2.",
        "ROR: verification manuelle necessaire avant validation definitive de la dose 2."
      ]
    };
  }

  const earliestDose2Date = addDays(lastDoseDateIso, 28);
  const dose2DueNow = earliestDose2Date && earliestDose2Date <= diagnosticDateIso;
  const dose2Action = {
    vaccine_name: "ROR",
    label: "Administrer dose ROR 2",
    dose_number: 2,
    min_interval_days: 28,
    proposed_date_iso: earliestDose2Date,
    notes: "Dose 2 selon intervalle minimal simplifie de 4 semaines.",
    rule_id: "RULE-ROR-CORE-003",
    references: [
      {
        source_id: "calendrier-2025-ror",
        section_hint: "Intervalles ROR",
        rule_id: "RULE-ROR-CORE-003"
      }
    ]
  };

  return {
    action_now: dose2DueNow
      ? [
          {
            vaccine_name: "ROR",
            label: "Administrer dose ROR 2",
            rationale: "Dose 2 due selon intervalle minimal simplifie.",
            rule_id: "RULE-ROR-CORE-003",
            references: dose2Action.references
          }
        ]
      : [],
    action_next: dose2DueNow ? [] : [dose2Action],
    limitations: ["ROR: schema simplifie a 2 doses dans cette version."]
  };
}

function evaluateCovidRule({ ageYears, diagnosticDateIso, riskFlags, pregnancyStatus, resolvedHistory }) {
  const covidDoseCount = countAntigenDoses(resolvedHistory, "Covid19");
  const covidDoseDates = getAntigenDoseDates(resolvedHistory, "Covid19");
  const lastCovidDoseDateIso = covidDoseDates.length > 0 ? covidDoseDates[covidDoseDates.length - 1] : "";
  const isPregnant = String(pregnancyStatus || "").trim().toLowerCase() === "oui";
  const eligibleByAge = Number.isFinite(ageYears) && ageYears >= 5;
  const highPriorityProfile = Boolean(
    (Number.isFinite(ageYears) && ageYears >= 65) ||
    isPregnant ||
    hasMappedHighRiskCondition(riskFlags)
  );

  if (!eligibleByAge) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["Covid-19: non declenche hors perimetre age simplifie (>=5 ans)."]
    };
  }

  if (covidDoseCount === 0) {
    return {
      action_now: [
        {
          vaccine_name: "Covid-19",
          label: "Evaluer puis administrer dose Covid-19 initiale",
          rationale: "Aucune dose Covid-19 detectee dans l historique.",
          rule_id: "RULE-COVID-CORE-001",
          references: [
            {
              source_id: "calendrier-2025-covid",
              section_hint: "Indications Covid-19",
              rule_id: "RULE-COVID-CORE-001"
            }
          ]
        }
      ],
      action_next: [],
      limitations: ["Covid-19: schema et periodicite de rappel simplifies dans cette version."]
    };
  }

  if (!highPriorityProfile) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["Covid-19: rappel non declenche automatiquement hors profil prioritaire simplifie (age/risque/grossesse)."]
    };
  }

  if (!lastCovidDoseDateIso) {
    return {
      action_now: [
        {
          vaccine_name: "Covid-19",
          label: "Evaluer un rappel Covid-19",
          rationale: "Profil prioritaire avec historique Covid-19 sans date exploitable.",
          rule_id: "RULE-COVID-CORE-002",
          references: [
            {
              source_id: "calendrier-2025-covid",
              section_hint: "Rappels Covid-19",
              rule_id: "RULE-COVID-CORE-002"
            }
          ]
        }
      ],
      action_next: [],
      limitations: [
        "Covid-19: date de derniere dose manquante, intervalle de rappel non calculable."
      ]
    };
  }

  const minIntervalDays = 180;
  const earliestBoosterDateIso = addDays(lastCovidDoseDateIso, minIntervalDays);
  const boosterDueNow = earliestBoosterDateIso && earliestBoosterDateIso <= diagnosticDateIso;
  const boosterAction = {
    vaccine_name: "Covid-19",
    label: "Programmer rappel Covid-19",
    dose_number: covidDoseCount + 1,
    min_interval_days: minIntervalDays,
    proposed_date_iso: earliestBoosterDateIso,
    notes: "Intervalle minimal simplifie: 6 mois depuis la derniere dose.",
    rule_id: "RULE-COVID-CORE-003",
    references: [
      {
        source_id: "calendrier-2025-covid",
        section_hint: "Intervalles rappels Covid-19",
        rule_id: "RULE-COVID-CORE-003"
      }
    ]
  };

  return {
    action_now: boosterDueNow
      ? [
          {
            vaccine_name: "Covid-19",
            label: "Evaluer un rappel Covid-19",
            rationale: "Profil prioritaire age/risque/grossesse avec rappel potentiellement du.",
            rule_id: "RULE-COVID-CORE-002",
            references: [
              {
                source_id: "calendrier-2025-covid",
                section_hint: "Rappels Covid-19",
                rule_id: "RULE-COVID-CORE-002"
              }
            ]
          }
        ]
      : [],
    action_next: boosterDueNow ? [] : [boosterAction],
    limitations: ["Covid-19: strategie de rappel simplifiee avec intervalle minimal de 6 mois."]
  };
}

function evaluateZonaRule({ ageYears, diagnosticDateIso, riskFlags, resolvedHistory }) {
  const zonaDoseCount = countAntigenDoses(resolvedHistory, "Zona");
  const zonaDoseDates = getAntigenDoseDates(resolvedHistory, "Zona");
  const lastDoseDateIso = zonaDoseDates.length > 0 ? zonaDoseDates[zonaDoseDates.length - 1] : "";

  const eligibleByAge = Number.isFinite(ageYears) && ageYears >= 65;
  const eligibleByRisk = Number.isFinite(ageYears) && ageYears >= 18 && Boolean(
    riskFlags?.immunodepression ||
    riskFlags?.cancer_en_cours
  );
  if (!eligibleByAge && !eligibleByRisk) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["Zona: non declenche sans age >=65 ou immunodepression/cancer explicite."]
    };
  }

  if (zonaDoseCount >= 2) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["Zona: schema 2 doses considere complet selon historique disponible."]
    };
  }

  if (zonaDoseCount === 0) {
    const minIntervalDays = 60;
    return {
      action_now: [
        {
          vaccine_name: "Zona",
          label: "Administrer dose Zona 1 (Shingrix)",
          rationale: "Patient eligible au schema Zona (version simplifiee).",
          rule_id: "RULE-ZONA-CORE-001",
          references: [
            {
              source_id: "calendrier-2025-zona",
              section_hint: "Indications zona",
              rule_id: "RULE-ZONA-CORE-001"
            }
          ]
        }
      ],
      action_next: [
        {
          vaccine_name: "Zona",
          label: "Programmer dose Zona 2",
          dose_number: 2,
          min_interval_days: minIntervalDays,
          proposed_date_iso: addDays(diagnosticDateIso, minIntervalDays),
          notes: "Intervalle minimal simplifie: 2 mois.",
          rule_id: "RULE-ZONA-CORE-002",
          references: [
            {
              source_id: "calendrier-2025-zona",
              section_hint: "Intervalles zona",
              rule_id: "RULE-ZONA-CORE-002"
            }
          ]
        }
      ],
      limitations: ["Zona: schema simplifie (2 doses) dans cette version."]
    };
  }

  if (!lastDoseDateIso) {
    return {
      action_now: [
        {
          vaccine_name: "Zona",
          label: "Evaluer puis administrer dose Zona 2",
          rationale: "Date precedente manquante: verification manuelle requise avant validation temporelle.",
          rule_id: "RULE-ZONA-CORE-004",
          references: [
            {
              source_id: "calendrier-2025-zona",
              section_hint: "Intervalles zona",
              rule_id: "RULE-ZONA-CORE-004"
            }
          ]
        }
      ],
      action_next: [],
      limitations: [
        "Zona: date de dose precedente manquante, impossible de positionner dose 2.",
        "Zona: verification manuelle necessaire avant validation definitive de la dose 2."
      ]
    };
  }

  const earliestDose2Date = lastDoseDateIso ? addDays(lastDoseDateIso, 60) : "";
  const canDose2Now = earliestDose2Date && earliestDose2Date <= diagnosticDateIso;
  const dose2Action = {
    vaccine_name: "Zona",
    label: "Administrer dose Zona 2",
    dose_number: 2,
    min_interval_days: 60,
    proposed_date_iso: earliestDose2Date || "",
    notes: earliestDose2Date
      ? "Dose 2 selon intervalle minimal simplifie de 2 mois."
      : "Date dose 1 non disponible: verifier historique avant dose 2.",
    rule_id: "RULE-ZONA-CORE-003",
    references: [
      {
        source_id: "calendrier-2025-zona",
        section_hint: "Intervalles zona",
        rule_id: "RULE-ZONA-CORE-003"
      }
    ]
  };

  return {
    action_now: canDose2Now
      ? [
          {
            vaccine_name: "Zona",
            label: "Administrer dose Zona 2",
            rationale: "Dose 2 due selon intervalle minimal simplifie.",
            rule_id: "RULE-ZONA-CORE-003",
            references: dose2Action.references
          }
        ]
      : [],
    action_next: canDose2Now ? [] : [dose2Action],
    limitations: ["Zona: schema simplifie (2 doses) dans cette version."]
  };
}

function isDtcaPolioMilestoneAge(ageYears) {
  if (!Number.isFinite(ageYears)) return false;
  const normalizedAge = Math.trunc(ageYears);
  if (normalizedAge === 25 || normalizedAge === 45 || normalizedAge === 65) return true;
  if (normalizedAge >= 75 && (normalizedAge - 75) % 10 === 0) return true;
  return false;
}

function evaluateDTcaPolioRule({ ageYears, diagnosticDateIso, pregnancyStatus, patientSex, resolvedHistory }) {
  const dtcaDoseCount = countAntigenDoses(resolvedHistory, "dTcaPolio");
  const dtcaDoseDates = getAntigenDoseDates(resolvedHistory, "dTcaPolio");
  const lastDoseDateIso = dtcaDoseDates.length > 0 ? dtcaDoseDates[dtcaDoseDates.length - 1] : "";
  const milestoneAge = isDtcaPolioMilestoneAge(ageYears);
  const pregnantFemale =
    String(pregnancyStatus || "").trim().toLowerCase() === "oui" &&
    String(patientSex || "").trim().toUpperCase() === "F";

  if (pregnantFemale) {
    return {
      action_now: [
        {
          vaccine_name: "dTcaPolio",
          label: "Evaluer rappel dTcaPolio pendant grossesse",
          rationale: "Grossesse renseignee: evaluation d un rappel coqueluche/dTcaPolio recommandee.",
          rule_id: "RULE-DTCAPOLIO-CORE-004",
          references: [
            {
              source_id: "calendrier-2025-dtcapolio",
              section_hint: "Grossesse et coqueluche",
              rule_id: "RULE-DTCAPOLIO-CORE-004"
            }
          ]
        }
      ],
      action_next: [],
      limitations: [
        "dTcaPolio grossesse: fenetre gestationnelle non modelisee dans cette version."
      ]
    };
  }

  if (!milestoneAge && dtcaDoseCount === 0) {
    return {
      action_now: [],
      action_next: [],
      limitations: [
        "dTcaPolio: rappel non declenche hors jalons age simplifies (25/45/65 puis tous les 10 ans a partir de 75)."
      ]
    };
  }

  if (!lastDoseDateIso) {
    return {
      action_now: [
        {
          vaccine_name: "dTcaPolio",
          label: milestoneAge
            ? "Evaluer puis administrer rappel dTcaPolio"
            : "Verifier date du dernier rappel dTcaPolio",
          rationale: milestoneAge
            ? "Jalon age atteint, mais date de dernier rappel absente."
            : "Historique dTcaPolio detecte sans date exploitable pour calculer l intervalle de rappel.",
          rule_id: "RULE-DTCAPOLIO-CORE-001",
          references: [
            {
              source_id: "calendrier-2025-dtcapolio",
              section_hint: "Rappels dTcaPolio adulte",
              rule_id: "RULE-DTCAPOLIO-CORE-001"
            }
          ]
        }
      ],
      action_next: [],
      limitations: [
        milestoneAge
          ? "dTcaPolio: date de dernier rappel manquante, verification manuelle requise."
          : "dTcaPolio: historique detecte hors jalon avec date de dernier rappel manquante, verification manuelle requise."
      ]
    };
  }

  const earliestReminderDate = addDays(lastDoseDateIso, 3650);
  const reminderDueNow = earliestReminderDate && earliestReminderDate <= diagnosticDateIso;
  const reminderAction = {
    vaccine_name: "dTcaPolio",
    label: "Programmer rappel dTcaPolio",
    dose_number: dtcaDoseCount + 1,
    min_interval_days: 3650,
    proposed_date_iso: earliestReminderDate,
    notes: milestoneAge
      ? "Intervalle minimal simplifie: 10 ans depuis la derniere dose."
      : "Hors jalon: rappel planifie selon intervalle minimal simplifie de 10 ans depuis la derniere dose.",
    rule_id: "RULE-DTCAPOLIO-CORE-003",
    references: [
      {
        source_id: "calendrier-2025-dtcapolio",
        section_hint: "Intervalles rappels dTcaPolio",
        rule_id: "RULE-DTCAPOLIO-CORE-003"
      }
    ]
  };

  return {
    action_now: reminderDueNow
      ? [
          {
            vaccine_name: "dTcaPolio",
            label: "Administrer rappel dTcaPolio",
            rationale: milestoneAge
              ? "Jalon age atteint et intervalle simplifie de 10 ans depasse."
              : "Intervalle simplifie de 10 ans depasse depuis la derniere dose historique.",
            rule_id: "RULE-DTCAPOLIO-CORE-002",
            references: [
              {
                source_id: "calendrier-2025-dtcapolio",
                section_hint: "Rappels dTcaPolio adulte",
                rule_id: "RULE-DTCAPOLIO-CORE-002"
              }
            ]
          }
        ]
      : [],
    action_next: reminderDueNow ? [] : [reminderAction],
    limitations: [
      milestoneAge
        ? "dTcaPolio: jalons age simplifies (25/45/65 puis tous les 10 ans a partir de 75) dans cette version."
        : "dTcaPolio: hors jalon age, rappel evalue sur intervalle minimal simplifie de 10 ans (jalons non modelises finement)."
    ]
  };
}

function evaluateVrsRule({ ageYears, pregnancyStatus, patientSex, resolvedHistory }) {
  const vrsDoseCount = countAntigenDoses(resolvedHistory, "VRS");
  const vrsDoseDates = getAntigenDoseDates(resolvedHistory, "VRS");
  const hasDatedDose = vrsDoseDates.length > 0;
  const seniorEligible = Number.isFinite(ageYears) && ageYears >= 60;
  const pregnantFemale =
    String(pregnancyStatus || "").trim().toLowerCase() === "oui" &&
    String(patientSex || "").trim().toUpperCase() === "F";

  if (!seniorEligible && !pregnantFemale && vrsDoseCount === 0) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["VRS: non declenche hors profils simplifies (senior >=60 ans ou grossesse)."]
    };
  }

  if (vrsDoseCount >= 1 && !hasDatedDose) {
    if (seniorEligible || pregnantFemale) {
      return {
        action_now: [
          {
            vaccine_name: "VRS",
            label: "Verifier historique VRS avant conclusion schema",
            rationale:
              "Dose historique non datee: verification documentaire requise avant de considerer le schema VRS comme couvert.",
            rule_id: "RULE-VRS-CORE-003",
            references: [
              {
                source_id: "calendrier-2025-vrs",
                section_hint: "VRS seniors / grossesse",
                rule_id: "RULE-VRS-CORE-003"
              }
            ]
          }
        ],
        action_next: [],
        limitations: ["VRS: historique non date, verification manuelle requise avant conclusion schema couvert."]
      };
    }

    return {
      action_now: [],
      action_next: [],
      limitations: ["VRS: historique non date detecte hors profil prioritaire, verification manuelle recommandee."]
    };
  }

  if (vrsDoseCount >= 1) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["VRS: dose historique detectee, schema simplifie considere couvert (mono-dose)."]
    };
  }

  if (pregnantFemale) {
    return {
      action_now: [
        {
          vaccine_name: "VRS",
          label: "Evaluer puis administrer vaccination VRS grossesse",
          rationale: "Grossesse renseignee: evaluation VRS maternel simplifiee.",
          rule_id: "RULE-VRS-CORE-001",
          references: [
            {
              source_id: "calendrier-2025-vrs",
              section_hint: "VRS grossesse",
              rule_id: "RULE-VRS-CORE-001"
            }
          ]
        }
      ],
      action_next: [],
      limitations: ["VRS grossesse: fenetre gestationnelle exacte non modelisee dans cette version."]
    };
  }

  return {
    action_now: [
      {
        vaccine_name: "VRS",
        label: "Evaluer puis administrer vaccination VRS senior",
        rationale: "Profil senior eligible au schema VRS simplifie.",
        rule_id: "RULE-VRS-CORE-002",
        references: [
          {
            source_id: "calendrier-2025-vrs",
            section_hint: "VRS seniors",
            rule_id: "RULE-VRS-CORE-002"
          }
        ]
      }
    ],
    action_next: [],
    limitations: ["VRS: schema simplifie en mono-dose dans cette version."]
  };
}

function evaluateMeningococcalAcwyRule({ ageYears, riskFlags, resolvedHistory }) {
  const menAcwyDoseCount = countAntigenDoses(resolvedHistory, "Meningocoque_ACWY");
  const menAcwyDoseDates = getAntigenDoseDates(resolvedHistory, "Meningocoque_ACWY");
  const hasDatedDose = menAcwyDoseDates.length > 0;
  const eligibleByAge = Number.isFinite(ageYears) && ageYears >= 11 && ageYears <= 24;
  const eligibleByRisk = hasMappedHighRiskCondition(riskFlags);

  if (!eligibleByAge && !eligibleByRisk && menAcwyDoseCount === 0) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["Meningocoque ACWY: non declenche sans age 11-24 ou facteur de risque cartographie."]
    };
  }

  if (menAcwyDoseCount >= 1) {
    if (!hasDatedDose) {
      if (!eligibleByAge && !eligibleByRisk) {
        return {
          action_now: [
            {
              vaccine_name: "Meningocoque ACWY",
              label: "Verifier historique Meningocoque ACWY",
              rationale:
                "Profil hors perimetre age/risque avec historique non date: verification documentaire necessaire avant conclusion.",
              rule_id: "RULE-MEN-ACWY-CORE-003",
              references: [
                {
                  source_id: "calendrier-2025-meningocoque",
                  section_hint: "Rattrapage Meningocoque ACWY",
                  rule_id: "RULE-MEN-ACWY-CORE-003"
                }
              ]
            }
          ],
          action_next: [],
          limitations: [
            "Meningocoque ACWY: historique non date hors perimetre age/risque, verification manuelle requise avant toute recommandation."
          ]
        };
      }

      return {
        action_now: [
          {
            vaccine_name: "Meningocoque ACWY",
            label: "Evaluer puis administrer dose Meningocoque ACWY",
            rationale: "Dose historique detectee sans date exploitable pour confirmer la validite clinique.",
            rule_id: "RULE-MEN-ACWY-CORE-002",
            references: [
              {
                source_id: "calendrier-2025-meningocoque",
                section_hint: "Rattrapage Meningocoque ACWY",
                rule_id: "RULE-MEN-ACWY-CORE-002"
              }
            ]
          }
        ],
        action_next: [],
        limitations: [
          "Meningocoque ACWY: date de dose precedente manquante, verification manuelle requise avant confirmation schema complet."
        ]
      };
    }

    return {
      action_now: [],
      action_next: [],
      limitations: ["Meningocoque ACWY: schema simplifie considere couvert apres 1 dose historique."]
    };
  }

  return {
    action_now: [
      {
        vaccine_name: "Meningocoque ACWY",
        label: "Administrer dose Meningocoque ACWY",
        rationale: "Patient eligible au rattrapage Meningocoque ACWY (version simplifiee).",
        rule_id: "RULE-MEN-ACWY-CORE-001",
        references: [
          {
            source_id: "calendrier-2025-meningocoque",
            section_hint: "Rattrapage Meningocoque ACWY",
            rule_id: "RULE-MEN-ACWY-CORE-001"
          }
        ]
      }
    ],
    action_next: [],
    limitations: ["Meningocoque ACWY: schema simplifie a une dose dans cette version."]
  };
}

function evaluateMeningococcalBRule({ ageYears, diagnosticDateIso, riskFlags, resolvedHistory }) {
  const menBDoseCount = countAntigenDoses(resolvedHistory, "Meningocoque_B");
  const menBDoseDates = getAntigenDoseDates(resolvedHistory, "Meningocoque_B");
  const lastDoseDateIso = menBDoseDates.length > 0 ? menBDoseDates[menBDoseDates.length - 1] : "";

  const eligibleByAge = Number.isFinite(ageYears) && ageYears >= 15 && ageYears <= 24;
  const eligibleByRisk = hasMappedHighRiskCondition(riskFlags);

  if (!eligibleByAge && !eligibleByRisk && menBDoseCount === 0) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["Meningocoque B: non declenche sans age 15-24 ou facteur de risque cartographie."]
    };
  }

  if (menBDoseCount >= 2) {
    return {
      action_now: [],
      action_next: [],
      limitations: ["Meningocoque B: schema 2 doses considere complet selon historique disponible."]
    };
  }

  if (menBDoseCount === 0) {
    const minIntervalDays = 30;
    return {
      action_now: [
        {
          vaccine_name: "Meningocoque B",
          label: "Administrer dose Meningocoque B 1",
          rationale: "Initiation schema Meningocoque B (version simplifiee).",
          rule_id: "RULE-MEN-B-CORE-001",
          references: [
            {
              source_id: "calendrier-2025-meningocoque",
              section_hint: "Rattrapage Meningocoque B",
              rule_id: "RULE-MEN-B-CORE-001"
            }
          ]
        }
      ],
      action_next: [
        {
          vaccine_name: "Meningocoque B",
          label: "Programmer dose Meningocoque B 2",
          dose_number: 2,
          min_interval_days: minIntervalDays,
          proposed_date_iso: addDays(diagnosticDateIso, minIntervalDays),
          notes: "Intervalle minimal simplifie: 1 mois.",
          rule_id: "RULE-MEN-B-CORE-002",
          references: [
            {
              source_id: "calendrier-2025-meningocoque",
              section_hint: "Intervalles Meningocoque B",
              rule_id: "RULE-MEN-B-CORE-002"
            }
          ]
        }
      ],
      limitations: ["Meningocoque B: schema simplifie 2 doses dans cette version."]
    };
  }

  if (!lastDoseDateIso) {
    if (!eligibleByAge && !eligibleByRisk) {
      return {
        action_now: [
          {
            vaccine_name: "Meningocoque B",
            label: "Verifier historique Meningocoque B",
            rationale:
              "Profil hors perimetre age/risque avec historique non date: verification documentaire necessaire avant recommandation de rattrapage.",
            rule_id: "RULE-MEN-B-CORE-005",
            references: [
              {
                source_id: "calendrier-2025-meningocoque",
                section_hint: "Rattrapage Meningocoque B",
                rule_id: "RULE-MEN-B-CORE-005"
              }
            ]
          }
        ],
        action_next: [],
        limitations: [
          "Meningocoque B: historique non date hors perimetre age/risque, verification manuelle requise avant recommandation."
        ]
      };
    }

    return {
      action_now: [
        {
          vaccine_name: "Meningocoque B",
          label: "Evaluer puis administrer dose Meningocoque B 2",
          rationale: "Une dose historique est detectee sans date exploitable pour verifier l intervalle minimal.",
          rule_id: "RULE-MEN-B-CORE-004",
          references: [
            {
              source_id: "calendrier-2025-meningocoque",
              section_hint: "Intervalles Meningocoque B",
              rule_id: "RULE-MEN-B-CORE-004"
            }
          ]
        }
      ],
      action_next: [],
      limitations: ["Meningocoque B: date de dose precedente manquante, verification manuelle requise avant dose 2."]
    };
  }

  const earliestDose2Date = addDays(lastDoseDateIso, 30);
  const dose2DueNow = earliestDose2Date && earliestDose2Date <= diagnosticDateIso;
  const dose2Action = {
    vaccine_name: "Meningocoque B",
    label: "Administrer dose Meningocoque B 2",
    dose_number: 2,
    min_interval_days: 30,
    proposed_date_iso: earliestDose2Date,
    notes: "Dose 2 selon intervalle minimal simplifie de 1 mois.",
    rule_id: "RULE-MEN-B-CORE-003",
    references: [
      {
        source_id: "calendrier-2025-meningocoque",
        section_hint: "Intervalles Meningocoque B",
        rule_id: "RULE-MEN-B-CORE-003"
      }
    ]
  };

  return {
    action_now: dose2DueNow
      ? [
          {
            vaccine_name: "Meningocoque B",
            label: "Administrer dose Meningocoque B 2",
            rationale: "Dose 2 due selon intervalle minimal simplifie.",
            rule_id: "RULE-MEN-B-CORE-003",
            references: dose2Action.references
          }
        ]
      : [],
    action_next: dose2DueNow ? [] : [dose2Action],
    limitations: ["Meningocoque B: schema simplifie 2 doses dans cette version."]
  };
}

export function evaluateRules({ normalizedInput, resolvedHistory, rulesVersion = "v2.0.0" }) {
  const ageYears = parseAgeYears(normalizedInput?.patient?.age_years);
  const diagnosticDateIso = normalizedInput?.diagnostic_date_iso || new Date().toISOString().slice(0, 10);

  const hypothesesAssumed = [];
  const riskFlags = normalizedInput?.patient?.risk_flags || {};
  const pregnancyStatus = String(normalizedInput?.patient?.pregnancy_status || "").trim();
  const patientSex = String(normalizedInput?.patient?.sex || "").trim();

  if (!Number.isFinite(ageYears)) {
    hypothesesAssumed.push("Hypothese: age exact non renseigne, evaluation par age partielle.");
  }
  if (!pregnancyStatus) {
    hypothesesAssumed.push("Hypothese: grossesse non renseignee = non.");
  }
  if (riskFlags.immunodepression === undefined) {
    hypothesesAssumed.push("Hypothese: immunodepression non renseignee = false");
  }
  if (riskFlags.cancer_en_cours === undefined) {
    hypothesesAssumed.push("Hypothese: cancer_en_cours non renseigne = false");
  }
  if (riskFlags.allergie_severe === undefined) {
    hypothesesAssumed.push("Hypothese: allergie severe non renseignee = false");
  }

  const incompleteHistoryEntries = collectIncompleteHistoryEntries(resolvedHistory);
  const futureHistoryEntries = collectFutureHistoryEntries(resolvedHistory, diagnosticDateIso);
  const resolvedHistoryForDosing = filterFutureHistoryFromDosing(resolvedHistory, diagnosticDateIso);
  const unknownProducts = resolvedHistory.filter((entry) => entry?.resolution_status === "unknown_product");
  const unsupportedAntigens = collectOutOfCoverageAntigens(resolvedHistory);

  const hpv = evaluateHpvRule({ ageYears, diagnosticDateIso, resolvedHistory: resolvedHistoryForDosing });
  const pneumococcal = evaluatePneumococcalRule({
    ageYears,
    diagnosticDateIso,
    riskFlags,
    resolvedHistory: resolvedHistoryForDosing
  });
  const hepB = evaluateHepBRule({ ageYears, diagnosticDateIso, riskFlags, resolvedHistory: resolvedHistoryForDosing });
  const ror = evaluateRorRule({ ageYears, diagnosticDateIso, resolvedHistory: resolvedHistoryForDosing });
  const covid = evaluateCovidRule({
    ageYears,
    diagnosticDateIso,
    riskFlags,
    pregnancyStatus,
    resolvedHistory: resolvedHistoryForDosing
  });
  const zona = evaluateZonaRule({ ageYears, diagnosticDateIso, riskFlags, resolvedHistory: resolvedHistoryForDosing });
  const dtcaPolio = evaluateDTcaPolioRule({
    ageYears,
    diagnosticDateIso,
    pregnancyStatus,
    patientSex,
    resolvedHistory: resolvedHistoryForDosing
  });
  const vrs = evaluateVrsRule({
    ageYears,
    pregnancyStatus,
    patientSex,
    resolvedHistory: resolvedHistoryForDosing
  });
  const menAcwy = evaluateMeningococcalAcwyRule({ ageYears, riskFlags, resolvedHistory: resolvedHistoryForDosing });
  const menB = evaluateMeningococcalBRule({
    ageYears,
    diagnosticDateIso,
    riskFlags,
    resolvedHistory: resolvedHistoryForDosing
  });

  const actionNow = [
    ...hpv.action_now,
    ...pneumococcal.action_now,
    ...hepB.action_now,
    ...ror.action_now,
    ...covid.action_now,
    ...zona.action_now,
    ...dtcaPolio.action_now,
    ...vrs.action_now,
    ...menAcwy.action_now,
    ...menB.action_now
  ];
  const actionNext = [
    ...hpv.action_next,
    ...pneumococcal.action_next,
    ...hepB.action_next,
    ...ror.action_next,
    ...covid.action_next,
    ...zona.action_next,
    ...dtcaPolio.action_next,
    ...vrs.action_next,
    ...menAcwy.action_next,
    ...menB.action_next
  ];
  const limitations = [
    ...hpv.limitations,
    ...pneumococcal.limitations,
    ...hepB.limitations,
    ...ror.limitations,
    ...covid.limitations,
    ...zona.limitations,
    ...dtcaPolio.limitations,
    ...vrs.limitations,
    ...menAcwy.limitations,
    ...menB.limitations,
    "Couverture moteur v2.0.0 limitee a HPV, pneumocoque, HepB, ROR, Covid-19, zona, dTcaPolio, VRS et meningocoques ACWY/B (perimetre partiel)."
  ];

  if (incompleteHistoryEntries.length > 0) {
    const productNames = [...new Set(incompleteHistoryEntries.map((entry) => entry.product_name))];
    limitations.push(
      `Historique vaccinal incomplet: date(s) manquante(s) pour ${productNames.join(", ")}.`
    );
  }
  if (futureHistoryEntries.length > 0) {
    const productNames = [...new Set(futureHistoryEntries.map((entry) => entry.product_name))];
    limitations.push(
      `Historique vaccinal incoherent: date(s) futures detectee(s) pour ${productNames.join(", ")}.`
    );
    limitations.push(
      "Mode prudent: les doses datees dans le futur sont exclues du calcul de schema jusqu a verification."
    );
  }
  if (unsupportedAntigens.length > 0) {
    limitations.push(
      `Antigenes hors couverture moteur ${rulesVersion}: ${unsupportedAntigens.join(", ")}.`
    );
  }

  const decisionStatus =
    incompleteHistoryEntries.length > 0 ||
    futureHistoryEntries.length > 0 ||
    unknownProducts.length > 0 ||
    unsupportedAntigens.length > 0 ||
    !Number.isFinite(ageYears)
      ? "needs_more_info"
      : "ready";

  return {
    meta: {
      rules_version: rulesVersion,
      coverage_status: "partial",
      decision_status: decisionStatus
    },
    action_now: actionNow,
    action_next: actionNext,
    cautions: [],
    hypotheses_assumed: hypothesesAssumed,
    limitations,
    debug: {
      normalizedInput,
      resolvedHistory,
      resolvedHistoryForDosing
    }
  };
}
