import OpenAI from "openai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const schema = JSON.parse(
  readFileSync(path.join(moduleDir, "schema.min.json"), "utf8")
);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "text/plain" },
        body: "Method Not Allowed",
      };
    }

    let body = null;
    try {
      body = event.body ? JSON.parse(event.body) : null;
    } catch {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    // Accepte soit { patient: {...} } soit directement {...}
    const patient =
      body && typeof body === "object" && "patient" in body
        ? body.patient
        : body;

    if (!patient || typeof patient !== "object" || Array.isArray(patient)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing or invalid patient payload" }),
      };
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;
    if (!OPENAI_API_KEY || !VECTOR_STORE_ID) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Missing OPENAI_API_KEY or VECTOR_STORE_ID",
        }),
      };
    }

    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    // ✅ Requêtes file_search limitées (évite les 100 requêtes dupliquées)
    const searchQueries = [
      "2.22.2 Vaccination des femmes enceintes grippe covid coqueluche VRS Abrysvo",
      "vaccins vivants contre-indiqués grossesse ROR varicelle BCG",
      "ROR intervalle un mois deux doses méconnaissance statut vaccinal",
      "intervalle minimum 2 semaines dTCa Abrysvo",
    ];

    const systemPrompt = `Tu es un assistant de diagnostic vaccinal basé EXCLUSIVEMENT sur les extraits renvoyés par l’outil file_search (le PDF fourni). Interdiction d’utiliser toute connaissance générale, internet ou hypothèse.

Règles strictes:
- Tu dois répondre UNIQUEMENT en JSON conforme au schéma Structured Outputs fourni.
- Chaque recommandation/contre-indication/précaution/conseil/phrase importante doit avoir au moins une source: page + snippet (<= 30 mots) + section_hint.
- Si tu ne trouves pas une info dans les extraits du PDF: tu n’inventes rien. Tu laisses la liste concernée vide et tu ajoutes une limitation claire dans limitations.
- Tu ne prescris pas: tu synthétises les recommandations du document.
- “Autorisé / non autorisé en officine” et “Administrable par …”: si ce n’est pas explicitement dans le PDF, mets "non_précisé_dans_source".

Règle grossesse / contre-indication (sécurité):
- Si une vaccination est contre-indiquée "pendant la grossesse" (ou non recommandée "actuellement"), alors:
  - proposed_date_iso = ""
  - min_interval_days = 0
  - notes doit contenir: "à réaliser après accouchement, date à définir"
  - et inclure au moins une source.

Dates proposées (rattrapage):
- Extrais les délais/intervales minimaux du PDF quand ils sont chiffrés.
- min_interval_days: entier.
- proposed_date_iso = diagnostic_date_iso + min_interval_days.
- Si pas chiffré: min_interval_days = 0 et notes explique que l’intervalle n’est pas précisé dans la source.

Sortie:
- meta.source_document = "Calendrier des vaccinations et recommandations vaccinales (Déc. 2025)"
- meta.version = "v1"
- patient_input_echo doit refléter exactement les champs reçus.`;


    // Important: on force file_search à travailler sur ton vector store
    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Patient:\n${JSON.stringify(patient, null, 2)}`,
            },
            {
              type: "input_text",
              text: `Requêtes de recherche (à utiliser, sans en inventer d'autres):\n- ${searchQueries.join(
                "\n- "
              )}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "vaccin_act_diagnostic_v1",
          schema,
          strict: true,
        },
      },
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
          max_num_results: 20,
        },
      ],
      temperature: 0,
    });

    const outMsg = resp.output?.find((o) => o.type === "message");
    const outText = outMsg?.content?.find(
      (c) => c.type === "output_text"
    )?.text;

    return {
      statusCode: outText ? 200 : 500,
      headers: { "Content-Type": "application/json" },
      body: outText ?? JSON.stringify({ error: "No output_text" }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e?.message ?? String(e) }),
    };
  }
};
