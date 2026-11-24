// api.js - talks to the two free, key-less web APIs.
//   Open-Meteo (weather):            https://open-meteo.com
//   OpenStreetMap Nominatim (places): https://nominatim.org  (max 1 request/second)
// Every request has a timeout so a slow network never freezes the app.

import { parseWeather, shortPlaceName, roundCoord } from './utils.js';

const TIMEOUT_MS = 8000;
const placeCache = new Map(); // avoids asking Nominatim twice for the same spot
let lastNominatimCall = 0;

export async function fetchJSON(url, { timeout = TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Server replied ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getWeather(lat, lon, opts) {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    '&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto';
  return parseWeather(await fetchJSON(url, opts));
}

export async function getPlaceName(lat, lon, opts) {
  const key = `${roundCoord(lat, 4)},${roundCoord(lon, 4)}`;
  if (placeCache.has(key)) return placeCache.get(key);

  // Respect Nominatim's fair-use policy: no more than one request per second.
  const wait = 1100 - (Date.now() - lastNominatimCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();

  const url =
    'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18' +
    `&accept-language=en&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  const name = shortPlaceName(await fetchJSON(url, opts));
  if (name) placeCache.set(key, name);
  return name;
}
