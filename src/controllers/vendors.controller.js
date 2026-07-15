const { z } = require('zod');
const { VendorModel } = require('../models/Vendor');
const { ReviewModel } = require('../models/Review');
const { CategoryModel } = require('../models/Category');
const { fail } = require('../lib/httpError');
const { buildPage, parseCursor } = require('../lib/pagination');
const { distanceMeters } = require('../lib/geo');

function toCard(v, userPos) {
  const json = v.toJSON();
  return {
    id: json.id,
    name: json.name,
    primaryCategoryId: json.primaryCategoryId,
    categories: json.categories,
    area: json.area,
    photoUrl: json.photoUrl,
    blurhash: json.blurhash,
    rating: json.rating,
    reviewCount: json.reviewCount,
    distanceMeters: userPos ? Math.round(distanceMeters(userPos, json.geo)) : null,
    availability: json.availability,
    verified: json.verified,
  };
}

async function listVendors(req, res) {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : undefined;
  const area = typeof req.query.area === 'string' ? req.query.area.toLowerCase() : undefined;
  const lat = req.query.lat ? Number(req.query.lat) : undefined;
  const lng = req.query.lng ? Number(req.query.lng) : undefined;
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'rating';
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 8;

  const filter = {};
  if (category) filter.categories = category;
  if (area) filter.area = { $regex: area, $options: 'i' };

  let vendors = await VendorModel.find(filter);

  if (q) {
    const categoryNames = new Map(
      (await CategoryModel.find({}, { name: 1 })).map((c) => [String(c._id), c.name.toLowerCase()]),
    );
    vendors = vendors.filter((v) => {
      if (v.name.toLowerCase().includes(q)) return true;
      if (v.area.toLowerCase().includes(q)) return true;
      if (v.services.some((s) => s.name.toLowerCase().includes(q))) return true;
      if (v.categories.some((cid) => (categoryNames.get(cid) ?? '').includes(q))) return true;
      return false;
    });
  }

  const userPos = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng) ? { lat, lng } : undefined;
  let cards = vendors.map((v) => toCard(v, userPos));

  if (sort === 'nearest' && userPos) {
    cards.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  } else if (sort === 'newest') {
    cards.reverse();
  } else {
    cards.sort((a, b) => b.rating - a.rating);
  }

  const total = cards.length;
  const page = cards.slice(skip, skip + limit);
  res.json(buildPage(page, skip, limit, total));
}

async function getVendor(req, res) {
  const vendor = await VendorModel.findById(req.params.id);
  if (!vendor) fail(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');
  res.json(vendor.toJSON());
}

async function listVendorReviews(req, res) {
  const skip = parseCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
  const limit = 10;
  const [total, reviews] = await Promise.all([
    ReviewModel.countDocuments({ vendorId: req.params.id }),
    ReviewModel.find({ vendorId: req.params.id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);
  res.json(buildPage(reviews.map((r) => r.toJSON()), skip, limit, total));
}

const reviewBodySchema = z.object({ rating: z.number().min(1).max(5), text: z.string().max(2000) });

async function createVendorReview(req, res) {
  const body = reviewBodySchema.parse(req.body);
  const vendor = await VendorModel.findById(req.params.id);
  if (!vendor) fail(404, 'VENDOR_NOT_FOUND', 'Vendor not found.');

  const review = await ReviewModel.create({
    vendorId: vendor._id,
    customerId: req.user._id,
    customerName: req.user.name ?? 'You',
    rating: body.rating,
    text: body.text,
  });

  const stats = await ReviewModel.aggregate([
    { $match: { vendorId: vendor._id } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  if (stats[0]) {
    vendor.rating = Math.round(stats[0].avg * 10) / 10;
    vendor.reviewCount = stats[0].count;
    await vendor.save();
  }

  res.status(201).json(review.toJSON());
}

module.exports = {
  listVendors,
  getVendor,
  listVendorReviews,
  createVendorReview,
};
