// Normalizes a phone number to the exact format the OTP login flow always
// looks up by (OtpScreen.jsx: `${DEFAULT_CC}${sanitize(digits)}`, where
// DEFAULT_CC defaults to '+91') — strips everything but digits, keeps the
// last 10, and prepends +91. Without this, admin.controller.js's createUser
// used to store whatever raw format the admin typed (e.g. "9900566466" with
// no country code), which silently mismatched what OTP login searches for —
// the person could never actually log into the role the admin had just
// provisioned for them; OTP login would just create a second, blank User
// document instead of matching the intended one.
const DEFAULT_COUNTRY_CODE = '+91';

function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D+/g, '');
  const last10 = digits.slice(-10);
  return `${DEFAULT_COUNTRY_CODE}${last10}`;
}

module.exports = { normalizePhone };
