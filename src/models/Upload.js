const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

const UPLOAD_KINDS = ['aadhaar', 'pan', 'gst', 'shop', 'profile', 'other'];

// Image bytes for KYC documents / shop photos, stored in MongoDB (no
// S3/Cloudinary account is configured — Render's own disk is ephemeral, so
// files on it would vanish on every deploy). The document _id is the "key"
// the rest of the system already stores (Vendor.kyc.aadhaarPhotoKey,
// Onboarding.aadhaarPhotoKey, ...), so moving to object storage later only
// changes where these bytes live, not any of those references.
//
// Private by design: served only through GET /uploads/:id to the uploader,
// the vendor whose KYC references it, or the admin panel.
const uploadSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: UPLOAD_KINDS, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(uploadSchema);

const UploadModel = model('Upload', uploadSchema);

module.exports = { UploadModel, UPLOAD_KINDS };
