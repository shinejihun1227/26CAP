#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include "SparkFun_BMI270_Arduino_Library.h"
#include <Adafruit_SHTC3.h>
#include <Adafruit_DRV2605.h>

namespace StepOn {

constexpr uint8_t I2C_SDA_PIN = 6;
constexpr uint8_t I2C_SCL_PIN = 7;
constexpr uint8_t MUX_S0_PIN = 1;
constexpr uint8_t MUX_S1_PIN = 3;
constexpr uint8_t MUX_S2_PIN = 4;
constexpr uint8_t MUX_S3_PIN = 5;
constexpr uint8_t MUX_SIG_PIN = 0;
constexpr const char *FOOT_SIDE = "left";

constexpr uint8_t TCA9548A_ADDRESS_LOW = 0x70;
constexpr uint8_t TCA9548A_ADDRESS_HIGH = 0x71;
constexpr uint8_t BMI270_ADDRESS = 0x68;
constexpr uint8_t DRV2605_ADDRESS = 0x5A;
constexpr uint8_t PRESSURE_COUNT = 8;
constexpr uint8_t THERMAL_COUNT = 4;
constexpr uint8_t PRESSURE_CHANNELS[PRESSURE_COUNT] = {0, 2, 4, 6, 8, 10, 12, 14};
constexpr uint8_t THERMAL_CHANNELS[THERMAL_COUNT] = {3, 4, 5, 6};
constexpr int PRESSURE_RAW_MIN = 0;
constexpr int PRESSURE_RAW_MAX = 4095;
constexpr uint16_t PRESSURE_SETTLE_US = 250;

struct SensorFrame {
  uint32_t frame = 0;
  uint32_t millisValue = 0;
  uint16_t pressureRaw[PRESSURE_COUNT] = {};
  uint8_t pressure[PRESSURE_COUNT] = {};
  float temperature[THERMAL_COUNT] = {-127, -127, -127, -127};
  float humidity[THERMAL_COUNT] = {-127, -127, -127, -127};
  float accelX = 0;
  float accelY = 0;
  float accelZ = 0;
  float gyroX = 0;
  float gyroY = 0;
  float gyroZ = 0;
  bool tcaReady = false;
  bool imuReady = false;
  bool drv2605Ready = false;
  bool shtc3Ready[THERMAL_COUNT] = {};
};

static BMI270 bmi270;
static Adafruit_SHTC3 shtc3[THERMAL_COUNT];
static Adafruit_DRV2605 drv2605;
static bool tca9548aReady = false;
static uint8_t tca9548aAddress = 0;
static bool bmi270Ready = false;
static bool drv2605Ready = false;
static bool shtc3Ready[THERMAL_COUNT] = {};
static uint32_t frameCounter = 0;

inline bool probeI2c(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

inline void selectPressureChannel(uint8_t channel) {
  digitalWrite(MUX_S0_PIN, channel & 0x01);
  digitalWrite(MUX_S1_PIN, (channel >> 1) & 0x01);
  digitalWrite(MUX_S2_PIN, (channel >> 2) & 0x01);
  digitalWrite(MUX_S3_PIN, (channel >> 3) & 0x01);
  delayMicroseconds(PRESSURE_SETTLE_US);
}

inline int readPressureRaw(uint8_t channel) {
  selectPressureChannel(channel);
  analogRead(MUX_SIG_PIN);
  delayMicroseconds(50);
  return analogRead(MUX_SIG_PIN);
}

inline bool selectThermalChannel(uint8_t channel) {
  if (!tca9548aReady || tca9548aAddress == 0 || channel > 7) return false;
  Wire.beginTransmission(tca9548aAddress);
  Wire.write(static_cast<uint8_t>(1u << channel));
  return Wire.endTransmission() == 0;
}

inline void disableThermalChannels() {
  if (!tca9548aReady || tca9548aAddress == 0) return;
  Wire.beginTransmission(tca9548aAddress);
  Wire.write(0);
  Wire.endTransmission();
}

inline uint8_t readyThermalCount() {
  uint8_t count = 0;
  for (uint8_t i = 0; i < THERMAL_COUNT; i++) if (shtc3Ready[i]) count++;
  return count;
}

inline uint8_t pressurePercent(int raw) {
  raw = constrain(raw, PRESSURE_RAW_MIN, PRESSURE_RAW_MAX);
  return static_cast<uint8_t>(map(raw, PRESSURE_RAW_MIN, PRESSURE_RAW_MAX, 0, 100));
}

inline bool initSensorCore() {
  pinMode(MUX_S0_PIN, OUTPUT);
  pinMode(MUX_S1_PIN, OUTPUT);
  pinMode(MUX_S2_PIN, OUTPUT);
  pinMode(MUX_S3_PIN, OUTPUT);
  pinMode(MUX_SIG_PIN, INPUT);
  selectPressureChannel(0);

  analogReadResolution(12);
  analogSetPinAttenuation(MUX_SIG_PIN, ADC_11db);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(100000);
  if (probeI2c(TCA9548A_ADDRESS_LOW)) {
    tca9548aAddress = TCA9548A_ADDRESS_LOW;
  } else if (probeI2c(TCA9548A_ADDRESS_HIGH)) {
    tca9548aAddress = TCA9548A_ADDRESS_HIGH;
  }
  tca9548aReady = tca9548aAddress != 0;
  disableThermalChannels();

  bmi270Ready = bmi270.beginI2C(BMI270_ADDRESS, Wire) == BMI2_OK;
  drv2605Ready = probeI2c(DRV2605_ADDRESS) && drv2605.begin(&Wire);
  if (drv2605Ready) {
    drv2605.selectLibrary(1);
    drv2605.setMode(DRV2605_MODE_INTTRIG);
  }

  for (uint8_t i = 0; i < THERMAL_COUNT; i++) {
    shtc3Ready[i] = selectThermalChannel(THERMAL_CHANNELS[i]) && shtc3[i].begin(&Wire);
  }
  disableThermalChannels();

  Serial.println();
  Serial.println("[센서 초기화 결과]");
  Serial.printf("  I2C 핀       : SDA=GPIO%u, SCL=GPIO%u\n", I2C_SDA_PIN, I2C_SCL_PIN);
  Serial.printf("  TCA9548A     : %s (주소 0x%02X)\n",
    tca9548aReady ? "정상" : "연결 안 됨", tca9548aAddress);
  Serial.printf("  BMI270       : %s (주소 0x%02X)\n",
    bmi270Ready ? "정상" : "연결 안 됨", BMI270_ADDRESS);
  Serial.printf("  DRV2605L     : %s (주소 0x%02X)\n",
    drv2605Ready ? "정상" : "연결 안 됨", DRV2605_ADDRESS);
  Serial.printf("  SHTC3        : %u/%u개 정상\n",
    static_cast<unsigned>(readyThermalCount()),
    static_cast<unsigned>(THERMAL_COUNT));
  Serial.println();
  return true;
}

inline void updateFrameStatus(SensorFrame &frame) {
  frame.tcaReady = tca9548aReady;
  frame.imuReady = bmi270Ready;
  frame.drv2605Ready = drv2605Ready;
}

// Fast path used by the AI input. Only the IMU is read here so the slower
// pressure and thermal I2C/ADC reads do not reduce the IMU frame rate.
inline void readFastImuFrame(SensorFrame &frame) {
  frame.frame = ++frameCounter;
  frame.millisValue = millis();
  updateFrameStatus(frame);

  frame.accelX = frame.accelY = frame.accelZ = 0;
  frame.gyroX = frame.gyroY = frame.gyroZ = 0;
  if (bmi270Ready) {
    bmi270.getSensorData();
    frame.accelX = bmi270.data.accelX;
    frame.accelY = bmi270.data.accelY;
    frame.accelZ = bmi270.data.accelZ;
    frame.gyroX = bmi270.data.gyroX;
    frame.gyroY = bmi270.data.gyroY;
    frame.gyroZ = bmi270.data.gyroZ;
  }
}

// Slow auxiliary path. The latest pressure/temperature/humidity values stay
// in the same frame while frame/frame.millisValue advance with the IMU path.
inline void readSlowSensors(SensorFrame &frame) {
  updateFrameStatus(frame);

  for (uint8_t i = 0; i < PRESSURE_COUNT; i++) {
    const int raw = readPressureRaw(PRESSURE_CHANNELS[i]);
    frame.pressureRaw[i] = static_cast<uint16_t>(raw);
    frame.pressure[i] = pressurePercent(raw);
  }

  for (uint8_t i = 0; i < THERMAL_COUNT; i++) {
    frame.temperature[i] = -127;
    frame.humidity[i] = -127;
    frame.shtc3Ready[i] = shtc3Ready[i];
    if (!shtc3Ready[i] || !selectThermalChannel(THERMAL_CHANNELS[i])) continue;
    sensors_event_t humidityEvent;
    sensors_event_t temperatureEvent;
    if (shtc3[i].getEvent(&humidityEvent, &temperatureEvent)) {
      frame.temperature[i] = temperatureEvent.temperature;
      frame.humidity[i] = humidityEvent.relative_humidity;
    }
  }
  disableThermalChannels();
}

// Compatibility helper for any existing caller that wants a complete frame.
inline void readSensorFrame(SensorFrame &frame) {
  readSlowSensors(frame);
  readFastImuFrame(frame);
}

inline String frameToJson(const SensorFrame &frame) {
  String json;
  json.reserve(1900);
  json += "{\"frame\":";
  json += frame.frame;
  json += ",\"millis\":";
  json += frame.millisValue;
  json += ",\"foot_side\":\"";
  json += FOOT_SIDE;
  json += "\",\"bilateral_available\":false";
  json += ",\"tca_ready\":";
  json += (frame.tcaReady ? "true" : "false");
  json += ",\"imu_ready\":";
  json += (frame.imuReady ? "true" : "false");
  json += ",\"drv2605_ready\":";
  json += (frame.drv2605Ready ? "true" : "false");
  uint8_t thermalCount = 0;
  for (uint8_t i = 0; i < THERMAL_COUNT; i++) if (frame.shtc3Ready[i]) thermalCount++;
  json += ",\"shtc3_count\":";
  json += thermalCount;
  json += ",\"shtc3_channels\":[";
  for (uint8_t i = 0; i < THERMAL_COUNT; i++) {
    if (i) json += ',';
    json += THERMAL_CHANNELS[i];
  }
  json += "]";
  json += ",\"pressure\":[";
  for (uint8_t i = 0; i < PRESSURE_COUNT; i++) { if (i) json += ','; json += frame.pressure[i]; }
  json += "],\"pressure_raw\":[";
  for (uint8_t i = 0; i < PRESSURE_COUNT; i++) { if (i) json += ','; json += frame.pressureRaw[i]; }
  json += "],\"temperature\":[";
  for (uint8_t i = 0; i < THERMAL_COUNT; i++) { if (i) json += ','; json += String(frame.temperature[i], 2); }
  json += "],\"humidity\":[";
  for (uint8_t i = 0; i < THERMAL_COUNT; i++) { if (i) json += ','; json += String(frame.humidity[i], 2); }
  json += "],\"shtc3_ready\":[";
  for (uint8_t i = 0; i < THERMAL_COUNT; i++) { if (i) json += ','; json += (frame.shtc3Ready[i] ? "true" : "false"); }
  json += "],\"accel\":{\"x\":";
  json += String(frame.accelX, 4);
  json += ",\"y\":";
  json += String(frame.accelY, 4);
  json += ",\"z\":";
  json += String(frame.accelZ, 4);
  json += "},\"gyro\":{\"x\":";
  json += String(frame.gyroX, 4);
  json += ",\"y\":";
  json += String(frame.gyroY, 4);
  json += ",\"z\":";
  json += String(frame.gyroZ, 4);
  json += "}}";
  return json;
}

} // namespace StepOn
