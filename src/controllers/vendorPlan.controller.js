const { z } = require('zod');
const { VendorPlanModel } = require('../models/VendorPlan');
const { fail } = require('../lib/httpError');

// Uppercase letters/digits/underscore, must start with a letter — mirrors
// the BASIC/PRO shape so it reads sensibly as `store.plan` on the client and
// as the `plan` value persisted on Vendor documents.
const TIER_RE = /^[A-Z][A-Z0-9_]{1,19}$/;

async function listVendorPlansAdmin(_req, res) {
  const plans = await VendorPlanModel.find({}).sort({ sortOrder: 1 });
  res.json(plans.map((p) => p.toJSON()));
}

const createSchema = z.object({
  tier: z.string().regex(TIER_RE, 'Tier must be 2-20 uppercase letters/digits/underscore, starting with a letter.'),
  label: z.string().min(1),
  tagline: z.string().optional(),
  baseFeePaise: z.number().int().nonnegative(),
  serviceQuota: z.number().int().positive().nullable().optional(),
  badge: z.string().nullable().optional(),
  bullets: z.array(z.string()).optional(),
});

// Admin-created tier, on top of the BASIC/PRO pair seeded at launch. Any
// vendor who registers under it gets `plan: tier` and `serviceQuota` copied
// from this doc at registration time (see vendorSelf.controller.js) — later
// edits here don't retroactively change already-registered vendors, same as
// RechargePlan edits don't rewrite past purchases.
async function createVendorPlan(req, res) {
  const body = createSchema.parse(req.body);
  const existing = await VendorPlanModel.findOne({ tier: body.tier });
  if (existing) fail(409, 'TIER_EXISTS', 'A plan with this tier already exists.');
  const maxSort = await VendorPlanModel.findOne({}).sort({ sortOrder: -1 });
  const plan = await VendorPlanModel.create({
    ...body,
    sortOrder: (maxSort?.sortOrder ?? -1) + 1,
  });
  res.status(201).json(plan.toJSON());
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

// Keyed by tier, not a Mongo id — the tier IS the stable identity here
// (mirrors what Vendor.plan stores and what payments.controller.js looks
// up by), and it's what the admin panel's edit form uses. Tier itself is
// immutable after creation — renaming it would orphan already-registered
// vendors' `plan` values.
async function updateVendorPlan(req, res) {
  const tier = req.params.tier?.toUpperCase();
  const body = updateSchema.parse(req.body);
  const plan = await VendorPlanModel.findOne({ tier });
  if (!plan) fail(404, 'NOT_FOUND', 'Plan not found.');
  Object.assign(plan, body);
  await plan.save();
  res.json(plan.toJSON());
}

// Deleting a tier doesn't touch vendors already registered under it — their
// `plan`/`serviceQuota` were copied onto the Vendor doc at registration time,
// same as RechargePlan deletion doesn't affect past purchases.
async function deleteVendorPlan(req, res) {
  const tier = req.params.tier?.toUpperCase();
  const plan = await VendorPlanModel.findOne({ tier });
  if (!plan) fail(404, 'NOT_FOUND', 'Plan not found.');
  const remaining = await VendorPlanModel.countDocuments({});
  if (remaining <= 1) fail(400, 'LAST_PLAN', 'At least one vendor plan must remain.');
  await plan.deleteOne();
  res.status(204).end();
}

// Public (no auth) — matches /categories' access level. Powers
// StepPayment.jsx's plan picker, which a vendor sees before they've
// necessarily completed every earlier step of signup.
async function listVendorPlansPublic(_req, res) {
  const plans = await VendorPlanModel.find({}).sort({ sortOrder: 1 });
  res.json(plans.map((p) => p.toJSON()));
}

module.exports = {
  listVendorPlansAdmin,
  createVendorPlan,
  updateVendorPlan,
  deleteVendorPlan,
  listVendorPlansPublic,
};
