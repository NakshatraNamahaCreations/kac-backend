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

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, newJti };
