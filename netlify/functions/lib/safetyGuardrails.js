function pushUnique(items, message) {
  if (!items.includes(message)) {
    items.push(message);
  }
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

function isPregnancyContext(value) {
  const normalized = String(value || "").toLowerCase().trim();
  return (
    normalized === "oui" ||
    normalized.includes("enceinte") ||
    normalized.includes("grossesse") ||
    normalized.includes("projet") ||
    normalized.includes("postpartum")
  );
}

function normalizeSex(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (normalized === "F" || normalized === "FEMME" || normalized === "FEMALE") return "F";
  if (normalized === "M" || normalized === "H" || normalized === "HOMME" || normalized === "MALE") return "M";
  return "OTHER";
}

function markNeedsMoreInfo(output) {
  if (!output.meta || typeof output.meta !== "object") {
    output.meta = {};
  }
  output.meta.decision_status = "needs_more_info";
}

export function applySafetyGuardrails(result, normalizedInput, options = {}) {
  const output = { ...result };
  output.meta = output.meta && typeof output.meta === "object" ? { ...output.meta } : output.meta;
  output.cautions = Array.isArray(output.cautions) ? [...output.cautions] : [];
  output.limitations = Array.isArray(output.limitations) ? [...output.limitations] : [];

  const riskFlags = normalizedInput?.patient?.risk_flags || {};
  const ageYears = parseAgeYears(normalizedInput?.patient?.age_years);
  const patientSex = normalizeSex(normalizedInput?.patient?.sex);
  const pregnancyStatus = normalizedInput?.patient?.pregnancy_status;

  if (Number.isFinite(ageYears) && (ageYears < 0 || ageYears > 120)) {
    output.cautions.push({
      title: "Age incoherent",
      severity: "precaution",
      details: `Age hors plage plausible detecte (${ageYears}). Verifier la saisie.`,
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Qualite des donnees",
          rule_id: "SAFE-AGE-RANGE-001"
        }
      ]
    });
    pushUnique(output.limitations, "Donnee incoherente: age hors plage plausible.");
    markNeedsMoreInfo(output);
  }

  if (isPregnancyContext(pregnancyStatus) && patientSex && patientSex !== "F") {
    output.cautions.push({
      title: "Incoherence sexe/grossesse",
      severity: "precaution",
      details: "Statut grossesse incompatible avec le sexe renseigne. Verification manuelle requise.",
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Qualite des donnees",
          rule_id: "SAFE-PREG-SEX-001"
        }
      ]
    });
    pushUnique(output.limitations, "Donnee incoherente: combinaison sexe/grossesse a verifier.");
    markNeedsMoreInfo(output);
  }

  if (riskFlags.allergie_severe) {
    output.cautions.push({
      title: "Allergie severe / anaphylaxie",
      severity: "precaution",
      details: "Verification RCP requise avant administration.",
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Allergie severe",
          rule_id: "SAFE-ANAPHYLAXIS-001"
        }
      ]
    });
    pushUnique(output.limitations, "Alerte securite: allergie severe signalee, validation humaine requise.");
  }

  if (riskFlags.immunodepression) {
    output.cautions.push({
      title: "Immunodepression",
      severity: "precaution",
      details: "Verifier regles vaccins vivants attenues.",
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Immunodepression",
          rule_id: "SAFE-IMMUNODEP-001"
        }
      ]
    });
  }

  if (riskFlags.cancer_en_cours) {
    output.cautions.push({
      title: "Cancer en cours",
      severity: "precaution",
      details: "Verifier le niveau d immunodepression iatrogene et la compatibilite des vaccins vivants.",
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Cancer en cours",
          rule_id: "SAFE-CANCER-001"
        }
      ]
    });
    pushUnique(output.limitations, "Cancer en cours signale: verification clinique requise avant administration.");
  }

  if (riskFlags.immunodepression && isPregnancyContext(pregnancyStatus)) {
    output.cautions.push({
      title: "Grossesse + immunodepression",
      severity: "precaution",
      details: "Cas combine a haut risque: verification clinique/RCP requise avant administration.",
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Cas combine grossesse/immunodepression",
          rule_id: "SAFE-COMBO-PREG-IMMUNO-001"
        }
      ]
    });
    pushUnique(
      output.limitations,
      "Cas combine grossesse/immunodepression detecte: validation humaine obligatoire."
    );
  }

  const resolvedHistory = Array.isArray(options.resolvedHistory) ? options.resolvedHistory : [];
  const diagnosticDateIso = String(normalizedInput?.diagnostic_date_iso || "").trim();
  const hasDiagnosticDate = isIsoDate(diagnosticDateIso);
  const unknownProducts = resolvedHistory
    .filter((entry) => entry?.resolution_status === "unknown_product")
    .map((entry) => entry?.product_name)
    .filter(Boolean);
  if (unknownProducts.length > 0) {
    output.cautions.push({
      title: "Produits non reconnus",
      severity: "precaution",
      details: `Produits a verifier manuellement: ${unknownProducts.join(", ")}.`,
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Mapping produit",
          rule_id: "SAFE-UNKNOWN-PRODUCT-001"
        }
      ]
    });
    pushUnique(output.limitations, "Au moins un nom commercial n a pas pu etre mappe vers un antigene.");
  }

  const futureHistoryProducts = resolvedHistory
    .filter(
      (entry) =>
        entry?.resolution_status === "resolved" &&
        entry?.product_name &&
        hasDiagnosticDate &&
        isIsoDate(entry?.administration_date_iso) &&
        String(entry.administration_date_iso).trim() > diagnosticDateIso
    )
    .map((entry) => entry.product_name);
  if (futureHistoryProducts.length > 0) {
    const products = [...new Set(futureHistoryProducts)];
    output.cautions.push({
      title: "Historique vaccinal incoherent",
      severity: "precaution",
      details: `Date(s) future(s) detectee(s) pour: ${products.join(", ")}.`,
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Qualite des donnees",
          rule_id: "SAFE-FUTURE-HISTORY-001"
        }
      ]
    });
    pushUnique(output.limitations, "Historique incoherent: une ou plusieurs dates de dose sont dans le futur.");
  }

  const incompleteHistoryProducts = resolvedHistory
    .filter(
      (entry) =>
        entry?.resolution_status === "resolved" &&
        entry?.product_name &&
        !isIsoDate(entry?.administration_date_iso)
    )
    .map((entry) => entry.product_name);

  if (incompleteHistoryProducts.length > 0) {
    const products = [...new Set(incompleteHistoryProducts)];
    output.cautions.push({
      title: "Historique vaccinal incomplet",
      severity: "precaution",
      details: `Date(s) manquante(s) pour: ${products.join(", ")}.`,
      references: [
        {
          source_id: "safety-guardrail",
          section_hint: "Qualite des donnees",
          rule_id: "SAFE-INCOMPLETE-HISTORY-001"
        }
      ]
    });
    pushUnique(output.limitations, "Historique incomplet: une ou plusieurs dates de dose sont manquantes.");
  }

  return output;
}
