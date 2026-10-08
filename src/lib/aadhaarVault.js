const crypto = require('node:crypto');
const { env } = require('../config/env');

// Full Aadhaar numbers are kept ENCRYPTED (AES-256-GCM), never in plain
// text — UIDAI rules don't allow storing them in the clear. Only the admin
// panel decrypts (admin.controller.js getUserDetail); every other response
// sees just the masked form, and toJSON strips the ciphertext entirely
// (models/plugins.js).
//
// Key: AADHAAR_ENC_KEY — 64 hex chars (32 bytes). Without it, nothing new is
// stored in full (masked only), so the app keeps working. Losing / changing
// the key makes the stored numbers unreadable: back it up.
const KEY = /^[0-9a-fA-F]{64}$/.test(env.aadhaarEncKey ?? '') ? Buffer.from(env.aadhaarEncKey, 'hex') : null;

const digitsOf = (raw) => String(raw ?? '').replace(/\D+/g, '');

function encryptAadhaar(raw) {
  const digits = digitsOf(raw);
  return digits.length === 12 ? encryptDigits(digits) : null;
}

// Bank account numbers use the same key/format (9–18 digits).
function encryptAccount(raw) {
  const digits = digitsOf(raw);
  return digits.length >= 9 && digits.length <= 18 ? encryptDigits(digits) : null;
}

function encryptDigits(digits) {
  if (!KEY) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function decryptAadhaar(stored) {
  if (!KEY || typeof stored !== 'string') return null;
  const [v, iv, tag, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const maskAadhaar = (raw) => `XXXX XXXX ${digitsOf(raw).slice(-4)}`;

// What to store for a newly entered Aadhaar number.
function aadhaarFields(raw) {
  return { aadhaarNumberMasked: maskAadhaar(raw), aadhaarNumberEnc: encryptAadhaar(raw) };
}

// What to store for a newly entered bank account number.
function accountFields(raw) {
  return { accountNumberMasked: `XXXX${digitsOf(raw).slice(-4)}`, accountNumberEnc: encryptAccount(raw) };
}

module.exports = {
  encryptAadhaar,
  decryptAadhaar,
  // Same cipher format, so one decrypt serves both.
  decryptSecret: decryptAadhaar,
  maskAadhaar,
  aadhaarFields,
  accountFields,
};
