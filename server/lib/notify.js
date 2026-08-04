/*
  eGS — Vérifie l'indice de risque de chaque ville, pour chaque maladie suivie,
  et notifie les abonnés concernés si le risque est élevé. Conçu pour être
  appelé périodiquement (endpoint /api/tasks/check-alertes, déclenché par le
  GitHub Action planifié).
*/
'use strict';
const { db } = require('../db.js');
const { CITIES, DISEASES, fetchCityClimate, computeAllRisks } = require('./climate.js');
const { sendAlertEmail, looksLikeEmail } = require('./mailer.js');

const HIGH_RISK_THRESHOLD = 66;
const COOLDOWN_DAYS = Number(process.env.ALERT_COOLDOWN_DAYS || 3);

function recentlyNotified(cityId, diseaseId) {
  const row = db.prepare(
    `SELECT * FROM alert_log WHERE city_id = ? AND disease_id = ? AND sent_at >= datetime('now', ?) ORDER BY sent_at DESC LIMIT 1`
  ).get(cityId, diseaseId, `-${COOLDOWN_DAYS} days`);
  return Boolean(row);
}

async function checkAndNotify() {
  const results = [];

  for (const city of CITIES) {
    let all;
    try {
      const series = await fetchCityClimate(city);
      all = computeAllRisks(series);
    } catch (e) {
      results.push({ city: city.id, error: e.message });
      continue;
    }
    if (!all) {
      results.push({ city: city.id, error: 'Aucune donnée climatique disponible' });
      continue;
    }

    for (const diseaseId of Object.keys(DISEASES)) {
      const risk = all.diseases[diseaseId];

      if (risk.score < HIGH_RISK_THRESHOLD) {
        results.push({ city: city.id, disease: diseaseId, score: risk.score, notified: false, reason: 'risque non élevé' });
        continue;
      }
      if (recentlyNotified(city.id, diseaseId)) {
        results.push({ city: city.id, disease: diseaseId, score: risk.score, notified: false, reason: 'déjà notifié récemment' });
        continue;
      }

      const subs = db.prepare('SELECT * FROM subscriptions WHERE city_id = ? AND disease_id = ?').all(city.id, diseaseId);
      let sentCount = 0;
      for (const sub of subs) {
        if (!looksLikeEmail(sub.contact)) continue; // numéros de téléphone ignorés (pas de canal SMS)
        try {
          await sendAlertEmail(sub.contact, { cityName: city.name, score: risk.score, label: `Risque élevé — ${risk.label}` });
          sentCount++;
        } catch (e) {
          console.error(`[notify] échec d'envoi à ${sub.contact} :`, e.message);
        }
      }

      db.prepare('INSERT INTO alert_log (city_id, disease_id, score, recipients) VALUES (?,?,?,?)')
        .run(city.id, diseaseId, risk.score, sentCount);

      results.push({ city: city.id, disease: diseaseId, score: risk.score, notified: true, recipients: sentCount, subscribers: subs.length });
    }
  }

  return results;
}

module.exports = { checkAndNotify, HIGH_RISK_THRESHOLD, COOLDOWN_DAYS };
