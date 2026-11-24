// Unit tests for js/api.js using a fake fetch (no real network needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJSON, getWeather } from './api.js';

const fakeFetch = (body, { ok = true, status = 200, delay = 0 } = {}) => (url, { signal } = {}) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ ok, status, json: async () => body }), delay);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });

test('fetchJSON returns parsed JSON', async () => {
  const data = await fetchJSON('https://x.test', { fetchImpl: fakeFetch({ hello: 'world' }) });
  assert.deepEqual(data, { hello: 'world' });
});

test('fetchJSON throws a clear error on HTTP failure', async () => {
  await assert.rejects(
    () => fetchJSON('https://x.test', { fetchImpl: fakeFetch({}, { ok: false, status: 503 }) }),
    /Server replied 503/,
  );
});

test('fetchJSON times out on a slow server', async () => {
  await assert.rejects(
    () => fetchJSON('https://x.test', { timeout: 50, fetchImpl: fakeFetch({}, { delay: 1000 }) }),
    /timed out/,
  );
});

test('getWeather builds the right URL and parses the result', async () => {
  let calledUrl;
  const fetchImpl = (url, opts) => {
    calledUrl = url;
    return fakeFetch({ current: { temperature_2m: 4.4, weather_code: 61, wind_speed_10m: 20 } })(url, opts);
  };
  const w = await getWeather(56.46, -2.97, { fetchImpl });
  assert.match(calledUrl, /api\.open-meteo\.com/);
  assert.match(calledUrl, /latitude=56\.46/);
  assert.match(calledUrl, /longitude=-2\.97/);
  assert.equal(w.tempC, 4);
  assert.equal(w.text, 'Light rain');
});

test('getWeather returns null when the API sends unexpected data', async () => {
  assert.equal(await getWeather(0, 0, { fetchImpl: fakeFetch({ error: true }) }), null);
});
