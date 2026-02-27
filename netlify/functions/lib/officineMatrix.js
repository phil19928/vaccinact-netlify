function normalizeRuleId(value = "") {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "UNKNOWN";
}

function parseIsoDate(value) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function extractMatrixEntries(matrix = {}) {
  if (matrix?.entries && typeof matrix.entries === "object") {
    return matrix.entries;
  }
  if (!matrix || typeof matrix !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(matrix).filter(([key, value]) => {
      if (["rules_version", "sources_catalog", "sources_catalog_version"].includes(String(key))) {
        return false;
      }
      return Boolean(value && typeof value === "object" && !Array.isArray(value));
    })
  );
}

function normalizeSourcesCatalog(matrix = {}) {
  const rawCatalog = matrix?.sources_catalog;
  if (!rawCatalog || typeof rawCatalog !== "object" || Array.isArray(rawCatalog)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawCatalog).map(([sourceId, metadata]) => {
      const sourceKey = String(sourceId || "").trim();
      const sourceMetadata =
        metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
      return [
        sourceKey,
        {
          title: String(sourceMetadata.title || ""),
          publisher: String(sourceMetadata.publisher || ""),
          document_type: String(sourceMetadata.document_type || ""),
          status: String(sourceMetadata.status || "to_confirm"),
          last_verified_at_iso: String(sourceMetadata.last_verified_at_iso || ""),
          url: String(sourceMetadata.url || ""),
          note: String(sourceMetadata.note || "")
        }
      ];
    })
  );
}

function buildFallbackReference({ vaccineLabel, source, key, sourceCatalog }) {
  const fallbackSourceId = "officine-matrix-fallback";
  const fallbackSource = sourceCatalog[fallbackSourceId] || {};
  return {
    source_id: fallbackSourceId,
    source_title: String(fallbackSource.title || ""),
    source_publisher: String(fallbackSource.publisher || ""),
    source_document_type: String(fallbackSource.document_type || ""),
    source_url: String(fallbackSource.url || ""),
    source_last_verified_at_iso: String(fallbackSource.last_verified_at_iso || ""),
    source_status: String(fallbackSource.status || "to_confirm"),
    section_hint: "Administrable en officine",
    rule_id: source && source !== "not_specified" ? `OFF-SOURCE-${normalizeRuleId(source)}` : `OFF-MISSING-${normalizeRuleId(key)}`,
    snippet:
      source && source !== "not_specified"
        ? `Source matrice officine: ${source}.`
        : `Statut administrable en officine non specifie pour ${vaccineLabel}.`,
    page: 0,
    evidence_status: "to_confirm"
  };
}

function normalizeMatrixReferences({ entry, key, vaccineLabel, sourceCatalog }) {
  const source = String(entry?.source || "not_specified");
  const explicitReferences = Array.isArray(entry?.references) ? entry.references : [];

  if (explicitReferences.length === 0) {
    return [buildFallbackReference({ vaccineLabel, source, key, sourceCatalog })];
  }

  return explicitReferences.map((reference, index) => {
    const sourceId = String(reference?.source_id || "officine-matrix-fallback");
    const sourceMetadata = sourceCatalog[sourceId] || {};
    const refId = String(reference?.reference_id || `OFF-${normalizeRuleId(key)}-${index + 1}`);
    return {
      source_id: sourceId,
      source_title: String(sourceMetadata.title || ""),
      source_publisher: String(sourceMetadata.publisher || ""),
      source_document_type: String(sourceMetadata.document_type || ""),
      source_url: String(sourceMetadata.url || ""),
      source_last_verified_at_iso: String(sourceMetadata.last_verified_at_iso || ""),
      source_status: String(sourceMetadata.status || "missing"),
      section_hint: String(reference?.section_hint || "Administrable en officine"),
      rule_id: refId,
      snippet: String(reference?.snippet || source || "Reference reglementaire officine"),
      page: Number.isFinite(Number(reference?.page)) ? Number(reference.page) : 0,
      evidence_status: String(reference?.status || sourceMetadata.status || "to_confirm")
    };
  });
}

function deduplicateReferences(references = []) {
  const seen = new Set();
  const output = [];
  for (const reference of references) {
    const key = `${reference?.source_id || ""}|${reference?.rule_id || ""}|${reference?.snippet || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(reference);
  }
  return output;
}

function inferReviewStatus(entry = {}) {
  if (entry.review_status) {
    return String(entry.review_status);
  }
  if (entry.status === "allowed") {
    return "confirmed";
  }
  return "to_confirm";
}

function toNullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRiskFlags(riskFlags = {}) {
  if (!riskFlags || typeof riskFlags !== "object" || Array.isArray(riskFlags)) {
    return {};
  }
  return riskFlags;
}

function statusRank(status = "") {
  const normalized = String(status || "to_confirm");
  if (normalized === "not_allowed") return 2;
  if (normalized === "to_confirm") return 1;
  return 0;
}

function pickMostRestrictiveStatus(currentStatus = "to_confirm", candidateStatus = "to_confirm") {
  return statusRank(candidateStatus) > statusRank(currentStatus) ? candidateStatus : currentStatus;
}

function evaluateConditionalStatus({ entry = {}, baseStatus = "to_confirm", context = {} }) {
  const conditionsApplied = [];
  let resolvedStatus = String(baseStatus || "to_confirm");

  const patientAgeYears = toNullableNumber(context?.patientAgeYears);
  const minAgeYears = toNullableNumber(entry?.min_age_years);
  const maxAgeYears = toNullableNumber(entry?.max_age_years);

  if (patientAgeYears !== null && minAgeYears !== null && patientAgeYears < minAgeYears) {
    resolvedStatus = pickMostRestrictiveStatus(resolvedStatus, "not_allowed");
    conditionsApplied.push(`Age ${patientAgeYears} ans < seuil minimal officine ${minAgeYears} ans.`);
  }
  if (patientAgeYears !== null && maxAgeYears !== null && patientAgeYears > maxAgeYears) {
    resolvedStatus = pickMostRestrictiveStatus(resolvedStatus, "not_allowed");
    conditionsApplied.push(`Age ${patientAgeYears} ans > seuil maximal officine ${maxAgeYears} ans.`);
  }

  const riskFlags = normalizeRiskFlags(context?.riskFlags);
  const restrictions = Array.isArray(entry?.restrictions) ? entry.restrictions : [];
  for (const restriction of restrictions) {
    if (String(restriction?.type || "") !== "risk_flag_true") continue;
    const flag = String(restriction?.flag || "").trim();
    if (!flag) continue;
    if (riskFlags[flag] !== true) continue;

    const overrideStatus = String(restriction?.override_status || "to_confirm");
    resolvedStatus = pickMostRestrictiveStatus(resolvedStatus, overrideStatus);
    conditionsApplied.push(String(restriction?.reason || `Restriction officine appliquee: ${flag}=true.`));
  }

  return {
    resolved_status: resolvedStatus,
    conditions_applied: conditionsApplied
  };
}

export function applyOfficineMatrix(actions = [], matrix = {}, context = {}) {
  const entries = extractMatrixEntries(matrix);
  const sourceCatalog = normalizeSourcesCatalog(matrix);
  const matrixRulesVersion = String(matrix.rules_version || "v2.0.0");
  const sourceCatalogVersion = String(matrix.sources_catalog_version || "unversioned");

  return actions.map((action) => {
    const key = String(action.vaccine_name || action.label || "").toLowerCase();
    const entry = entries[key] || {};
    const baseStatus = entry.status || "to_confirm";
    const source = entry.source || "not_specified";
    const references = normalizeMatrixReferences({
      entry,
      key,
      vaccineLabel: action.vaccine_name || action.label || "vaccin inconnu",
      sourceCatalog
    });
    const mergedReferences = deduplicateReferences([...(action.references || []), ...references]);
    const primarySourceReference = references[0] || {};
    const conditional = evaluateConditionalStatus({
      entry,
      baseStatus,
      context
    });
    const resolvedStatus = conditional.resolved_status;
    const baseReviewStatus = inferReviewStatus(entry);
    const resolvedReviewStatus =
      resolvedStatus === baseStatus
        ? baseReviewStatus
        : resolvedStatus === "to_confirm"
          ? "to_confirm"
          : "confirmed";
    const baseNote = String(entry.note || "");
    const conditionalNote =
      conditional.conditions_applied.length > 0 ? conditional.conditions_applied.join(" ") : "";
    const mergedNote = [baseNote, conditionalNote].filter(Boolean).join(" ");

    return {
      ...action,
      references: mergedReferences,
      officine_administration_status: resolvedStatus,
      officine_administration_base_status: baseStatus,
      officine_administration_source: source,
      officine_administration_source_status: String(primarySourceReference.source_status || "to_confirm"),
      officine_administration_source_last_verified_at_iso: String(
        primarySourceReference.source_last_verified_at_iso || ""
      ),
      officine_administration_note: mergedNote,
      officine_administration_review_status: resolvedReviewStatus,
      officine_administration_rules_version: matrixRulesVersion,
      officine_administration_source_catalog_version: sourceCatalogVersion,
      officine_administration_conditions_applied: conditional.conditions_applied,
      officine_administration_references: references
    };
  });
}

export function auditOfficineMatrix(matrix = {}, { nowIso = new Date().toISOString(), maxSourceAgeDays = 180 } = {}) {
  const entries = extractMatrixEntries(matrix);
  const sourceCatalog = normalizeSourcesCatalog(matrix);
  const nowDate = parseIsoDate(nowIso) || new Date();
  const maxAgeDays = parsePositiveInteger(maxSourceAgeDays) || 180;

  const statusBreakdown = {};
  const reviewStatusBreakdown = {};
  const unresolvedVaccines = [];
  const entriesMissingReferences = [];
  const confirmedEntriesWithoutConfirmedReference = [];
  const missingSourceCatalogReferences = [];
  const staleSourceReferences = [];
  const seenMissing = new Set();
  const seenStale = new Set();

  for (const [key, entry] of Object.entries(entries)) {
    const resolvedEntry = entry && typeof entry === "object" ? entry : {};
    const status = String(resolvedEntry.status || "to_confirm");
    statusBreakdown[status] = Number(statusBreakdown[status] || 0) + 1;

    const reviewStatus = inferReviewStatus(resolvedEntry);
    reviewStatusBreakdown[reviewStatus] = Number(reviewStatusBreakdown[reviewStatus] || 0) + 1;
    if (status === "to_confirm") {
      unresolvedVaccines.push(key);
    }

    const references = normalizeMatrixReferences({
      entry: resolvedEntry,
      key,
      vaccineLabel: key,
      sourceCatalog
    });

    if (references.length === 0) {
      entriesMissingReferences.push(key);
    }

    let hasConfirmedReference = false;
    for (const reference of references) {
      if (String(reference?.evidence_status || "") === "confirmed") {
        hasConfirmedReference = true;
      }

      if (String(reference?.source_status || "") === "missing") {
        const missingKey = `${key}|${reference?.rule_id || ""}|${reference?.source_id || ""}`;
        if (!seenMissing.has(missingKey)) {
          seenMissing.add(missingKey);
          missingSourceCatalogReferences.push({
            vaccine: key,
            source_id: String(reference?.source_id || ""),
            rule_id: String(reference?.rule_id || "")
          });
        }
      }

      if (String(reference?.source_status || "") === "confirmed") {
        const verifiedAtDate = parseIsoDate(reference?.source_last_verified_at_iso);
        const ageDays = verifiedAtDate
          ? Math.floor((nowDate.getTime() - verifiedAtDate.getTime()) / (24 * 60 * 60 * 1000))
          : Number.POSITIVE_INFINITY;

        if (ageDays > maxAgeDays) {
          const staleKey = `${reference?.source_id || ""}|${reference?.rule_id || ""}`;
          if (!seenStale.has(staleKey)) {
            seenStale.add(staleKey);
            staleSourceReferences.push({
              vaccine: key,
              source_id: String(reference?.source_id || ""),
              rule_id: String(reference?.rule_id || ""),
              source_last_verified_at_iso: String(reference?.source_last_verified_at_iso || ""),
              age_days: Number.isFinite(ageDays) ? ageDays : null
            });
          }
        }
      }
    }

    if (reviewStatus === "confirmed" && !hasConfirmedReference) {
      confirmedEntriesWithoutConfirmedReference.push(key);
    }
  }

  const summary = {
    total_entries: Object.keys(entries).length,
    total_sources_catalog: Object.keys(sourceCatalog).length,
    status_breakdown: statusBreakdown,
    review_status_breakdown: reviewStatusBreakdown,
    to_confirm_entries_count: unresolvedVaccines.length,
    entries_missing_references_count: entriesMissingReferences.length,
    confirmed_entries_without_confirmed_reference_count:
      confirmedEntriesWithoutConfirmedReference.length,
    missing_source_catalog_refs_count: missingSourceCatalogReferences.length,
    stale_source_references_count: staleSourceReferences.length
  };

  const readyForRegulatorySignoff =
    summary.to_confirm_entries_count === 0 &&
    summary.entries_missing_references_count === 0 &&
    summary.confirmed_entries_without_confirmed_reference_count === 0 &&
    summary.missing_source_catalog_refs_count === 0 &&
    summary.stale_source_references_count === 0;

  return {
    generated_at_iso: nowDate.toISOString(),
    matrix_rules_version: String(matrix.rules_version || "v2.0.0"),
    sources_catalog_version: String(matrix.sources_catalog_version || "unversioned"),
    max_source_age_days: maxAgeDays,
    ready_for_regulatory_signoff: readyForRegulatorySignoff,
    summary,
    unresolved_vaccines: unresolvedVaccines,
    entries_missing_references: entriesMissingReferences,
    confirmed_entries_without_confirmed_reference: confirmedEntriesWithoutConfirmedReference,
    missing_source_catalog_references: missingSourceCatalogReferences,
    stale_source_references: staleSourceReferences
  };
}

export function collectOfficineMatrixLimitations(actions = []) {
  const unresolved = [
    ...new Set(
      actions
        .filter((action) => String(action?.officine_administration_status || "") === "to_confirm")
        .map((action) => String(action?.vaccine_name || action?.label || "").trim())
        .filter(Boolean)
    )
  ];
  const notAllowed = [
    ...new Set(
      actions
        .filter((action) => String(action?.officine_administration_status || "") === "not_allowed")
        .map((action) => String(action?.vaccine_name || action?.label || "").trim())
        .filter(Boolean)
    )
  ];
  const notAllowedReasons = [
    ...new Set(
      actions
        .filter((action) => String(action?.officine_administration_status || "") === "not_allowed")
        .flatMap((action) =>
          Array.isArray(action?.officine_administration_conditions_applied)
            ? action.officine_administration_conditions_applied
            : []
        )
        .map((line) => String(line || "").trim())
        .filter(Boolean)
    )
  ];

  const limitations = [];
  if (unresolved.length > 0) {
    limitations.push(
      `Administrabilite officine a confirmer pour: ${unresolved.join(", ")}. Verifier la reglementation locale avant administration.`
    );
  }
  if (notAllowed.length > 0) {
    const reasonsSuffix =
      notAllowedReasons.length > 0 ? ` Motifs: ${notAllowedReasons.join(" ")}` : "";
    limitations.push(
      `Actes non autorises en officine pour: ${notAllowed.join(", ")}. Orienter vers un parcours habilite.${reasonsSuffix}`
    );
  }

  return limitations;
}
