// Unit tests for js/utils.js - run with:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeWeather, isValidEmail, passwordProblems, cleanText, roundCoord, distanceKm,
  shortPlaceName, parseWeather, computeStats, filterMoments, fitSize, formatDate,
} from './utils.js';

test('describeWeather maps known and unknown codes', () => {
  assert.deepEqual(describeWeather(0), { text: 'Clear sky', icon: '☀️' });
  assert.equal(describeWeather(63).text, 'Rain');
  assert.equal(describeWeather(12345).text, 'Unknown');
});

test('isValidEmail accepts good emails and rejects bad ones', () => {
  assert.ok(isValidEmail('student@dundee.ac.uk'));
  assert.ok(isValidEmail('  a.b@example.com  '));
  for (const bad of ['', 'nope', 'a@b', 'a @b.com', null, 42]) assert.equal(isValidEmail(bad), false, String(bad));
});

test('passwordProblems enforces length, letter and number', () => {
  assert.deepEqual(passwordProblems('abc12345'), []);
  assert.deepEqual(passwordProblems('short1'), ['at least 8 characters']);
  assert.deepEqual(passwordProblems('onlyletters'), ['a number']);
  assert.deepEqual(passwordProblems('12345678'), ['a letter']);
  assert.equal(passwordProblems(undefined).length, 3);
});

test('cleanText trims, collapses spaces and limits length', () => {
  assert.equal(cleanText('  hello   world  '), 'hello world');
  assert.equal(cleanText('x'.repeat(200), 80).length, 80);
  assert.equal(cleanText(null), '');
});

test('roundCoord rounds to the requested decimals', () => {
  assert.equal(roundCoord(56.462018, 3), 56.462);
  assert.equal(roundCoord(-2.970721, 2), -2.97);
});

test('distanceKm gives realistic distances', () => {
  assert.equal(distanceKm(56.46, -2.97, 56.46, -2.97), 0);
  const dundeeToEdinburgh = distanceKm(56.462, -2.9707, 55.9533, -3.1883);
  assert.ok(dundeeToEdinburgh > 55 && dundeeToEdinburgh < 60, `got ${dundeeToEdinburgh}`);
});

test('shortPlaceName builds a short name from a Nominatim response', () => {
  assert.equal(
    shortPlaceName({ address: { attraction: 'V&A Dundee', road: 'Riverside Esplanade', city: 'Dundee' } }),
    'V&A Dundee, Dundee',
  );
  assert.equal(shortPlaceName({ address: { road: 'Perth Road', city: 'Dundee' } }), 'Perth Road, Dundee');
  assert.equal(shortPlaceName({ address: {}, display_name: 'Somewhere, Scotland, UK' }), 'Somewhere, Scotland');
  assert.equal(shortPlaceName({ error: 'Unable to geocode' }), null);
  assert.equal(shortPlaceName(null), null);
});

test('parseWeather reads an Open-Meteo response and rejects bad data', () => {
  const w = parseWeather({ current: { temperature_2m: 7.6, weather_code: 3, wind_speed_10m: 14.2 } });
  assert.deepEqual(w, { tempC: 8, code: 3, text: 'Overcast', icon: '☁️', wind: 14 });
  assert.equal(parseWeather({}), null);
  assert.equal(parseWeather(null), null);
  assert.equal(parseWeather({ current: { temperature_2m: null } }), null);
});

test('computeStats counts moments, places, photos and distance', () => {
  const moments = [
    { createdAt: 1, placeName: 'A', hasPhoto: false, lat: 56.462, lon: -2.9707 },
    { createdAt: 2, placeName: 'A', hasPhoto: true, lat: 55.9533, lon: -3.1883 },
    { createdAt: 3, placeName: 'B' },
  ];
  const s = computeStats(moments);
  assert.equal(s.count, 3);
  assert.equal(s.places, 2);
  assert.equal(s.photos, 1);
  assert.ok(s.km > 55 && s.km < 60);
  assert.deepEqual(computeStats(undefined), { count: 0, places: 0, photos: 0, km: 0 });
});

test('filterMoments searches title, note and place (case-insensitive)', () => {
  const list = [
    { title: 'Beach day', note: '', placeName: 'Broughty Ferry' },
    { title: 'Coffee', note: 'Great flat white', placeName: 'Dundee' },
  ];
  assert.equal(filterMoments(list, 'BEACH').length, 1);
  assert.equal(filterMoments(list, 'flat white')[0].title, 'Coffee');
  assert.equal(filterMoments(list, 'ferry').length, 1);
  assert.equal(filterMoments(list, '').length, 2);
  assert.equal(filterMoments(list, 'zzz').length, 0);
});

test('fitSize keeps aspect ratio and never enlarges', () => {
  assert.deepEqual(fitSize(4032, 3024, 1280), { width: 1280, height: 960 });
  assert.deepEqual(fitSize(3024, 4032, 1280), { width: 960, height: 1280 });
  assert.deepEqual(fitSize(800, 600, 1280), { width: 800, height: 600 });
});

test('formatDate handles valid and invalid input', () => {
  assert.match(formatDate(Date.UTC(2026, 10, 25, 12, 0)), /25 Nov 2026/);
  assert.equal(formatDate('not a date'), '');
});
