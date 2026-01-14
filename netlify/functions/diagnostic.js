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

RÈGLES GROSSESSE / STATUT (CRITIQUE):
- Ne jamais assimiler "non recommandé" à "contre-indiqué".
- CAS A — "contre-indiqué pendant la grossesse" (mention explicite dans le PDF):
  - Ajouter une entrée dans contraindications_and_precautions avec severity="contre-indication_majeure"
  - Dans catchup_schedule: proposed_date_iso="" ; min_interval_days=0 ; notes="Vaccin contre-indiqué pendant la grossesse. À réaliser après accouchement, date à définir avec le professionnel de santé."
  - Inclure ≥1 source issue des extraits file_search.
- CAS B — "non recommandé chez [groupe]" (ex: femmes enceintes immunodéprimées):
  - Ajouter dans contraindications_and_precautions avec severity="précaution" OU "recommandation_négative" (selon le texte exact)
  - NE PAS créer de catchup_schedule post-partum sauf si le PDF dit explicitement de le faire après accouchement.
  - Si le PDF propose une alternative (ex: anticorps monoclonal nourrisson), l'inclure (avec source).

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
- Les champs "sources" et "references" doivent provenir EXCLUSIVEMENT des extraits renvoyés par l'outil file_search.
- Interdiction de citer le contenu du patient_input_echo comme source (ce n'est pas une source documentaire).
- Interdiction d'inventer des pages/snippets/section_hint.
- recommended_vaccines: uniquement les vaccins pertinents au profil patient.
- catchup_schedule: doses manquantes avec dates calculées ou vides si contre-indiqué.
- contraindications_and_precautions: severity = "contre-indication_majeure" / "précaution" / "recommandation".
- practical_advice ne doit contenir que des conseils explicitement présents dans les extraits file_search.
- Interdit d'ajouter des conseils généraux (effets secondaires, fièvre, surveillance, avis spécialisé, hémorragie, etc.) si le PDF ne les mentionne pas.
- Si aucun conseil n'est trouvé dans les extraits: practical_advice = [] et ajouter une limitation.
- patient_report: résumé synthétique pour le patient (langage simple).
- gp_report: résumé professionnel pour médecin traitant (langage médical).
- references: toutes les sources citées (dédupliquées).
- limitations: liste claire de ce qui n'a PAS été trouvé dans le PDF.`;

/**
 * Build dynamic search queries based on patient context
 * Only search for information that's actually relevant to reduce costs and hallucination
 */
function buildSearchQueries(patient) {
  const queries = [];

  // Always include base calendar query for age-appropriate vaccines
  const ageRange = patient.patient_age_range || '';
  if (ageRange.includes('0-1') || ageRange.includes('2-5') || ageRange.includes('6-17')) {
    queries.push("Calendrier vaccinal obligatoire recommandé enfant nourrisson rattrapage doses");
  } else {
    queries.push("Calendrier vaccinal obligatoire recommandé adulte rattrapage doses rappels");
  }

  // Pregnancy-specific queries
  const pregnancy = patient.patient_pregnancy_status_or_project || '';
  const isPregnant = pregnancy.includes('enceinte') || pregnancy === 'projet' || pregnancy === 'postpartum';
  if (isPregnant || patient.patient_sex === 'F') {
    queries.push("Vaccination femmes enceintes grossesse coqueluche grippe covid VRS Abrysvo");
  }

  // Immunosuppression / immunodepression queries
  const immunoCheck = patient.contraindications_check_immunosuppressive_or_immunodepression || '';
  const treatments = patient.patient_current_treatments_summary || '';
  const conditions = patient.patient_chronic_conditions_summary || '';

  const hasImmunoDep =
    immunoCheck === 'oui' ||
    treatments.toLowerCase().includes('immunosuppres') ||
    treatments.toLowerCase().includes('corticoïd') ||
    treatments.toLowerCase().includes('biothérap') ||
    treatments.toLowerCase().includes('chimio') ||
    conditions.toLowerCase().includes('immunodép') ||
    conditions.toLowerCase().includes('vih') ||
    conditions.toLowerCase().includes('greffe') ||
    conditions.toLowerCase().includes('asplénie');

  if (hasImmunoDep) {
    queries.push("Vaccins vivants contre-indications immunodépression immunosuppression");
    queries.push("Vaccination patient immunodéprimé recommandations précautions");
  }

  // Travel-related queries
  const travel = patient.patient_travel_plan_country_date || '';
  if (travel && travel.length > 3) {
    queries.push("Vaccinations voyageurs recommandations pays zones endémiques");
  }

  // Anticoagulant-specific query
  const anticoag = patient.contraindications_check_anticoagulants || '';
  if (anticoag === 'oui' || treatments.toLowerCase().includes('anticoag')) {
    queries.push("Vaccination anticoagulants précautions administration intramusculaire");
  }

  // Severe allergies
  const allergies = patient.contraindications_check_severe_allergy_anaphylaxis_history || '';
  const allergyHistory = patient.patient_allergies_history || '';
  if (allergies === 'oui' || allergyHistory.toLowerCase().includes('anaphyl')) {
    queries.push("Contre-indications allergies anaphylaxie vaccins");
  }

  // Professional exposure risks
  const profession = patient.patient_profession_risk_exposure || '';
  if (profession.toLowerCase().includes('soignant') ||
    profession.toLowerCase().includes('creche') ||
    profession.toLowerCase().includes('ehpad')) {
    queries.push("Vaccination professionnels santé soignants personnel médical");
  }

  // Always include intervals query (needed for catchup schedule)
  queries.push("Intervalles délais minimum entre doses rappels vaccins");

  return queries;
}

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

    // Build dynamic search queries based on patient context
    const searchQueries = buildSearchQueries(patient);

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
