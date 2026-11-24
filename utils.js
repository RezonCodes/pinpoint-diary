// utils.js - small, pure helper functions (no DOM, no network).
// Kept separate so they can be unit-tested with Node's built-in test runner.

/** Open-Meteo WMO weather codes -> readable text + emoji. */
const WEATHER_CODES = {
  0: ['Clear sky', '☀️'],
  1: ['Mainly clear', '🌤️'],
  2: ['Partly cloudy', '⛅'],
  3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'],
  48: ['Freezing fog', '🌫️'],
  51: ['Light drizzle', '🌦️'],
  53: ['Drizzle', '🌦️'],
  55: ['Heavy drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'],
  57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'],
  63: ['Rain', '🌧️'],
  65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'],
  67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'],
  73: ['Snow', '🌨️'],
  75: ['Heavy snow', '❄️'],
  77: ['Snow grains', '🌨️'],
  80: ['Rain showers', '🌦️'],
  81: ['Rain showers', '🌧️'],
  82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'],
  86: ['Heavy snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'],
  96: ['Thunderstorm with hail', '⛈️'],
  99: ['Thunderstorm with hail', '⛈️'],
};

export function describeWeather(code) {
  const entry = WEATHER_CODES[code];
  if (!entry) return { text: 'Unknown', icon: '🌡️' };
  return { text: entry[0], icon: entry[1] };
}

/** Basic email format check (not perfect on purpose - just catches typos). */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/**
 * Password rules: at least 8 characters, one letter and one number.
 * Returns a list of problems (empty list = password is OK).
 */
export function passwordProblems(pw) {
  const problems = [];
  if (typeof pw !== 'string' || pw.length < 8) problems.push('at least 8 characters');
  if (!/[A-Za-z]/.test(pw || '')) problems.push('a letter');
  if (!/[0-9]/.test(pw || '')) problems.push('a number');
  return problems;
}

/** Trim and limit the length of user text so storage cannot be flooded. */
export function cleanText(value, maxLength = 500) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Round coordinates (used as a cache key and to limit location precision shown). */
export function roundCoord(value, decimals = 3) {
  const f = 10 ** decimals;
  return Math.round(Number(value) * f) / f;
}

/** Distance in km between two GPS points (Haversine formula). */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** "12 Mar 2026, 14:05" style date. */
export function formatDate(timestamp, locale = 'en-GB') {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Turn a Nominatim reverse-geocode response into a short place name. */
export function shortPlaceName(data) {
  if (!data || typeof data !== 'object') return null;
  const a = data.address || {};
  const local = a.attraction || a.tourism || a.amenity || a.leisure || a.building ||
    a.road || a.neighbourhood || a.suburb || a.village || a.hamlet;
  const town = a.city || a.town || a.village || a.municipality || a.county;
  const parts = [local, town].filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  if (unique.length) return unique.join(', ');
  if (data.display_name) return String(data.display_name).split(',').slice(0, 2).join(',').trim();
  return null;
}

/** Turn an Open-Meteo "current" response into the fields we store. */
export function parseWeather(data) {
  const c = data && data.current;
  if (!c || typeof c.temperature_2m !== 'number') return null;
  const { text, icon } = describeWeather(c.weather_code);
  return {
    tempC: Math.round(c.temperature_2m),
    code: c.weather_code,
    text,
    icon,
    wind: typeof c.wind_speed_10m === 'number' ? Math.round(c.wind_speed_10m) : null,
  };
}

/** Summary numbers for the profile screen. */
export function computeStats(moments) {
  const list = Array.isArray(moments) ? moments : [];
  const places = new Set(list.map((m) => m.placeName).filter(Boolean));
  const withGps = list.filter((m) => typeof m.lat === 'number' && typeof m.lon === 'number')
    .sort((a, b) => a.createdAt - b.createdAt);
  let km = 0;
  for (let i = 1; i < withGps.length; i++) {
    km += distanceKm(withGps[i - 1].lat, withGps[i - 1].lon, withGps[i].lat, withGps[i].lon);
  }
  return {
    count: list.length,
    places: places.size,
    photos: list.filter((m) => m.hasPhoto).length,
    km: Math.round(km * 10) / 10,
  };
}

/** Case-insensitive search over title, note and place name. */
export function filterMoments(moments, query) {
  const q = cleanText(query, 100).toLowerCase();
  if (!q) return moments;
  return moments.filter((m) =>
    [m.title, m.note, m.placeName].some((f) => (f || '').toLowerCase().includes(q)));
}

/** Work out a scaled size that fits inside maxSize while keeping aspect ratio. */
export function fitSize(width, height, maxSize) {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const scale = maxSize / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
