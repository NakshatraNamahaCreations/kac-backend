const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// Singleton — unlike VendorPlan (multiple admin-managed BASIC/PRO tiers),
// agent registration has always been exactly one flat membership fee, so
// this collection only ever holds a single document, always looked up by
// this fixed id (see agentPlan.controller.js's getOrCreateAgentPlan).
// GST for agent registration is a flat ₹9 (not the 18% vendor plans use) —
// intentionally left as a payments.controller.js constant rather than a
// field here, since only baseFeePaise/bullets were ever meant to be
// admin-editable.
const SINGLETON_ID = 'agent_plan';

const agentPlanSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    baseFeePaise: { type: Number, required: true, min: 0 },
    bullets: { type: [String], default: [] },
  },
  { timestamps: true },
);

applyIdTransform(agentPlanSchema);
const AgentPlanModel = model('AgentPlan', agentPlanSchema);

module.exports = { AgentPlanModel, SINGLETON_ID };
