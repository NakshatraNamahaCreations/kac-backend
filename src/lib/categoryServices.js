// Mirrors CATEGORY_SERVICES in ../../../src/lib/api/mock/server.js so a
// vendor who registers/adds a service against the real backend gets the
// same starter service catalogue the mock demoed, instead of an empty
// `services` array (which made every booking 404 with SERVICE_NOT_FOUND).
const CATEGORY_SERVICES = {
  cat_plumber: [
    { name: 'Tap repair', pricePaise: 30000 },
    { name: 'Pipe leak fix', pricePaise: 50000 },
    { name: 'Geyser install', pricePaise: 90000 },
  ],
  cat_electrician: [
    { name: 'Switchboard fix', pricePaise: 30000 },
    { name: 'Fan installation', pricePaise: 40000 },
    { name: 'Inverter install', pricePaise: 80000 },
  ],
  cat_ac_repair: [
    { name: 'AC service', pricePaise: 60000 },
    { name: 'Gas refill', pricePaise: 250000 },
  ],
  cat_carpenter: [
    { name: 'Door repair', pricePaise: 80000 },
    { name: 'Custom shelf', pricePaise: 350000 },
  ],
  cat_painter: [
    { name: 'Per-sqft interior', pricePaise: 1500 },
    { name: 'Per-sqft exterior', pricePaise: 2200 },
  ],
  cat_house_cleaning: [
    { name: '2BHK deep clean', pricePaise: 300000 },
    { name: '3BHK deep clean', pricePaise: 450000 },
  ],
};

// Returns plain {name, pricePaise} objects — Mongoose assigns each
// subdocument its own _id when pushed onto Vendor.services.
function servicesForCategories(categoryIds) {
  const list = [];
  categoryIds.forEach((cid) => {
    const items = CATEGORY_SERVICES[cid] ?? [{ name: 'General service', pricePaise: 50000 }];
    items.forEach((s) => list.push({ name: s.name, pricePaise: s.pricePaise }));
  });
  if (list.length === 0) {
    list.push({ name: 'General service', pricePaise: 50000 });
  }
  return list;
}

module.exports = { CATEGORY_SERVICES, servicesForCategories };
