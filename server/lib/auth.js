/*
  eGS — Hashage des mots de passe avec scrypt (module natif node:crypto).
  Chaque mot de passe a son propre sel aléatoire ; le hash et le sel sont
  stockés séparément (jamais le mot de passe en clair).
*/
'use strict';
const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(attempt, 'hex');
  const b = Buffer.from(hash, 'hex');
  // timingSafeEqual exige des buffers de même longueur.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { hashPassword, verifyPassword, generateToken };
