const { z } = require('zod');
const { AgentPlanModel, SINGLETON_ID } = require('../models/AgentPlan');
const { GST_RATE_PERCENT, gstForBasePaise, totalWithGstPaise } = require('../lib/gst');

// Same defaults previously hardcoded in AgentRegisterMembershipScreen.jsx
// (client) and payments.controller.js's AGENT_MEMBERSHIP_PAISE (server) —
// used only to lazily create the singleton doc the first time it's read,
// so an empty DB still shows a sane price instead of erroring.
const DEFAULT_BASE_FEE_PAISE = 49900; // ₹499
const DEFAULT_BULLETS = [
  'Your own executive code',
  '₹249 per vendor / agent signup',
  'Bank withdrawals · 1:1 INR',
];

async function getOrCreateAgentPlan() {
  let plan = await AgentPlanModel.findById(SINGLETON_ID);
  if (!plan) {
    plan = await AgentPlanModel.create({
      baseFeePaise: DEFAULT_BASE_FEE_PAISE,
      bullets: DEFAULT_BULLETS,
    });
  }
  return plan;
}

// Adds the 18% GST (lib/gst.js) and total, so the app's fee card and the
// admin panel show exactly what the membership order charges.
function toDto(plan) {
  return {
    ...plan.toJSON(),
    gstRatePercent: GST_RATE_PERCENT,
    gstPaise: gstForBasePaise(plan.baseFeePaise),
    totalPaise: totalWithGstPaise(plan.baseFeePaise),
  };
}

async function getAgentPlanAdmin(_req, res) {
  const plan = await getOrCreateAgentPlan();
  res.json(toDto(plan));
}

const updateSchema = z.object({
  baseFeePaise: z.number().int().nonnegative().optional(),
  bullets: z.array(z.string()).optional(),
});

async function updateAgentPlan(req, res) {
  const body = updateSchema.parse(req.body);
  const plan = await getOrCreateAgentPlan();
  Object.assign(plan, body);
  await plan.save();
  res.json(toDto(plan));
}

// Public (no auth) — matches /categories and /vendor-plans' access level.
// Powers AgentRegisterMembershipScreen.jsx's fee card, seen before a
// prospective agent has necessarily logged in with any role yet.
async function getAgentPlanPublic(_req, res) {
  const plan = await getOrCreateAgentPlan();
  res.json(toDto(plan));
}

module.exports = { getAgentPlanAdmin, updateAgentPlan, getAgentPlanPublic };
