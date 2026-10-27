// One full, readable address line for the admin panel, in the same shape the
// customer signup stores: "606, 3rd Cross Road, Srinivaspura, Bengaluru - 560041".
// Agent / vendor signups store a short "house · street · landmark · pincode"
// string and keep the locality in `area` — this merges the two (skipping area
// parts the address already mentions) so every role shows the full address.
function fullAddress(address, area, pincode) {
  const raw = String(address ?? '').trim();
  if (!raw) return null;
  // Show what the person entered, exactly. Only the old short form
  // ("house · street · landmark · pincode", which has no locality) is filled
  // out below with the area.
  if (!raw.includes('·')) return raw;
  const parts = String(address ?? '')
    .split(/\s*·\s*|\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  // No street address saved — show nothing rather than just the locality,
  // so it's obvious the address is missing.
  if (parts.length === 0) return null;

  // Pull a trailing pincode ("560041" or "Bengaluru - 560041") off the end.
  let pin = pincode ? String(pincode).trim() : '';
  const last = parts[parts.length - 1] ?? '';
  const m = last.match(/^(.*?)\s*-?\s*(\d{6})$/);
  if (m) {
    parts.pop();
    if (m[1]) parts.push(m[1].replace(/\s*-\s*$/, ''));
    pin = pin || m[2];
  }

  const lower = parts.join(' ').toLowerCase();
  const allArea = String(area ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  // Add the area only to an address that names no locality at all (the old
  // short "house · street · pincode" form). A full address — e.g. one picked
  // from Google suggestions — already says where it is; adding a separate
  // service area to it would mix two different places.
  const hasLocality = allArea.some((p) => lower.includes(p.toLowerCase()));
  const areaParts = hasLocality ? [] : allArea;

  const line = [...parts, ...areaParts].join(', ');
  if (!line && !pin) return null;
  return pin ? `${line} - ${pin}` : line;
}

module.exports = { fullAddress };
