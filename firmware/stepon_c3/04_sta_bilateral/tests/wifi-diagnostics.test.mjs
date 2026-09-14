// Source-contract/regression checks, not a Wi-Fi radio or authentication simulator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sketch = read('04_sta_bilateral.ino');
const diag = read('wifi_diagnostics.h');
const docs = read('README.md');

test('observer starts before STA and keeps the original connection policy', () => {
  assert.ok(sketch.indexOf('WifiDiagnostics::begin();') < sketch.indexOf('WiFi.mode(WIFI_STA)'));
  assert.match(sketch, /WiFi\.persistent\(false\)/);
  assert.match(sketch, /WiFi\.setAutoReconnect\(true\)/);
  assert.match(sketch, /WiFi\.setSleep\(WIFI_POWER_SAVE\)/);
  assert.match(sketch, /!connected && uint32_t\(millis\(\) - retryAt\) >= 15000/);
  assert.equal((sketch.match(/WiFi\.reconnect\(\)/g) || []).length, 1);
  assert.match(sketch, /source=existing_15s_timer/);
  assert.doesNotMatch(diag, /WiFi\.(?:begin|reconnect|disconnect|scanNetworks|softAP|mode|set\w+)\(/);
});

test('callback only copies bounded events and never logs or waits', () => {
  const callback = diag.slice(diag.indexOf('inline void onEvent('), diag.indexOf('inline void begin()'));
  assert.doesNotMatch(callback, /Serial\.|WiFi\.|HTTP|Wire\.|\bdelay\(|vTaskDelay|portMAX_DELAY/);
  assert.match(callback, /xQueueSend\(events, &e, 0\)/);
  assert.match(diag, /xQueueCreate\(12, sizeof\(Event\)\)/);
  assert.match(diag, /n < 4 && xQueueReceive\(events, &e, 0\)/);
  assert.match(diag, /std::atomic<uint16_t> lastReason/);
  assert.match(callback, /lastReason\.store\(e\.reason\)/);
  assert.match(callback, /droppedEvents\.fetch_add\(1\)/);
});

test('STA transmit power is reduced during startup with a bounded application check', () => {
  const setup = sketch.slice(sketch.indexOf('void setup()'), sketch.indexOf('void loop()'));
  const loop = sketch.slice(sketch.indexOf('void loop()'));
  const beginAt = setup.indexOf('WiFi.begin(WIFI_SSID, WIFI_PASSWORD)');
  const powerAt = setup.indexOf('WiFi.setTxPower(WIFI_POWER_8_5dBm)');
  assert.ok(beginAt >= 0 && powerAt > beginAt);
  assert.ok(powerAt < setup.indexOf('xTaskCreate(sensorTask'));
  assert.match(setup, /bool txPowerOk = false;/);
  assert.match(setup, /for \(int i = 0; i < 20 && !txPowerOk; \+\+i\)/);
  assert.match(setup, /if \(!txPowerOk\) delay\(10\);/);
  assert.match(setup, /\[WIFI-TX\] applied=%d requested=8\.5dBm/);
  assert.match(setup, /setting only, NOT connection success/);
  assert.equal((sketch.match(/WiFi\.begin\(/g) || []).length, 1);
  assert.doesNotMatch(setup.slice(beginAt, powerAt), /WL_CONNECTED/);
  assert.doesNotMatch(loop, /setTxPower|txPowerOk/);
  assert.doesNotMatch(sketch, /WiFi\.softAP\(|WiFi\.mode\(WIFI_(?:AP|AP_STA)\)/);
});

test('reports association, IP, loss, auth changes and numeric disconnect reason', () => {
  for (const event of ['STA_START', 'STA_STOP', 'STA_CONNECTED', 'STA_DISCONNECTED', 'STA_GOT_IP', 'STA_LOST_IP', 'STA_AUTHMODE_CHANGE']) {
    assert.ok(diag.includes(`ARDUINO_EVENT_WIFI_${event}`), event);
  }
  assert.match(diag, /info\.wifi_sta_disconnected\.reason/);
  assert.match(diag, /info\.wifi_sta_disconnected\.rssi/);
  assert.match(diag, /reason=%u\(%s\)/);
  assert.match(diag, /WiFi\.disconnectReasonName/);
  assert.match(diag, /channel=%u auth=%u\(%s\)/);
  assert.match(diag, /event=GOT_IP ip=%s gateway=%s/);
});

test('periodic summary preserves failures for a late-opened serial monitor', () => {
  assert.match(sketch, /WifiDiagnostics::drain\(\)/);
  assert.match(sketch, /WifiDiagnostics::printStatus\(\)/);
  assert.match(diag, /last_reason=%u\(%s\) last_at=%lu disconnects=%lu dropped_events=%lu/);
  assert.match(diag, /count \? reasonName\(reason\) : "NONE"/);
  assert.match(diag, /last_reason is historical/);
  assert.match(diag, /queue unavailable; periodic last-reason summary still enabled/);
});

test('no credential logging or misleading success/cause claims', () => {
  assert.doesNotMatch(diag, /WIFI_PASSWORD|wifi_secrets|passphrase|password\s*[,)]/);
  const passwordUses = sketch.split('\n').filter((line) => line.includes('WIFI_PASSWORD'));
  assert.equal(passwordUses.length, 1);
  assert.match(passwordUses[0], /WiFi\.begin\(WIFI_SSID, WIFI_PASSWORD\)/);
  assert.match(diag, /this alone does not prove a wrong password/);
  assert.match(diag, /return is NOT connection success/);
  assert.match(sketch, /request accepted, NOT connection success/);
  assert.match(diag, /wifi-diag-v1/);
});

test('sensor processing, API payload and PC registration remain byte-for-byte equivalent', () => {
  const unchanged = [
    ['String stateJson()', 'void sensorTask(', '0d32266c335e38b715d7e9f467911bb11a928ebce4a5141b344152f491c09643'],
    ['void sensorTask(', 'void registrationTask(', '3afdfd6e2a8e6f2d158f83ca5edb7cb82e05fc09f4aea908e85bdd264bee2a79'],
    ['void registrationTask(', 'void setup(', '942eb5fecdfc0cb567360027f808542c12b6d3bf12a6ba2044d40454c89809f9'],
  ];
  for (const [start, end, expected] of unchanged) {
    const section = sketch.slice(sketch.indexOf(start), sketch.indexOf(end)).trim();
    assert.equal(createHash('sha256').update(section).digest('hex'), expected, start);
  }
});

test('documents upload, late monitor, diagnostic limits and read-only networking', () => {
  for (const phrase of ['wifi-diag-v1', '115200', 'Core Debug Level', 'last_reason', 'dropped_events', 'AUTH_FAIL', 'event_rssi', '추가 스캔']) {
    assert.ok(docs.includes(phrase), phrase);
  }
  for (const phrase of ['WIFI_POWER_8_5dBm', '[WIFI-TX]', 'applied=0', 'applied=1']) {
    assert.ok(docs.includes(phrase), phrase);
  }
});
