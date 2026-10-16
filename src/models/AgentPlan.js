const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// Singleton — unlike VendorPlan (multiple admin-managed BASIC/PRO tiers),
// agent registration has always been exactly one flat membership fee, so
// this collection only ever holds a single document, always looked up by
// this fixed id (see agentPlan.controller.js's getOrCreateAgentPlan).
// GST is 18% of baseFeePaise (lib/gst.js), same as every other fee.
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
