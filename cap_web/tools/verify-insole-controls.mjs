// Optional browser regression check. Uses a running web server for static files;
// intercepts every /api/ request, so no real registration or output is sent.
// Install Playwright separately or set STEPON_PLAYWRIGHT_MODULE to its module path.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STEPON_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.STEPON_VERIFY_URL || 'http://127.0.0.1:8000';
const output = path.resolve('output/playwright');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.STEPON_BROWSER_PATH ? { executablePath: process.env.STEPON_BROWSER_PATH } : { channel: 'chrome' }) });
const errors = [];
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }

async function fixture(mobile = false) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
  const model = { frame: 0, polls: 0, posts: [], online: true, error: null, reject: false, gate: null,
    urls: { left: 'http://10.255.255.1', right: 'http://10.255.255.2' } };
  const sensor = (side) => ({ firmware: '04_2_sta_bilateral_wroom', wifi_mode: 'STA',
    device_id: `SIMULATED-${side}`, boot_id: 'browser-test', foot_side: side,
    frame: model.frame, millis: model.frame * 250, sample_hz: 64, actual_sample_hz: 64,
    pressure_ready: true, pressure_count: 4, pressure_layout: 'stepon-pressure-4-v1',
    pressure_channels: [0, 2, 4, 6], pressure: [12, 25, 70, 85],
    temperature: [30, 31, 32, 33], humidity: [40, 50, 60, 70],
    shtc3_ready: [true, true, true, true], shtc3_channels: [3, 4, 5, 6],
    imu_ready: true, tca_ready: true, drv2605_ready: false,
    accel: { x: side === 'left' ? 1 : 2, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 3 } });
  function payload() {
    return { service: 'stepon-bilateral-v1', frame: ++model.frame,
      feet: Object.fromEntries(['left', 'right'].map((side) => [side, {
        side, connected: side === 'left' || model.online,
        status: side === 'right' && !model.online ? 'error' : 'online',
        base_url: model.urls[side], device_id: `SIMULATED-${side}`,
        age_ms: 10, received_hz: 4, missed_frames: 0, restarts: 0,
        last_error: side === 'right' ? model.error : null, state: sensor(side),
      }])) };
  }
  await context.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/editor-state') return json({ directText: {} });
    if (url.pathname === '/api/insoles/state') { model.polls++; return json(payload()); }
    if (url.pathname === '/api/insoles/config') {
      const body = request.postDataJSON(); model.posts.push(body);
      if (model.gate) await model.gate;
      if (model.reject) return json({ error: 'duplicate_device' }, 409);
      model.urls[body.side] = body.url.replace(/\/$/, '');
      return json(payload());
    }
    errors.push(`Unexpected API request: ${request.method()} ${url.pathname}`);
    return json({ error: 'unexpected_test_request' }, 500);
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/?view=devices&esp32=1&transport=sta&ai=0&mobile=${mobile ? 1 : 0}`);
  await page.locator('[data-insole-card="right"].is-online').waitFor();
  const input = (side) => page.locator(`[data-insole-form="${side}"] input`);
  const summary = (side) => page.locator(`[data-insole-card="${side}"] summary`);
  async function polls(count = 4) {
    const end = model.polls + count, until = Date.now() + 8000;
    while (model.polls < end && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(model.polls >= end, 'sensor polling must continue');
    // Wait for the response to be applied to the DOM, not only requested.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  return { context, page, model, input, summary, polls };
}

try {
  const { context, page, model, input, summary, polls } = await fixture();
  await summary('right').click();
  await input('right').fill('');
  const rightNode = await input('right').elementHandle();
  await input('right').pressSequentially('http://10.255.255.22', { delay: 90 });
  await polls();
  check(await rightNode.evaluate((el) => el.isConnected && el === document.activeElement), true, 'right input survives polling');
  check(await input('right').inputValue(), 'http://10.255.255.22', 'slow typing survives polling');
  check(await summary('right').evaluate((el) => el.parentElement.open), true, 'right disclosure stays open');
  model.online = false; model.error = 'foot_side_mismatch';
  await page.locator('[data-insole-card="right"] .insole-error').waitFor();
  check(await page.locator('[data-insole-card="right"] .insole-error').textContent(),
    '보드의 좌우 설정이 다릅니다. 오른발 보드는 STEPON_RIGHT_FOOT=1으로 업로드하세요.', 'wrong-side guidance');
  check(await rightNode.evaluate((el) => el.isConnected && el === document.activeElement), true, 'status refresh preserves input');
  model.online = true; model.error = null;
  await page.locator('[data-insole-card="right"].is-online').waitFor();

  await summary('left').click();
  await input('left').fill('http://10.255.255.11');
  const leftNode = await input('left').elementHandle();
  await polls();
  check(await leftNode.evaluate((el) => el.isConnected && el === document.activeElement), true, 'left input survives polling');
  await page.locator('h1').click();
  await polls();
  check(await input('left').inputValue(), 'http://10.255.255.11', 'left draft survives blur');
  check(await input('right').inputValue(), 'http://10.255.255.22', 'right draft survives blur');

  const select = page.locator('[data-rehab-setting="activeFoot"]');
  await select.focus();
  const selectNode = await select.elementHandle();
  await select.press('Space');
  await polls();
  check(await selectNode.evaluate((el) => el.isConnected && el === document.activeElement), true, 'open native select survives polling');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await polls();
  check(await select.inputValue(), 'right', 'right foot selection persists');
  check(await page.locator('.device-hero').textContent().then((s) => s.includes('분석·출력 대상 오른발')), true, 'selected foot reaches view');
  check(await input('right').inputValue(), 'http://10.255.255.22', 'selection preserves address draft');

  // Replace the form while registration is in flight; completion must clean the current form.
  let release;
  model.gate = new Promise((resolve) => { release = resolve; });
  await page.locator('[data-insole-form="right"] button').click();
  await page.locator('h1').click();
  await polls();
  check(model.posts.at(-1), { side: 'right', url: 'http://10.255.255.22' }, 'right registration payload');
  release(); model.gate = null;
  await page.locator('.toast', { hasText: '주소를 등록' }).waitFor();
  await polls();
  check(await input('right').evaluate((el) => el.value === el.defaultValue), true, 'successful submission clears only submitted draft');
  check(await page.locator('.toast').textContent().then((s) => s.includes('주소를 등록')), true, 'toast survives polling');
  model.urls.right = 'http://10.255.255.23';
  await polls();
  check(await input('right').inputValue(), model.urls.right, 'untouched address follows server updates');
  check(await input('left').inputValue(), 'http://10.255.255.11', 'other draft remains unchanged');

  model.gate = new Promise((resolve) => { release = resolve; });
  await input('right').fill('http://10.255.255.24');
  await input('right').press('Enter');
  await polls(1);
  await input('right').fill('http://10.255.255.25');
  release(); model.gate = null;
  await polls();
  check(await input('right').inputValue(), 'http://10.255.255.25', 'new typing survives earlier request completion');
  check(await input('right').evaluate((el) => el === document.activeElement), true, 'completion does not interrupt new typing');

  model.reject = true;
  await input('right').press('Enter');
  await page.locator('.toast', { hasText: '등록 실패' }).waitFor();
  await polls();
  check(await input('right').inputValue(), 'http://10.255.255.25', 'failed submission preserves draft');
  check(await page.locator('.toast').textContent(), '등록 실패: duplicate_device', 'registration error remains visible');
  await page.screenshot({ path: path.join(output, 'insole-controls-desktop.png'), fullPage: true });

  await page.locator('button[data-view="live"]').first().click();
  const liveSelect = page.locator('[data-rehab-setting="activeFoot"]');
  await liveSelect.focus();
  const liveNode = await liveSelect.elementHandle();
  await polls();
  check(await liveNode.evaluate((el) => el.isConnected && el === document.activeElement), true, 'live-view selector survives polling');
  check(model.posts.length, 3, 'no unintended registration or output requests');
  await context.close();

  const mobile = await fixture(true);
  await mobile.summary('right').click();
  await mobile.input('right').fill('http://10.255.255.44');
  const mobileNode = await mobile.input('right').elementHandle();
  await mobile.polls();
  check(await mobileNode.evaluate((el) => el.isConnected && el === document.activeElement), true, 'mobile right input survives polling');
  await mobile.page.locator('[data-rehab-setting="activeFoot"]').selectOption('right');
  await mobile.polls();
  check(await mobile.input('right').inputValue(), 'http://10.255.255.44', 'mobile draft survives selection');
  await mobile.page.screenshot({ path: path.join(output, 'insole-controls-mobile.png'), fullPage: true });
  await mobile.context.close();
  check(errors, [], 'no browser errors or real API writes');
  console.log(`PASS: ${checks} browser assertions; desktop and mobile; all API requests mocked.`);
} finally {
  await browser.close();
}
