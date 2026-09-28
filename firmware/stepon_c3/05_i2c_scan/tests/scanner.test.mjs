// Source-contract checks only; these do not simulate I2C or validate hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../05_i2c_scan.ino', import.meta.url), 'utf8');
const instructions = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('matches 04 pin mapping and bounds I2C operations', () => {
  assert.match(source, /SCAN_SDA = 6/);
  assert.match(source, /SCAN_SCL = 7/);
  assert.match(source, /Wire\.setTimeOut\(20\)/);
  assert.match(source, /address = 0x08; address <= 0x77/);
  assert.match(source, /millis\(\) - serialStart\) < 3000/);
});
test('checks both BMI addresses and distinguishes ACK from CHIP_ID', () => {
  assert.match(source, /address = 0x68; address <= 0x69/);
  assert.match(source, /id == 0x24/);
  assert.match(source, /04 currently checks 0x68 only/);
  assert.ok(source.indexOf('identifyBmi(visible);') < source.indexOf('if (!visible[TCA_SCAN_ADDRESS])'));
});
test('never automatically writes to an ambiguous TCA address', () => {
  assert.match(source, /TCA_SCAN_ADDRESS = 0x71/);
  assert.match(source, /static_assert\(TCA_SCAN_ADDRESS >= 0x71 && TCA_SCAN_ADDRESS <= 0x77/);
  assert.match(source, /Wire\.beginTransmission\(TCA_SCAN_ADDRESS\)/);
  assert.match(source, /if \(!address70OnRoot\) \{ shtCommand\(0x3517\); delay\(1\); \}/);
});
test('isolates all eight channels, distinguishes upstream, stops on failed close', () => {
  assert.match(source, /channel = 0; channel < 8/);
  assert.match(source, /muxMask\(uint8_t\(1u << channel\)\)/);
  assert.match(source, /\[shared upstream\]/);
  assert.match(source, /if \(!muxMask\(0\)\)/);
  assert.match(source, /INCOMPLETE SCAN/);
  assert.match(source, /00011110/);
});
test('SHT identification requires expected bits and CRC, not only ACK', () => {
  assert.match(source, /shtCommand\(0xEFC8\)/);
  assert.match(source, /shtCrc\(bytes, 2\) == bytes\[2\] && \(id & 0x083F\) == 0x0807/);
  assert.match(source, /crc = 0xFF/);
  assert.match(source, /\^ 0x31/);
});
test('no networking or actuator drive; repeat and restore instructions present', () => {
  assert.doesNotMatch(source, /#include.*(?:WiFi|HTTP|DRV|BMI270|SHTC3)/);
  assert.doesNotMatch(source, /digitalWrite\([^;]*HIGH\)|\.go\(\)|setWaveform\(/);
  assert.match(source, /digitalWrite\(LASER_SAFE_PIN, LOW\)/);
  assert.match(source, /command == 'r' \|\| command == 'R'/);
  assert.match(instructions, /115200/);
  assert.match(instructions, /Wi-Fi 접속과 웹 센서 수집이 중단/);
  assert.match(instructions, /04_sta_bilateral\/04_sta_bilateral\.ino/);
});
