/*
  eGS — Envoi d'e-mails (alertes de risque).
  Utilise nodemailer avec n'importe quel SMTP (Gmail avec mot de passe
  d'application, Brevo, Mailtrap, etc.) configuré via variables d'environnement.
  Si SMTP_HOST n'est pas défini, l'envoi est simplement journalisé en console
  (mode "dry-run") au lieu d'échouer — pratique en développement local.
*/
'use strict';
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const ALERT_FROM = process.env.ALERT_FROM_EMAIL || SMTP_USER || 'alertes@egs.local';

let transporter = null;
function getTransporter() {
  if (!SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// contact peut être un e-mail ou un numéro de téléphone (les abonnements acceptent les deux).
// On n'envoie ici que si contact ressemble à un e-mail ; les numéros de téléphone sont ignorés
// tant que le canal SMS n'est pas branché (voir README pour l'étendre).
function looksLikeEmail(contact) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
}

async function sendAlertEmail(to, { cityName, diseaseName, score, label }) {
  const disease = diseaseName || 'paludisme';
  const subject = `eGS — Risque ${label.toLowerCase()} (${disease}) à ${cityName} (${score}/100)`;
  const text = `Bonjour,\n\nL'indice de risque ${disease} calculé pour ${cityName} est maintenant de ${score}/100 (${label}).\nCet indice est une estimation pédagogique basée sur les données climatiques NASA POWER, pas un diagnostic médical.\n\nRetrouvez le détail et des conseils de prévention sur la page « Alertes » du site eGS.\n\n— eGS`;

  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] (dry-run, SMTP_HOST non configuré) aurait envoyé à ${to}: ${subject}`);
    return { sent: false, dryRun: true };
  }
  await t.sendMail({ from: ALERT_FROM, to, subject, text });
  return { sent: true, dryRun: false };
}

module.exports = { sendAlertEmail, looksLikeEmail };
