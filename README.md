# 📍 Pinpoint Diary

A private, offline-first **Progressive Web App** for saving moments: a photo, a note and a mood,
automatically tagged with **GPS location, place name and live weather**, and shown on a timeline and a map.
Runs on **iPhone (Safari) and Android (Chrome)** from one codebase.

CS32005 Mobile Application Development – University of Dundee.

## Features

| Area | What it does |
|---|---|
| Login | Register / log in, password rules, show-password, 30 s lock-out after 5 wrong tries, auto-lock after 5 min in background |
| Hardware | **GPS** (Geolocation API), **camera** (photo capture, resized for performance) |
| APIs | **Open-Meteo** (weather), **OpenStreetMap Nominatim** (place names), OSM map tiles |
| Local storage | **IndexedDB** – everything is **AES-256-GCM encrypted** with a key derived from the password |
| Offline | Service worker caches the app; moments saved offline get place + weather automatically when back online |
| Screens | Timeline (search), Add/Edit, Detail, Map (Leaflet), Profile (stats, settings, export, delete) |
| Accessibility | Screen-reader labels, focus management, AA contrast, dark mode, 3 text sizes, reduced motion, landscape |
| Privacy | No server, no tracking, approximate-location option, export (JSON) and delete-all |

## Project structure

```
index.html            all screens (shown/hidden by the router)
css/styles.css        styles, light/dark themes
js/app.js             screens, navigation, user actions
js/auth.js            register / login / lock-out
js/crypto.js          PBKDF2 password hashing, AES-GCM encryption (Web Crypto)
js/db.js              IndexedDB storage
js/api.js             weather + place-name APIs (timeouts, caching, rate limit)
js/device.js          GPS + photo processing
js/utils.js           pure helper functions (unit-tested)
sw.js                 service worker (offline)
manifest.webmanifest  install settings, icons
lib/leaflet/          Leaflet 1.9.4 map library (BSD-2)
tests/                unit tests (node --test) + end-to-end script (Playwright)
```

## Run locally

```bash
python3 -m http.server 8080      # or: npm start
# open http://localhost:8080
```
(GPS and the service worker work on `localhost`. On a phone they need **HTTPS**, so use GitHub Pages below.)

## Tests

```bash
npm test                          # 25 unit tests, needs Node 18+
pip install playwright && python3 tests/e2e_playwright.py   # optional end-to-end run (server must be running)
```

## Deploy to GitHub Pages (free HTTPS – needed for phones)

1. Create a new **public** repository on GitHub, e.g. `pinpoint-diary`.
2. Upload all files in this folder (drag-and-drop on the repo page → *Commit changes*), or:
   ```bash
   git init && git add . && git commit -m "Pinpoint Diary v1.0"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/pinpoint-diary.git
   git push -u origin main
   ```
3. Repo **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**.
4. After about 1 minute the app is at `https://YOUR-USERNAME.github.io/pinpoint-diary/`.

## Install on a phone

- **Android (Chrome):** open the link → tap **Install** (or ⋮ menu → *Install app*).
- **iPhone (Safari):** open the link → **Share** button → **Add to Home Screen**.
- Allow **Location** when asked. To take photos, tap *Take or choose photo* → *Take Photo*.

## Credits

Weather: Open-Meteo.com (CC BY 4.0). Places and map: © OpenStreetMap contributors (ODbL).
Map library: Leaflet (BSD-2-Clause). AI assistance: Claude (Anthropic) – see report.
