# VaccinAct - Runbook pilote dual primary store

Date: 2026-02-26
Scope: `beta-feedback`, `beta-feedback-report`, `beta-feedback-dual-readiness`, `beta-feedback-dual-canary-gate`

## 1. Objectif

Determiner de facon mesurable quand basculer de `mode=dual` vers `mode=http` pour le primary store KPI.

## 2. Prerequis de configuration

1. `BETA_FEEDBACK_PRIMARY_STORE_MODE=dual`
2. `BETA_FEEDBACK_PRIMARY_STORE_SQLITE_PATH=<path-local>`
3. `BETA_FEEDBACK_PRIMARY_STORE_URL=<endpoint-manage>`
4. `BETA_FEEDBACK_PRIMARY_STORE_SECRET=<secret>`
5. `BETA_FEEDBACK_PRIMARY_STORE_DUAL_WRITE_STRICT=false` (pilotage initial)

Seuils readiness recommandes:
1. `BETA_FEEDBACK_DUAL_PILOT_WINDOW_DAYS=7`
2. `BETA_FEEDBACK_DUAL_PILOT_MIN_EVENTS=40`
3. `BETA_FEEDBACK_DUAL_PILOT_MIN_SYNCED_RATE=0.98`
4. `BETA_FEEDBACK_DUAL_PILOT_MAX_DEGRADED_RATE=0.02`
5. `BETA_FEEDBACK_DUAL_PILOT_MAX_DISABLED_RATE=0`

Gate canary recommande:
1. `BETA_FEEDBACK_DUAL_CANARY_REQUIRED_WINDOWS=2`
2. `BETA_FEEDBACK_DUAL_CANARY_FAIL_ON_BLOCKED=true` (en CI/ops)

Decision automatique (preuve):
1. `npm run ops:dual:decision`
2. Artefact JSON attendu:
   - `_bmad-output/brainstorming/dual-pilot-decision-proof-<timestamp>.json`

## 3. Verification quotidienne

1. `GET /.netlify/functions/beta-feedback-dual-readiness`
2. Verifier:
   - `readiness.status`,
   - `readiness.metrics.total_events`,
   - `readiness.metrics.synced_rate`,
   - `readiness.metrics.degraded_rate`,
   - `readiness.metrics.last_degraded_event`.

## 4. Regles de decision

`insufficient_data`:
1. Continuer en dual.
2. Ne pas basculer.

`not_ready`:
1. Continuer en dual.
2. Investiguer la cause `last_degraded_event`.
3. Ouvrir incident si `degraded_rate` > seuil 2 jours consecutifs.

`ready`:
1. Confirmer 2 fenetres consecutives `ready` via `GET /.netlify/functions/beta-feedback-dual-canary-gate`.
2. Activer un canary `mode=http` sur environnement non critique.
3. Si stable 24h, planifier bascule production.

Commande decision canary:
1. `GET /.netlify/functions/beta-feedback-dual-canary-gate?required_windows=2&fail_on_blocked=1`
2. Verifier:
   - `gate.status=ready`,
   - `gate.canary_allowed=true`,
   - `windows[*].readiness.status=ready`.
3. Option script:
   - `DUAL_PILOT_DECISION_FAIL_ON_BLOCKED=1 npm run ops:dual:decision`

## 5. Bascule production

1. Switch:
   - `BETA_FEEDBACK_PRIMARY_STORE_MODE=http`
2. Garder sqlite en backup passif pendant 7 jours:
   - ne pas supprimer DB locale.
3. Surveiller:
   - volume ingestion,
   - taux erreurs HTTP,
   - go/no-go report.

## 6. Rollback

Conditions rollback:
1. erreurs replication/ingestion critiques,
2. perte de lots,
3. indisponibilite endpoint manage.

Action rollback:
1. remettre `BETA_FEEDBACK_PRIMARY_STORE_MODE=dual`,
2. valider reprise ingestion sur sqlite,
3. lancer replay des batches manquants.
