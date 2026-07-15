const { CategoryModel } = require('../models/Category');

async function listCategories(_req, res) {
  const categories = await CategoryModel.find({ active: true }).sort({ name: 1 });
  res.json(categories.map((c) => c.toJSON()));
}

module.exports = { listCategories };
