require('dotenv/config');

const isProduction = process.env.NODE_ENV === 'production';

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// JWT secrets get a dev-only fallback so local setup stays quick, but a
// production deploy that forgets to set these must fail loudly at startup
// instead of silently signing tokens with a fallback string that's
// published in this very file.
function requiredSecret(name) {
  const v = process.env[name];
  if (v) return v;
  if (isProduction) {
    throw new Error(`Missing required env var: ${name} (no insecure fallback allowed in production)`);
  }
  return `dev-only-insecure-${name.toLowerCase()}`;
}

const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/gigkaar'),
  jwtAccessSecret: requiredSecret('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: requiredSecret('JWT_REFRESH_SECRET'),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:8081').split(',').map((s) => s.trim()),
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
  devOtpCode: process.env.DEV_OTP_CODE ?? '123456',
  // Whether requestOtp echoes the real per-request code back in its
  // response (session.controller.js) — shown outside production by
  // default, same as before. SHOW_DEV_OTP=true opts a production deploy
  // into it too (e.g. Render, while no real SMS gateway is wired up)
  // without touching NODE_ENV itself, since that also gates JWT-secret and
  // admin-password-hash requirements below — a much bigger blast radius
  // than intended for what's really just an OTP-visibility toggle.
  showDevOtp: process.env.SHOW_DEV_OTP === 'true' || !isProduction,
  // Admin panel — a single fixed operator login, deliberately separate from
  // the phone+OTP User/roles system (there's no "admin" role on User; this
  // is its own credential pair + its own JWT secret so an admin token can
  // never be confused with / forged from a regular user access token).
  // Dev fallback logs in with admin / admin123 — change ADMIN_PASSWORD_HASH
  // before deploying (see server/README or .env.example for how to hash one).
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPasswordHash:
    process.env.ADMIN_PASSWORD_HASH ??
    (isProduction
      ? required('ADMIN_PASSWORD_HASH')
      : '$2a$10$JjhW4idckdPRZPwKQLPToOcc5HgZTa/VUcWDc86GvI5drv5PqQ9ZW'),
  adminJwtSecret: requiredSecret('ADMIN_JWT_SECRET'),
};

module.exports = { env };
