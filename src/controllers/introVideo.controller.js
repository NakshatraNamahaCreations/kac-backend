const os = require('node:os');
const fs = require('node:fs');
const { z } = require('zod');
const multer = require('multer');
const mongoose = require('mongoose');
const { IntroVideoModel, SINGLETON_ID } = require('../models/IntroVideo');
const { getBucket } = require('../lib/gridfs');
const { fail } = require('../lib/httpError');

const BUCKET_NAME = 'introVideos';
// Atlas's free/shared tiers cap total storage well under a gigabyte, so an
// admin-uploaded tour video is capped generously below that rather than at
// some large "whatever fits in RAM" number. A longer/heavier video should go
// through the link field (YouTube, Cloudinary, etc.) instead.
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024; // 80MB

const DIRECT_FILE = /\.(mp4|m4v|mov|webm|m3u8)$/i;

// What the mobile player needs to decide HOW to play the URL:
//   file    — a direct video file / HLS stream: plays inline (expo-video)
//   youtube — plays via the YouTube app / browser; thumbnail is derived
//   link    — any other page: opened in the browser
function describeUrl(rawUrl) {
  if (!rawUrl) return { kind: null, youtubeId: null };
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'link', youtubeId: null };
  }
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtu.be') {
    return { kind: 'youtube', youtubeId: url.pathname.slice(1) || null };
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id =
      url.searchParams.get('v') ??
      url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1] ??
      null;
    return { kind: 'youtube', youtubeId: id };
  }
  if (DIRECT_FILE.test(url.pathname)) return { kind: 'file', youtubeId: null };
  return { kind: 'link', youtubeId: null };
}

async function getOrCreate() {
  let doc = await IntroVideoModel.findById(SINGLETON_ID);
  if (!doc) doc = await IntroVideoModel.create({});
  return doc;
}

// Builds the response shape the mobile app + admin panel both read:
// `source` ('upload' | 'link'), `kind` (how to play it), `videoUrl` (always
// a directly usable URL — for an upload, this server's own streaming route).
function serialize(doc, req) {
  const json = doc.toJSON();
  if (json.videoFileId) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return {
      ...json,
      source: 'upload',
      videoUrl: `${origin}/intro-video/file/${json.videoFileId}`,
      kind: 'file',
      youtubeId: null,
      thumbnailUrl: json.thumbnailUrl || '',
    };
  }
  const { kind, youtubeId } = describeUrl(json.videoUrl);
  const thumbnailUrl =
    json.thumbnailUrl || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : '');
  return { ...json, source: 'link', videoFileId: null, kind, youtubeId, thumbnailUrl };
}

async function getIntroVideoAdmin(req, res) {
  res.json(serialize(await getOrCreate(), req));
}

// Empty string is allowed (clears the field); anything else must be an
// http(s) URL so the app never tries to open javascript:/file: schemes.
const urlField = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Enter a valid http(s) link');

const updateSchema = z.object({
  active: z.boolean().optional(),
  videoUrl: urlField.optional(),
  thumbnailUrl: urlField.optional(),
  title: z.string().trim().max(80).optional(),
  subtitle: z.string().trim().max(240).optional(),
});

async function deleteGridfsFile(fileId) {
  if (!fileId) return;
  try {
    await getBucket(BUCKET_NAME).delete(new mongoose.Types.ObjectId(fileId));
  } catch {
    // Already gone, or never fully committed — nothing to clean up.
  }
}

// Saving a link (even the same PATCH that only touches title/thumbnail) is
// how the admin panel's "Link" tab switches away from an uploaded file — so
// any request that mentions videoUrl at all clears a previously uploaded
// file, freeing its GridFS storage. A request that never mentions videoUrl
// (e.g. just flipping `active`) leaves an existing upload alone.
async function updateIntroVideo(req, res) {
  const switchingToLink = Object.prototype.hasOwnProperty.call(req.body, 'videoUrl');
  const body = updateSchema.parse(req.body);
  const doc = await getOrCreate();

  if (switchingToLink && doc.videoFileId) {
    await deleteGridfsFile(doc.videoFileId);
    doc.videoFileId = null;
    doc.videoFileName = '';
    doc.videoFileSize = 0;
    doc.videoContentType = '';
  }

  Object.assign(doc, body);
  // A tour with no video (either kind) can't be "active".
  if (!doc.videoUrl && !doc.videoFileId) doc.active = false;
  await doc.save();
  res.json(serialize(doc, req));
}

// multer stores the upload to a tmp file first (rather than buffering the
// whole thing in process memory) and streamIntoGridfs below pipes that file
// into GridFS, deleting the tmp file afterwards either way.
const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      const err = new Error('Please choose a video file.');
      err.code = 'UNSUPPORTED_FILE_TYPE';
      cb(err);
      return;
    }
    cb(null, true);
  },
}).single('video');

function streamIntoGridfs(tmpPath, { filename, contentType }) {
  return new Promise((resolve, reject) => {
    const uploadStream = getBucket(BUCKET_NAME).openUploadStream(filename, { contentType });
    fs.createReadStream(tmpPath)
      .on('error', reject)
      .pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => resolve(uploadStream.id));
  });
}

async function uploadIntroVideoFile(req, res) {
  if (!req.file) fail(400, 'NO_FILE', 'Choose a video file to upload.');

  try {
    const doc = await getOrCreate();
    const previousFileId = doc.videoFileId;

    const fileId = await streamIntoGridfs(req.file.path, {
      filename: req.file.originalname || `intro-video-${Date.now()}`,
      contentType: req.file.mimetype,
    });

    // Uploading is how the admin panel's "Upload" tab switches away from a
    // link — clear it so the two sources can't disagree about which plays.
    doc.videoUrl = '';
    doc.videoFileId = fileId;
    doc.videoFileName = req.file.originalname || '';
    doc.videoFileSize = req.file.size;
    doc.videoContentType = req.file.mimetype;
    await doc.save();

    // Old file is only removed once the new one is safely committed, so a
    // failed upload never leaves the tour with no video at all.
    await deleteGridfsFile(previousFileId);

    res.json(serialize(doc, req));
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}

async function deleteIntroVideoFile(req, res) {
  const doc = await getOrCreate();
  if (doc.videoFileId) {
    await deleteGridfsFile(doc.videoFileId);
    doc.videoFileId = null;
    doc.videoFileName = '';
    doc.videoFileSize = 0;
    doc.videoContentType = '';
  }
  if (!doc.videoUrl) doc.active = false;
  await doc.save();
  res.json(serialize(doc, req));
}

// Public (no auth) — the intro screen renders right after login, and there's
// nothing sensitive in a tutorial video. Returns { active: false } until the
// admin publishes one, so the app falls back to its placeholder.
async function getIntroVideoPublic(req, res) {
  const v = serialize(await getOrCreate(), req);
  if (!v.active || !v.videoUrl) return res.json({ active: false });
  res.json({
    active: true,
    videoUrl: v.videoUrl,
    kind: v.kind,
    thumbnailUrl: v.thumbnailUrl,
    title: v.title,
    subtitle: v.subtitle,
    updatedAt: v.updatedAt,
  });
}

// Streams an uploaded video's bytes out of GridFS, with HTTP Range support —
// required for the mobile player (and a browser <video> tag) to seek instead
// of only ever downloading from the start. Public: same rationale as above,
// and the id alone (a random ObjectId) isn't guessable.
async function streamIntroVideoFile(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) fail(404, 'NOT_FOUND', 'Video not found.');
  const _id = new mongoose.Types.ObjectId(id);

  const bucket = getBucket(BUCKET_NAME);
  const [file] = await bucket.find({ _id }).toArray();
  if (!file) fail(404, 'NOT_FOUND', 'Video not found.');

  const contentType = file.contentType || 'video/mp4';
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);

  let start = 0;
  let end = file.length - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
      } else if (match[2]) {
        // Suffix range ("bytes=-500" = last 500 bytes) — no start given.
        start = Math.max(0, file.length - Number(match[2]));
      }
      end = Math.min(end, file.length - 1);
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= file.length) {
      res.status(416).setHeader('Content-Range', `bytes */${file.length}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${file.length}`);
    res.setHeader('Content-Length', end - start + 1);
  } else {
    res.setHeader('Content-Length', file.length);
  }

  const downloadStream = bucket.openDownloadStream(_id, { start, end: end + 1 });
  downloadStream.on('error', () => res.destroy());
  downloadStream.pipe(res);
}

module.exports = {
  getIntroVideoAdmin,
  updateIntroVideo,
  uploadIntroVideoMiddleware: upload,
  uploadIntroVideoFile,
  deleteIntroVideoFile,
  getIntroVideoPublic,
  streamIntroVideoFile,
  describeUrl,
};
