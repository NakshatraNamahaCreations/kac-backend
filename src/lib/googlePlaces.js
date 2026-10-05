const { env } = require('../config/env');
const { fail } = require('./httpError');

// Address search for the admin panel, proxied through the API so the Google
// key never ships to a browser (and isn't subject to browser CORS / referrer
// restrictions). Same Places API (New) + Geocoding calls the mobile app makes
// (src/lib/googleMaps.js), returning the same field names.

function requireKey() {
  if (!env.googleMapsApiKey) fail(503, 'MAPS_NOT_CONFIGURED', 'Address search is not configured on the server.');
  return env.googleMapsApiKey;
}

function placeFromComponents(components, formattedAddress) {
  const find = (...types) => {
    for (const type of types) {
      const hit = components.find((c) => c.types.includes(type));
      if (hit) return hit.long;
    }
    return undefined;
  };
  const route = find('route');
  const streetNumber = find('street_number');
  const subLocality = find('sublocality_level_1', 'sublocality', 'neighborhood', 'sublocality_level_2');
  return {
    street: route ?? null,
    streetNumber: streetNumber ?? null,
    district: subLocality ?? null,
    city: find('locality', 'administrative_area_level_3', 'administrative_area_level_2') ?? null,
    region: find('administrative_area_level_1') ?? null,
    postalCode: find('postal_code') ?? null,
    formattedAddress: formattedAddress ?? null,
  };
}

// "Indiranagar, Bengaluru, Karnataka"
function localityLabel(p) {
  const parts = [p.district, p.city, p.region];
  return parts.filter((s, i) => !!s && parts.indexOf(s) === i).join(', ');
}

async function searchPlaces(input, sessionToken) {
  const key = requireKey();
  const q = (input ?? '').trim();
  if (q.length < 3) return [];
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ input: q, sessionToken, includedRegionCodes: ['in'], languageCode: 'en' }),
  });
  const json = await res.json();
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      placeId: p.placeId,
      primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }));
}

async function reverseGeocode(lat, lng, key) {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&key=${key}`,
  );
  const json = await res.json();
  if (json.status !== 'OK' || !json.results?.length) return null;
  const comps = [];
  const seen = new Set();
  for (const r of json.results.slice(0, 6)) {
    for (const c of r.address_components ?? []) {
      const k = c.types.join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      comps.push({ long: c.long_name, types: c.types });
    }
  }
  return placeFromComponents(comps, json.results[0].formatted_address);
}

// Resolves { address, area, pincode, lat, lng } for a picked suggestion.
async function placeDetails(placeId, sessionToken) {
  const key = requireKey();
  if (!/^[\w-]+$/.test(placeId ?? '')) fail(400, 'INVALID_PLACE', 'Invalid place.');
  const qs = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}${qs}`, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,addressComponents',
    },
  });
  const json = await res.json();
  if (!json.location) fail(404, 'PLACE_NOT_FOUND', "Couldn't find that address.");
  const comps = (json.addressComponents ?? []).map((c) => ({ long: c.longText, types: c.types ?? [] }));
  const place = placeFromComponents(comps, json.formattedAddress);
  const lat = json.location.latitude;
  const lng = json.location.longitude;
  // Area-level results ("Indiranagar") carry no pincode — look it up.
  if (!place.postalCode || !place.city) {
    const near = await reverseGeocode(lat, lng, key).catch(() => null);
    place.postalCode = place.postalCode ?? near?.postalCode ?? null;
    place.city = place.city ?? near?.city ?? null;
    place.region = place.region ?? near?.region ?? null;
    place.district = place.district ?? near?.district ?? null;
  }
  return {
    address: place.formattedAddress ?? json.displayName?.text ?? '',
    area: localityLabel(place),
    pincode: (place.postalCode ?? '').replace(/\D/g, '').slice(0, 6) || null,
    lat,
    lng,
  };
}

module.exports = { searchPlaces, placeDetails };
