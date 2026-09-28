const { z } = require('zod');
const { isValidObjectId } = require('mongoose');
const { UploadModel, UPLOAD_KINDS } = require('../models/Upload');
const { VendorModel } = require('../models/Vendor');
const { fail } = require('../lib/httpError');

const MAX_BYTES = 6 * 1024 * 1024;
// Abuse guard: a KYC flow needs a handful of images per person, not hundreds.
const MAX_UPLOADS_PER_USER = 100;

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

// POST /uploads  { kind, dataBase64 } -> 201 { key, kind, contentType, size }
async function createUpload(req, res) {
  const body = uploadSchema.parse(req.body);
  // Tolerate a data-URL prefix ("data:image/jpeg;base64,....").
  const b64 = body.dataBase64.replace(/^data:[^;]+;base64,/, '');
  const data = Buffer.from(b64, 'base64');
  if (data.length === 0) fail(400, 'INVALID_IMAGE', 'That file is empty.');
  if (data.length > MAX_BYTES) {
    fail(413, 'IMAGE_TOO_LARGE', 'That photo is too large. Please use one under 6 MB.');
  }
  const contentType = sniffImageType(data);
  if (!contentType) fail(400, 'INVALID_IMAGE', 'Only JPEG, PNG or WebP photos can be uploaded.');

  const count = await UploadModel.countDocuments({ ownerId: req.user._id });
  if (count >= MAX_UPLOADS_PER_USER) {
    fail(429, 'UPLOAD_LIMIT', 'Upload limit reached. Please contact support.');
  }

  const doc = await UploadModel.create({
    ownerId: req.user._id,
    kind: body.kind,
    contentType,
    size: data.length,
    data,
  });
  res.status(201).json({ key: String(doc._id), kind: doc.kind, contentType, size: data.length });
}

function sendImage(res, doc) {
  res.set('Content-Type', doc.contentType);
  res.set('Content-Length', String(doc.size));
  // Private documents: the app may cache them on-device, shared caches must not.
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(doc.data);
}

// GET /uploads/:id — the uploader, or a vendor whose registered KYC/profile
// points at this key (e.g. documents an agent uploaded for them during
// in-person onboarding, see agent.controller.js's createOnboarding).
async function getUpload(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) fail(404, 'NOT_FOUND', 'Image not found.');
  const doc = await UploadModel.findById(id);
  if (!doc) fail(404, 'NOT_FOUND', 'Image not found.');

  let allowed = String(doc.ownerId) === String(req.user._id);
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
  sendImage(res, doc);
}

// GET /admin/uploads/:id — admin panel, for reviewing a vendor's KYC.
async function getUploadAdmin(req, res) {
  const { id } = req.params;
  if (!isValidObjectId(id)) fail(404, 'NOT_FOUND', 'Image not found.');
  const doc = await UploadModel.findById(id);
  if (!doc) fail(404, 'NOT_FOUND', 'Image not found.');
  sendImage(res, doc);
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

module.exports = { createUpload, getUpload, getUploadAdmin, assertOwnedUploads };
