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
};

module.exports = { env };
