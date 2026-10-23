const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// A vendor / agent asking the GigKaar team to change details they can't edit
// in the app (bank account, Aadhaar / PAN / GST, Google Pay / PhonePe number).
// The admin works it from the admin panel (Change requests), makes the edit
// on the user, and moves the status along; the app shows the status.
const CHANGE_REQUEST_CATEGORIES = ['bank', 'kyc', 'upi', 'other'];
const CHANGE_REQUEST_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];

const changeRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Which of their roles the request is about.
    role: { type: String, enum: ['vendor', 'agent'], required: true },
    category: { type: String, enum: CHANGE_REQUEST_CATEGORIES, required: true },
    message: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: CHANGE_REQUEST_STATUSES, default: 'OPEN', index: true },
    // Shown to the user in the app (what was done / why it was rejected).
    adminNote: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    // Every status step, oldest first — the app shows it as a timeline.
    history: {
      type: [
        {
          _id: false,
          status: { type: String, enum: CHANGE_REQUEST_STATUSES, required: true },
          note: { type: String, default: null },
          at: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

applyIdTransform(changeRequestSchema);
const ChangeRequestModel = model('ChangeRequest', changeRequestSchema);

module.exports = { ChangeRequestModel, CHANGE_REQUEST_CATEGORIES, CHANGE_REQUEST_STATUSES };
