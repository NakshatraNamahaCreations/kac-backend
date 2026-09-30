const { Schema, model } = require('mongoose');
const { applyIdTransform } = require('./plugins');

// KYC documents — never publicly reachable (Cloudinary `authenticated`).
const PRIVATE_KINDS = ['aadhaar', 'pan', 'gst'];
// Shown to other users straight from their Cloudinary URL.
//   shop / profile — vendor cover + avatars, gallery — vendor photos,
//   category — admin-managed category images.
const PUBLIC_KINDS = ['shop', 'profile', 'gallery', 'category', 'other'];
const UPLOAD_KINDS = [...PRIVATE_KINDS, ...PUBLIC_KINDS];

// One row per uploaded image. The document _id is the "key" the rest of the
// system stores (Vendor.kyc.aadhaarPhotoKey, Onboarding.shopPhotoKey, ...).
//
// Where the bytes live:
//   Cloudinary (current) — cloudinaryPublicId set; `url` set for public
//     kinds only. See lib/cloudinary.js.
//   MongoDB (legacy, or when Cloudinary isn't configured) — `data`.
// Served through GET /uploads/:id (uploader, or the vendor whose KYC
// references it) and GET /admin/uploads/:id; public kinds are also usable
// directly via `url`.
const uploadSchema = new Schema(
  {
    // The uploading user. Null for admin-panel uploads (category images) —
    // the admin is a separate identity, not a User.
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    uploadedByAdmin: { type: Boolean, default: false },
    kind: { type: String, enum: UPLOAD_KINDS, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, default: undefined },
    cloudinaryPublicId: { type: String, default: null },
    cloudinaryFormat: { type: String, default: null },
    cloudinaryType: { type: String, default: null }, // 'upload' | 'authenticated'
    url: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

applyIdTransform(uploadSchema);

const UploadModel = model('Upload', uploadSchema);

module.exports = { UploadModel, UPLOAD_KINDS, PRIVATE_KINDS, PUBLIC_KINDS };
