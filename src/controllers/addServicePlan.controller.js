const { z } = require('zod');
const { AddServicePlanModel, SINGLETON_ID } = require('../models/AddServicePlan');

// Same price previously hardcoded in AddServiceScreen.jsx and
// payments.controller.js — used only to lazily create the singleton the
// first time it's read.
const DEFAULT_BASE_FEE_PAISE = 39900; // ₹399
const DEFAULT_GST_PAISE = 900; // ₹9
const DEFAULT_BULLETS = [
  'New category live right after payment',
  'Show up in that category’s customer searches',
  'One-time fee · no renewal',
];

async function getOrCreateAddServicePlan() {
  let plan = await AddServicePlanModel.findById(SINGLETON_ID);
  if (!plan) {
    plan = await AddServicePlanModel.create({
      baseFeePaise: DEFAULT_BASE_FEE_PAISE,
      gstPaise: DEFAULT_GST_PAISE,
      bullets: DEFAULT_BULLETS,
    });
  }
  return plan;
}

function toDto(plan) {
  const json = plan.toJSON();
  return { ...json, totalPaise: plan.baseFeePaise + plan.gstPaise };
}

async function getAddServicePlan(_req, res) {
  res.json(toDto(await getOrCreateAddServicePlan()));
}

const updateSchema = z.object({
  baseFeePaise: z.number().int().positive().optional(),
  gstPaise: z.number().int().nonnegative().optional(),
  bullets: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
});

async function updateAddServicePlan(req, res) {
  const body = updateSchema.parse(req.body);
  const plan = await getOrCreateAddServicePlan();
  Object.assign(plan, body);
  await plan.save();
  res.json(toDto(plan));
}

module.exports = { getOrCreateAddServicePlan, getAddServicePlan, updateAddServicePlan };
