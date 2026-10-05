const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const { UploadModel, UPLOAD_KINDS, PRIVATE_KINDS } = require('../models/Upload');
const { VendorModel } = require('../models/Vendor');
const { UserModel } = require('../models/User');
const { fail } = require('../lib/httpError');
const { cloudinaryConfigured, uploadImageBuffer, fetchPrivateImage } = require('../lib/cloudinary');

const MAX_BYTES = 6 * 1024 * 1024;
// Abuse guard: a KYC flow + a gallery needs a handful of images per person,
// not hundreds.
const MAX_UPLOADS_PER_USER = 150;

const uploadSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  dataBase64: z.string().min(100),
});

// Identify the image from its own first bytes instead of trusting the
// client's declared type — so this endpoint can't be used to park arbitrary
// files (HTML, executables) that GET /uploads/:id would later serve back.
function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function decodeImage(dataBase64) {
  // Tolerate a data-URL prefix ("data:image/jpeg;base64,....").
  const data = Buffer.from(dataBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (data.length === 0) fail(400, 'INVALID_IMAGE', 'That file is empty.');
  if (data.length > MAX_BYTES) {
    fail(413, 'IMAGE_TOO_LARGE', 'That photo is too large. Please use one under 6 MB.');
  }
  const contentType = sniffImageType(data);
  if (!contentType) fail(400, 'INVALID_IMAGE', 'Only JPEG, PNG or WebP photos can be uploaded.');
  return { data, contentType };
}

// Stores the image (Cloudinary, or MongoDB when Cloudinary isn't configured)
// and creates the Upload row. Shared by the app and the admin panel.
async function storeImage({ kind, data, contentType, ownerId, uploadedByAdmin = false }) {
  const isPrivate = PRIVATE_KINDS.includes(kind);
  if (!cloudinaryConfigured) {
    return UploadModel.create({ ownerId, uploadedByAdmin, kind, contentType, size: data.length, data });
  }
  let stored;
  try {
    stored = await uploadImageBuffer(data, { folder: isPrivate ? 'kyc' : kind, isPrivate });
  } catch {
    fail(502, 'UPLOAD_FAILED', "Couldn't save that photo right now. Please try again.");
  }
  return UploadModel.create({
    ownerId,
    uploadedByAdmin,
    kind,
    contentType,
    size: stored.bytes ?? data.length,
    cloudinaryPublicId: stored.publicId,
    cloudinaryFormat: stored.format,
    cloudinaryType: stored.deliveryType,
    url: stored.url,
  });
}

function uploadResponse(doc) {
  return {
    key: String(doc._id),
    kind: doc.kind,
    contentType: doc.contentType,
    size: doc.size,
    // Public kinds only — KYC documents never get a shareable URL.
    url: doc.url ?? null,
  };
}

// POST /uploads  { kind, dataBase64 } -> 201 { key, kind, contentType, size, url }
async function createUpload(req, res) {
  const body = uploadSchema.parse(req.body);
  const { data, contentType } = decodeImage(body.dataBase64);

  const count = await UploadModel.countDocuments({ ownerId: req.user._id });
  if (count >= MAX_UPLOADS_PER_USER) {
    fail(429, 'UPLOAD_LIMIT', 'Upload limit reached. Please contact support.');
  }

  const doc = await storeImage({ kind: body.kind, data, contentType, ownerId: req.user._id });
  res.status(201).json(uploadResponse(doc));
}

// POST /admin/uploads { kind: 'category', dataBase64 } — admin panel images.
// POST /admin/uploads { kind, dataBase64, ownerUserId? }
//   'category' — admin-owned category image.
//   KYC / shop / profile / gallery — uploaded by the admin ON BEHALF of a
//   user (ownerUserId), so it's owned by that user exactly as if they had
//   uploaded it from the app: their app can show it, and the usual
//   ownership checks (assertOwnedUploads) accept it on their profile.
const adminUploadSchema = z.object({
  kind: z.enum(['category', 'aadhaar', 'pan', 'gst', 'shop', 'profile', 'gallery']),
  dataBase64: z.string().min(100),
  ownerUserId: z.string().optional(),
});

async function createUploadAdmin(req, res) {
  const body = adminUploadSchema.parse(req.body);
  let ownerId = null;
  if (body.kind !== 'category') {
    if (!body.ownerUserId || !isValidObjectId(body.ownerUserId)) {
      fail(400, 'OWNER_REQUIRED', 'Which user is this photo for?');
    }
    if (!(await UserModel.exists({ _id: body.ownerUserId }))) fail(404, 'NOT_FOUND', 'User not found.');
    ownerId = body.ownerUserId;
  }
  const { data, contentType } = decodeImage(body.dataBase64);
  const doc = await storeImage({ kind: body.kind, data, contentType, ownerId, uploadedByAdmin: true });
  res.status(201).json(uploadResponse(doc));
}

async function sendImage(res, doc) {
  // Public Cloudinary image — let the CDN serve it.
  if (doc.url) {
    res.redirect(302, doc.url);
    return;
  }
  let buffer = doc.data;
  let contentType = doc.contentType;
  if (!buffer && doc.cloudinaryPublicId) {
    try {
      ({ buffer, contentType } = await fetchPrivateImage(doc.cloudinaryPublicId, doc.cloudinaryFormat));
    } catch {
      fail(502, 'IMAGE_UNAVAILABLE', "Couldn't load that image right now. Please try again.");
    }
  }
  if (!buffer) fail(404, 'NOT_FOUND', 'Image not found.');
  res.set('Content-Type', contentType);
  res.set('Content-Length', String(buffer.length));
  // Private documents: the app may cache them on-device, shared caches must not.
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(buffer);
}

// GET /uploads/:id — the uploader, or a vendor whose registered KYC/profile
// points at this key (e.g. documents an agent uploaded for them during
// in-person onboarding, see agent.controller.js's createOnboarding).
async function getUpload(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) fail(404, 'NOT_FOUND', 'Image not found.');
  const doc = await UploadModel.findById(id);
  if (!doc) fail(404, 'NOT_FOUND', 'Image not found.');

  // Public images are public by definition.
  let allowed = !!doc.url || String(doc.ownerId) === String(req.user._id);
  if (!allowed) {
    allowed = !!(await VendorModel.exists({
      userId: req.user._id,
      $or: [
        { 'kyc.aadhaarPhotoKey': id },
        { 'kyc.panPhotoKey': id },
        { 'kyc.gstPhotoKey': id },
      ],
    }));
  }
  if (!allowed) fail(404, 'NOT_FOUND', 'Image not found.');
  await sendImage(res, doc);
}

// GET /admin/uploads/:id — admin panel, for reviewing a vendor's KYC.
async function getUploadAdmin(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) fail(404, 'NOT_FOUND', 'Image not found.');
  const doc = await UploadModel.findById(id);
  if (!doc) fail(404, 'NOT_FOUND', 'Image not found.');
  await sendImage(res, doc);
}

// A submitted *PhotoKey must be an upload this same user made. Without the
// check a client could name someone else's upload id as its own KYC photo
// (and getUpload would then serve it to them, since a vendor may read the
// uploads their KYC references) or a made-up key that never resolves.
// Empty/absent keys are skipped.
async function assertOwnedUploads(ownerId, keys) {
  const wanted = [...new Set(keys.filter(Boolean))];
  if (wanted.length === 0) return;
  const valid = wanted.filter((k) => isValidObjectId(k));
  const owned =
    valid.length > 0 ? await UploadModel.countDocuments({ _id: { $in: valid }, ownerId }) : 0;
  if (valid.length !== wanted.length || owned !== wanted.length) {
    fail(400, 'INVALID_UPLOAD', 'One of the uploaded photos is missing. Please upload it again.');
  }
}

// Public display URL for an upload key the given user owns — used where a
// record stores a URL rather than a key (vendor cover photo, avatars).
// Null for anything else: someone else's upload, a private KYC image, or a
// legacy MongoDB-stored image (no public URL exists for those).
async function publicUrlForOwnedKey(ownerId, key) {
  if (!key || !isValidObjectId(key)) return null;
  const doc = await UploadModel.findOne({ _id: key, ownerId }, 'url');
  return doc?.url ?? null;
}

module.exports = {
  createUpload,
  createUploadAdmin,
  getUpload,
  getUploadAdmin,
  assertOwnedUploads,
  publicUrlForOwnedKey,
};
