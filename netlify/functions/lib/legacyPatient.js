import { deriveAgeRangeFromYears } from "./normalizeInput.js";

function ensureLegacyDefaults(patient, requiredFields = []) {
  const result = { ...patient };

  for (const field of requiredFields) {
    if (result[field] === undefined || result[field] === null) {
      result[field] = field.endsWith("_flag") ? false : "";
    }
  }

  return result;
}

function mergeV2IntoLegacy(legacyPatient, patientV2) {
  if (!patientV2 || typeof patientV2 !== "object") return legacyPatient;

  const merged = { ...legacyPatient };
  const v2Patient = patientV2.patient || {};
  const riskFlags = v2Patient.risk_flags || {};
  const historyEntries = Array.isArray(patientV2.vaccine_history_entries) ? patientV2.vaccine_history_entries : [];

  const ageYears = Number(v2Patient.age_years);
  if (!Number.isNaN(ageYears) && Number.isFinite(ageYears)) {
    merged.patient_age_years = ageYears;
    if (!merged.patient_age_range) {
      merged.patient_age_range = deriveAgeRangeFromYears(ageYears);
    }
  }

  if (!merged.patient_sex && v2Patient.sex) {
    merged.patient_sex = String(v2Patient.sex);
  }
  if (!merged.patient_pregnancy_status_or_project && v2Patient.pregnancy_status) {
    merged.patient_pregnancy_status_or_project = String(v2Patient.pregnancy_status);
    merged.contraindications_check_pregnancy_or_postpartum = String(v2Patient.pregnancy_status);
  }

  const chronicConditions = merged.patient_chronic_conditions_summary ? [merged.patient_chronic_conditions_summary] : [];
  if (riskFlags.immunodepression) chronicConditions.push("immunodépression");
  if (riskFlags.cancer_en_cours) chronicConditions.push("cancer en traitement");
  if (riskFlags.asplenie) chronicConditions.push("asplénie");
  if (riskFlags.dialyse_ou_ir) chronicConditions.push("insuffisance rénale");
  if (riskFlags.vih) chronicConditions.push("VIH");
  merged.patient_chronic_conditions_summary = [...new Set(chronicConditions.filter(Boolean))].join(", ");

  if (riskFlags.immunodepression && !merged.contraindications_check_immunosuppressive_or_immunodepression) {
    merged.contraindications_check_immunosuppressive_or_immunodepression = "oui";
  }
  if (riskFlags.allergie_severe && !merged.contraindications_check_severe_allergy_anaphylaxis_history) {
    merged.contraindications_check_severe_allergy_anaphylaxis_history = "oui";
  }

  if (historyEntries.length > 0) {
    merged.vaccine_history_entries = historyEntries;
    const countsByProduct = {};
    const lastDateByProduct = {};

    for (const entry of historyEntries) {
      if (!entry || !entry.product_name) continue;
      const name = String(entry.product_name).trim();
      if (!name) continue;

      countsByProduct[name] = (countsByProduct[name] || 0) + 1;
      const dateIso = entry.administration_date_iso ? String(entry.administration_date_iso) : "";
      if (dateIso) {
        if (!lastDateByProduct[name] || dateIso > lastDateByProduct[name]) {
          lastDateByProduct[name] = dateIso;
        }
      }
    }

    if (!merged.vax_history_doses_count_per_vaccine) {
      merged.vax_history_doses_count_per_vaccine = Object.entries(countsByProduct)
        .map(([name, doseCount]) => `${name}: ${doseCount}`)
        .join("; ");
    }
    if (!merged.vax_history_last_injection_date_per_vaccine) {
      merged.vax_history_last_injection_date_per_vaccine = Object.entries(lastDateByProduct)
        .map(([name, dateIso]) => `${name}: ${dateIso}`)
        .join("; ");
    }
  }

  return merged;
}

export function normalizeIncomingPayload(body, requiredFields = []) {
  const basePatient =
    body && typeof body.patient === "object" && body.patient !== null
      ? { ...body.patient }
      : body && typeof body === "object"
        ? { ...body }
        : {};

  const merged = mergeV2IntoLegacy(basePatient, body?.patient_v2);
  const withDefaults = ensureLegacyDefaults(merged, requiredFields);

  const ageYears = Number(withDefaults.patient_age_years);
  if ((!withDefaults.patient_age_range || withDefaults.patient_age_range === "") && Number.isFinite(ageYears)) {
    withDefaults.patient_age_range = deriveAgeRangeFromYears(ageYears);
  }

  return withDefaults;
}

export function buildFallbackV2FromLegacy(patient, diagnosticDateIso) {
  const chronicConditions = String(patient?.patient_chronic_conditions_summary || "").toLowerCase();

  return {
    diagnostic_date_iso: diagnosticDateIso,
    patient: {
      age_years: Number.isFinite(Number(patient?.patient_age_years)) ? Number(patient.patient_age_years) : null,
      sex: patient?.patient_sex || "",
      pregnancy_status: patient?.patient_pregnancy_status_or_project || "",
      risk_flags: {
        immunodepression: patient?.contraindications_check_immunosuppressive_or_immunodepression === "oui",
        cancer_en_cours: chronicConditions.includes("cancer"),
        asplenie: chronicConditions.includes("aspl"),
        dialyse_ou_ir:
          chronicConditions.includes("insuffisance rénale") ||
          chronicConditions.includes("insuffisance renale"),
        vih: chronicConditions.includes("vih"),
        allergie_severe: patient?.contraindications_check_severe_allergy_anaphylaxis_history === "oui"
      }
    },
    vaccine_history_entries: Array.isArray(patient?.vaccine_history_entries) ? patient.vaccine_history_entries : []
  };
}
