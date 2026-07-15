const { verifyAccessToken } = require('../lib/jwt');
const { HttpError } = require('../lib/httpError');
const { UserModel } = require('../models/User');

async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Missing access token.');

    const payload = verifyAccessToken(token);
    const user = await UserModel.findById(payload.sub);
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'User no longer exists.');
    req.user = user;
    next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, 'UNAUTHENTICATED', 'Access token is invalid or expired.'));
  }
}

// Rejects with 403 if the authenticated user hasn't added this role yet
// (via the relevant */register endpoint or POST /me/roles). Use on routes
// that assume a role-specific profile document already exists, instead of
// letting the controller silently auto-provision an empty one for anyone.
function requireRole(role) {
  return function (req, _res, next) {
    if (!req.user.roles.includes(role)) {
      return next(new HttpError(403, 'ROLE_REQUIRED', `You need the ${role} role for this.`));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
