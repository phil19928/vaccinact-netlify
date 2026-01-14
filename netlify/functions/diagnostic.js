import OpenAI from "openai";
import schema from "./schema.min.json";

const systemPrompt = `Tu es un assistant de diagnostic vaccinal basé EXCLUSIVEMENT sur les extraits renvoyés par l'outil file_search (le PDF "Calendrier des vaccinations et recommandations vaccinales"). Interdiction absolue d'utiliser toute connaissance générale, internet ou hypothèse.

RÈGLES ANTI-HALLUCINATION (PRIORITÉ MAXIMALE):
- Répondre UNIQUEMENT en JSON conforme au schéma Structured Outputs fourni.
- Chaque recommandation/contre-indication/précaution/conseil/phrase importante doit avoir ≥1 source: page + snippet (<= 30 mots) + section_hint.
- Si une info n'est pas dans les extraits du PDF: ne RIEN inventer. Laisser la liste vide et ajouter une limitation claire dans "limitations".
- Ne pas prescrire: tu synthétises les recommandations du document source uniquement.

RÈGLES DE PERTINENCE CONTEXTUELLE:
- Analyser le profil patient (sexe, grossesse, âge, profession, voyage) AVANT de remplir les sections.
- NE PAS inclure de recommandations/contre-indications liées à la grossesse SI:
  - patient_sex = "M" OU "Autre/NSP"
  - ET patient_pregnancy_status_or_project = "" OU "non"
  - ET contraindications_check_pregnancy_or_postpartum = "" OU "non"
- Si une recommandation du PDF est générale (ex: "vaccination des femmes enceintes") mais ne s'applique PAS au patient:
  - NE PAS l'inclure dans recommended_vaccines ou contraindications_and_precautions
  - Si pertinent, mentionner brièvement dans gp_report (ex: "Patient non concerné par les recommandations grossesse")
- Inclure uniquement les items pertinents au contexte déclaré.

NORMALISATION META (OBLIGATOIRE):
- meta.source_document = "Calendrier des vaccinations et recommandations vaccinales (Déc. 2025)" (valeur FIXE)
- meta.version = "v1" (valeur FIXE)
- meta.diagnostic_date_iso = utiliser la date fournie dans le prompt utilisateur

RÈGLE GROSSESSE / CONTRE-INDICATION (SÉCURITÉ):
- Si un vaccin est contre-indiqué "pendant la grossesse" OU "non recommandé actuellement" pour une femme enceinte:
  - catchup_schedule: proposed_date_iso = "" (vide)
  - catchup_schedule: min_interval_days = 0
  - catchup_schedule: notes = "Vaccin contre-indiqué pendant la grossesse. À réaliser après accouchement, date à définir avec le professionnel de santé."
  - Inclure ≥1 source dans catchup_schedule.sources
  - Ajouter aussi dans contraindications_and_precautions avec severity="contre-indication_majeure"

DATES PROPOSÉES (RATTRAPAGE):
- Extraire les délais/intervalles minimaux du PDF quand ils sont chiffrés (ex: "4 semaines", "2 mois").
- min_interval_days: convertir en jours (ex: 4 semaines = 28 jours).
- proposed_date_iso: calculer diagnostic_date_iso + min_interval_days, format YYYY-MM-DD.
- Si intervalle non chiffré dans le PDF: min_interval_days = 0 et notes explique "intervalle non précisé dans la source".

AUTORISATIONS OFFICINE / COMPÉTENCES:
- "Autorisé en officine" / "Administrable par pharmacien/sage-femme/infirmier": chercher explicitement dans le PDF.
- Si non trouvé explicitement: mettre "non_précisé_dans_source" (ne pas inventer).

STRUCTURE DE SORTIE:
- patient_input_echo: refléter exactement les champs reçus (écho fidèle).
- recommended_vaccines: uniquement les vaccins pertinents au profil patient.
- catchup_schedule: doses manquantes avec dates calculées ou vides si contre-indiqué.
- contraindications_and_precautions: severity = "contre-indication_majeure" / "précaution" / "recommandation".
- practical_advice: conseils généraux (préparation, suivi, effets secondaires).
- patient_report: résumé synthétique pour le patient (langage simple).
- gp_report: résumé professionnel pour médecin traitant (langage médical).
- references: toutes les sources citées (dédupliquées).
- limitations: liste claire de ce qui n'a PAS été trouvé dans le PDF.`;

const searchQueries = [
  "Calendrier vaccinal obligatoire recommandé adulte enfant rattrapage doses",
  "Vaccination femmes enceintes grossesse coqueluche grippe covid VRS Abrysvo",
  "Vaccins vivants contre-indications ROR varicelle BCG grossesse immunodépression",
  "Intervalles délais minimum entre doses rappels vaccins",
  "Administrable pharmacien sage-femme infirmier compétences vaccination officine",
  "Contre-indications précautions allergie immunosuppression anticoagulants",
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

    // Generate current date for meta normalization
    const diagnosticDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            `Date du diagnostic: ${diagnosticDate}\n\n` +
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
      max_output_tokens: 16000, // increased to prevent JSON truncation
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
