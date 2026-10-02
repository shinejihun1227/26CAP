#include <Wire.h>

TwoWire I2C_13_14(1);

constexpr uint8_t SHTC3_ADDR = 0x70;

uint8_t sendCommand(TwoWire &bus, uint16_t command) {
  bus.beginTransmission(SHTC3_ADDR);
  bus.write(uint8_t(command >> 8));
  bus.write(uint8_t(command));
  return bus.endTransmission(); // 0이면 ACK
}

uint8_t crc8(const uint8_t *data, uint8_t length) {
  uint8_t crc = 0xFF;

  for (uint8_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80)
        ? uint8_t((crc << 1) ^ 0x31)
        : uint8_t(crc << 1);
    }
  }
  return crc;
}

void scanBus(TwoWire &bus, const char *name) {
  bool found = false;

  Serial.printf("[%s] I2C address scan:\n", name);

  for (uint8_t address = 0x08; address <= 0x77; address++) {
    bus.beginTransmission(address);
    if (bus.endTransmission() == 0) {
      Serial.printf("[%s] FOUND 0x%02X\n", name, address);
      found = true;
    }
  }

  if (!found) {
    Serial.printf("[%s] No devices found\n", name);
  }
}

void testSHTC3(TwoWire &bus, const char *name) {
  Serial.printf("\n=== Testing SHT on %s ===\n", name);

  uint8_t wakeError = sendCommand(bus, 0x3517);
  Serial.printf("[%s] Wake ACK: %s (Wire error=%u)\n",
                name, wakeError == 0 ? "YES" : "NO", wakeError);

  if (wakeError != 0) {
    scanBus(bus, name);
    return;
  }

  delay(1);
  scanBus(bus, name); // SHTC3가 깨어난 뒤 주소도 다시 확인

  uint8_t idError = sendCommand(bus, 0xEFC8);
  Serial.printf("[%s] ID command ACK: %s (Wire error=%u)\n",
                name, idError == 0 ? "YES" : "NO", idError);

  if (idError == 0) {
    delay(1);
    uint8_t count = bus.requestFrom(SHTC3_ADDR, uint8_t(3));
    Serial.printf("[%s] ID bytes received: %u\n", name, count);

    if (count == 3) {
      uint8_t id[3] = { bus.read(), bus.read(), bus.read() };
      uint16_t productId = (uint16_t(id[0]) << 8) | id[1];
      bool crcOK = crc8(id, 2) == id[2];
      bool productOK = (productId & 0x083F) == 0x0807;

      Serial.printf("[%s] ID=%02X %02X, CRC=%02X, CRC=%s, SHTC3 ID=%s\n",
                    name, id[0], id[1], id[2],
                    crcOK ? "OK" : "FAIL",
                    productOK ? "OK" : "FAIL");
    }
  }

  sendCommand(bus, 0xB098); // 테스트 후 SHTC3 sleep
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("Initializing both I2C buses...");

  bool bus21Started = Wire.begin(21, 22);
  bool bus13Started = I2C_13_14.begin(13, 14);

  Serial.printf("GPIO21/22 Wire.begin: %s\n",
                bus21Started ? "OK" : "FAILED");
  Serial.printf("GPIO13/14 Wire1.begin: %s\n",
                bus13Started ? "OK" : "FAILED");

  if (bus21Started) {
    Wire.setClock(100000);
    Wire.setTimeOut(10);
    testSHTC3(Wire, "GPIO21/22");
  }

  if (bus13Started) {
    I2C_13_14.setClock(100000);
    I2C_13_14.setTimeOut(10);
    testSHTC3(I2C_13_14, "GPIO13/14");
  }
}

void loop() {}