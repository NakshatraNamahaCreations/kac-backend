const { z } = require('zod');
const { RechargePlanModel } = require('../models/RechargePlan');
const { fail } = require('../lib/httpError');

// Admin-side management (requireAdminAuth, see admin.routes.js) — full list
// including inactive plans, so the admin can re-enable one later instead of
// only ever creating new ones.
async function listPlansAdmin(_req, res) {
  const plans = await RechargePlanModel.find({}).sort({ sortOrder: 1, coins: 1 });
  res.json(plans.map((p) => p.toJSON()));
}

const planSchema = z.object({
  coins: z.number().int().positive(),
  label: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

async function createPlan(req, res) {
  const body = planSchema.parse(req.body);
  const plan = await RechargePlanModel.create({
    coins: body.coins,
    label: body.label || null,
    sortOrder: body.sortOrder ?? 0,
  });
  res.status(201).json(plan.toJSON());
}

const updatePlanSchema = z.object({
  coins: z.number().int().positive().optional(),
  label: z.string().nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

async function updatePlan(req, res) {
  const body = updatePlanSchema.parse(req.body);
  const plan = await RechargePlanModel.findById(req.params.id);
  if (!plan) fail(404, 'NOT_FOUND', 'Plan not found.');
  Object.assign(plan, body);
  await plan.save();
  res.json(plan.toJSON());
}

async function deletePlan(req, res) {
  const plan = await RechargePlanModel.findByIdAndDelete(req.params.id);
  if (!plan) fail(404, 'NOT_FOUND', 'Plan not found.');
  res.status(204).send();
}

// Customer-facing (no auth requirement, matches the rest of the customer
// wallet routes) — active plans only, in display order. Powers
// CustomerRechargeScreen.jsx's preset grid.
async function listPlansPublic(_req, res) {
  const plans = await RechargePlanModel.find({ active: true }).sort({ sortOrder: 1, coins: 1 });
  res.json(plans.map((p) => p.toJSON()));
}

module.exports = { listPlansAdmin, createPlan, updatePlan, deletePlan, listPlansPublic };
