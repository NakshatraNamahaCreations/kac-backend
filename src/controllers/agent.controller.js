const { z } = require('zod');
const { AgentModel } = require('../models/Agent');
const { OnboardingModel } = require('../models/Onboarding');
const { LedgerEntryModel } = require('../models/LedgerEntry');
const { EmployeeModel, EmployeeReferralModel } = require('../models/Employee');
const { agentReferralCode, detectReferralKind } = require('../lib/referralCode');
const { buildPage, parseCursor } = require('../lib/pagination');
const { io } = require('../realtime/socket');

// Lazy require — vendorReferral.controller.js requires agent.controller.js
// for creditAgentCoins, so a top-level require here would form a cycle.
function creditVendorReferrer(...args) {
  return require('./vendorReferral.controller').creditVendorReferrer(...args);
}

const bankSchema = z.object({ accountNumber: z.string(), ifsc: z.string(), accountHolder: z.string() });

const registerSchema = z.object({
  name: z.string(),
  area: z.string(),
  bank: bankSchema,
  address: z.string().optional(),
  referralCode: z.string().optional(),
  membershipOrderId: z.string().optional(),
});

async function registerAgent(req, res) {
  const body = registerSchema.parse(req.body);
  const user = req.user;

  let agent = await AgentModel.findOne({ userId: user._id });
  if (!agent) {
    agent = await AgentModel.create({
      userId: user._id,
      executiveCode: agentReferralCode(String(user._id)),
      area: body.area,
      bankAccounts: [],
      walletCoins: 0,
    });
  }

  const digits = body.bank.accountNumber.replace(/\D+/g, '');
  const ifsc = body.bank.ifsc.toUpperCase();
  agent.bankAccounts.filter((b) => b.ifsc === ifsc).forEach((b) => agent.bankAccounts.pull(b._id));
  agent.bankAccounts.push({ accountHolder: body.bank.accountHolder, accountNumberMasked: `XXXX${digits.slice(-4)}`, ifsc });
  await agent.save();

  if (!user.roles.includes('agent')) {
    user.roles.push('agent');
    await user.save();
  }

  if (body.referralCode) {
    const kind = detectReferralKind(body.referralCode);
    if (kind === 'employee') {
      const employee = await EmployeeModel.findOne({ referralCode: body.referralCode.trim().toUpperCase() });
      if (employee) {
        await EmployeeReferralModel.create({
          employeeId: employee._id,
          userId: user._id,
          userName: body.name,
          userPhone: user.phone,
          role: 'agent',
          area: body.area,
        });
      }
    } else if (kind === 'agent') {
      // A new agent was referred by an existing agent's code — same
      // cashback mechanism as a vendor referral, just a different referred
      // role. Guard against a self-referral loop (code belongs to this
      // same agent, e.g. re-submitting the form).
      if (body.referralCode.trim().toUpperCase() !== agent.executiveCode) {
        await creditReferralCodeForAgent(body.referralCode, body.name, user.phone);
      }
    } else if (kind === 'vendor') {
      // A vendor referred this new agent — credits the referring vendor's
      // (agent-backed) wallet instead.
      await creditVendorReferrer(body.referralCode, user._id, body.name, user.phone, 'agent');
    }
  }

  res.status(201).json({ executiveCode: agent.executiveCode });
}

async function requireOwnAgent(userId) {
  let agent = await AgentModel.findOne({ userId });
  if (!agent) {
    agent = await AgentModel.create({ userId, executiveCode: agentReferralCode(String(userId)), bankAccounts: [], walletCoins: 0 });
  }
  return agent;
}

async function getAgentDashboard(req, res) {
  const agent = await requireOwnAgent(req.user._id);
  const onboardings = await OnboardingModel.find({ agentId: req.user._id });
  const active = onboardings.filter((o) => o.status === 'ACTIVE');
  const totalsCoins = active.reduce((sum, o) => sum + o.earningsCoins, 0);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysActive = active.filter((o) => o.createdAt >= todayStart);
  const todayEarnings = todaysActive.reduce((sum, o) => sum + o.earningsCoins, 0);

  // App installs isn't a signal this backend can observe yet (no referral-
  // link click tracking endpoint exists in the contract) — reported equal to
  // onboardings rather than inventing a synthetic multiplier.
  res.json({
    executiveCode: agent.executiveCode,
    totals: { onboardings: onboardings.length, earningsCoins: totalsCoins, appInstalls: onboardings.length },
    today: { onboardings: todaysActive.length, earningsCoins: todayEarnings, appInstalls: todaysActive.length },
    walletCoins: agent.walletCoins,
  });
}

const onboardSchema = z.object({
  vendorPhone: z.string(),
  vendorName: z.string(),
  categoryIds: z.array(z.string()).optional(),
  area: z.string().optional(),
  phoneVerified: z.boolean().optional(),
  aadhaarNumber: z.string().optional(),
  aadhaarName: z.string().optional(),
  aadhaarPhotoKey: z.string().optional(),
  panNumber: z.string().optional(),
  panPhotoKey: z.string().optional(),
  gstNumber: z.string().optional(),
  gstPhotoKey: z.string().optional(),
  businessName: z.string().optional(),
  ownerName: z.string().optional(),
  shopPhotoKey: z.string().optional(),
  establishedYear: z.string().optional(),
  locationLat: z.number().optional(),
  locationLng: z.number().optional(),
  placeTags: z.array(z.string()).optional(),
  serviceTags: z.array(z.string()).optional(),
});

async function createOnboarding(req, res) {
  const body = onboardSchema.parse(req.body);
  await requireOwnAgent(req.user._id);
  const onboarding = await OnboardingModel.create({ ...body, agentId: req.user._id, status: 'PENDING', earningsCoins: 0 });
  res.status(201).json({ onboardingId: String(onboarding._id), status: 'PENDING' });
}

async function listOnboardings(req, res) {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 10;
  const filter = { agentId: req.user._id };
  if (status) filter.status = status;
  const [total, onboardings] = await Promise.all([
    OnboardingModel.countDocuments(filter),
    OnboardingModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(onboardings.map((o) => o.toJSON()), skip, limit, total));
}

// Cashback business rule — kept out of vendorSelf.controller.ts's happy path
// so the credit logic lives in one place. Called after a vendor completes
// their own registration; ties the agent's ₹249-equivalent (249 coins)
// cashback to a real event (the referred vendor signing up) instead of a
// fixed timer like the mock server used.
const COINS_PER_ONBOARDING = 249;

async function creditOnboardingForVendorPhone(vendorPhone, vendorName) {
  const onboarding = await OnboardingModel.findOne({ vendorPhone, status: 'PENDING' }).sort({ createdAt: -1 });
  if (!onboarding) return false;

  onboarding.status = 'ACTIVE';
  onboarding.earningsCoins = COINS_PER_ONBOARDING;
  await onboarding.save();

  await creditAgentCoins(onboarding.agentId, 'Onboarding bonus', vendorName, onboarding._id);
  return true;
}

// Shared crediting path for both the phone-prearranged onboarding flow above
// and a vendor/new-agent directly typing an agent's referral code at signup
// (no prior Onboarding record needed for that path). `name` is the referred
// vendor/agent's name — included in both the ledger description and the
// socket payload, since SocketProvider.jsx's toast reads `p.vendorName`.
async function creditAgentCoins(agentUserId, reason, name, onboardingId) {
  const agent = await requireOwnAgent(agentUserId);
  agent.walletCoins += COINS_PER_ONBOARDING;
  await agent.save();

  await LedgerEntryModel.create({
    ownerId: agentUserId,
    kind: 'credit',
    coins: COINS_PER_ONBOARDING,
    balance: agent.walletCoins,
    description: `${reason} — ${name}`,
    onboardingId: onboardingId ?? null,
  });

  io()?.to(`user:${String(agentUserId)}`).emit('wallet.credited', {
    coins: COINS_PER_ONBOARDING,
    balance: agent.walletCoins,
    onboardingId: onboardingId ? String(onboardingId) : null,
    vendorName: name,
  });
}

// A vendor/agent entered another agent's referral code directly (rather than
// the agent having pre-registered their phone via Onboard Vendor). Credits
// the same cashback and records it as an ACTIVE onboarding for the agent's
// history/dashboard totals to stay consistent either way.
async function creditReferralCodeForAgent(referralCode, referredName, referredPhone) {
  const agent = await AgentModel.findOne({ executiveCode: referralCode.trim().toUpperCase() });
  if (!agent) return false;

  const onboarding = await OnboardingModel.create({
    agentId: agent.userId,
    vendorPhone: referredPhone,
    vendorName: referredName,
    status: 'ACTIVE',
    earningsCoins: COINS_PER_ONBOARDING,
  });

  await creditAgentCoins(agent.userId, 'Referral bonus', referredName, onboarding._id);
  return true;
}

module.exports = {
  registerAgent,
  getAgentDashboard,
  createOnboarding,
  listOnboardings,
  creditOnboardingForVendorPhone,
  creditReferralCodeForAgent,
  creditAgentCoins,
};
