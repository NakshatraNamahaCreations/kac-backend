const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// Singleton, like AgentPlan — the one-time fee an existing vendor pays to
// add another service category (Profile > Services > Add service). Admin-
// managed so the price can change without an app release; read by both the
// app's fee card and payments.controller.js's order amount, so the two can
// never drift apart. GST is a flat amount here (not a %), matching how this
// fee has always been charged (₹399 + ₹9).
const SINGLETON_ID = 'add_service_plan';

const addServicePlanSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    baseFeePaise: { type: Number, required: true, min: 0 },
    gstPaise: { type: Number, required: true, min: 0 },
    bullets: { type: [String], default: [] },
  },
  { timestamps: true },
);

applyIdTransform(addServicePlanSchema);
const AddServicePlanModel = model('AddServicePlan', addServicePlanSchema);

module.exports = { AddServicePlanModel, SINGLETON_ID };
