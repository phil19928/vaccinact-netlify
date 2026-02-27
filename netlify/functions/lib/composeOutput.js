export function composeDeterministicOutput({ engineResult, diagnosticDateIso }) {
  const references = [];
  for (const action of [...(engineResult?.action_now || []), ...(engineResult?.action_next || []), ...(engineResult?.cautions || [])]) {
    for (const ref of action.references || []) {
      const key = `${ref.source_id || ""}|${ref.rule_id || ""}`;
      if (!references.some((existing) => `${existing.source_id || ""}|${existing.rule_id || ""}` === key)) {
        references.push(ref);
      }
    }
  }

  return {
    meta: {
      rules_version: engineResult?.meta?.rules_version || "v2.0.0",
      diagnostic_date_iso: diagnosticDateIso,
      coverage_status: engineResult?.meta?.coverage_status || "partial",
      decision_status: engineResult?.meta?.decision_status || "ready",
      source_document: "Calendrier des vaccinations et recommandations vaccinales (Dec. 2025)",
      version: `deterministic-${engineResult?.meta?.rules_version || "v2.0.0"}`
    },
    action_now: engineResult?.action_now || [],
    action_next: engineResult?.action_next || [],
    cautions: engineResult?.cautions || [],
    hypotheses_assumed: engineResult?.hypotheses_assumed || [],
    limitations: engineResult?.limitations || [],
    references
  };
}
