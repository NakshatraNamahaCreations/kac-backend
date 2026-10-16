// One GST rule for every fee GigKaar charges (vendor registration, agent
// membership, add-service): 18% of the base fee (CGST 9% + SGST 9%).
// Amounts are integer paise; Math.round keeps the GST a whole paisa.
// Mirrored in the app (src/lib/gst.js) and admin panel (admin/src/lib/gst.js)
// so the price people see always matches what Razorpay charges.
const GST_RATE_PERCENT = 18;

function gstForBasePaise(basePaise) {
  return Math.round((basePaise * GST_RATE_PERCENT) / 100);
}

function totalWithGstPaise(basePaise) {
  return basePaise + gstForBasePaise(basePaise);
}

module.exports = { GST_RATE_PERCENT, gstForBasePaise, totalWithGstPaise };
