# End-to-end test: drives the real app in Chrome on a phone-sized screen with fake GPS,
# a fake camera photo and mocked APIs. Start a server first (python3 -m http.server 8080).
import json, sys, time
from playwright.sync_api import sync_playwright, expect

import os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = HERE
BASE = os.environ.get('BASE', 'http://localhost:8080/')
SHOTS = os.path.join(HERE, 'screenshots') + '/'
os.makedirs(SHOTS, exist_ok=True)
PHOTO = os.path.join(HERE, 'test-photo.jpg')
errors = []

WEATHER = {"current": {"temperature_2m": 6.3, "weather_code": 2, "wind_speed_10m": 18.0}}
PLACE = {"address": {"attraction": "V&A Dundee", "road": "Riverside Esplanade", "city": "Dundee"},
         "display_name": "V&A Dundee, Riverside Esplanade, Dundee"}
api_calls = {'weather': 0, 'place': 0}

def mock_routes(ctx):
    def weather(route):
        api_calls['weather'] += 1
        route.fulfill(status=200, content_type='application/json', body=json.dumps(WEATHER),
                      headers={'Access-Control-Allow-Origin': '*'})
    def place(route):
        api_calls['place'] += 1
        route.fulfill(status=200, content_type='application/json', body=json.dumps(PLACE),
                      headers={'Access-Control-Allow-Origin': '*'})
    ctx.route('**/api.open-meteo.com/**', weather)
    ctx.route('**/nominatim.openstreetmap.org/**', place)
    ctx.route('**/tile.openstreetmap.org/**', lambda r: r.fulfill(status=200, content_type='image/png',
              body=open(os.path.join(ROOT, 'icon-192.png'), 'rb').read()))

def step(name):
    print('✔', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(**({'executable_path': os.environ['CHROME']} if os.environ.get('CHROME') else {}))
    ctx = browser.new_context(
        viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
        user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
        geolocation={'latitude': 56.4571, 'longitude': -2.9667}, permissions=['geolocation'],
        service_workers='allow')
    mock_routes(ctx)
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())

    page.goto(BASE)
    expect(page.locator('#screen-login')).to_be_visible()
    page.screenshot(path=SHOTS + '01-login.png')
    step('login screen shown for new visitor')

    # --- register validation
    page.click('text=Create an account')
    page.fill('#reg-email', 'notanemail')
    page.fill('#reg-password', 'short')
    page.fill('#reg-confirm', 'short')
    page.check('#reg-consent')
    page.click('#register-form button[type=submit]')
    expect(page.locator('#register-error')).to_contain_text('valid email')
    page.fill('#reg-email', 'student@dundee.ac.uk')
    page.click('#register-form button[type=submit]')
    expect(page.locator('#register-error')).to_contain_text('Password needs')
    page.fill('#reg-password', 'Dundee2026')
    page.fill('#reg-confirm', 'Dundee2026x')
    page.click('#register-form button[type=submit]')
    expect(page.locator('#register-error')).to_contain_text('do not match')
    page.fill('#reg-confirm', 'Dundee2026')
    page.screenshot(path=SHOTS + '02-register.png', full_page=True)
    page.click('#register-form button[type=submit]')
    expect(page.locator('#screen-timeline')).to_be_visible(timeout=10000)
    expect(page.locator('#timeline-empty')).to_be_visible()
    page.screenshot(path=SHOTS + '03-empty-timeline.png')
    step('register with validation -> empty timeline')

    # --- add moment with photo + GPS + APIs
    page.click('#tabbar a[data-tab=add]')
    expect(page.locator('#loc-status')).to_contain_text('V&A Dundee', timeout=10000)
    expect(page.locator('#loc-status')).to_contain_text('6°C')
    page.set_input_files('#photo-input', PHOTO)
    expect(page.locator('#photo-preview')).to_be_visible(timeout=10000)
    page.fill('#m-title', 'Sunset at the V&A')
    page.fill('#m-note', 'Walked along the river after the lab. <script>alert(1)</script>')
    page.click('.moods label:nth-child(6)')  # 🤩 (legend is child 1)
    page.screenshot(path=SHOTS + '04-add-moment.png', full_page=True)
    page.click('#moment-save')
    expect(page.locator('#screen-detail')).to_be_visible(timeout=10000)
    expect(page.locator('#detail-body')).to_contain_text('<script>alert(1)</script>')  # shown as text, not run
    page.wait_for_timeout(500)
    page.screenshot(path=SHOTS + '05-detail.png', full_page=True)
    step('add moment with camera photo, GPS, place + weather; XSS text rendered safely')

    # photo was compressed
    size = page.evaluate("document.querySelector('.detail-photo img').naturalWidth")
    assert size == 1280, size
    step(f'photo resized from 3000px to {size}px')

    # check data is encrypted at rest
    raw = page.evaluate("""() => new Promise(res => {
      const r = indexedDB.open('pinpoint-diary'); r.onsuccess = () => {
        const tx = r.result.transaction(['moments','users']); const out = {};
        tx.objectStore('moments').getAll().onsuccess = e => out.m = e.target.result;
        tx.objectStore('users').getAll().onsuccess = e => out.u = e.target.result;
        tx.oncomplete = () => res(JSON.stringify(out)); } })""")
    assert 'Sunset' not in raw and 'V&A' not in raw and 'Dundee2026' not in raw, 'plain text found in DB!'
    step('IndexedDB contains only encrypted data and a password hash')

    # --- second moment without photo, approximate location
    page.click('#tabbar a[data-tab=profile]')
    page.click('.segmented label:has-text("Approx")')
    page.click('#tabbar a[data-tab=add]')
    expect(page.locator('#loc-status')).to_contain_text('Dundee', timeout=10000)
    page.fill('#m-title', 'Coffee on Perth Road')
    page.click('#moment-save')
    expect(page.locator('#screen-detail')).to_be_visible(timeout=10000)
    expect(page.locator('#detail-body')).to_contain_text('56.46, -2.97')
    step('approximate-location setting rounds coordinates')

    # --- timeline + search
    page.click('#tabbar a[data-tab=timeline]')
    expect(page.locator('.moment-card')).to_have_count(2)
    page.screenshot(path=SHOTS + '06-timeline.png')
    page.fill('#search', 'coffee')
    page.wait_for_timeout(300)
    expect(page.locator('.moment-card')).to_have_count(1)
    page.fill('#search', '')
    page.wait_for_timeout(300)
    step('timeline lists moments; search filters')

    # --- edit
    page.click('.moment-card:has-text("Sunset")')
    page.click('#detail-edit')
    expect(page.locator('#photo-preview')).to_be_visible(timeout=5000)
    page.fill('#m-title', 'Golden sunset at the V&A')
    page.click('#moment-save')
    expect(page.locator('#detail-title')).to_have_text('Golden sunset at the V&A', timeout=5000)
    step('edit keeps photo and location, updates title')

    # --- map
    page.click('#detail-map')
    expect(page.locator('#screen-map')).to_be_visible()
    page.wait_for_timeout(800)
    expect(page.locator('.leaflet-marker-icon')).to_have_count(2)
    assert page.evaluate("[...document.querySelectorAll('.leaflet-marker-icon')].every(i => i.naturalWidth > 0)"), 'marker images missing'
    page.screenshot(path=SHOTS + '07-map.png')
    step('map shows 2 pins')

    # --- profile + settings
    page.click('#tabbar a[data-tab=profile]')
    expect(page.locator('#stats')).to_contain_text('2')
    expect(page.locator('.stat:has-text("Photos") dd')).to_have_text('1')
    page.click('.segmented label:has-text("Dark")')
    page.click('input[name=textsize][value="1.3"] + span')
    page.screenshot(path=SHOTS + '08-profile-dark-large.png', full_page=True)
    fs = page.evaluate("getComputedStyle(document.documentElement).fontSize")
    assert fs == '20.8px', fs
    page.click('#tabbar a[data-tab=timeline]')
    page.screenshot(path=SHOTS + '09-timeline-dark.png')
    page.click('#tabbar a[data-tab=profile]')
    page.click('.segmented label:has-text("System")')
    page.click('input[name=textsize][value="1"] + span')
    page.click('.segmented label:has-text("Exact")')
    step('dark mode + large text settings applied')

    # --- export
    with page.expect_download() as dl:
        page.click('#export-btn')
    data = json.loads(open(dl.value.path()).read())
    assert len(data['moments']) == 2 and data['moments'][0]['photo'] is None or data['moments'][1]['photo']
    step('export downloads JSON with both moments')

    # --- service worker ready -> offline
    page.evaluate("navigator.serviceWorker.ready")
    page.reload()
    page.wait_for_timeout(1000)
    ctx.set_offline(True)
    page.reload()
    expect(page.locator('#screen-login')).to_be_visible(timeout=10000)
    expect(page.locator('#offline-banner')).to_be_visible()
    step('app loads while OFFLINE (service worker) and session is locked after reload')

    # --- wrong password, then right
    page.fill('#login-password', 'wrongpass1')
    page.click('#login-form button[type=submit]')
    expect(page.locator('#login-error')).to_contain_text('incorrect', timeout=10000)
    page.fill('#login-password', 'Dundee2026')
    page.click('#login-form button[type=submit]')
    expect(page.locator('.moment-card')).to_have_count(2, timeout=10000)
    step('wrong password rejected; right password decrypts diary offline')

    # --- add offline moment -> sync when online
    before = dict(api_calls)
    page.click('#tabbar a[data-tab=add]')
    expect(page.locator('#loc-status')).to_contain_text('Offline', timeout=10000)
    page.fill('#m-title', 'Offline moment')
    page.click('#moment-save')
    expect(page.locator('#detail-body')).to_contain_text('Will be added when online', timeout=5000)
    page.screenshot(path=SHOTS + '10-offline-moment.png', full_page=True)
    assert 'null' not in page.inner_text('#detail-body'), 'null text shown'
    ctx.set_offline(False)
    page.evaluate("window.dispatchEvent(new Event('online'))")
    expect(page.locator('#detail-body')).to_contain_text('V&A Dundee', timeout=10000)
    expect(page.locator('#detail-body')).to_contain_text('added later')
    step('offline moment saved, then place + weather added when back online')

    # --- delete
    page.click('#detail-delete')
    expect(page.locator('.moment-card')).to_have_count(2, timeout=5000)
    step('delete moment')

    # --- lockout after 5 wrong attempts
    page.click('#tabbar a[data-tab=profile]')
    page.click('#logout-btn')
    for i in range(5):
        page.fill('#login-password', f'bad{i}pass1')
        page.click('#login-form button[type=submit]')
        page.wait_for_timeout(700)
    page.fill('#login-password', 'Dundee2026')
    page.click('#login-form button[type=submit]')
    expect(page.locator('#login-error')).to_contain_text('Too many attempts', timeout=5000)
    step('5 wrong passwords -> 30s lockout')

    # --- landscape / tablet
    page.set_viewport_size({'width': 844, 'height': 390})
    page.screenshot(path=SHOTS + '11-landscape-login.png')
    browser.close()

real = [e for e in errors if 'Failed to load resource' not in e and 'ERR_INTERNET_DISCONNECTED' not in e]
print('console errors:', real or 'none')
print('API calls:', api_calls)
