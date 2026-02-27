export function deriveAgeRangeFromYears(ageYears) {
  if (!Number.isFinite(ageYears) || ageYears < 0) return "";
  if (ageYears <= 1) return "0-1";
  if (ageYears <= 5) return "2-5";
  if (ageYears <= 17) return "6-17";
  if (ageYears <= 25) return "18-25";
  if (ageYears <= 45) return "26-45";
  if (ageYears <= 65) return "46-65";
  return "65+";
}

function parseAgeYears(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeInputV2(input = {}) {
  const patient = input.patient || {};
  const ageYears = parseAgeYears(patient.age_years);

  return {
    diagnostic_date_iso: input.diagnostic_date_iso || "",
    patient: {
      age_years: ageYears,
      age_range: Number.isFinite(ageYears) ? deriveAgeRangeFromYears(ageYears) : "",
      sex: patient.sex || "",
      pregnancy_status: patient.pregnancy_status || "",
      risk_flags: patient.risk_flags || {}
    },
    vaccine_history_entries: Array.isArray(input.vaccine_history_entries)
      ? input.vaccine_history_entries
      : []
  };
}
