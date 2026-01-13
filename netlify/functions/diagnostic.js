import OpenAI from "openai";
import schema from "./schema.min.json";

const systemPrompt = `Tu es un assistant de diagnostic vaccinal basé EXCLUSIVEMENT sur les extraits renvoyés par l'outil file_search (le PDF fourni). Interdiction d'utiliser toute connaissance générale, internet ou hypothèse.

Règles strictes:
- Répondre UNIQUEMENT en JSON conforme au schéma Structured Outputs fourni.
- Chaque recommandation/contre-indication/précaution/conseil/phrase importante doit avoir ≥1 source: page + snippet (<= 30 mots) + section_hint.
- Si une info n'est pas dans les extraits: ne rien inventer; laisser vide et ajouter une limitation claire.
- "Autorisé en officine" / "Administrable par …": si pas explicite => "non_précisé_dans_source".

Règle grossesse / contre-indication (sécurité):
- Si contre-indiqué "pendant la grossesse" (ou non recommandé "actuellement"):
  - proposed_date_iso = ""
  - min_interval_days = 0
  - notes: "à réaliser après accouchement, date à définir"
  - inclure ≥1 source.

Dates proposées (rattrapage):
- Extraire les intervalles minimaux chiffrés quand présents.
- proposed_date_iso = diagnostic_date_iso + min_interval_days.
- Si non chiffré: min_interval_days = 0 et notes l'explique.`;

const searchQueries = [
  "2.22.2 Vaccination des femmes enceintes grippe covid coqueluche VRS Abrysvo",
  "vaccins vivants contre-indiqués grossesse ROR varicelle BCG",
  "ROR deux doses au moins un mois d'intervalle méconnaissance statut vaccinal",
  "intervalle minimum 2 semaines dTCa Abrysvo",
];

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const patient = body.patient ?? body; // accepte {patient: {...}} ou directement {...}

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;

    if (!OPENAI_API_KEY || !VECTOR_STORE_ID) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing OPENAI_API_KEY or VECTOR_STORE_ID" }),
      };
    }

    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `Patient (JSON):\n${JSON.stringify(patient, null, 2)}\n\n` +
            `Requêtes de recherche autorisées (n'en ajoute pas d'autres):\n- ${searchQueries.join("\n- ")}`,
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
          max_num_results: 12, // baisse si besoin pour accélérer
        },
      ],
      temperature: 0,
      max_output_tokens: 2500, // limite le blabla et accélère
    });

    const outMsg = resp.output?.find((o) => o.type === "message");
    const outText = outMsg?.content?.find((c) => c.type === "output_text")?.text;

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
