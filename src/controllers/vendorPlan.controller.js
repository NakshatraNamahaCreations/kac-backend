const { z } = require('zod');
const { VendorPlanModel } = require('../models/VendorPlan');
const { fail } = require('../lib/httpError');

async function listVendorPlansAdmin(_req, res) {
  const plans = await VendorPlanModel.find({}).sort({ sortOrder: 1 });
  res.json(plans.map((p) => p.toJSON()));
}

const updateSchema = z.object({
  label: z.string().min(1).optional(),
  tagline: z.string().optional(),
  baseFeePaise: z.number().int().nonnegative().optional(),
  serviceQuota: z.number().int().positive().nullable().optional(),
  badge: z.string().nullable().optional(),
  bullets: z.array(z.string()).optional(),
  sortOrder: z.number().int().optional(),
});

// Keyed by tier (BASIC/PRO), not a Mongo id — the tier IS the stable
// identity here (see the model's comment on why it's a fixed enum), and
// this is what the admin panel's edit form and payments.controller.js's
// lookup both use.
async function updateVendorPlan(req, res) {
  const tier = req.params.tier?.toUpperCase();
  if (!['BASIC', 'PRO'].includes(tier)) fail(400, 'INVALID_TIER', 'Tier must be BASIC or PRO.');
  const body = updateSchema.parse(req.body);
  const plan = await VendorPlanModel.findOne({ tier });
  if (!plan) fail(404, 'NOT_FOUND', 'Plan not found.');
  Object.assign(plan, body);
  await plan.save();
  res.json(plan.toJSON());
}

// Public (no auth) — matches /categories' access level. Powers
// StepPayment.jsx's plan picker, which a vendor sees before they've
// necessarily completed every earlier step of signup.
async function listVendorPlansPublic(_req, res) {
  const plans = await VendorPlanModel.find({}).sort({ sortOrder: 1 });
  res.json(plans.map((p) => p.toJSON()));
}

module.exports = { listVendorPlansAdmin, updateVendorPlan, listVendorPlansPublic };
