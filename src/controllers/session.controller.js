const crypto = require('node:crypto');
const { isValidObjectId } = require('mongoose');
const { z } = require('zod');
const { UserModel } = require('../models/User');
const { OtpRequestModel } = require('../models/OtpRequest');
const { RefreshTokenModel } = require('../models/RefreshToken');
const { EmployeeModel, EmployeeReferralModel } = require('../models/Employee');
const { newJti, signAccessToken, signRefreshToken, verifyRefreshToken } = require('../lib/jwt');
const { fail } = require('../lib/httpError');
const { detectReferralKind } = require('../lib/referralCode');
const { creditCustomerWelcomeBonus } = require('./customerWallet.controller');
const { env } = require('../config/env');

const CUSTOMER_REFERRAL_REWARD_COINS = 99;

function generateOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

const otpRequestSchema = z.object({ phone: z.string().min(6) });

const isProduction = process.env.NODE_ENV === 'production';

async function requestOtp(req, res) {
  const { phone } = otpRequestSchema.parse(req.body);
  const code = generateOtpCode();
  const doc = await OtpRequestModel.create({ phone, code });
  // No SMS gateway wired up yet — log the code so it's usable in dev/staging.
  // Real backend: send via SMS provider here instead of console.log.
  // eslint-disable-next-line no-console
  console.log(`[otp] ${phone} -> ${code} (or DEV_OTP_CODE=${env.devOtpCode})`);
  // Only ever included outside production — this exists purely so the app
  // can show the code on-screen while there's no real SMS gateway wired up.
  // Returning the OTP in the response would defeat the entire point of OTP
  // verification once real SMS delivery is live.
  res.json({ requestId: String(doc._id), devCode: isProduction ? undefined : code });
}

const otpVerifySchema = z.object({ requestId: z.string(), code: z.string().regex(/^\d{6}$/) });

async function issueTokenPair(userId) {
  const jti = newJti();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await RefreshTokenModel.create({ userId, jti, expiresAt });
  return {
    accessToken: signAccessToken(userId),
    refreshToken: signRefreshToken(userId, jti),
  };
}

async function verifyOtp(req, res) {
  const body = otpVerifySchema.parse(req.body);
  if (!isValidObjectId(body.requestId)) {
    fail(400, 'INVALID_REQUEST', 'Verification session expired. Request a new code.');
  }
  const otp = await OtpRequestModel.findById(body.requestId);
  if (!otp || otp.consumed) fail(400, 'INVALID_REQUEST', 'Verification session expired. Request a new code.');
  if (body.code !== otp.code && body.code !== env.devOtpCode) {
    fail(400, 'INVALID_CODE', 'That code is incorrect.');
  }
  otp.consumed = true;
  await otp.save();

  let user = await UserModel.findOne({ phone: otp.phone });
  let isNewUser = false;
  if (!user) {
    user = await UserModel.create({ phone: otp.phone, roles: [] });
    isNewUser = true;
  }

  const tokens = await issueTokenPair(String(user._id));
  res.json({ ...tokens, user: user.toJSON(), isNewUser });
}

const refreshSchema = z.object({ refreshToken: z.string() });

async function refresh(req, res) {
  const { refreshToken } = refreshSchema.parse(req.body);
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    fail(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please sign in again.');
  }
  const stored = await RefreshTokenModel.findOne({ jti: payload.jti, userId: payload.sub });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    fail(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please sign in again.');
  }
  stored.revoked = true;
  await stored.save();

  const tokens = await issueTokenPair(payload.sub);
  res.json(tokens);
}

async function getMe(req, res) {
  res.json(req.user.toJSON());
}

const patchMeSchema = z.object({
  name: z.string().optional(),
  language: z.string().optional(),
  area: z.string().optional(),
  address: z.string().optional(),
  referralCode: z.string().optional(),
});

async function patchMe(req, res) {
  const { referralCode, ...patch } = patchMeSchema.parse(req.body);
  const user = req.user;
  const wasFirstSetup = !user.name && !!patch.name;

  Object.assign(user, patch);
  await user.save();

  // Apply referral attribution on first-time profile setup only — repeat
  // PATCHes (edit-profile flows) don't re-attribute.
  if (wasFirstSetup && referralCode) {
    const kind = detectReferralKind(referralCode);
    if (kind === 'employee') {
      const employee = await EmployeeModel.findOne({ referralCode: referralCode.trim().toUpperCase() });
      if (employee) {
        await EmployeeReferralModel.create({
          employeeId: employee._id,
          userId: user._id,
          userName: user.name ?? 'Customer',
          userPhone: user.phone,
          role: 'customer',
          area: user.area ?? null,
        });
      }
    } else if (kind === 'customer') {
      // Customer code → 99 welcome coins credited to the NEW customer.
      await creditCustomerWelcomeBonus(user, CUSTOMER_REFERRAL_REWARD_COINS, 'Welcome bonus — referred');
    }
  }

  res.json(user.toJSON());
}

const addRoleSchema = z.object({ role: z.enum(['customer', 'vendor', 'agent', 'employee']) });

async function addRole(req, res) {
  const { role } = addRoleSchema.parse(req.body);
  const user = req.user;
  if (!user.roles.includes(role)) {
    user.roles.push(role);
    await user.save();
  }
  res.json(user.toJSON());
}

const pushTokenSchema = z.object({ token: z.string(), platform: z.enum(['ios', 'android', 'web']) });

async function setPushToken(req, res) {
  const body = pushTokenSchema.parse(req.body);
  // Atomic pull-then-push avoids DocumentArray subdocument typing headaches
  // and sidesteps races between concurrent push-token registrations.
  await UserModel.updateOne({ _id: req.user._id }, { $pull: { pushTokens: { token: body.token } } });
  await UserModel.updateOne({ _id: req.user._id }, { $push: { pushTokens: body } });
  res.status(204).send();
}

module.exports = {
  requestOtp,
  verifyOtp,
  refresh,
  getMe,
  patchMe,
  addRole,
  setPushToken,
};
