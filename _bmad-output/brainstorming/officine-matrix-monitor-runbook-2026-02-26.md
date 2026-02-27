# VaccinAct - Runbook d escalade monitor officine matrix

Date: 2026-02-26
Owner: Produit + Tech (VaccinAct)
Scope: `/.netlify/functions/officine-matrix-monitor`

## 1. Objectif

Assurer une reaction operationnelle rapide si la matrice reglementaire officine devient:
1. stale (sources a reverifier),
2. incoherente (references manquantes),
3. non prete pour validation reglementaire.

## 2. Cibles d alerte supportees

1. `signed_webhook` (endpoint incident interne):
   - payload JSON signe (`X-VaccinAct-Signature`).
2. `slack` (incoming webhook):
   - message formatte avec status, causes, compteurs, liens dashboard/runbook.

## 3. Configuration environnement

Variables minimales:
1. `OFFICINE_MATRIX_MONITOR_SEND_WEBHOOK=true`
2. `OFFICINE_MATRIX_MONITOR_DELIVERY_MODE=signed_webhook|slack`
3. `OFFICINE_MATRIX_MONITOR_WEBHOOK_URL=<incident-endpoint>`
4. `OFFICINE_MATRIX_MONITOR_SLACK_WEBHOOK_URL=<slack-incoming-webhook>` (si mode `slack`)
5. `OFFICINE_MATRIX_MONITOR_MAX_SOURCE_AGE_DAYS=180`
6. `OFFICINE_MATRIX_MONITOR_STALE_SOURCE_ALERT_THRESHOLD=0`
7. `OFFICINE_MATRIX_MONITOR_REQUIRE_READY_FOR_REGULATORY_SIGNOFF=true`
8. `OFFICINE_MATRIX_MONITOR_OPS_ENVIRONMENT=prod`
9. `OFFICINE_MATRIX_MONITOR_DASHBOARD_URL=<url-dashboard>`
10. `OFFICINE_MATRIX_MONITOR_RUNBOOK_URL=<url-runbook>`

Options:
1. `OFFICINE_MATRIX_MONITOR_FAIL_ON_ALERT=true` pour integration CI/CD bloquante.
2. `OFFICINE_MATRIX_MONITOR_SEND_WEBHOOK_ON_OK=false` pour limiter le bruit.

## 4. Niveaux de severite

SEV-1:
1. `ready_for_regulatory_signoff=false`
2. ou `missing_source_catalog_refs_count > 0`
3. ou `confirmed_entries_without_confirmed_reference_count > 0`

SEV-2:
1. `stale_source_references_count > stale_source_alert_threshold`
2. ou `entries_missing_references_count > 0`

SEV-3:
1. Alerte transitoire resolue au run suivant sans action manuelle.

## 5. Procedure d intervention

T0 (reception alerte):
1. Ouvrir la reponse monitor (payload ou endpoint audit).
2. Identifier la/les raisons (`alert_reasons`).

T0 + 15 min:
1. Qualifier severite (SEV-1/2/3).
2. Assigner owner (Reglementaire/Tech).
3. Ouvrir ticket incident avec horodatage et evidences.

T0 + 60 min:
1. Corriger la matrice/sources (references manquantes, dates de verification, statut source).
2. Commit + review + deploy.
3. Relancer verification manuelle:
   - `GET /.netlify/functions/officine-matrix-monitor?send_webhook=0`
   - puis `GET /.netlify/functions/officine-matrix-audit`

Resolution:
1. `monitor.status=ok`
2. `ready_for_regulatory_signoff=true`
3. pas de stale au-dessus du seuil.

## 6. Commandes de verification

Smoke monitor:
1. `curl -sS "http://localhost:8888/.netlify/functions/officine-matrix-monitor?send_webhook=0"`

Simulation stale:
1. `curl -sS "http://localhost:8888/.netlify/functions/officine-matrix-monitor?send_webhook=0&now_iso=2027-12-31T00:00:00.000Z&max_source_age_days=30"`

Drill SEV-1 simule avec preuve:
1. `npm run drill:officine:sev1`
2. Artefact JSON attendu:
   - `_bmad-output/brainstorming/ops-sev1-drill-proof-<timestamp>.json`
3. Endpoint de preuve (receiver):
   - `/.netlify/functions/ops-drill-receiver`
   - `GET ?drill_id=<id>` pour verifier la reception.

## 7. Escalade

1. SEV-1 > 1h non resolu -> escalation fondateur + responsable reglementaire.
2. SEV-1 > 4h non resolu -> gel des evolutions non critiques + focus correction.
3. SEV-2 > 24h non resolu -> conversion en priorite sprint immediate.

## 8. Post-mortem minimal (obligatoire)

1. Cause racine.
2. Impact produit.
3. Action corrective immediate.
4. Action preventive (test/monitor/process).
5. Date de prochaine reverification.
