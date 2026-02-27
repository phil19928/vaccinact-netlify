import officineMatrixData from "./data/officine-matrix.v1.json" with { type: "json" };
import { auditOfficineMatrix } from "./lib/officineMatrix.js";

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    const query = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : {};
    const maxSourceAgeDays = parsePositiveInteger(
      body.max_source_age_days ?? query.max_source_age_days,
      180
    );
    const nowIso = String(body.now_iso ?? query.now_iso ?? new Date().toISOString());
    const audit = auditOfficineMatrix(officineMatrixData, {
      nowIso,
      maxSourceAgeDays
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matrix: {
          rules_version: String(officineMatrixData.rules_version || "v2.0.0"),
          sources_catalog_version: String(officineMatrixData.sources_catalog_version || "unversioned")
        },
        audit
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: String(error)
      })
    };
  }
};
