# VaccinAct MVP v2 - Schema technique cible

Date: 2026-02-26
Contexte repo: `public/index.html` + `netlify/functions/diagnostic.js`

## 1. Principes techniques

1. Decision clinique par regles deterministes, pas par generation libre.
2. LLM limite a:
   - explication de la decision,
   - collecte d infos manquantes,
   - reformulation.
3. Tracabilite obligatoire:
   - `rules_version`,
   - hypotheses,
   - references source.
4. Couverture geree par version explicite, jamais implicite.

## 2. Architecture logique (4 couches)

## Couche A - Clinical Rules Engine

Responsabilite:
1. Evaluer age, contexte, historique.
2. Calculer `action_now`, `action_next`, `cautions`.
3. Gerer intervalles, rattrapages, statuts de couverture.

Inputs:
1. Donnees patient normalisees.
2. Historique vaccinal normalise.
3. Rules pack versionne.

Outputs:
1. Decision structuree.
2. Hypotheses explicites.
3. References regles appliquees.

## Couche B - Product Dictionary

Responsabilite:
1. Mapper nom commercial -> antigene(s)/valence(s).
2. Supporter alias et variantes de saisie.
3. Declarer inconnus proprement.

## Couche C - Safety Guardrails

Responsabilite:
1. Appliquer regles CI/precautions minimales.
2. Produire avertissements sans sur-blocage.
3. Basculer en `to_confirm` si ambigu.
4. Guardrails minimaux explicites:
   - allergie severe,
   - immunodepression,
   - cancer en cours (`SAFE-CANCER-001`),
   - produit inconnu / historique incomplet.

## Couche D - Officine Administration Matrix

Responsabilite:
1. Statut administrable en officine (`allowed`, `not_allowed`, `to_confirm`).
2. Source reglementaire associee.
3. Gestion explicite du manque de preuve.
4. Catalogue de sources versionne + audit de fraicheur des preuves.
5. Application de conditions d eligibilite (`min_age_years`, restrictions de risque).

## 3. Composants proposes dans ce repo

## Frontend

Fichier actuel:
1. `public/index.html`

Refactor cible:
1. `public/js/form-v2.js` (collecte, mode rapide)
2. `public/js/render-v2.js` (resultat now/next/cautions)
3. `public/js/payload-mapper-v2.js` (normalisation payload)

## Backend

Fichier actuel:
1. `netlify/functions/diagnostic.js`

Refactor cible:
1. `netlify/functions/diagnostic.js` (orchestrateur)
2. `netlify/functions/lib/normalizeInput.js`
3. `netlify/functions/lib/productDictionary.js`
4. `netlify/functions/lib/rulesEngine.js`
5. `netlify/functions/lib/safetyGuardrails.js`
6. `netlify/functions/lib/officineMatrix.js`
7. `netlify/functions/lib/composeOutput.js`
8. `netlify/functions/officine-matrix-audit.js`
9. `netlify/functions/officine-matrix-monitor.js`

Data files proposes:
1. `netlify/functions/data/product-dictionary.v1.json`
2. `netlify/functions/data/rules.v1.json`
3. `netlify/functions/data/safety-rules.v1.json`
4. `netlify/functions/data/officine-matrix.v1.json`

## 4. Donnees d entree v2

## Payload v2 (propose)

```json
{
  "diagnostic_date_iso": "2026-02-26",
  "patient": {
    "age_years": 46,
    "sex": "F",
    "pregnancy_status": "non",
    "risk_flags": {
      "immunodepression": false,
      "cancer_en_cours": false,
      "asplenie": false,
      "dialyse_ou_ir": false,
      "vih": false,
      "allergie_severe": false
    }
  },
  "vaccine_history_entries": [
    {
      "product_name": "Gardasil 9",
      "administration_date_iso": "2023-05-14",
      "source": "declaratif"
    }
  ]
}
```

Notes:
1. `age_years` remplace la tranche d age.
2. `vaccine_history_entries` devient la source principale pour historique.
3. Les anciens champs (voyage, profession) restent optionnels et non bloquants en phase transitoire.

## 5. Modele interne normalise

```json
{
  "normalized_patient": {
    "age_years": 46,
    "sex": "F",
    "pregnancy_status": "non",
    "risk_flags": {
      "immunodepression": false,
      "allergie_severe": false
    }
  },
  "normalized_history": [
    {
      "raw_product_name": "Gardasil 9",
      "resolved_product_id": "gardasil9",
      "antigens": ["HPV"],
      "administration_date_iso": "2023-05-14",
      "resolution_status": "resolved"
    }
  ]
}
```

## 6. Sortie v2 (propose)

```json
{
  "meta": {
    "rules_version": "v2.0.0",
    "diagnostic_date_iso": "2026-02-26",
    "coverage_status": "covered"
  },
  "action_now": [
    {
      "label": "Administrer dose X",
      "officine_administration_status": "allowed",
      "rationale": "Condition(s) remplies",
      "references": [
        {
          "source_id": "calendrier-2025-table-xx",
          "section_hint": "Rattrapage ...",
          "rule_id": "RULE-HPV-001"
        }
      ]
    }
  ],
  "action_next": [
    {
      "label": "Prochaine dose",
      "proposed_date_iso": "2026-04-23",
      "min_interval_days": 56,
      "references": [
        {
          "source_id": "calendrier-2025-table-xx",
          "rule_id": "RULE-HPV-002"
        }
      ]
    }
  ],
  "cautions": [],
  "hypotheses_assumed": [
    "absence_immunodepression_non_renseignee"
  ],
  "limitations": [],
  "coverage_matrix_ref": "coverage.v2.0.0"
}
```

## 7. Flux runtime cible

1. Front collecte v2 -> payload brut.
2. `normalizeInput`:
   - valider types,
   - normaliser dates,
   - normaliser booleens.
3. `productDictionary.resolve`:
   - match produit,
   - remonter antigene(s),
   - tagger inconnus.
4. `rulesEngine.evaluate`:
   - calcul now/next,
   - detecter infos manquantes,
   - definir coverage status.
5. `safetyGuardrails.apply`:
   - ajouter CI/precautions.
6. `officineMatrix.apply`:
   - statut administrable (avec contexte age/risques).
7. `officineMatrix.audit` (endpoint dedie):
   - consolidation KPI reglementaires (to_confirm, refs manquantes, refs stale).
8. `composeOutput`:
   - assembler sortie stable v2,
   - injecter hypotheses + references + rules_version.
9. LLM optionnel:
   - expliquer la decision,
   - jamais modifier la decision deterministe.

Routine de reverification officine:
1. `officine-matrix-monitor` execute un audit periodique (cron quotidien 07:00 UTC).
2. Variables monitor:
   - `OFFICINE_MATRIX_MONITOR_MAX_SOURCE_AGE_DAYS`,
   - `OFFICINE_MATRIX_MONITOR_STALE_SOURCE_ALERT_THRESHOLD`,
   - `OFFICINE_MATRIX_MONITOR_REQUIRE_READY_FOR_REGULATORY_SIGNOFF`,
   - `OFFICINE_MATRIX_MONITOR_SEND_WEBHOOK`,
   - `OFFICINE_MATRIX_MONITOR_SEND_WEBHOOK_ON_OK`,
   - `OFFICINE_MATRIX_MONITOR_FAIL_ON_ALERT`,
   - `OFFICINE_MATRIX_MONITOR_DELIVERY_MODE` (`signed_webhook` ou `slack`),
   - `OFFICINE_MATRIX_MONITOR_WEBHOOK_URL`,
   - `OFFICINE_MATRIX_MONITOR_SLACK_WEBHOOK_URL`,
   - `OFFICINE_MATRIX_MONITOR_WEBHOOK_SECRET`,
   - `OFFICINE_MATRIX_MONITOR_EVENT_NAME`,
   - `OFFICINE_MATRIX_MONITOR_OPS_ENVIRONMENT`,
   - `OFFICINE_MATRIX_MONITOR_DASHBOARD_URL`,
   - `OFFICINE_MATRIX_MONITOR_RUNBOOK_URL`.
3. Modes de livraison:
   - `signed_webhook`: payload JSON signe (HMAC, meme mecanisme que la pipeline beta feedback),
   - `slack`: message Slack formate (status, raisons, compteurs stale/missing, liens dashboard/runbook).
4. Overrides manuels possibles en GET/POST:
   - `delivery_mode`,
   - `webhook_url`,
   - `ops_environment`,
   - `dashboard_url`,
   - `runbook_url`.

## 8. Strate anti-hallucination

1. Aucune recommandation clinique sans `rule_id`.
2. Aucune reference affichee sans source structuree.
3. Cas non couvert -> `coverage_status=partial/out_of_scope` + limitations explicites.
4. Produit inconnu -> pas de deduction automatique d antigene.
5. LLM sandboxe en lecture seule du resultat moteur.
6. References officine enrichies avec metadonnees source (`source_status`, `source_last_verified_at_iso`) avant affichage.
7. Statut officine degrade dynamiquement si conditions hors perimetre (ex: age < seuil, restriction immunodepression).

## 9. Strategie de migration depuis l existant

## Etape M1 - Compatibilite payload

1. Ajouter support des nouveaux champs v2 sans casser v1.
2. Mapper v1->v2 en backend pour transition.

## Etape M2 - Moteur deterministe minimal

1. Introduire `rulesEngine.js` pour un sous-ensemble couvre.
2. Garder l ancien flux LLM en fallback explicite.

## Etape M3 - Basculer sortie par defaut

1. Sortie v2 deterministe par defaut.
2. LLM uniquement pour bloc explication.

## Etape M4 - Nettoyage

1. Retirer dependence decisionnelle au prompt system v1.
2. Conserver prompts uniquement pour textualisation.

## 9bis. Persistance KPI primaire (mode operationnel)

Objectif:
1. Decoupler la collecte KPI de la seule cible HTTP.
2. Garantir une ecriture transactionnelle idempotente par `batch_id`.

Modes supportes:
1. `http` (historique): livraison vers `BETA_FEEDBACK_PRIMARY_STORE_URL`.
2. `sqlite` (nouveau): stockage local transactionnel dans un fichier DB.
3. `dual` (migration): ecriture primaire sqlite + replication HTTP vers cible managée.

Variables d environnement:
1. `BETA_FEEDBACK_PRIMARY_STORE_MODE` = `http` | `sqlite`.
2. `BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH` = chemin DB locale (mode sqlite).
3. `BETA_FEEDBACK_PRIMARY_STORE_URL` = endpoint cible (mode http).
4. `BETA_FEEDBACK_PRIMARY_STORE_SECRET` + retry/timeout existants conserves pour mode http.
5. `BETA_FEEDBACK_PRIMARY_STORE_RETENTION_DAYS` (optionnel) = retention temporelle en jours (mode sqlite).
6. `BETA_FEEDBACK_PRIMARY_STORE_RETENTION_MAX_BATCHES` (optionnel) = borne haute de batches conserves (mode sqlite).
7. `BETA_FEEDBACK_PRIMARY_STORE_BACKUP_DIR` (optionnel) = dossier snapshots sqlite.
8. `BETA_FEEDBACK_PRIMARY_STORE_BACKUP_MAX_FILES` (optionnel) = rotation max des snapshots.
9. `BETA_FEEDBACK_PRIMARY_STORE_DUAL_WRITE_STRICT` (optionnel) = exige succes HTTP en plus du sqlite quand mode `dual`.

Contrat idempotence:
1. `batch_id` reste la cle canonique.
2. En mode sqlite, `batch_id` est cle primaire table batch.
3. Re-insertion d un meme `batch_id` => no-op (`duplicate_batch=true`).

Maintenance sqlite:
1. Retention appliquee en local apres ingestion (`retention_days`, `retention_max_batches`).
2. Snapshot backup sqlite optionnel (copie coherente `VACUUM INTO`) + rotation fichiers.
3. Endpoint report enrichi avec inspection primaire (`health`: volumes, taille DB, derniere ecriture).

Strategie migration managée:
1. Activer `mode=dual` pour dupliquer les batches vers la cible HTTP sans abandonner le socle sqlite.
2. Monitorer `replication_status` (`synced`/`degraded`) pendant la phase de convergence.
3. Basculer en `mode=http` seulement apres stabilisation (0 erreur replication sur fenetre definie).

Affinage moteur pneumocoque (v2.0.0+):
1. Lecture historique par produit commercial resolu (PCV/PPSV) et date.
2. Sequences deterministes simplifiees:
   - historique `Prevenar20/Capvaxive` => pas d action redondante (schema considere couvert),
   - historique conjugue seul (`Prevenar13`/`Vaxneuvance`) => complement `PPSV23` avec intervalle minimal 8 semaines,
   - historique `PPSV23` seul (`Pneumovax`) => dose conjuguee avec intervalle minimal 1 an.
3. Cas sans date conserve en mode prudent:
   - action "evaluer puis administrer",
   - limitation explicite sur intervalle non calculable.
4. Cas de sequence multi-produits:
   - historique combine conjugue + polysaccharidique => pas d action redondante immediate,
   - limitation explicite de strategie de rappels ulterieurs (a confirmer reglementairement/clinique).
5. Cartographie risque alignee:
   - profils a risque reconnus: `immunodepression`, `cancer_en_cours`, `dialyse_ou_ir`, `vih`, `asplenie`.

Affinage moteur Covid-19 (v2.0.0+):
1. Maintien du perimetre simplifie age >=5 ans.
2. Profil prioritaire (>=65 ans ou facteurs de risque cartographies ou grossesse):
   - rappel `now` si intervalle minimal simplifie >=6 mois atteint,
   - rappel `next` planifie sinon (`min_interval_days=180`, `proposed_date_iso` calculee).
   - facteurs de risque cartographies: `immunodepression`, `cancer_en_cours`, `dialyse_ou_ir`, `vih`, `asplenie`.
3. Historique dose non date:
   - sortie actionnable conservee (`action_now`),
   - limitation explicite sur intervalle de rappel non calculable.

Affinage moteur Meningocoques (v2.0.0+):
1. Cartographie risque harmonisee:
   - facteurs reconnus: `immunodepression`, `cancer_en_cours`, `dialyse_ou_ir`, `vih`, `asplenie`.
2. Meningocoque B avec historique incomplet:
   - si dose precedente detectee sans date, conserver une sortie actionnable (`action_now`, evaluation dose 2),
   - ajouter une limitation explicite de verification manuelle de la date precedente,
   - laisser la decision globale en mode prudent (`needs_more_info`) quand l historique reste incomplet.

Affinage guardrails securite (v2.0.0+):
1. Ajout du guardrail `SAFE-CANCER-001` (patient avec `risk_flags.cancer_en_cours=true`).
2. Effet attendu:
   - precaution explicite dans `cautions`,
   - limitation de verification clinique manuelle,
   - pas de blocage automatique des actions deterministes.

Affinage moteur dTcaPolio (v2.0.0+):
1. Grossesse conservee en voie prioritaire avec evaluation dediee.
2. Hors grossesse:
   - sans historique: rappel non declenche hors jalons simplifies (25/45/65 puis tous les 10 ans a partir de 75),
   - avec historique date: rappel evalue via intervalle minimal simplifie de 10 ans, y compris hors jalon.
3. Historique non date:
   - sortie prudente actionnable (`action_now`) avec verification manuelle explicite.
4. Transparence:
   - limitation explicite differenciee pour les cas hors jalon (`jalons non modelises finement`).

Pilotage dual explicite:
1. Journaliser chaque evenement de replication dual dans sqlite (`feedback_replication_events`).
2. Exposer un snapshot fenetre glissante (`dual_replication`) via `inspectPrimaryStore`:
   - `total_events`, `synced_events`, `degraded_events`, `disabled_events`,
   - `synced_rate`, `degraded_rate`, `disabled_rate`,
   - `last_degraded_event`.
   - bornes temporelles strictes appliquees: `window_start_iso <= event_at_iso <= now_iso`.
3. Evaluer la readiness de bascule via `evaluateDualPilotReadiness`:
   - seuils configurables (`min_events`, `min_synced_rate`, `max_degraded_rate`, `max_disabled_rate`),
   - statuts `insufficient_data`, `not_ready`, `ready`.
4. Endpoint dedie:
   - `netlify/functions/beta-feedback-dual-readiness.js`,
   - options GET/POST et env:
     - `BETA_FEEDBACK_DUAL_PILOT_WINDOW_DAYS`,
     - `BETA_FEEDBACK_DUAL_PILOT_MIN_EVENTS`,
     - `BETA_FEEDBACK_DUAL_PILOT_MIN_SYNCED_RATE`,
     - `BETA_FEEDBACK_DUAL_PILOT_MAX_DEGRADED_RATE`,
     - `BETA_FEEDBACK_DUAL_PILOT_MAX_DISABLED_RATE`,
     - `BETA_FEEDBACK_DUAL_PILOT_FAIL_ON_NOT_READY`.
5. Gate canary dual -> http:
   - module `evaluateDualPilotCanaryGate` (evaluation sur fenetres consecutives),
   - endpoint `netlify/functions/beta-feedback-dual-canary-gate.js`,
   - statuts: `ready`, `blocked_not_ready`, `blocked_insufficient_data`, `insufficient_data`,
   - options:
     - `required_windows`,
     - `window_days`,
     - seuils readiness,
     - `fail_on_blocked`.
6. Reporting unifie:
   - `beta-feedback-report` expose `dual_canary_gate` (en plus de `dual_pilot_readiness`) quand mode primaire = `dual`.
7. Decision ops scriptable:
   - script `scripts/run-dual-pilot-decision.mjs`,
   - commande `npm run ops:dual:decision`,
   - artefact de preuve `_bmad-output/brainstorming/dual-pilot-decision-proof-<timestamp>.json`.

KPI qualite collecte beta:
1. `summarizeFeedback` expose en plus des KPI go/no-go:
   - `required_core_completion_rate`,
   - `quick_history_usage_rate`,
   - `avg_quick_history_entries_count`,
   - `timed_submission_rate`.
2. Objectif produit:
   - suivre en lot la qualite des donnees cliniques minimales,
   - mesurer l adoption reelle du mode "entree rapide nom commercial + date".

Kit drill Ops (SEV-1 simule):
1. Endpoint de reception de preuve:
   - `netlify/functions/ops-drill-receiver.js` (GET/POST/DELETE).
2. Stockage des preuves:
   - NDJSON local via `OPS_DRILL_RECEIVER_STORE_PATH` (defaut `.netlify/ops-drill-receiver.ndjson`).
3. Script automate:
   - `scripts/run-officine-sev1-drill.mjs`,
   - commande `npm run drill:officine:sev1`.
4. Resultat:
   - artefact de preuve JSON exporte dans `_bmad-output/brainstorming/ops-sev1-drill-proof-<timestamp>.json`.

## 10. Matrice de couverture v1 (squelette)

Format recommande:

```json
{
  "rules_version": "v2.0.0",
  "domains": [
    { "name": "HPV", "status": "covered" },
    { "name": "Pneumocoque", "status": "partial" },
    { "name": "Zona", "status": "covered" },
    { "name": "dTcaPolio", "status": "partial" },
    { "name": "Meningocoque_ACWY", "status": "partial" },
    { "name": "Meningocoque_B", "status": "partial" },
    { "name": "VRS", "status": "partial" }
  ],
  "notes": [
    "RCP detaille incomplet pour certains produits",
    "Matrice officine consolidee sur noyau vaccinal >=11 ans (Covid >=5 ans), avec audit de fraicheur des sources",
    "dTcaPolio modele en jalons d age simplifies et cas grossesse non exhaustif",
    "VRS modele en profils simplifies senior/grossesse (fenetre gestationnelle a affiner)"
  ]
}
```

## 11. Tests minimum requis

1. Unit tests:
   - resolution produit,
   - calcul intervalle,
   - guardrails CI.
2. Contract tests:
   - validation schema sortie v2.
3. Golden tests:
   - jeux de cas references cliniques.
   - inclure des cas frontiere reglementaires (ex: <11 ans avec restrictions) et des sequences multi-produits (PCV+PPSV).
   - inclure des scenarios "couvert + bruit" (ex: sequence Pneumocoque couverte + produit inconnu) pour verifier l absence d actions redondantes.
   - inclure des scenarios multi-domaines coherents sur historique mixte (ex: HPV + HepB + ROR + Meningocoques).
   - inclure des scenarios multi-produits bruites qui doivent rester actionnables en mode prudent (`needs_more_info`).
   - inclure des bornes d age explicites sur Covid officine (cas age 4/5 ans).
   - inclure des cas de qualite de donnees historique (doublons meme jour deduplicables, dates manquantes en mode fail-safe).
4. Non-regression:
   - aucun champ obligatoire v2 manquant.

## 12. Checklist readiness beta

1. Rules pack versionne publie.
2. Dictionnaire commercial initial charge.
3. Pipeline deterministe actif.
4. Sortie tracee visible UI/PDF.
5. Instrumentation KPI branchee.
6. Matrice de couverture publiee.
