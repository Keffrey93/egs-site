/*
  eGS — API backend (inscriptions, alertes, rendez-vous).
  100% Node.js natif : aucun paquet à installer (node:http + node:sqlite).
  Démarrage : node server.js   (Node.js 22.5+ requis)
  Port par défaut : 3001 (variable d'environnement PORT pour changer).
*/
'use strict';
const http = require('node:http');
const { URL } = require('node:url');
const { db } = require('./db.js');
const { checkAndNotify } = require('./lib/notify.js');

const PORT = process.env.PORT || 3001;
// En développement, laisse '*' pour accepter n'importe quelle origine (fichier local, live-server, etc.).
// En production, remplace par l'URL exacte de ton site pour restreindre l'accès (ex: 'https://egs.example.com').
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Clé requise (en-tête x-api-key) pour les routes sensibles : lecture des listes
// complètes (inscriptions, abonnements, rendez-vous) et suppressions.
// Si ADMIN_API_KEY n'est pas définie, ces routes restent bloquées par sécurité
// (renvoient 503) plutôt que d'être ouvertes par défaut.
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

function isAdmin(req) {
  if (!ADMIN_API_KEY) return false;
  return req.headers['x-api-key'] === ADMIN_API_KEY;
}

function requireAdmin(req, res) {
  if (!ADMIN_API_KEY) {
    send(res, 503, { error: "ADMIN_API_KEY non configurée côté serveur — route désactivée." });
    return false;
  }
  if (!isAdmin(req)) {
    send(res, 401, { error: "Accès refusé — en-tête 'x-api-key' manquant ou invalide." });
    return false;
  }
  return true;
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) req.destroy(); // garde-fou anti-abus (1MB max)
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

function missingFields(obj, fields) {
  return fields.filter(f => !obj[f] || String(obj[f]).trim() === '');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean); // ex: ['api','abonnements','12']

  try {
    // ---------- Santé ----------
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, time: new Date().toISOString() });
    }

    // ---------- Inscriptions (profils utilisateurs) ----------
    if (parts[0] === 'api' && parts[1] === 'inscriptions') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        const missing = missingFields(body, ['firstname', 'lastname', 'email', 'phone', 'city']);
        if (missing.length) return send(res, 400, { error: `Champs manquants : ${missing.join(', ')}` });

        const stmt = db.prepare(
          `INSERT INTO users (firstname,lastname,email,phone,city_id) VALUES (?,?,?,?,?)`
        );
        const info = stmt.run(body.firstname.trim(), body.lastname.trim(), body.email.trim(), body.phone.trim(), body.city.trim());
        const created = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        return send(res, 201, created);
      }
      if (req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
        return send(res, 200, rows);
      }
    }

    // ---------- Abonnements aux alertes ----------
    if (parts[0] === 'api' && parts[1] === 'abonnements') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        const missing = missingFields(body, ['city', 'contact']);
        if (missing.length) return send(res, 400, { error: `Champs manquants : ${missing.join(', ')}` });

        const stmt = db.prepare(`INSERT INTO subscriptions (city_id, contact) VALUES (?,?)`);
        const info = stmt.run(body.city.trim(), body.contact.trim());
        const created = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(info.lastInsertRowid);
        return send(res, 201, created);
      }
      if (req.method === 'GET') {
        const contact = url.searchParams.get('contact');
        // Sans filtre 'contact', on renvoie la liste de TOUS les abonnés : réservé à l'admin.
        if (!contact && !requireAdmin(req, res)) return;
        const rows = contact
          ? db.prepare('SELECT * FROM subscriptions WHERE contact = ? ORDER BY created_at DESC').all(contact)
          : db.prepare('SELECT * FROM subscriptions ORDER BY created_at DESC').all();
        return send(res, 200, rows);
      }
      if (req.method === 'DELETE' && parts[2]) {
        if (!requireAdmin(req, res)) return;
        db.prepare('DELETE FROM subscriptions WHERE id = ?').run(Number(parts[2]));
        return send(res, 200, { deleted: true });
      }
    }

    // ---------- Rendez-vous de téléconsultation ----------
    if (parts[0] === 'api' && parts[1] === 'rendezvous') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        const missing = missingFields(body, ['patientName', 'motif', 'slot']);
        if (missing.length) return send(res, 400, { error: `Champs manquants : ${missing.join(', ')}` });

        const stmt = db.prepare(`INSERT INTO appointments (patient_name, motif, slot) VALUES (?,?,?)`);
        const info = stmt.run(body.patientName.trim(), body.motif.trim(), body.slot.trim());
        const created = db.prepare('SELECT * FROM appointments WHERE id = ?').get(info.lastInsertRowid);
        return send(res, 201, created);
      }
      if (req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        const rows = db.prepare('SELECT * FROM appointments ORDER BY created_at DESC').all();
        return send(res, 200, rows);
      }
      if (req.method === 'DELETE' && parts[2]) {
        if (!requireAdmin(req, res)) return;
        db.prepare('DELETE FROM appointments WHERE id = ?').run(Number(parts[2]));
        return send(res, 200, { deleted: true });
      }
    }

    // ---------- Tâche : vérification et envoi des alertes de risque ----------
    // Protégée par la clé admin. À déclencher périodiquement (cron externe, ex.
    // Render Cron Job — voir render.yaml) ou via le planificateur interne
    // optionnel (ENABLE_INTERNAL_SCHEDULER, voir plus bas).
    if (parts[0] === 'api' && parts[1] === 'tasks' && parts[2] === 'check-alertes' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      const results = await checkAndNotify();
      return send(res, 200, { ranAt: new Date().toISOString(), results });
    }

    send(res, 404, { error: 'Route inconnue' });
  } catch (err) {
    send(res, 500, { error: err.message || 'Erreur serveur' });
  }
});

server.listen(PORT, () => {
  console.log(`eGS API en écoute sur http://localhost:${PORT}`);
});

// Planificateur interne optionnel : utile si le processus tourne en continu
// (ex. plan Render payant sans mise en veille). Sur le plan gratuit, préfère
// un cron externe qui appelle POST /api/tasks/check-alertes (voir render.yaml).
if (process.env.ENABLE_INTERNAL_SCHEDULER === 'true') {
  const hours = Number(process.env.SCHEDULER_INTERVAL_HOURS || 6);
  console.log(`[scheduler] activé — vérification des alertes toutes les ${hours}h`);
  setInterval(() => {
    checkAndNotify()
      .then(results => console.log('[scheduler] vérification effectuée :', results))
      .catch(err => console.error('[scheduler] erreur :', err.message));
  }, hours * 60 * 60 * 1000);
}
