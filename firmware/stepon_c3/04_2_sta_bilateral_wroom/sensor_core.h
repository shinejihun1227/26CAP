#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <SparkFun_BMI270_Arduino_Library.h>
#include <Adafruit_DRV2605.h>
#include "config.h"

namespace StaSensors {
struct Frame {
  uint32_t sequence = 0, atMs = 0, pressureAtMs = 0;
  uint16_t pressureRaw[4] = {};
  uint8_t pressure[4] = {};
  float temperature[4] = {-127, -127, -127, -127};
  float humidity[4] = {-127, -127, -127, -127};
  float accel[3] = {}, gyro[3] = {}, actualHz = 0;
  uint32_t thermalAtMs[4] = {}, missedDeadlines = 0;
  bool imuReady = false, pressureReady = false, tcaReady = false, drvReady = false, thermalReady[4] = {};
};
static BMI270 imu;
static Adafruit_DRV2605 driver;
static bool imuInitialized = false, thermalInitialized[4] = {}, pending[4] = {};
static uint8_t thermalPhase = 0, thermalIndex = 0;
static uint32_t thermalNext = 0, thermalReadAt = 0;
inline bool probe(uint8_t address) { Wire.beginTransmission(address); return Wire.endTransmission() == 0; }
inline bool channel(int index) {
  Wire.beginTransmission(TCA_ADDRESS);
  Wire.write(index < 0 ? 0 : uint8_t(1u << THERMAL_CHANNELS[index]));
  return Wire.endTransmission() == 0;
}
inline bool shtCommand(uint16_t command) {
  Wire.beginTransmission(0x70); Wire.write(uint8_t(command >> 8)); Wire.write(uint8_t(command));
  return Wire.endTransmission() == 0;
}
// SHTC3 data CRC: polynomial 0x31, initialization 0xFF.
inline uint8_t crc(const uint8_t *bytes, uint8_t length) {
  uint8_t result = 0xff;
  for (uint8_t i = 0; i < length; ++i) {
    result ^= bytes[i];
    for (uint8_t bit = 0; bit < 8; ++bit) result = (result & 0x80) ? uint8_t((result << 1) ^ 0x31) : uint8_t(result << 1);
  }
  return result;
}
inline bool readBytes(uint8_t *bytes, uint8_t count) {
  if (Wire.requestFrom(uint8_t(0x70), count) != count) { while (Wire.available()) Wire.read(); return false; }
  for (uint8_t i = 0; i < count; ++i) bytes[i] = Wire.read();
  return true;
}
inline void initialize(Frame &f) {
  for (uint8_t pin : {MUX_S0, MUX_S1, MUX_S2, MUX_S3}) { pinMode(pin, OUTPUT); digitalWrite(pin, LOW); }
  pinMode(MUX_SIG, INPUT); analogReadResolution(12); analogSetPinAttenuation(MUX_SIG, ADC_11db);
  Wire.begin(I2C_SDA, I2C_SCL); Wire.setClock(100000); Wire.setTimeOut(10);
  f.tcaReady = probe(TCA_ADDRESS);
  if (f.tcaReady) channel(-1);
  else Serial.println("[SENSOR] TCA 0x71 missing. Check address straps; SHTC3 uses 0x70.");
  Serial.println("[SENSOR] BMI270 initialization...");
  imuInitialized = probe(0x68) && imu.beginI2C(0x68, Wire) == BMI2_OK;
  if (imuInitialized) {
    // Hardware runs at 100 Hz; the software reads the latest sample at 64 Hz.
    imu.setAccelODR(BMI2_ACC_ODR_100HZ); imu.setGyroODR(BMI2_GYR_ODR_100HZ);
  }
  f.drvReady = probe(0x5a) && driver.begin(&Wire);
  if (f.drvReady) { driver.selectLibrary(1); driver.setMode(DRV2605_MODE_INTTRIG); }
  for (uint8_t i = 0; i < 4 && f.tcaReady; ++i) {
    if (!channel(i) || !shtCommand(0x3517)) continue;
    delayMicroseconds(250);
    uint8_t id[3];
    thermalInitialized[i] = shtCommand(0xefc8) && readBytes(id, 3) && crc(id, 2) == id[2] && ((((uint16_t(id[0]) << 8) | id[1]) & 0x083f) == 0x0807);
    shtCommand(0xb098);
  }
  if (f.tcaReady) channel(-1);
  Serial.printf("[SENSOR] IMU=%u TCA=%u DRV=%u SHT=%u%u%u%u (missing devices do not stop Wi-Fi)\n", imuInitialized, f.tcaReady, f.drvReady, thermalInitialized[0], thermalInitialized[1], thermalInitialized[2], thermalInitialized[3]);
}
inline void readImu(Frame &f) {
  f.sequence++; f.atMs = millis();
  f.imuReady = imuInitialized && imu.getSensorData() == BMI2_OK;
  if (f.imuReady) {
    f.accel[0] = imu.data.accelX; f.accel[1] = imu.data.accelY; f.accel[2] = imu.data.accelZ;
    f.gyro[0] = imu.data.gyroX; f.gyro[1] = imu.data.gyroY; f.gyro[2] = imu.data.gyroZ;
    for (uint8_t i = 0; i < 3; ++i) f.imuReady = f.imuReady && isfinite(f.accel[i]) && isfinite(f.gyro[i]);
  }
  if (!f.imuReady) for (uint8_t i = 0; i < 3; ++i) f.accel[i] = f.gyro[i] = 0;
}
inline void readPressure(Frame &f) {
  for (uint8_t i = 0; i < 4; ++i) {
    const uint8_t c = PRESSURE_CHANNELS[i];
    digitalWrite(MUX_S0, c & 1); digitalWrite(MUX_S1, (c >> 1) & 1);
    digitalWrite(MUX_S2, (c >> 2) & 1); digitalWrite(MUX_S3, (c >> 3) & 1);
    delayMicroseconds(250); analogRead(MUX_SIG); delayMicroseconds(50);
    f.pressureRaw[i] = analogRead(MUX_SIG); f.pressure[i] = map(f.pressureRaw[i], 0, 4095, 0, 100);
  }
  f.pressureAtMs = millis(); f.pressureReady = true; // ADC read succeeded; not an FSR continuity test.
}
// Split start/wait/read across iterations; never wait indefinitely for an SHT.
// All four convert in parallel on isolated mux channels, target 20 Hz each.
inline void thermalTick(Frame &f) {
  if (!f.tcaReady) return;
  const uint32_t now = millis();
  if (thermalPhase == 0) {
    if (int32_t(now - thermalNext) < 0) return;
    thermalNext = now + AUX_INTERVAL_MS; thermalIndex = 0; thermalPhase = 1;
  }
  const uint8_t i = thermalIndex;
  if (thermalPhase == 1) {
    pending[i] = thermalInitialized[i] && channel(i) && shtCommand(0x3517);
    if (pending[i]) { delayMicroseconds(250); pending[i] = shtCommand(0x7866); }
    channel(-1);
    if (++thermalIndex == 4) { thermalReadAt = millis() + 14; thermalIndex = 0; thermalPhase = 2; }
    return;
  }
  if (int32_t(now - thermalReadAt) < 0) return;
  uint8_t bytes[6];
  f.thermalReady[i] = pending[i] && channel(i) && readBytes(bytes, 6) && crc(bytes, 2) == bytes[2] && crc(bytes + 3, 2) == bytes[5];
  if (f.thermalReady[i]) {
    const uint16_t t = (uint16_t(bytes[0]) << 8) | bytes[1], h = (uint16_t(bytes[3]) << 8) | bytes[4];
    f.temperature[i] = -45.0f + 175.0f * t / 65536.0f; f.humidity[i] = 100.0f * h / 65536.0f; f.thermalAtMs[i] = now;
  } else { f.temperature[i] = f.humidity[i] = -127; }
  if (pending[i]) shtCommand(0xb098);
  channel(-1);
  if (++thermalIndex == 4) thermalPhase = 0;
}
}
