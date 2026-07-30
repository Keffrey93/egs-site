/*
  eGS — Vérifie l'indice de risque de chaque ville suivie et notifie les
  abonnés concernés si le risque est élevé. Conçu pour être appelé
  périodiquement (voir server.js : tâche planifiée interne + endpoint
  /api/tasks/check-alertes déclenchable par un cron externe, ex. Render Cron Job).
*/
'use strict';
const { db } = require('../db.js');
const { CITIES, fetchCityClimate, riskIndex } = require('./climate.js');
const { sendAlertEmail, looksLikeEmail } = require('./mailer.js');

const HIGH_RISK_THRESHOLD = 66;
const COOLDOWN_DAYS = Number(process.env.ALERT_COOLDOWN_DAYS || 3);

function recentlyNotified(cityId) {
  const row = db.prepare(
    `SELECT * FROM alert_log WHERE city_id = ? AND sent_at >= datetime('now', ?) ORDER BY sent_at DESC LIMIT 1`
  ).get(cityId, `-${COOLDOWN_DAYS} days`);
  return Boolean(row);
}

async function checkAndNotify() {
  const results = [];

  for (const city of CITIES) {
    let risk;
    try {
      const series = await fetchCityClimate(city);
      risk = riskIndex(series);
    } catch (e) {
      results.push({ city: city.id, error: e.message });
      continue;
    }

    if (!risk || risk.score < HIGH_RISK_THRESHOLD) {
      results.push({ city: city.id, score: risk ? risk.score : null, notified: false, reason: 'risque non élevé' });
      continue;
    }

    if (recentlyNotified(city.id)) {
      results.push({ city: city.id, score: risk.score, notified: false, reason: 'déjà notifié récemment' });
      continue;
    }

    const subs = db.prepare('SELECT * FROM subscriptions WHERE city_id = ?').all(city.id);
    const label = 'Risque élevé';
    let sentCount = 0;
    for (const sub of subs) {
      if (!looksLikeEmail(sub.contact)) continue; // numéros de téléphone ignorés pour l'instant (pas de canal SMS)
      try {
        await sendAlertEmail(sub.contact, { cityName: city.name, score: risk.score, label });
        sentCount++;
      } catch (e) {
        console.error(`[notify] échec d'envoi à ${sub.contact} :`, e.message);
      }
    }

    db.prepare('INSERT INTO alert_log (city_id, score, recipients) VALUES (?,?,?)')
      .run(city.id, risk.score, sentCount);

    results.push({ city: city.id, score: risk.score, notified: true, recipients: sentCount, subscribers: subs.length });
  }

  return results;
}

module.exports = { checkAndNotify, HIGH_RISK_THRESHOLD, COOLDOWN_DAYS };
