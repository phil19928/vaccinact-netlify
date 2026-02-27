# VaccinAct MVP v2 - Backlog d execution

Date: 2026-02-26
Source: brainstorming-session-2026-02-26.md
Mode: officine-first, usage anonyme, sans HDS, sans auth

## Objectif produit

Livrer en 21 jours un MVP v2 fonde sur:
1. Moteur clinique deterministe versionne.
2. Dictionnaire nom commercial -> antigene(s) -> schema.
3. Formulaire adaptatif avec mode entree rapide nom commercial + date.
4. Sortie operationnelle tracee (now/next/cautions + hypotheses + sources + rules_version).

## Delta vs etat actuel

Etat actuel observe:
1. Formulaire centre sur tranches d age, profession, voyage, et champs texte larges.
2. Diagnostic genere via LLM + file_search.
3. Pas de couche explicite de regles deterministes versionnees.

Delta cible:
1. Formulaire recentre officine (age exact, sexe, grossesse, pathologies cles, historique par nom commercial + date).
2. Pipeline de decision prioritairement non-LLM.
3. LLM relegue a explication et collecte d informations manquantes.

## KPIs go/no-go beta

1. Temps moyen formulaire <= 2m30.
2. Taux completion >= 85%.
3. Utilite percue >= 4.0/5.
4. Intention reutilisation >= 70%.
5. Corrections cliniques majeures < 10% des cas.

## Epics et user stories

## EPIC E0 - Architecture et fondations

### US-E0-01 - Contrat de sortie standardise
En tant que moteur clinique, je veux produire une sortie stable et verifiable pour tous les cas.

Acceptance criteria:
1. Le JSON final contient systematiquement: action_now, action_next, cautions, hypotheses, references, rules_version.
2. Chaque action contient au moins une reference source structuree.
3. Un champ `coverage_status` est renseigne (`covered`, `partial`, `out_of_scope`).

Definition of done:
1. Schema JSON v2 redige.
2. Validation automatique de schema en test.

### US-E0-02 - Versionnement des regles
En tant qu equipe produit, je veux versionner explicitement les regles.

Acceptance criteria:
1. `rules_version` est obligatoire dans chaque resultat.
2. Un changelog des regles est maintenu par version.
3. Les tests mentionnent la version cible.

## EPIC E1 - Formulaire officine-first

### US-E1-01 - Age exact au lieu de tranche d age
En tant que pharmacien, je veux saisir un age exact pour une decision plus fiable.

Acceptance criteria:
1. Le champ `patient_age_years` entier est obligatoire.
2. L ancien champ `patient_age_range` n est plus bloqueur.
3. Le payload transmis contient `patient_age_years`.

Impacted files:
1. public/index.html

### US-E1-02 - Mode entree rapide historique vaccinal
En tant que pharmacien, je veux ajouter des lignes `nom commercial + date` rapidement.

Acceptance criteria:
1. UI avec ajout/suppression de lignes.
2. Au moins une ligne possible sans friction (2 clics max apres ouverture).
3. Payload contient un tableau `vaccine_history_entries`.

Entry shape:
1. `product_name`
2. `administration_date_iso`
3. `source` (optionnel, ex: carnet/declaratif)

### US-E1-03 - Formulaire adaptatif conditionnel
En tant que pharmacien, je veux ne voir que les questions utiles.

Acceptance criteria:
1. Les blocs conditionnels s affichent selon reponses precedentes.
2. Les champs hors pertinence ne sont pas obligatoires.
3. Le mode "infos insuffisantes" du moteur est active si variable critique absente.

## EPIC E2 - Dictionnaire medicament et mapping

### US-E2-01 - Table de correspondance nom commercial
En tant que moteur clinique, je veux mapper chaque nom commercial vers ses valences.

Acceptance criteria:
1. Table initiale inclut le portefeuille officine prioritaire.
2. Prise en charge des alias (casse, accents, variantes ecriture).
3. Si produit inconnu: statut `unknown_product` + message de collecte.

### US-E2-02 - Resolution antigene et schema
En tant que moteur clinique, je veux traduire le produit en logique de regles.

Acceptance criteria:
1. Chaque entree historique resolue contient `antigens[]`.
2. Le moteur peut calculer la progression dose/intervalle pour les cas couverts.
3. Les cas non couverts sont signales sans hallucination.

## EPIC E3 - Moteur clinique deterministe

### US-E3-01 - Calcul now/next/cautions
En tant que pharmacien, je veux un plan d action immediat et futur.

Acceptance criteria:
1. `action_now` et `action_next` produits a partir de regles deterministes.
2. Intervalles minimaux convertis en jours quand chiffrables.
3. Pas de recommendation generee hors couverture declaree.

### US-E3-02 - Gestion des hypotheses explicites
En tant qu utilisateur, je veux savoir quelles hypotheses ont ete utilisees.

Acceptance criteria:
1. Chaque sortie contient `hypotheses_assumed[]`.
2. Une hypothese critique absente force un statut `needs_more_info`.
3. Les hypotheses alimentent la section limitations.

### US-E3-03 - Trajectoire couverture calendrier complete
En tant qu equipe produit, je veux etendre progressivement la couverture.

Acceptance criteria:
1. Une matrice de couverture par domaine est publiee.
2. Chaque release augmente explicitement le perimetre couvert.
3. Les zones non couvertes restent visibles dans le resultat.

## EPIC E4 - Securite et reglementaire

### US-E4-01 - Guardrails CI/precautions minimaux
En tant que pharmacien, je veux des alertes de securite fiables.

Acceptance criteria:
1. Regles minimales implementees: anaphylaxie severe, vivants attenues en immunodepression persistante.
2. Les alertes ne bloquent que si condition explicite.
3. Si ambiguite, sortie `precaution` + renvoi verification RCP.

### US-E4-02 - Administrable en officine
En tant que pharmacien, je veux savoir si l acte est administrable en officine.

Acceptance criteria:
1. Champ `officine_administration_status` present pour chaque action.
2. Valeurs possibles: `allowed`, `not_allowed`, `to_confirm`.
3. `to_confirm` est la valeur par defaut hors matrice consolidee.

## EPIC E5 - UX resultat et export

### US-E5-01 - Resultat professionnel lisible
En tant que pharmacien, je veux une lecture immediate du plan.

Acceptance criteria:
1. Bloc `Maintenant` en tete.
2. Bloc `Plus tard` avec dates/prochaines etapes.
3. Bloc `Precautions` et bloc `References` visibles.

### US-E5-02 - Export PDF simple
En tant qu utilisateur, je veux exporter le diagnostic sans mise en page lourde.

Acceptance criteria:
1. Export PDF contient uniquement sections indispensables.
2. Le PDF inclut date de diagnostic et rules_version.
3. Le PDF inclut references et hypotheses.

## EPIC E6 - Instrumentation beta

### US-E6-01 - Telemetrie KPI
En tant qu equipe produit, je veux mesurer adoption et qualite.

Acceptance criteria:
1. Temps de completion capture.
2. Completion formulaire capture.
3. Utilite percue (1-5) et intention de reutilisation capturees.
4. Compteur corrections majeures collecte.

### US-E6-02 - Rapport hebdo beta
En tant que fondateur, je veux un rapport decisionnel hebdo.

Acceptance criteria:
1. Rapport consolide par officine.
2. Rapport consolide global.
3. Statut go/no-go calcule automatiquement.

## Planification 21 jours

## Sprint S1 (J1-J5) - Fondations

Stories:
1. US-E0-01
2. US-E0-02
3. US-E1-01

Sortie attendue:
1. Contrat de sortie v2.
2. Champ age exact en place.
3. Tests schema de base.

## Sprint S2 (J6-J10) - Collecte et mapping

Stories:
1. US-E1-02
2. US-E1-03
3. US-E2-01

Sortie attendue:
1. Mode entree rapide operationnel.
2. Form adaptatif actif.
3. Dictionnaire produits initial.

## Sprint S3 (J11-J15) - Moteur et securite

Stories:
1. US-E2-02
2. US-E3-01
3. US-E3-02
4. US-E4-01
5. US-E4-02

Sortie attendue:
1. Premier calcul deterministe stable.
2. Guardrails CI v1.
3. Statut administrable officine v1.

## Sprint S4 (J16-J21) - Resultat, export, beta ready

Stories:
1. US-E5-01
2. US-E5-02
3. US-E6-01
4. US-E6-02
5. US-E3-03

Sortie attendue:
1. UX resultat finalisee.
2. Export PDF simple stable.
3. Dash KPI beta pret.
4. Matrice de couverture publiee.

## Risques et mitigations

1. Mapping commercial incomplet.
Mitigation: statut `unknown_product` + boucle d enrichissement hebdo.

2. Couverture clinique sur-vendue.
Mitigation: matrice de couverture versionnee affichee au runtime.

3. Surcharge de scope 21 jours.
Mitigation: geler P0; reporter P1/P2 apres beta.

## Definition de release candidate (RC)

La RC beta est atteinte si:
1. Toutes les stories P0 sont terminees.
2. Test schema + tests regles de base passent.
3. L application produit des sorties tracees sans hallucination declarative.
4. Les KPIs beta sont instrumentes.

## Execution progress (2026-02-26)

Deja implemente:
1. Frontend: `patient_age_years` obligatoire + derive `patient_age_range` compatibilite.
2. Frontend: mode entree rapide `nom commercial + date` avec tableau `vaccine_history_entries`.
3. Frontend: envoi bundle `{ patient (legacy), patient_v2, diagnostic_date }`.
4. Backend: normalisation v1/v2 (`normalizeIncomingPayload` + fusion v2->legacy).
5. Backend: feature flag `DIAGNOSTIC_ENGINE_MODE` avec branche `deterministic`.
6. Backend: moteur deterministe minimal HPV + pneumocoque (coverage partiel explicite).
7. Backend: squelettes modules et data (`lib/*`, `data/*.json`) crees.
8. Backend: dictionnaire produits renforce (alias + normalisation des noms commerciaux).
9. Frontend: section debug `deterministic_v2` ajoutee (coverage, actions, hypotheses, limitations, references).
10. Tests automatises ajoutes et passes (`npm test`) pour:
   - resolution dictionnaire (canonique + alias + inconnu),
   - regles moteur HPV/pneumocoque.
11. Guardrails securite renforces:
   - precaution allergie severe avec reference de regle,
   - precaution produit inconnu (`unknown_product`) + limitation explicite.
12. Instrumentation KPI beta ajoutee dans l UI:
   - temps de completion du formulaire capture dans `beta_metrics`,
   - feedback local utilite/reutilisation/corrections sauvegarde via `localStorage`.
13. Export feedback beta ajoute dans l UI:
   - export JSON local,
   - export CSV local,
   - purge stockage local.
14. Tests etendus et passes:
   - scenario immunodepression <65 declenche pneumocoque,
   - guardrail immunodepression ajoute.
15. Collecte centralisee KPI ajoutee:
   - endpoint `/.netlify/functions/beta-feedback` (validation + synthese),
   - push batch depuis UI locale vers serveur.
16. Tests validation KPI ajoutes:
   - normalisation et rejet des entrees invalides,
   - calcul des agregats (utilite, reutilisation, completion, corrections).
17. Tests combinatoires securite ajoutes:
   - immunodepression + unknown_product dans un meme cas.
18. Scenarios combinatoires et statut de decision ajoutes:
   - moteur: `decision_status` (`ready` / `needs_more_info`) selon completude des donnees,
   - moteur: limitation explicite si historique vaccinal incomplet (date manquante),
   - guardrails: cas combine `grossesse + immunodepression`,
   - guardrails: precaution `historique vaccinal incomplet`,
   - output: `decision_status` expose dans la meta deterministic.
19. Tests unitaires etendus et passes:
   - scenario combine `grossesse + immunodepression + historique incomplet`,
   - verification `decision_status=needs_more_info`.
20. Matrice officine enrichie dans le runtime:
   - ajout `officine_administration_source` et `officine_administration_note` sur les actions,
   - mapping source/note depuis `officine-matrix.v1.json`,
   - remontee de la note dans les `vigilance_points` legacy.
21. Tests matrice officine ajoutes et passes:
   - statut/source corrects pour un vaccin mappe,
   - fallback `to_confirm` + `not_specified` pour un vaccin non mappe.
22. Debut de centralisation des modules:
   - suppression de la duplication `deriveAgeRangeFromYears`,
   - `diagnostic.js` importe desormais la fonction partagee depuis `lib/normalizeInput.js`.
23. Centralisation avancee `lib/*`:
   - extraction de la normalisation legacy/v2 vers `lib/legacyPatient.js`,
   - extraction du mapping deterministic->legacy vers `lib/legacyResponseMapper.js`,
   - `diagnostic.js` simplifie pour orchestrer les modules sans logique metier dupliquee.
24. Fallback deterministic centralise:
   - creation de `buildFallbackV2FromLegacy(...)` pour produire un input v2 standard a partir du payload legacy.
25. Tests de refactorisation ajoutes et passes:
   - `legacyPatient.test.mjs` (fusion payload + fallback v2),
   - `legacyResponseMapper.test.mjs` (mapping sortie legacy + sources).
26. Suite de non-regression "cas de reference officine" ajoutee:
   - test pipeline complet HPV rattrapage,
   - test pipeline complet pneumocoque senior,
   - test pipeline fail-safe grossesse + immunodepression + historique incomplet.
27. Extension de la suite de reference pipeline:
   - cas `unknown_product` -> caution + `needs_more_info`,
   - cas allergie severe -> caution securite obligatoire,
   - cas age manquant -> `needs_more_info` + hypothese explicite.
28. Correctif robustesse age:
   - `normalizeInputV2` ne convertit plus `null` en `0`,
   - parsing d age harmonise (nombre et string numerique) dans normalisation et moteur.
29. Extension moteur deterministe:
   - ajout d un bloc `Zona` (Shingrix) dans le rules engine,
   - logique simplifiee: eligibilite age/risque, dose 1 puis dose 2 avec intervalle minimal,
   - limitations explicites conservees (schema simplifie, couverture partielle).
30. Tests moteur et pipeline etendus pour Zona:
   - tests unitaires `rulesEngine` (initiation + dose 2 planifiee),
   - test de reference pipeline `>=65` avec action Zona now/next.
31. Strategie de retention KPI implementee (mode optionnel):
   - ajout `lib/betaFeedbackArchive.js` pour archivage batch en NDJSON,
   - integration dans `beta-feedback.js` via `BETA_FEEDBACK_ARCHIVE_PATH`,
   - statut `archive` renvoye dans la reponse API.
32. Tests archivage KPI ajoutes et passes:
   - mode desactive sans path,
   - ecriture NDJSON validee avec path temporaire.
33. Extension complementaire du jeu de reference pipeline:
   - grossesse sans immunodepression: pas de caution combinee erronee,
   - produit mappe sans date: `needs_more_info` + caution historique incomplet,
   - age string invalide: traite comme age manquant (`needs_more_info`).
34. Extension moteur deterministe `HepB`:
   - eligibilite simplifiee (age 11-25 ou facteurs de risque cartographies),
   - schema simplifie 0-1-6 (avec rattrapage progressif selon nombre de doses),
   - references/rules IDs explicites et limitations de simplification conservees.
35. Tests HepB ajoutes et passes:
   - `rulesEngine`: initiation HepB et gestion dose 2 due,
   - `pipelineReferenceCases`: cas officine HepB catch-up chez jeune adulte.
36. Matrice officine enrichie:
   - entree `hepb` ajoutee avec statut `to_confirm` + source/note provisoires.
37. Alignement tests matrice officine:
   - cas fallback ajuste vers un vaccin non mappe (`Dengue`) apres ajout de `hepb`.
38. Extension moteur deterministe `ROR`:
   - rattrapage simplifie 2 doses (intervalle minimal 4 semaines),
   - logique dose 2 immediate ou planifiee selon date de dose 1,
   - limites explicites (perimetre age simplifie <=45 ans).
39. Tests ROR ajoutes et passes:
   - `rulesEngine`: initiation ROR + dose 2 due,
   - `pipelineReferenceCases`: cas adulte <=45 sans historique.
40. Matrice officine enrichie:
   - entree `ror` ajoutee avec statut `to_confirm` + source/note provisoires.
41. Extension moteur deterministe `Covid-19`:
   - logique simplifiee age >=5 ans,
   - recommandation initiale si aucune dose historique,
   - recommandation rappel pour profils prioritaires (age/risque) avec historique existant.
42. Tests Covid-19 ajoutes et passes:
   - `rulesEngine`: initiation Covid-19 + rappel profil prioritaire,
   - `pipelineReferenceCases`: verification statut officine `allowed` via matrice.
43. Registre de domaines regles mis a jour:
   - ajout de `Covid19` dans `rules.v1.json`.
44. KPI go/no-go integre dans le pipeline feedback:
   - `betaFeedback.js` enrichi avec seuils cibles et `evaluateGoNoGo(...)`,
   - ajout `completion_rate` dans les agregats,
   - endpoint `beta-feedback` retourne maintenant `go_no_go` avec checks detailles.
45. Agrégation feedback par officine ajoutee:
   - normalisation `site_id` (`officine_id`/`pharmacy_id` compatibles),
   - `summarizeFeedbackBySite(...)` avec statut go/no-go par groupe.
46. Rapport archive ajoute:
   - nouveau module `lib/betaFeedbackReport.js` (lecture NDJSON + fenetre temporelle + rapport global/par officine),
   - nouveau endpoint `beta-feedback-report` (GET/POST) pour exposer le rapport.
47. Tests feedback/report ajoutes et passes:
   - `betaFeedback.test.mjs` etendu (go/no-go + grouping site),
   - `betaFeedbackReport.test.mjs` ajoute (parsing archive + reporting window).
48. Gate de taille d echantillon ajoute au go/no-go beta:
   - seuil `min_total_entries=20` dans `evaluateGoNoGo(...)`,
   - statut `insufficient_data` retourne tant que le volume minimal n est pas atteint,
   - checks go/no-go exposes avec seuils utilises pour audit.
49. Robustesse historique vaccinal renforcee dans le moteur:
   - deduplication des doses par antigene/date pour eviter le double comptage des doublons de saisie,
   - maintien du comptage pour entrees non datees par identite produit afin de conserver le signal historique.
50. Couverture tests intervalle limite etendue:
   - HepB dose 2 due a J+30 exact,
   - HepB dose 3 due a J+150 exact apres dose 2,
   - ROR dose 2 due a J+28 exact,
   - Zona dose 2 due a J+60 exact.
51. Couverture tests doublons historiques etendue:
   - unit tests `rulesEngine` pour doublons meme jour sur ROR et HepB,
   - reference pipeline ajoutee pour deduplication end-to-end sans faux schema complet.
52. Politique de retention archive KPI implementee:
   - `archiveFeedbackBatch(...)` accepte `retentionDays` et `retentionMaxBatches`,
   - purge automatique NDJSON apres append selon fenetre temporelle et/ou nombre maximal de batches,
   - statistiques de retention retournees dans `archive.retention` (avant/apres/pruned/parse errors).
53. Ingestion feedback alignee sur la retention configurable:
   - `beta-feedback` passe `BETA_FEEDBACK_RETENTION_DAYS` et `BETA_FEEDBACK_RETENTION_MAX_BATCHES` a l archivage.
54. Tests retention KPI ajoutes et passes:
   - prune par jours,
   - prune par nombre max de batches (conservation des plus recents).
55. Livraison webhook KPI fiabilisee:
   - extraction de la livraison vers `lib/betaFeedbackDelivery.js`,
   - retries exponentiels sur erreurs reseau / HTTP retryables (429/5xx),
   - timeout configurable par tentative.
56. Securisation webhook KPI ajoutee:
   - signature HMAC SHA-256 optionnelle sur le payload (`X-VaccinAct-Signature`),
   - metadonnees d envoi normalisees (`X-VaccinAct-Event`, `X-VaccinAct-Sent-At`, request id).
57. Endpoint `beta-feedback` aligne sur livraison robuste:
   - passage de `go_no_go` et `archive` dans la charge webhook,
   - nouvelles variables d env pour retries / timeout / secret.
58. Tests webhook KPI ajoutes et passes:
   - desactive sans URL,
   - payload + headers + signature,
   - retry sur 503 puis succes,
   - non-retry sur 400,
   - retry apres erreur reseau puis succes.
59. Cible persistante primaire non-fichier ajoutee (mode HTTP):
   - `beta-feedback` envoie maintenant chaque batch vers `BETA_FEEDBACK_PRIMARY_STORE_URL`,
   - canal primaire distinct du webhook de notification,
   - delivery robuste (retry/timeout/signature) partagee.
60. Reprise/rejeu KPI implementes:
   - nouveau module `lib/betaFeedbackReplay.js` (chargement archive par batches, filtrage, replay cible),
   - nouveau endpoint `beta-feedback-replay` (dry-run, filtres `from_iso`, `max_batches`, cible `primary_store|webhook|both`).
61. Couverture tests replay et livraison multi-cibles ajoutee:
   - tests unitaires `betaFeedbackReplay.test.mjs`,
   - test override `eventName` dans `betaFeedbackDelivery.test.mjs`.
62. Gouvernance de couverture antigenes renforcee:
   - detection explicite des antigenes resolus hors perimetre moteur (`SUPPORTED_ANTIGENS`),
   - ajout d une limitation structuree `Antigenes hors couverture moteur ...`,
   - passage automatique en `decision_status=needs_more_info` pour eviter les faux `ready`.
63. Couverture tests multi-antigenes/hors-perimetre etendue:
   - tests unitaires `rulesEngine` pour antigenes hors couverture (ex: VRS) et entree multi-antigene mixte,
   - test de reference pipeline avec produit mappe mais hors couverture (Abrysvo -> VRS).
64. Qualite donnees historisation renforcee:
   - detection des doses datees dans le futur vs `diagnostic_date_iso`,
   - limitation explicite `Historique vaccinal incoherent: date(s) futures ...`,
   - passage en `decision_status=needs_more_info` pour eviter les plans d action sur historique incoherent.
65. Guardrail securite additionnel:
   - nouvelle caution `Historique vaccinal incoherent` avec reference `SAFE-FUTURE-HISTORY-001`.
66. Couverture tests qualite donnees etendue:
   - unit tests `rulesEngine` pour dates futures,
   - unit test `safetyGuardrails` pour caution date future,
   - test de reference pipeline end-to-end pour date future.
67. Idempotence de batch KPI ajoutee:
   - generation d un `batch_id` deterministe (`buildFeedbackBatchIdentity`) a partir du contenu normalise,
   - retour de `batch_id` dans la reponse `beta-feedback` et journalisation associee.
68. Traçabilité transport/alimentation alignee:
   - archivage NDJSON enrichi avec `batch_id`,
   - livraison HTTP (`primary_store` et `webhook`) enrichie avec `batch_id` + `Idempotency-Key`,
   - replay archive conserve/recalcule `batch_id` pour rejouer avec la meme cle d idempotence.
69. Couverture tests idempotence ajoutee:
   - stabilite / sensibilite `buildFeedbackBatchIdentity`,
   - verification headers/payload idempotence dans `betaFeedbackDelivery`,
   - verification propagation `batch_id` dans `betaFeedbackArchive` et `betaFeedbackReplay`.
70. Matrice officine enrichie pour traçabilité reglementaire:
   - chaque vaccin mappe porte maintenant `review_status` + `references` structurees (id/source/section/snippet/statut),
   - compatibilite maintenue avec les champs existants `status/source/note`.
71. Mapping officine aligne sur references auditables:
   - `applyOfficineMatrix(...)` injecte les references reglementaires dans `action.references`,
   - nouveaux champs exposes par action (`officine_administration_references`, `officine_administration_review_status`, `officine_administration_rules_version`),
   - ajout `collectOfficineMatrixLimitations(...)` pour signaler explicitement les vaccins encore `to_confirm`.
72. Pipeline deterministic aligne sur gouvernance reglementaire:
   - `diagnostic.js` ajoute automatiquement la limitation "Administrabilite officine a confirmer ..." quand applicable,
   - couverture tests etendue (`officineMatrix`, `pipelineReferenceCases`) pour verrouiller la propagation.
73. Extension moteur deterministe `Meningocoque ACWY`:
   - ajout d une regle simplifiee ACWY (declenchement age/risque, couverture dose historique),
   - references/rule IDs explicites et limitations de simplification conservees.
74. Extension moteur deterministe `Meningocoque B`:
   - ajout d un schema simplifie 2 doses (initiation + rappel a >=30 jours),
   - logique dose 2 immediate ou planifiee selon date de dose 1,
   - detection robuste des cas date manquante pour eviter les faux plans.
75. Gouvernance couverture meningo alignee:
   - `SUPPORTED_ANTIGENS` et `rules.v1.json` etendus (`Meningocoque_ACWY`, `Meningocoque_B`),
   - matrice officine enrichie (entrees `to_confirm` + references),
   - couverture tests etendue (`rulesEngine`, `officineMatrix`, `pipelineReferenceCases`).
76. Extension moteur deterministe `dTcaPolio`:
   - ajout d une logique simplifiee de rappel aux jalons d age (25/45/65 puis tous les 10 ans a partir de 75),
   - ajout d un cas grossesse (evaluation rappel dTcaPolio/coqueluche) avec limitation explicite de fenetre gestationnelle non modelisee,
   - references/rule IDs explicites pour now/next.
77. Gouvernance couverture `dTcaPolio` alignee:
   - `SUPPORTED_ANTIGENS` et `rules.v1.json` etendus avec `dTcaPolio`,
   - matrice officine enrichie (`dtcapolio` en `to_confirm` + reference structuree),
   - message de couverture moteur mis a jour.
78. Couverture tests `dTcaPolio` ajoutee:
   - unit tests `rulesEngine` (jalon sans date, due now >10 ans, planifie <10 ans, grossesse, hors couverture),
   - test `officineMatrix` mapping `dtcapolio`,
   - test de reference pipeline end-to-end pour rappel dTcaPolio.
79. Extension moteur deterministe `VRS`:
   - ajout d une logique simplifiee profils seniors (>=60 ans) et grossesse,
   - schema simplifie mono-dose avec limitation explicite (fenetre gestationnelle non modelisee),
   - references/rule IDs explicites pour voies senior et grossesse.
80. Gouvernance couverture `VRS` alignee:
   - `SUPPORTED_ANTIGENS` et `rules.v1.json` etendus avec `VRS`,
   - matrice officine enrichie (`vrs` en `to_confirm` + reference structuree),
   - message de couverture moteur mis a jour.
81. Couverture tests `VRS` ajoutee et migration hors-couverture:
   - unit tests `rulesEngine` pour profils VRS couverts (senior, grossesse, historique deja couvert),
   - test `officineMatrix` mapping `vrs`,
   - test de reference pipeline end-to-end VRS,
   - scenario hors-couverture deplace vers antigene non supporte (`Dengue`) pour conserver le guardrail.
82. Guardrails coherence donnees patient renforces:
   - detection incoherence `sexe/grossesse` avec caution dediee (`SAFE-PREG-SEX-001`),
   - detection age hors plage plausible (`SAFE-AGE-RANGE-001`),
   - bascule automatique `decision_status=needs_more_info` sur incoherence critique.
83. Registre safety-rules aligne:
   - ajout des regles `SAFE-PREG-SEX-001` et `SAFE-AGE-RANGE-001` dans `safety-rules.v1.json`.
84. Couverture tests coherence ajoutee:
   - tests unitaires `safetyGuardrails` (sexe/grossesse incoherent, age improbable),
   - test de reference pipeline end-to-end pour verification `needs_more_info` sur incoherence sexe/grossesse.
85. Persistance primaire transactionnelle KPI ajoutee (mode `sqlite`):
   - nouveau module `betaFeedbackPrimaryStore` avec stockage local transactionnel (`feedback_batches` + `feedback_entries`),
   - idempotence forte par `batch_id` (insert unique + `ON CONFLICT DO NOTHING`),
   - metadonnees de stockage exposees (`inserted_batch`, `inserted_entries`, `duplicate_batch`).
86. Endpoint ingestion aligne multi-modes primaire:
   - `beta-feedback` route le store primaire via `BETA_FEEDBACK_PRIMARY_STORE_MODE`,
   - fallback compatible HTTP conserve (`BETA_FEEDBACK_PRIMARY_STORE_URL`),
   - nouveau mode SQLite active via `BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH`.
87. Couverture tests primary store etendue:
   - nouveau test unitaire `betaFeedbackPrimaryStore.test.mjs`,
   - verification transaction sqlite (ecriture batch + entries),
   - verification idempotence sur batch duplique,
   - verification delegation HTTP via forwarder injectable.
88. Industrialisation mode sqlite primaire (maintenance) implemente:
   - retention operationnelle configurable (`BETA_FEEDBACK_PRIMARY_STORE_RETENTION_DAYS`, `BETA_FEEDBACK_PRIMARY_STORE_RETENTION_MAX_BATCHES`),
   - pruning automatique des batches anciens/surnumeraires avec suppression cascade des entries.
89. Backup sqlite rotatif ajoute:
   - snapshots cohérents du store primaire via `VACUUM INTO`,
   - rotation configurable (`BETA_FEEDBACK_PRIMARY_STORE_BACKUP_MAX_FILES`) dans `BETA_FEEDBACK_PRIMARY_STORE_BACKUP_DIR`.
90. Monitoring primaire integre:
   - snapshot `health` retourne par ingestion sqlite (volumes batches/entries + taille DB/WAL),
   - endpoint report enrichi avec inspection du primary store (`inspectPrimaryStore`),
   - tests unitaires ajoutes: retention, backup rotation, inspection.
91. Mode migration `dual-write` implemente:
   - nouveau mode `dual` pour ecriture sqlite + replication HTTP sur le meme batch,
   - statut replication explicite (`synced`/`degraded`/`disabled`) dans la reponse ingestion.
92. Controle de rigueur migration ajoute:
   - option `BETA_FEEDBACK_PRIMARY_STORE_DUAL_WRITE_STRICT` pour exiger succes replica HTTP,
   - semantics claires: strict off => succes pilote par sqlite; strict on => succes conditionne aux 2 stores.
93. Couverture tests dual-write ajoutee:
   - test `dual` synchrone (sqlite + HTTP ok),
   - test `dual` degrade non-strict,
   - test `dual` strict en erreur replica,
   - test inspection mode `dual` avec metadonnees replica.
94. Matrice officine structuree par catalogue de sources:
   - ajout `sources_catalog_version` + `sources_catalog` dans `officine-matrix.v1.json`,
   - decoupage des `source_id` provisoires par vaccin (HPV/pneumo/HepB/ROR/zona/meningocoques/dTcaPolio/VRS),
   - enrichissement des references actions avec metadonnees source (titre, statut, derniere verification).
95. Audit reglementaire de matrice implemente:
   - nouvelle fonction `auditOfficineMatrix` (KPI consolidation: `to_confirm`, refs manquantes, refs stale),
   - nouvel endpoint `netlify/functions/officine-matrix-audit.js` pour supervision et pilotage readiness.
96. Couverture tests officine etendue:
   - verification enrichissement source dans `applyOfficineMatrix`,
   - verification audit global (breakdown et absence de source manquante),
   - verification detection de references confirmees stale.
97. Consolidation reglementaire officine (vaccine-par-vaccine) livree:
   - bascule des entrees coeur (HPV/pneumo/HepB/ROR/zona/dTcaPolio/VRS/meningocoques) en `allowed` + `confirmed`,
   - references juridiques consolidees sur l arrete modifie (article 3) avec `source_id` dedie par vaccin,
   - metadonnees source completees (`url`, `last_verified_at_iso`, `status`).
98. Conditions d eligibilite officine integrees au runtime:
   - support `min_age_years` dans la matrice (>=11 ans, Covid >=5 ans),
   - support `restrictions` par facteurs de risque (ROR + immunodepression => `not_allowed`),
   - `applyOfficineMatrix` enrichi avec contexte patient (`patientAgeYears`, `riskFlags`) pour statut dynamique.
99. Pipeline deterministic aligne contexte officine:
   - `diagnostic.js` et tests pipeline transmettent age + risk flags a `applyOfficineMatrix`,
   - suppression des limitations officiine artificielles sur cas maintenant consolides (ex: pneumocoque adulte).
100. Readiness audit matrice confirmee:
   - endpoint `officine-matrix-audit` retourne `ready_for_regulatory_signoff=true` au 26/02/2026,
   - KPI consolidation: `to_confirm_entries_count=0`, `missing_source_catalog_refs_count=0`.
101. Routine de reverification periodique des sources officine implementee:
   - nouveau module `officineMatrixMonitor` (calcul statut `ok/alert` + raisons),
   - seuil stale configurable (`stale_source_alert_threshold`) et exigence `ready_for_regulatory_signoff` configurable.
102. Endpoint de monitoring active avec cron:
   - nouveau endpoint `netlify/functions/officine-matrix-monitor.js`,
   - execution planifiee quotidienne (07:00 UTC) + mode manuel GET/POST,
   - webhook d alerte optionnel et `fail_on_alert` pour integration CI/ops.
103. Couverture tests monitoring ajoutee:
   - tests unitaires du monitor (ok, stale alert, mode tolerant non-ready),
   - tests de livraison webhook (skip sans URL, skip en etat ok, envoi en etat alert).
104. Branchement ops monitor generalise (incident endpoint + Slack) implemente:
   - ajout `delivery_mode` (`signed_webhook` ou `slack`) sur `officine-matrix-monitor`,
   - support des variables `OFFICINE_MATRIX_MONITOR_DELIVERY_MODE`, `OFFICINE_MATRIX_MONITOR_SLACK_WEBHOOK_URL`,
   - support des overrides manuels GET/POST (`delivery_mode`, `webhook_url`, `ops_environment`, `dashboard_url`, `runbook_url`).
105. Packaging alerte Slack production-ready livre:
   - formatage message monitor (status, raisons, compteurs stale/missing, readiness),
   - livraison Slack resiliente (retry backoff, timeout, statut de tentative),
   - tests unitaires ajoutes (payload Slack + routage `deliverOfficineMatrixMonitorAlert` en mode `slack`).
106. Runbook d escalade officine matrix publie:
   - nouveau document `_bmad-output/brainstorming/officine-matrix-monitor-runbook-2026-02-26.md`,
   - severites SEV-1/SEV-2, procedure T0/T+15/T+60, commandes de verification,
   - criteres de resolution et post-mortem minimal obligatoire.
107. Telemetrie dual-write primaire enrichie:
   - journalisation persistante des evenements de replication dual dans sqlite (`feedback_replication_events`),
   - snapshot fenetre glissante expose par `inspectPrimaryStore` (`total/synced/degraded/disabled`, rates, dernier degrade).
108. Readiness de bascule dual -> managee operationnalisee:
   - nouveau module `betaFeedbackDualPilot` (statuts `insufficient_data` / `not_ready` / `ready`),
   - seuils explicites (`min_events`, `min_synced_rate`, `max_degraded_rate`, `max_disabled_rate`).
109. Endpoint readiness dedie livre:
   - nouveau endpoint `netlify/functions/beta-feedback-dual-readiness.js`,
   - support GET/POST + `fail_on_not_ready` (retour 503 optionnel pour CI/ops).
110. Reporting unifie enrichi:
   - `beta-feedback-report` intègre `dual_pilot_readiness` quand mode primaire = `dual`,
   - prise en charge de `dual_window_days`.
111. Couverture tests dual-pilot etendue:
   - tests `betaFeedbackDualPilot` ajoutes (insufficient_data, ready, not_ready),
   - tests `betaFeedbackPrimaryStore` ajoutes pour snapshot replication dual et journalisation event.
112. Runbook pilote dual publie:
   - nouveau document `_bmad-output/brainstorming/beta-feedback-dual-pilot-runbook-2026-02-26.md`,
   - prerequis, seuils, routine quotidienne, regles de decision, bascule et rollback.
113. Moteur pneumocoque affine (granularite produit/date):
   - sequencage deterministe simplifie selon historique commercial:
     - conjugue large couverture detecte (Prevenar20/Capvaxive) => schema considere couvert,
     - conjugue seul => complement PPSV23 (due now ou planifie >=8 semaines),
     - PPSV23 seul => rattrapage conjugue (due now ou planifie >=1 an),
   - conservation des limites explicites (strategie simplifiee).
114. Couverture tests pneumocoque etendue:
   - nouveaux tests `rulesEngine` pour cas frontiere produit/date (Prevenar20, Prevenar13 recent/ancien, Pneumovax ancien),
   - nouveaux tests pipeline lot/reglementaire pour eviter les actions redondantes et verrouiller le scheduling complementaire.
115. Telemetrie qualite collecte enrichie (beta feedback):
   - agregats feedback etendus avec:
     - `required_core_completion_rate`,
     - `quick_history_usage_rate`,
     - `avg_quick_history_entries_count`,
     - `timed_submission_rate`,
   - objectif: piloter la qualite donnees reelles en lot et l adoption du mode entree rapide.
116. Couverture tests reporting qualite renforcee:
   - tests `betaFeedback` mis a jour pour verifier les nouveaux KPI de collecte,
   - test `betaFeedbackReport` enrichi avec assert des metriques de qualite en fenetre.
117. Snapshot dual fenetre corrige (borne temporelle stricte):
   - `inspectPrimaryStore` borne maintenant `dual_replication` entre `window_start_iso` et `now_iso`,
   - evite la contamination des fenetres precedentes par des evenements futurs.
118. Gate canary dual->http formalise:
   - nouveau module `evaluateDualPilotCanaryGate` avec statuts:
     - `ready`,
     - `blocked_not_ready`,
     - `blocked_insufficient_data`,
     - `insufficient_data` (fenetres insuffisantes).
119. Endpoint canary dedie livre:
   - nouveau endpoint `netlify/functions/beta-feedback-dual-canary-gate.js`,
   - evaluation de N fenetres consecutives (defaut 2) avec option `fail_on_blocked` (503),
   - options GET/POST:
     - `window_days`,
     - `required_windows`,
     - seuils readiness (`min_events`, `min_synced_rate`, `max_degraded_rate`, `max_disabled_rate`).
120. Reporting unifie etendu avec gate canary:
   - `beta-feedback-report` expose `dual_canary_gate` en mode `dual`,
   - support `dual_canary_required_windows` (query/body/env) pour aligner la decision canary.
121. Couverture tests canary et borne fenetre ajoutee:
   - tests unitaires `betaFeedbackDualPilot` pour la decision gate,
   - test endpoint `betaFeedbackDualCanaryGateFunction`,
   - test `betaFeedbackPrimaryStore` pour verification de la borne `now_iso`.
122. Kit de drill SEV-1 simule livre (officine monitor):
   - nouvel endpoint `netlify/functions/ops-drill-receiver.js` (preuve reception GET/POST/DELETE),
   - stockage NDJSON local configurable (`OPS_DRILL_RECEIVER_STORE_PATH`).
123. Script d execution drill automatise:
   - `scripts/run-officine-sev1-drill.mjs`,
   - commande `npm run drill:officine:sev1`,
   - generation automatique d un artefact de preuve JSON dans `_bmad-output/brainstorming`.
124. Validation drill locale executee:
   - execution reussie `npm run drill:officine:sev1`,
   - preuve generee: `_bmad-output/brainstorming/ops-sev1-drill-proof-20260226_225500339Z.json`,
   - reception verifiee (`receipts=1`).
125. Couverture tests ops drill ajoutee:
   - tests endpoint `opsDrillReceiver` (stockage, lecture, suppression par `drill_id`),
   - regression complete remain green.
126. Couverture tests endpoint report dual etendue:
   - nouveau test `betaFeedbackReportFunction` pour `dual_pilot_readiness` + `dual_canary_gate`,
   - verification du cas `blocked_insufficient_data` sur fenetre precedente.
127. Script de decision dual/canary ajoute:
   - `scripts/run-dual-pilot-decision.mjs`,
   - commande `npm run ops:dual:decision`,
   - consolidation des reponses `dual-readiness` + `dual-canary-gate` avec recommandation.
128. Preuve decision locale generee:
   - artefact `_bmad-output/brainstorming/dual-pilot-decision-proof-20260226_225740118Z.json`,
   - statut attendu local actuel: `not_applicable_or_unavailable` (mode primaire != dual).
129. Moteur Covid-19 affine (intervalle temporel explicite):
   - rappel prioritaire conditionne par un intervalle minimal simplifie de 6 mois depuis la derniere dose datee,
   - generation `action_next` planifiee quand intervalle non atteint,
   - maintien d un mode fail-safe actionnable si dose historique non datee.
130. Couverture tests Covid-19 etendue:
   - tests `rulesEngine` ajoutes pour:
     - scheduling rappel (<6 mois),
     - due now a la borne exacte (6 mois),
     - historique non date avec limitation explicite.
131. Couverture pipeline batch/reference alignee:
   - `pipelineBatchQuality` enrichi (cas profil prioritaire avec rappel planifie),
   - `pipelineReferenceCases` ajuste pour conserver le cas rappel Covid-19 `now` sur date compatible.
132. Moteur dTcaPolio affine hors jalons:
   - suppression du blocage automatique des profils avec historique date hors jalons,
   - evaluation du rappel sur intervalle minimal simplifie de 10 ans meme hors jalon d age,
   - maintien des limites explicites (jalons non modelises finement, mode prudent si date manquante).
133. Couverture tests dTcaPolio etendue:
   - nouveaux tests `rulesEngine` pour cas hors jalon:
     - due now (intervalle >=10 ans),
     - planifie `action_next` (intervalle <10 ans).
134. Jeu de reference pipeline complete:
   - ajout d un cas de reference end-to-end dTcaPolio hors jalon (age non jalon + historique date),
   - verification de sortie actionnable et limitation explicite "hors jalon age".
135. Extension jeu de reference pipeline (multi-produits):
   - ajout d un cas pneumocoque PCV+PPSV (Prevenar13 + Pneumovax) sans action redondante,
   - verification limitation explicite "sequence conjugue + polysaccharidique detectee".
136. Extension jeu de reference pipeline (frontieres reglementaires):
   - ajout d un cas profil <11 ans + immunodepression avec mix de statuts officine:
     - Covid-19 conserve `allowed` (>=5 ans),
     - ROR/HepB/Pneumocoque forces `not_allowed` (age/restriction).
137. Couverture unitaire pneumocoque frontiere temporelle:
   - ajout d un test `rulesEngine` PPSV23 recent (historique seul) qui planifie le rattrapage conjugue (`action_next`, >=1 an).
138. Affinage moteur Covid-19 (profil grossesse):
   - inclusion de la grossesse (`pregnancy_status=oui`) dans le profil prioritaire simplifie,
   - maintien du meme schema temporel simplifie (intervalle minimal 6 mois) pour due/schedule.
139. Couverture tests Covid-19 grossesse etendue:
   - tests `rulesEngine` ajoutes pour grossesse:
     - scheduling rappel (<6 mois),
     - due now a la borne exacte (6 mois).
140. Jeu de reference pipeline enrichi (Covid grossesse):
   - ajout d un cas end-to-end grossesse avec rappel Covid-19 planifie et statut officine `allowed`.
141. Harmonisation facteurs de risque moteurs (cancer_en_cours):
   - ajout de `risk_flags.cancer_en_cours` dans la cartographie des profils a risque des moteurs:
     - Pneumocoque, HepB, Covid-19, Meningocoques ACWY/B.
   - extension Zona: eligibilite risque >=18 ans alignee sur `immunodepression` ou `cancer_en_cours`.
142. Traçabilite hypotheses renforcee:
   - ajout de l hypothese explicite `cancer_en_cours non renseigne = false` dans `hypotheses_assumed`.
143. Couverture tests cancer etendue:
   - tests `rulesEngine` ajoutes pour:
     - Pneumocoque (age <65 + cancer),
     - HepB (hors tranche age + cancer),
     - Covid-19 (rappel planifie + cancer),
     - Zona (profil cancer >=18),
     - Meningocoque ACWY (hors tranche age + cancer),
   - test `pipelineReferenceCases` ajoute (plan risque base cancer avec Pneumocoque now + Covid next).
144. Safety guardrail cancer explicite ajoute:
   - nouveau guardrail `SAFE-CANCER-001` dans `safety-rules.v1.json`,
   - `applySafetyGuardrails` ajoute une precaution dediee "Cancer en cours",
   - limitation explicite de verification clinique manuelle.
145. Meningocoque B (historique non date) garde une sortie actionnable:
   - `evaluateMeningococcalBRule` ajoute une action `now` (RULE-MEN-B-CORE-004) au lieu d un blocage passif,
   - maintien d une limitation explicite de verification de date precedente,
   - statut global conserve en fail-safe (`needs_more_info`) quand historique incomplet.
146. Stabilisation regressions pipeline reference:
   - alignement des assertions `decision_status` sur le comportement reel (`ready` vs `needs_more_info`) dans `pipelineReferenceCases.test.mjs`,
   - suite complete repassee au vert (`npm test`: 171/171).
147. Couverture pipeline reference etendue (HepB dedup):
   - ajout d un cas end-to-end "duplicate same-day HepB entries" dans `pipelineReferenceCases`,
   - verification que la deduplication garde un flux actionnable HepB (`action_now`) et un `decision_status=ready`,
   - regression complete validee apres ajout (`npm test`: 172/172).
148. Couverture pipeline reference etendue (frontiere age Covid officine):
   - ajout de 2 cas end-to-end dans `pipelineReferenceCases`:
     - age 5 ans: recommandation Covid presente avec statut officine `allowed`,
     - age 4 ans: absence de recommandation Covid avec maintien des restrictions officine sur ROR.
   - verification explicite des limitations reglementaires associees (mentions `Age 5 ans` / `Age 4 ans`),
   - regression complete validee apres ajout (`npm test`: 174/174).
149. Couverture pipeline reference etendue (scenario multi-produits complexe):
   - ajout d un cas end-to-end "multi-product mixed history" dans `pipelineReferenceCases`,
   - validation d un plan coherent multi-domaines (HPV, HepB, ROR, Meningocoques ACWY/B) avec `action_now` et `action_next`,
   - verification absence de bruit "Produits non reconnus" sur historique 100% mappe,
   - regression complete validee apres ajout (`npm test`: 175/175).
150. Couverture pipeline reference etendue (scenario multi-produits bruite fail-safe):
   - ajout d un cas end-to-end "noisy multi-product history" dans `pipelineReferenceCases`,
   - validation du mode prudent `needs_more_info` avec maintien d actions utiles (`action_now` presente),
   - verification explicite des drapeaux de securite:
     - precaution "Produits non reconnus",
     - precaution "Historique vaccinal incomplet",
     - restriction officine ROR en immunodepression (`not_allowed`).
   - regression complete validee apres ajout (`npm test`: 176/176).
151. Couverture pipeline reference etendue (pneumocoque couvert + bruit mappe):
   - ajout d un cas end-to-end "pneumococcal covered sequence with unknown product" dans `pipelineReferenceCases`,
   - validation de non-regression pneumocoque:
     - aucune action Pneumocoque redondante (schema considere couvert),
     - conservation d un plan actionnable sur autres domaines,
     - mode prudent maintenu (`needs_more_info`) en presence de produit inconnu.
   - verification explicite:
     - precaution "Produits non reconnus",
     - limitation de mapping inconnu,
     - limitation "dose conjuguee large couverture detectee".
   - regression complete validee apres ajout (`npm test`: 177/177).
152. ROR (historique non date) garde une sortie actionnable:
   - `evaluateRorRule` produit maintenant une action `now` (RULE-ROR-CORE-004) au lieu d un blocage passif,
   - maintien d un statut prudent (`needs_more_info`) avec verification manuelle explicite,
   - couverture tests ajoutee:
     - unit test `rulesEngine` pour 1 dose ROR non datee,
     - test de reference pipeline end-to-end "undated ROR history stays actionable in fail-safe mode",
   - regression complete validee apres ajout (`npm test`: 181/181).
153. Zona (historique non date) garde une sortie actionnable:
   - `evaluateZonaRule` produit maintenant une action `now` (RULE-ZONA-CORE-004) au lieu d une planification sans date exploitable,
   - maintien d un statut prudent (`needs_more_info`) avec verification manuelle explicite,
   - couverture tests ajoutee:
     - unit test `rulesEngine` pour 1 dose Zona non datee,
     - test de reference pipeline end-to-end "undated Zona history stays actionable in fail-safe mode",
   - regression complete validee apres ajout (`npm test`: 183/183).
154. Couverture pipeline reference etendue (frontiere age officine 11 ans):
   - ajout d un cas end-to-end "age 11 boundary unlocks officine eligibility for ROR and HepB" dans `pipelineReferenceCases`,
   - verification explicite:
     - recommandations `ROR` / `HepB` / `Covid-19` presentes,
     - statuts officine `allowed` a 11 ans,
     - absence de limitation reglementaire "Actes non autorises en officine ... Age 11 ans".
   - regression complete validee apres ajout (`npm test`: 184/184).
155. Couverture pipeline reference etendue (frontieres age meningocoques 24/25 ans):
   - ajout de 2 cas end-to-end dans `pipelineReferenceCases`:
     - age 24 ans: rattrapage `Meningocoque ACWY` + `Meningocoque B` actif et statuts officine `allowed`,
     - age 25 ans sans risque: absence de rattrapage meningo (hors perimetre age simplifie).
   - verification explicite des limitations metier hors perimetre:
     - "Meningocoque ACWY: non declenche sans age 11-24 ...",
     - "Meningocoque B: non declenche sans age 15-24 ...".
   - regression complete validee apres ajout (`npm test`: 186/186).
156. Couverture risque meningo hors tranche age consolidee:
   - ajout d un test unitaire moteur `rulesEngine`:
     - age 40 + `cancer_en_cours=true` declenche bien `Meningocoque B` (RULE-MEN-B-CORE-001 + RULE-MEN-B-CORE-002),
     - confirme l activation du chemin "facteur de risque" hors borne age simplifiee.
   - ajout d un cas end-to-end `pipelineReferenceCases`:
     - age 25 + `cancer_en_cours=true` reactive `Meningocoque ACWY` + `Meningocoque B`,
     - statuts officine verifies en `allowed`.
   - regression complete validee apres ajout (`npm test`: 188/188).
157. Couverture frontiere officine meningo <11 ans consolidee:
   - ajout d un cas end-to-end `pipelineReferenceCases`:
     - age 10 + `cancer_en_cours=true` conserve les recommandations cliniques `Meningocoque ACWY/B`,
     - matrice officine force `not_allowed` sur `action_now` et `action_next` (Meningocoque B),
     - verification explicite des conditions appliquees "Age 10 ans < seuil minimal officine 11 ans".
   - regression complete validee apres ajout (`npm test`: 189/189).
158. ACWY non date bascule en sortie actionnable (fail-safe):
   - moteur `rulesEngine` ajuste:
     - un historique `Meningocoque ACWY` uniquement non date ne ferme plus le schema passivement,
     - generation d une action `now` `RULE-MEN-ACWY-CORE-002` + limitation de verification manuelle.
   - couverture tests ajoutee:
     - test unitaire `rulesEngine` "Meningococcal ACWY with undated prior dose remains actionable with manual verification",
    - test end-to-end `pipelineReferenceCases` a 11 ans:
      - sortie `needs_more_info`,
      - action ACWY presente et `officine_administration_status=allowed`,
      - caution "Historique vaccinal incomplet".
   - regression complete validee apres ajout (`npm test`: 191/191).
159. Runtime Node aligne en ESM explicite:
   - ajout du champ `"type": "module"` dans `package.json` pour supprimer le mode de reparsing automatique Node (`MODULE_TYPELESS_PACKAGE_JSON`),
   - verification non-regression complete:
     - suite tests passe (`npm test`: 191/191),
     - warnings de typage module supprimes (hors avertissements SQLite experimentaux attendus).
160. VRS non date bascule en sortie fail-safe actionnable:
   - moteur `rulesEngine` ajuste (`evaluateVrsRule`):
     - un historique `VRS` non date ne ferme plus automatiquement le schema en "couvert",
     - pour les profils eligibles (senior/grossesse), generation d une action `now` de verification documentaire (`RULE-VRS-CORE-003`),
     - hors profil prioritaire, maintien d une sortie prudente sans auto-validation du schema.
   - couverture tests ajoutee:
     - tests unitaires `rulesEngine`:
       - "VRS with undated prior dose in eligible profile stays actionable with manual verification",
       - "VRS with undated prior dose outside eligible profile does not auto-close schema",
     - test end-to-end `pipelineReferenceCases`:
       - "undated VRS history stays actionable in fail-safe mode for eligible senior",
       - verification `decision_status=needs_more_info`, `officine_administration_status=allowed`, et caution "Historique vaccinal incomplet".
   - verification non-regression complete:
     - suite tests passe (`npm test`: 196/196).
161. Doses futures exclues du calcul de schema (sans masquer l incoherence):
   - moteur `rulesEngine` ajuste:
     - ajout d un filtrage `resolvedHistoryForDosing` qui exclut les entrees datees dans le futur du calcul dose/intervalle,
     - conservation des controles de securite/traçabilite sur historique brut (`date(s) futures` toujours remontees en limitations/cautions, `decision_status=needs_more_info` conserve).
   - impact clinique attendu:
     - un vaccin date dans le futur n est plus compte comme "deja administre",
     - le plan reste actionnable sur les donnees effectivement administrées.
   - couverture tests renforcee:
     - test unitaire `rulesEngine` "Future-dated resolved history marks decision as needs_more_info" complete avec verification d une action `ROR` `RULE-ROR-CORE-001`,
     - test end-to-end `pipelineReferenceCases` "future-dated history entry triggers needs_more_info and caution" complete avec verification d une action `ROR` officine `allowed`.
   - verification non-regression complete:
     - suite tests passe (`npm test`: 196/196).
162. Traçabilite explicite du mode prudent sur dates futures + extension de couverture HepB:
   - moteur `rulesEngine` complete:
     - ajout d une limitation explicite: "les doses datees dans le futur sont exclues du calcul de schema jusqu a verification",
     - comportement conserve: sortie fail-safe (`needs_more_info`) + incoherence historique remontee.
   - couverture tests renforcee:
     - test unitaire `rulesEngine`:
       - enrichissement du cas futur existant avec verification de la limitation explicite "exclues du calcul de schema",
       - nouveau cas "Future-dated HepB entry is ignored for dosing logic and keeps initiation actionable":
         - verification que `RULE-HEPB-CORE-001` (initiation) est bien genere,
         - verification absence de faux positif `RULE-HEPB-CORE-004` (dose 2 basee sur date future).
     - test end-to-end `pipelineReferenceCases`:
       - enrichissement du cas futur ROR avec verification de la limitation explicite,
       - nouveau cas "future-dated HepB history keeps fail-safe status but does not block initiation plan":
         - `decision_status=needs_more_info`,
         - action HepB now `allowed`,
         - caution "Historique vaccinal incoherent".
   - verification non-regression complete:
     - suite tests passe (`npm test`: 198/198).
163. Extension frontieres reglementaires officine (dTcaPolio/VRS) dans les cas de reference:
   - couverture `pipelineReferenceCases` renforcee:
     - `dTcaPolio` age 45: verification explicite du statut officine `allowed`,
     - nouveau cas `dTcaPolio` age 10 avec rappel du:
       - maintien de la recommandation clinique,
       - application matrice officine `not_allowed`,
       - limitation reglementaire explicite "Age 10 ans < seuil minimal officine 11 ans".
     - nouveau cas `VRS` voie grossesse (profil adulte):
       - verification `RULE-VRS-CORE-001`,
       - verification statut officine `allowed`.
   - objectif produit:
     - securiser les frontieres "recommandation clinique" vs "administrabilite officine" sur des domaines pas encore asserts en bout de pipeline.
   - verification non-regression complete:
     - suite tests passe (`npm test`: 200/200).
164. Pneumocoque large couverture non date: bascule fail-safe actionnable:
   - moteur `rulesEngine` ajuste (`evaluatePneumococcalRule`):
     - une dose `PCV20/Capvaxive` detectee sans date ne clot plus automatiquement le schema,
     - generation d une action `now` de verification documentaire (`RULE-PNEUMO-CORE-006`),
     - maintien d une limitation explicite de verification manuelle avant conclusion "schema couvert".
   - couverture tests renforcee:
     - test unitaire `rulesEngine`:
       - "Pneumococcal history with undated Prevenar20 stays actionable with manual verification",
       - verification `decision_status=needs_more_info` + action `RULE-PNEUMO-CORE-006`.
     - test end-to-end `pipelineReferenceCases`:
       - "undated broad-coverage pneumococcal dose stays actionable in fail-safe mode",
       - verification `officine_administration_status=allowed`,
       - verification caution "Historique vaccinal incomplet".
   - verification non-regression complete:
     - suite tests passe (`npm test`: 202/202).

165. Meningocoque B non date hors age/risque: sortie verification-only:
   - moteur `rulesEngine` ajuste (`evaluateMeningococcalBRule`):
     - lorsqu une dose `Meningocoque B` existe sans date exploitable ET que le profil est hors perimetre age (15-24) et hors facteurs de risque,
     - le moteur ne propose plus directement "dose 2" (`RULE-MEN-B-CORE-004`) et bascule vers une action de verification documentaire (`RULE-MEN-B-CORE-005`),
     - limitation explicite ajoutee pour imposer verification manuelle avant toute recommandation de rattrapage.
   - couverture tests renforcee:
     - test unitaire `rulesEngine`:
       - "Meningococcal B with undated prior dose outside age/risk scope triggers verification action",
       - verification `decision_status=needs_more_info` + `rule_id=RULE-MEN-B-CORE-005`.
     - test end-to-end `pipelineReferenceCases`:
       - "meningococcal B undated history outside age/risk scope triggers verification-only action",
       - verification `officine_administration_status=allowed`,
       - verification caution "Historique vaccinal incomplet".
   - verification non-regression complete:
     - suite tests passe (`npm test`: 204/204).

Reste prioritaire:
1. Configurer les secrets/URLs Ops reels par environnement et executer le meme drill sur endpoint incident reel (preuve de reception hors local).
2. Basculer environnement beta en `mode=dual`, collecter trafic reel puis executer `npm run ops:dual:decision` avec gate `ready` sur 2 fenetres avant canary `mode=http`.
3. Continuer l extension du jeu de reference pipeline (sequences multi-produits complexes supplementaires et cas frontiere reglementaires restants).
4. Etendre et affiner le moteur deterministe sur les domaines encore simplifies (rappels, fenetres cliniques, exceptions reglementaires fines).
