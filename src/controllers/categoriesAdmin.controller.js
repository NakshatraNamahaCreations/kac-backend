const { z } = require('zod');
const { CategoryModel } = require('../models/Category');
const { fail } = require('../lib/httpError');

// Admin sees everything, including inactive — the public /categories list
// (categories.controller.js) filters to active:true only.
async function listCategoriesAdmin(_req, res) {
  const categories = await CategoryModel.find({}).sort({ name: 1 });
  res.json(categories.map((c) => c.toJSON()));
}

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  iconKey: z.string().min(1),
  imageUrl: z.string().url().nullable().optional(),
  tags: z.array(z.string()).optional(),
  suggestedMinPaise: z.number().int().nonnegative().nullable().optional(),
  suggestedMaxPaise: z.number().int().nonnegative().nullable().optional(),
  popular: z.boolean().optional(),
});

// The vendor sign-up wizard's category picker (StepCategories.jsx) and the
// customer home/category grids all read straight off this collection via
// GET /categories, so a new category here shows up in the app immediately —
// no client release needed.
async function createCategory(req, res) {
  const body = createSchema.parse(req.body);
  const slug = slugify(body.name);
  if (!slug) fail(400, 'INVALID_NAME', 'Category name must contain at least one letter or number.');
  const existing = await CategoryModel.findOne({ slug });
  if (existing) fail(409, 'SLUG_EXISTS', 'A category with this name already exists.');
  const category = await CategoryModel.create({
    _id: `cat_${slug.replace(/-/g, '_')}`,
    slug,
    ...body,
  });
  res.status(201).json(category.toJSON());
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  iconKey: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  tags: z.array(z.string()).optional(),
  suggestedMinPaise: z.number().int().nonnegative().nullable().optional(),
  suggestedMaxPaise: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
  popular: z.boolean().optional(),
});

// Keyed by id (the "cat_xxx" slug-style _id already baked into the mobile
// app's fixtures) — slug/name are editable but id itself never changes,
// since Vendor.categories and Booking's category reference store this id.
async function updateCategory(req, res) {
  const category = await CategoryModel.findById(req.params.id);
  if (!category) fail(404, 'NOT_FOUND', 'Category not found.');
  const body = updateSchema.parse(req.body);
  Object.assign(category, body);
  await category.save();
  res.json(category.toJSON());
}

// Hard delete — matches the VendorPlan precedent (deleting a plan/category
// doesn't retroactively touch vendors already using it; it just stops
// appearing in future pickers/listings).
async function deleteCategory(req, res) {
  const category = await CategoryModel.findById(req.params.id);
  if (!category) fail(404, 'NOT_FOUND', 'Category not found.');
  await category.deleteOne();
  res.status(204).end();
}

module.exports = { listCategoriesAdmin, createCategory, updateCategory, deleteCategory };
