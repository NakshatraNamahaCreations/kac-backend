const cloudinary = require('cloudinary').v2;
const { env } = require('../config/env');

// Image storage. Every photo the apps upload goes through POST /uploads
// (uploads.controller.js) and lands here, in two flavours:
//   public  — shop photo, profile photo, vendor gallery, category images:
//             stored as normal Cloudinary assets, shown straight from the
//             returned https URL (CDN-cached, resized on the fly).
//   private — KYC documents (Aadhaar / PAN / GST): stored as
//             `authenticated` assets, which Cloudinary refuses to serve
//             without a signature. The API never hands that URL out; it
//             fetches the bytes itself and streams them to an authorised
//             caller (GET /uploads/:id, GET /admin/uploads/:id).
// Without credentials (local dev) uploads.controller falls back to storing
// bytes in MongoDB, as before.
const configured = !!(env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret);

if (configured) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
}

const ROOT_FOLDER = 'gigkaar';

// Resolves { publicId, url, bytes, format, deliveryType }.
function uploadImageBuffer(buffer, { folder, isPrivate }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${ROOT_FOLDER}/${folder}`,
        resource_type: 'image',
        type: isPrivate ? 'authenticated' : 'upload',
        // Strip camera EXIF (GPS location etc.) from what's stored.
        // Public images also get a sane size cap; documents keep full
        // resolution so the text stays readable.
        ...(isPrivate ? {} : { transformation: [{ width: 1600, height: 1600, crop: 'limit' }] }),
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          publicId: result.public_id,
          url: isPrivate ? null : result.secure_url,
          bytes: result.bytes,
          format: result.format,
          deliveryType: result.type,
        });
      },
    );
    stream.end(buffer);
  });
}

// Downloads a private (authenticated) image via a short-lived signed URL.
// Resolves { buffer, contentType }.
async function fetchPrivateImage(publicId, format) {
  const url = cloudinary.url(publicId, {
    type: 'authenticated',
    resource_type: 'image',
    sign_url: true,
    secure: true,
    format,
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cloudinary fetch failed (${res.status})`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
  };
}

async function destroyImage(publicId, deliveryType) {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', type: deliveryType ?? 'upload' });
  } catch {
    // Best effort — an orphaned asset is harmless.
  }
}

module.exports = {
  cloudinaryConfigured: configured,
  uploadImageBuffer,
  fetchPrivateImage,
  destroyImage,
};
