export function toLegacySource(ref, fallbackLabel = "") {
  if (!ref || typeof ref !== "object") {
    return {
      page: 0,
      snippet: "Source interne moteur deterministe.",
      section_hint: fallbackLabel || "Moteur"
    };
  }

  return {
    page: Number.isFinite(Number(ref.page)) ? Number(ref.page) : 0,
    snippet: ref.snippet || ref.rule_id || "Regle deterministe appliquee.",
    section_hint: ref.section_hint || ref.source_id || fallbackLabel || "Moteur"
  };
}

export function mapDeterministicToLegacyResponse({ deterministic, patient, diagnosticDate }) {
  const references = (deterministic.references || []).map((ref) => toLegacySource(ref, "Reference"));

  const recommendedVaccines = (deterministic.action_now || []).map((action) => {
    const sources = (action.references || []).map((ref) => toLegacySource(ref, action.vaccine_name || "Action"));
    const officineSources = Array.isArray(action.officine_administration_references)
      ? action.officine_administration_references.map((ref) => toLegacySource(ref, "Administrable en officine"))
      : [];

    if (officineSources.length > 0) {
      for (const source of officineSources) {
        if (!sources.some((existing) => existing.section_hint === source.section_hint && existing.snippet === source.snippet)) {
          sources.push(source);
        }
      }
    } else if (action.officine_administration_source && action.officine_administration_source !== "not_specified") {
      sources.push(
        toLegacySource(
          {
            source_id: "officine-matrix",
            section_hint: "Administrable en officine",
            rule_id: action.officine_administration_source
          },
          "Administrable en officine"
        )
      );
    }

    return {
      vaccine_name: action.vaccine_name || action.label || "Action clinique",
      act_type: "Recommandation operationnelle",
      timing_label: "Maintenant",
      allowed_in_pharmacy: action.officine_administration_status || "to_confirm",
      administerable_by: "pharmacien (selon reglementation locale)",
      vigilance_points: [
        action.rationale || "Verifier le contexte clinique complet avant administration.",
        action.officine_administration_note || ""
      ].filter(Boolean),
      sources
    };
  });

  const catchupSchedule = (deterministic.action_next || []).map((action) => ({
    vaccine_name: action.vaccine_name || action.label || "Suivi",
    dose_number: Number.isFinite(Number(action.dose_number)) ? Number(action.dose_number) : 0,
    min_interval_days: Number.isFinite(Number(action.min_interval_days)) ? Number(action.min_interval_days) : 0,
    proposed_date_iso: action.proposed_date_iso || "",
    notes: action.notes || action.rationale || "",
    sources: (action.references || []).map((ref) => toLegacySource(ref, action.vaccine_name || "Suivi"))
  }));

  const contraindicationsAndPrecautions = (deterministic.cautions || []).map((caution) => ({
    title: caution.title || "Precaution",
    severity: caution.severity || "précaution",
    details: caution.details || "",
    sources: (caution.references || []).map((ref) => toLegacySource(ref, caution.title || "Precaution"))
  }));

  const practicalAdvice = [
    {
      title: "Mode moteur deterministe",
      bullets: [
        "Sortie produite via regles versionnees.",
        `Version de regles: ${deterministic.meta?.rules_version || "v2.0.0"}.`,
        "Verifier les limitations de couverture avant decision finale."
      ],
      sources: references.length > 0 ? references.slice(0, 2) : [toLegacySource(null, "Moteur deterministe")]
    }
  ];

  return {
    meta: {
      diagnostic_date_iso: diagnosticDate,
      source_document: deterministic.meta?.source_document || "Calendrier des vaccinations et recommandations vaccinales (Déc. 2025)",
      version: deterministic.meta?.version || `deterministic-${deterministic.meta?.rules_version || "v2.0.0"}`
    },
    patient_input_echo: patient,
    recommended_vaccines: recommendedVaccines,
    catchup_schedule: catchupSchedule,
    contraindications_and_precautions: contraindicationsAndPrecautions,
    practical_advice: practicalAdvice,
    patient_report: {
      title: "Synthese patient",
      bullets: [
        "Un plan d action vaccinal a ete genere de maniere deterministe.",
        "Les recommandations couvrent partiellement le perimetre clinique actuel."
      ],
      sources: references.length > 0 ? references.slice(0, 2) : [toLegacySource(null, "Synthese")]
    },
    gp_report: {
      title: "Synthese professionnel",
      bullets: [
        `Coverage status: ${deterministic.meta?.coverage_status || "partial"}.`,
        `Decision status: ${deterministic.meta?.decision_status || "ready"}.`,
        "Verifier les zones hors couverture indiquees dans limitations."
      ],
      sources: references.length > 0 ? references.slice(0, 3) : [toLegacySource(null, "Synthese")]
    },
    references,
    limitations: deterministic.limitations || []
  };
}
