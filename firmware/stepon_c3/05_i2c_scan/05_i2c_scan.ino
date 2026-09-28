#include <Arduino.h>
#include <Wire.h>

// Standalone diagnostics: no Wi-Fi, sensor libraries, motor or laser commands.
// Cold-power-cycle ALL modules before testing. Never rewire a powered circuit.
constexpr uint8_t SCAN_SDA = 6;
constexpr uint8_t SCAN_SCL = 7;
constexpr uint8_t TCA_SCAN_ADDRESS = 0x71;  // Matches 04; do NOT use 0x70 with SHTC3.
constexpr uint8_t LASER_SAFE_PIN = 10;
static_assert(TCA_SCAN_ADDRESS >= 0x71 && TCA_SCAN_ADDRESS <= 0x77,
              "Use 0x71..0x77. A TCA at 0x70 conflicts with SHTC3.");
bool wireReady = false;

bool ack(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

bool muxMask(uint8_t mask) {
  // Only the explicitly configured TCA is written. Never auto-write candidates.
  Wire.beginTransmission(TCA_SCAN_ADDRESS);
  Wire.write(mask);
  return Wire.endTransmission() == 0;
}

const char *addressHint(uint8_t address) {
  if (address == 0x68 || address == 0x69) return "BMI270 candidate; CHIP_ID check follows";
  if (address == 0x5A) return "DRV2605L expected here; ACK is not model verification";
  if (address == 0x70) return "SHTC3 OR default-address TCA; address alone is ambiguous";
  if (address >= 0x71 && address <= 0x77) return "TCA9548A candidate; no unique chip-ID register";
  return "unknown device";
}

void scanBus(const char *label, bool *found, const bool *upstream = nullptr) {
  memset(found, 0, 128 * sizeof(bool));
  Serial.printf("\n[%s] ACK address list (7-bit)\n", label);
  Serial.printf("  Idle line logic: SDA=%d SCL=%d (not a voltage/pull-up test)\n",
                digitalRead(SCAN_SDA), digitalRead(SCAN_SCL));
  unsigned count = 0, errors = 0;
  // Exclude reserved I2C addresses, including general call.
  for (uint8_t address = 0x08; address <= 0x77; ++address) {
    Wire.beginTransmission(address);
    const uint8_t result = Wire.endTransmission();
    if (result == 0) {
      found[address] = true;
      count++;
      Serial.printf("  ACK 0x%02X  %s%s\n", address,
                    upstream && upstream[address] ? "[shared upstream] " : "",
                    addressHint(address));
    } else if (result != 2) {
      // 2 is the normal address-NACK result. Avoid flooding one line per timeout.
      if (errors == 0) Serial.printf("  First bus error: address=0x%02X code=%u\n", address, result);
      errors++;
    }
    delay(1);
  }
  Serial.printf("  Total ACK=%u, non-NACK bus errors=%u\n", count, errors);
  if (!count) Serial.println("  NO ADDRESS: check GPIO6/7, module power, common GND and I2C pull-ups.");
}

void identifyBmi(const bool *found) {
  for (uint8_t address = 0x68; address <= 0x69; ++address) {
    if (!found[address]) continue;
    Wire.beginTransmission(address);
    Wire.write(uint8_t(0x00));  // CHIP_ID register pointer, not a configuration write.
    if (Wire.endTransmission(false) != 0 || Wire.requestFrom(address, uint8_t(1)) != 1) {
      while (Wire.available()) Wire.read();
      Serial.printf("  [BMI] 0x%02X ACK, but CHIP_ID read failed\n", address);
      continue;
    }
    const uint8_t id = Wire.read();
    Serial.printf("  [BMI] address=0x%02X CHIP_ID=0x%02X -> %s\n", address, id,
                  id == 0x24 ? "BMI270 ID MATCH (not a measurement test)" : "NOT the expected BMI270 ID 0x24");
    if (id == 0x24 && address == 0x69)
      Serial.println("  [04 MISMATCH] 04 currently checks 0x68 only; this board responds at 0x69.");
  }
}

bool shtCommand(uint16_t command) {
  Wire.beginTransmission(uint8_t(0x70));
  Wire.write(uint8_t(command >> 8));
  Wire.write(uint8_t(command));
  return Wire.endTransmission() == 0;
}

uint8_t shtCrc(const uint8_t *bytes, uint8_t length) {
  uint8_t crc = 0xFF;
  for (uint8_t i = 0; i < length; ++i) {
    crc ^= bytes[i];
    for (uint8_t bit = 0; bit < 8; ++bit)
      crc = (crc & 0x80) ? uint8_t((crc << 1) ^ 0x31) : uint8_t(crc << 1);
  }
  return crc;
}

bool identifySht(uint8_t channel) {
  if (!shtCommand(0xEFC8) || Wire.requestFrom(uint8_t(0x70), uint8_t(3)) != 3) {
    while (Wire.available()) Wire.read();
    Serial.printf("  [SHT] CH%u: ACK exists, ID read failed; sensor not verified\n", channel);
    return false;
  }
  uint8_t bytes[3];
  for (uint8_t i = 0; i < 3; ++i) bytes[i] = Wire.read();
  const uint16_t id = uint16_t(bytes[0]) << 8 | bytes[1];
  const bool valid = shtCrc(bytes, 2) == bytes[2] && (id & 0x083F) == 0x0807;
  Serial.printf("  [SHT] CH%u address=0x70 ID=0x%04X -> %s\n", channel, id,
                valid ? "SHTC3 ID+CRC MATCH" : "ID/CRC MISMATCH (not verified)");
  return valid;
}

void runScan() {
  if (!wireReady) { Serial.println("[ERROR] Wire.begin failed. Check pin settings and restart."); return; }
  Serial.println("\n========== StepOn 05 I2C ADDRESS DIAGNOSTIC ==========");
  Serial.println("SDA=GPIO6 SCL=GPIO7 | 100kHz | timeout=20ms | INT not used");
  bool visible[128], root[128], channelFound[128];
  bool shtVerified[8] = {};
  // First pass does not assume that a previously powered TCA has its channels off.
  scanBus("VISIBLE BEFORE ISOLATION", visible);
  identifyBmi(visible);
  if (!visible[TCA_SCAN_ADDRESS]) {
    Serial.printf("\n[SKIP CHANNELS] Configured TCA 0x%02X did not ACK.\n", TCA_SCAN_ADDRESS);
    Serial.println("Other 0x70..0x77 ACKs are only candidates, not confirmed TCA addresses.");
    Serial.println("If TCA-only gives 0x70: power OFF, set A0=3.3V A1=A2=GND, then cold-start.");
    Serial.println("Do not just change the scanner to 0x70 when SHTC3 sensors are attached.");
    Serial.println("Power-cycle all modules before interpreting visible addresses as direct connections.");
    Serial.println("[END] Send r + Enter to repeat. Upload 04 again to restore Wi-Fi/web.");
    return;
  }
  if (!muxMask(0)) {
    Serial.println("[STOP] TCA channel-OFF write failed. Power-cycle all modules; check wiring.");
    return;
  }
  delay(2);
  scanBus("UPSTREAM / ALL TCA CHANNELS OFF", root);
  identifyBmi(root);
  const bool address70OnRoot = root[0x70];
  if (address70OnRoot)
    Serial.println("[WARNING] Upstream already has 0x70. SHT wake/ID commands are DISABLED to avoid address collisions.");
  bool channelControlOk = true;
  for (uint8_t channel = 0; channel < 8; ++channel) {
    if (!muxMask(uint8_t(1u << channel))) {
      Serial.printf("[STOP] Cannot select CH%u; remaining channels NOT TESTED.\n", channel);
      channelControlOk = false;
      break;
    }
    delay(2);
    // 04 leaves SHTC3 asleep. Wake only after isolating one channel, with no root alias.
    if (!address70OnRoot) { shtCommand(0x3517); delay(1); }
    char label[36];
    snprintf(label, sizeof(label), "TCA 0x%02X / CH%u", TCA_SCAN_ADDRESS, channel);
    scanBus(label, channelFound, root);
    unsigned added = 0;
    for (uint8_t address = 0x08; address <= 0x77; ++address)
      if (channelFound[address] && !root[address]) added++;
    Serial.printf("  CH%u new addresses vs upstream=%u (shared upstream devices are NOT extra sensors)\n", channel, added);
    if (channelFound[0x70] && !address70OnRoot) {
      shtVerified[channel] = identifySht(channel);
      if (shtVerified[channel]) shtCommand(0xB098);  // Return verified SHTC3 to sleep.
    }
    // Close each channel before opening the next. A stuck bus must not produce fake results.
    if (!muxMask(0)) {
      Serial.println("[STOP] Cannot close selected channel. Power-cycle all modules before retrying.");
      channelControlOk = false;
      break;
    }
  }
  Serial.println("\n[SUMMARY] Direct/upstream addresses:");
  Serial.printf("  TCA configured 0x%02X: ACK=%u (address/control only, not chip identity)\n", TCA_SCAN_ADDRESS, root[TCA_SCAN_ADDRESS]);
  Serial.printf("  BMI candidates 0x68=%u 0x69=%u | DRV candidate 0x5A=%u\n", root[0x68], root[0x69], root[0x5A]);
  Serial.printf("  SHTC3 verified by channel 0..7: %u%u%u%u%u%u%u%u\n",
                shtVerified[0], shtVerified[1], shtVerified[2], shtVerified[3],
                shtVerified[4], shtVerified[5], shtVerified[6], shtVerified[7]);
  Serial.println("  Expected SHTC3 map for 04: 00011110 (CH3,4,5,6). 0 means not verified, not proof of absence.");
  if (!channelControlOk) Serial.println("  INCOMPLETE SCAN: see STOP above; untested channels must not be diagnosed as missing.");
  Serial.println("[END] Send r + Enter to repeat. Upload 04 again to restore Wi-Fi/web.");
}

void setup() {
  pinMode(LASER_SAFE_PIN, OUTPUT);
  digitalWrite(LASER_SAFE_PIN, LOW);
  Serial.begin(115200);
  const uint32_t serialStart = millis();
  while (!Serial && uint32_t(millis() - serialStart) < 3000) delay(10);
  delay(500);
  wireReady = Wire.begin(SCAN_SDA, SCAN_SCL);
  Wire.setClock(100000);
  Wire.setTimeOut(20);
  runScan();
}

void loop() {
  if (Serial.available()) {
    const char command = Serial.read();
    if (command == 'r' || command == 'R') runScan();
  }
  delay(10);
}
