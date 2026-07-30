# eGS — API backend

Petit serveur qui stocke réellement, dans une base **SQLite** (fichier `data/egs.db`),
les inscriptions, les abonnements aux alertes et les rendez-vous de téléconsultation
du site eGS. Utilise les modules natifs de Node.js (`node:http`, `node:sqlite`) plus
**nodemailer** pour l'envoi d'e-mails d'alerte.

## Prérequis

- **Node.js 22.5 ou plus récent** (pour `node:sqlite`). Vérifie avec `node --version`.

## Installer et démarrer en local

```bash
cd server
npm install
cp .env.example .env   # puis remplis ADMIN_API_KEY (et SMTP_* si tu veux tester les e-mails)
node server.js
```

Tu devrais voir : `eGS API en écoute sur http://localhost:3001`.
La base `data/egs.db` est créée automatiquement au premier lancement.

## Utiliser le site avec ce backend

Les pages `inscription.html`, `assistance.html` et `teleconsultation.html`
appellent l'API sur `http://localhost:3001` par défaut. Lance le serveur
(`node server.js`) pendant que tu navigues sur le site : les inscriptions,
abonnements et rendez-vous seront réellement enregistrés dans `data/egs.db`.

## Authentification (routes admin)

Les routes qui exposent des listes complètes (données de tous les utilisateurs)
ou permettent de supprimer des données exigent un en-tête `x-api-key` égal à
la variable d'environnement `ADMIN_API_KEY`. Sans cette variable définie côté
serveur, ces routes répondent `503` (désactivées) plutôt que d'être ouvertes
par défaut.

```bash
curl -H "x-api-key: $ADMIN_API_KEY" https://ton-api.onrender.com/api/inscriptions
```

Les routes de création (`POST /api/inscriptions`, `POST /api/abonnements`,
`POST /api/rendezvous`) restent publiques — n'importe quel visiteur doit
pouvoir s'inscrire. `GET /api/abonnements?contact=...` reste public aussi
(un visiteur peut vérifier ses propres abonnements en connaissant son contact),
mais lister *tous* les abonnements sans filtre exige la clé admin.

## Endpoints disponibles

| Méthode | Route                          | Accès   | Description                              |
|---------|----------------------------------|---------|-------------------------------------------|
| GET     | `/api/health`                   | public  | Vérifie que l'API répond                  |
| POST    | `/api/inscriptions`             | public  | Crée un profil utilisateur                |
| GET     | `/api/inscriptions`             | admin   | Liste tous les profils                    |
| POST    | `/api/abonnements`               | public  | Crée un abonnement aux alertes d'une ville|
| GET     | `/api/abonnements?contact=`     | public  | Liste les abonnements d'un contact précis |
| GET     | `/api/abonnements`               | admin   | Liste tous les abonnements                |
| DELETE  | `/api/abonnements/:id`          | admin   | Supprime un abonnement                    |
| POST    | `/api/rendezvous`                | public  | Crée un rendez-vous de téléconsultation   |
| GET     | `/api/rendezvous`                | admin   | Liste tous les rendez-vous                |
| DELETE  | `/api/rendezvous/:id`           | admin   | Supprime un rendez-vous                   |
| POST    | `/api/tasks/check-alertes`      | admin   | Calcule le risque de chaque ville et envoie les alertes dues |

## Alertes réelles par e-mail

`lib/climate.js` recalcule côté serveur le même indice de risque que la page
« Alertes » (données NASA POWER). `lib/notify.js` compare cet indice au seuil
de risque élevé (66/100) ; si une ville dépasse ce seuil et n'a pas déjà été
notifiée dans les `ALERT_COOLDOWN_DAYS` derniers jours (3 par défaut), un
e-mail est envoyé à chaque abonné de cette ville dont le contact est une
adresse e-mail (`lib/mailer.js`, via SMTP configurable — Gmail avec mot de
passe d'application, Brevo, Mailtrap, etc.). Les contacts qui sont des numéros
de téléphone sont ignorés pour l'instant : il n'y a pas encore de canal SMS
branché (à ajouter dans `lib/mailer.js` si besoin, ex. Twilio).

Sans `SMTP_HOST` configuré, l'envoi est simulé (journalisé en console) —
pratique pour tester en local sans vrai compte SMTP.

**Déclencher la vérification :**
- Manuellement : `curl -X POST -H "x-api-key: $ADMIN_API_KEY" http://localhost:3001/api/tasks/check-alertes`
- Automatiquement en local/sur un plan payant : mets `ENABLE_INTERNAL_SCHEDULER=true`
  (vérifie toutes les `SCHEDULER_INTERVAL_HOURS` heures, 6 par défaut).
- En production sur le plan gratuit Render (le service s'endort, et les Cron
  Jobs Render ne sont plus disponibles en gratuit depuis 2026) : un GitHub
  Action gratuit s'en charge — voir `.github/workflows/check-alertes.yml` et
  la section déploiement ci-dessous.

## Déployer sur Render

Un blueprint `render.yaml` (à la racine du dépôt, au-dessus de `server/`)
définit le service web `egs-api` (l'API elle-même).

Étapes :

1. Pousse ce dépôt (avec `render.yaml` à la racine) sur GitHub/GitLab.
2. Sur [render.com](https://render.com) : **New → Blueprint**, connecte le dépôt.
3. Render crée le service `egs-api`. `ADMIN_API_KEY` est générée
   automatiquement — récupère sa valeur dans le dashboard Render
   (Environment).
4. Renseigne aussi `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `ALERT_FROM_EMAIL`
   sur `egs-api` si tu veux de vrais envois d'e-mails.
5. Une fois `egs-api` déployé, mets à jour `ALLOWED_ORIGIN` avec l'URL réelle
   de ton site (frontend), et indique l'URL de l'API dans chaque page HTML :

```html
<script>window.EGS_API_BASE = 'https://egs-api.onrender.com';</script>
```

### Activer la vérification quotidienne des alertes (gratuit, via GitHub)

1. Sur GitHub : dépôt → **Settings → Secrets and variables → Actions → New repository secret**
2. Ajoute deux secrets :
   - `EGS_API_URL` = l'URL de ton service `egs-api` (ex. `https://egs-api.onrender.com`, sans `/` à la fin)
   - `ADMIN_API_KEY` = la même clé que celle du dashboard Render
3. C'est tout : `.github/workflows/check-alertes.yml` appelle
   `POST /api/tasks/check-alertes` tous les jours à 6h UTC. Tu peux aussi le
   déclencher manuellement depuis l'onglet **Actions** du dépôt
   (bouton "Run workflow").

⚠️ Le plan gratuit Render n'a pas de disque persistant : `data/egs.db` est
réinitialisée à chaque redéploiement/veille prolongée. Pour une vraie mise en
production, passe sur un plan avec disque persistant, ou migre `db.js` vers
une base hébergée (Postgres géré, Supabase…) en gardant les mêmes fonctions
exposées.

## Limites actuelles (projet pédagogique)

- Les numéros de téléphone abonnés aux alertes ne reçoivent rien (pas de canal
  SMS branché) — seuls les contacts e-mail sont notifiés.
- Pas de disque persistant sur le plan gratuit Render (voir ci-dessus).
- L'indice de risque est une estimation pédagogique, pas un outil médical.
