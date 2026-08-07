const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { env } = require('../config/env');

function signAccessToken(userId) {
  const payload = { sub: userId };
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.jwtAccessTtl });
}

function signRefreshToken(userId, jti) {
  const payload = { sub: userId, jti };
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshTtl });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

function newJti() {
  return crypto.randomUUID();
}

// Admin tokens use their own secret (env.adminJwtSecret) — deliberately not
// jwtAccessSecret, so a leaked/forged regular-user token can never pass as
// an admin token and vice versa. There's only one admin identity (the fixed
// operator login), so the payload just marks the token's kind — no subject.
function signAdminToken() {
  return jwt.sign({ kind: 'admin' }, env.adminJwtSecret, { expiresIn: '12h' });
}

function verifyAdminToken(token) {
  const payload = jwt.verify(token, env.adminJwtSecret);
  if (payload.kind !== 'admin') throw new Error('Not an admin token');
  return payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  newJti,
  signAdminToken,
  verifyAdminToken,
};
