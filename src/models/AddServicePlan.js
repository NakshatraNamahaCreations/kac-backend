const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// Singleton, like AgentPlan — the one-time fee an existing vendor pays to
// add another service category (Profile > Services > Add service). Admin-
// managed so the price can change without an app release; read by both the
// app's fee card and payments.controller.js's order amount, so the two can
// never drift apart. GST is 18% of the base fee (lib/gst.js).
const SINGLETON_ID = 'add_service_plan';

const addServicePlanSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    baseFeePaise: { type: Number, required: true, min: 0 },
    // Legacy flat GST (₹9) — no longer used; GST is 18% of baseFeePaise.
    gstPaise: { type: Number, default: null },
    bullets: { type: [String], default: [] },
  },
  { timestamps: true },
);

applyIdTransform(addServicePlanSchema);
const AddServicePlanModel = model('AddServicePlan', addServicePlanSchema);

module.exports = { AddServicePlanModel, SINGLETON_ID };
