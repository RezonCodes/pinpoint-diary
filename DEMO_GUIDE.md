# Pinpoint Diary: Demo & Submission Guide

## 1. Tonight's checklist (in this order)

- [ ] Put the app on GitHub Pages (see README → *Deploy*). Open the link on your phone.
- [ ] Install it to the home screen, allow Location, and take a real photo moment. **Test on the exact phone you will bring.**
- [ ] Turn on Airplane mode → open the app from the home screen → it must still open and log in.
- [ ] Do the user test (section 4) with 3–5 people and write the results into the report.
- [ ] Fill in every **yellow** part of the report: name, ID, links, user testing, your phone, AI reflection **in your own words**. Then *File → Save as PDF* and name it `YourName_StudentID_ProjectReport.pdf`.
- [ ] Run `npm test` once on your laptop so you have seen the 25 tests pass. Keep that terminal open for the demo.
- [ ] Before the demo: add 3–4 real moments (different places) so the timeline and map look full. Charge the phone.
- [ ] Submit on MyDundee by **5 pm Wednesday**: the GitHub repo link (or the zip) + the PDF report.

**Backup plan:** if the phone fails, open the GitHub Pages link in Chrome on a laptop → F12 → device toolbar (Ctrl+Shift+M). DevTools → *Sensors* lets you set a fake location.

## 2. Five-minute demo script

| Time | Do | Say |
|---|---|---|
| 0:00 | Show home-screen icon | "Pinpoint Diary is a private photo diary that pins each moment to where it happened, with the weather. It's a PWA, so one codebase runs on both iPhone and Android." |
| 0:30 | Log in (type a wrong password first) | "Passwords are hashed with PBKDF2 and never stored. Wrong passwords get a generic message, and 5 failures lock login for 30 seconds." |
| 1:00 | Timeline → search | "Bottom tab bar for one-handed use. Search filters by title, note or place." |
| 1:30 | **Add** → take photo → title → save | "This uses the GPS and the camera. The place comes from OpenStreetMap and the weather from Open-Meteo, fetched in parallel with timeouts. The photo is resized from several MB to 1280 px for speed." |
| 2:30 | Open the moment → *Show on map* | "Leaflet map with a pin for every moment." |
| 3:00 | **Airplane mode** on → reopen app → add a moment | "The service worker caches the app, so it works offline. The moment keeps its GPS, and when I reconnect…" → turn data back on → "…place and weather are filled in automatically." |
| 3:45 | Profile → dark mode, large text, approx. location | "Accessibility: screen-reader labels, AA contrast, dark mode, text sizes. For privacy, approximate location hides your exact spot, and you can export or delete all data." |
| 4:15 | (laptop) `npm test` | "All diary data is AES-256 encrypted on the phone. I have 25 unit tests, including encryption, plus an end-to-end test with 16 steps. It found real bugs, like the tab bar disappearing with large text." |
| 4:45 | | "Next I'd add encrypted cloud backup and reminders. Thank you!" |

## 3. Questions you may be asked

**Why a PWA instead of native or Flutter?** One codebase for iOS and Android, no app store, it installs to the home screen and works offline. Downside: fewer hardware APIs on iOS (e.g. no barcode scanning or background GPS), so I only used features both platforms support.

**Where is the data stored?** In IndexedDB on the phone. There's no server. Each moment's details, thumbnail and photo are encrypted with AES-GCM before saving.

**How does the encryption key work?** When you log in, PBKDF2 turns your password plus a random salt into a 256-bit AES key. The key is kept only in memory (not extractable), so closing the app or the auto-lock forgets it. A wrong password can't decrypt, and AES-GCM detects tampering.

**What happens if the user forgets the password?** The data can't be recovered. That's a deliberate privacy trade-off, and the sign-up screen says so.

**How do you handle the APIs failing?** Every request has an 8-second timeout (AbortController). `Promise.allSettled` means one API failing doesn't block the other. Offline moments are flagged and filled in later. Nominatim is cached and limited to 1 request per second because of its usage policy.

**How does offline work?** `sw.js` pre-caches the app files on install and serves them cache-first. Map tiles you've viewed are cached too (up to 300). API calls always go to the network, and the app handles failures.

**Security against attacks?** User text is shown with `textContent`, never `innerHTML`, so there's no XSS. A Content Security Policy only allows scripts from the app itself. It runs over HTTPS only. Login has a lock-out and doesn't reveal which emails have accounts.

**How did you test?** Unit tests with Node's test runner, an end-to-end Playwright script on a phone-sized screen with fake GPS, camera and API responses, manual testing on my phone, and user testing with N people.

**A bug you fixed?** With extra-large text, long titles made the timeline wider than the screen, which pushed the tab bar off-screen. I fixed it with `minmax(0, 1fr)` grid columns.

**Did you use AI?** Yes, Claude, and I acknowledged it in the report. *(Be honest. Explain which parts you reviewed, tested and changed.)*

**Read through `js/app.js` → `wireMomentForm()` and `js/crypto.js` before the demo.** Those are the most likely "show me the code" questions.

## 4. User testing (10 minutes per person)

Ask 3–5 people to try the app on a phone. Don't help them; just watch and write notes.

1. "Create an account."
2. "Save a moment with a photo of something near you."
3. "Find that moment on the map."
4. "Change the app to dark mode and bigger text."
5. "Find a moment by searching for a word."

After each person, ask:
- "From 1–5, how easy was it?"
- "What was confusing?"
- "What would you add?"

Write down how many tasks each person completed without help, their scores, and 2–3 common comments. **Change at least one small thing** because of their feedback and mention it in the report. Markers like seeing that.
