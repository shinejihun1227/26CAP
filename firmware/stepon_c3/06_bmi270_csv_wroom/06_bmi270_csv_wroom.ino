#include <Arduino.h>
#include <Wire.h>
#include <esp_timer.h>
#include <math.h>
#include <SparkFun_BMI270_Arduino_Library.h>

// 06 is for the ORIGINAL ESP32-WROOM-32 / ESP32 Dev Module, not ESP32-C3/S3.
#if !defined(CONFIG_IDF_TARGET_ESP32)
#error "Select ESP32 Dev Module (original ESP32-WROOM-32). Do not use the C3 pin map."
#endif

constexpr uint8_t SDA_PIN = 21, SCL_PIN = 22;
constexpr uint32_t SERIAL_BAUD = 230400, I2C_CLOCK = 400000;
constexpr uint32_t ODR_HZ = 100, NOMINAL_PERIOD_US = 1000000 / ODR_HZ;
constexpr float ACCEL_RANGE_G = 16.0f, GYRO_RANGE_DPS = 2000.0f;
// Protocol v1 fixes ODR/ranges; update the recorder/schema too if changing them.
static_assert(ODR_HZ == 100, "Protocol v1 records the BMI270 100 Hz setting");

BMI270 imu;
bool ready = false;
uint8_t imuAddress = 0;
char deviceId[13], bootId[9];
uint32_t sequence = 0, readErrors = 0, txDrops = 0, gapEvents = 0;
uint32_t statsAt = 0, validSinceStats = 0;
uint64_t previousReadUs = 0;

bool chipIdMatches(uint8_t address) {
  Wire.beginTransmission(address);
  Wire.write(uint8_t(0x00)); // CHIP_ID, not merely an I2C ACK check.
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(address, uint8_t(1)) != 1) return false;
  return Wire.read() == 0x24;
}

bool initializeImu() {
  if (!Wire.begin(SDA_PIN, SCL_PIN, I2C_CLOCK)) {
    Serial.println("# ERROR: I2C controller could not start");
    return false;
  }
  Wire.setTimeOut(20);
  uint8_t found = 0;
  for (uint8_t address : {uint8_t(0x68), uint8_t(0x69)}) {
    if (chipIdMatches(address)) { imuAddress = address; ++found; }
  }
  if (found != 1) {
    Serial.printf("# ERROR: verified BMI270 count=%u; connect exactly one at 0x68 or 0x69; check 3.3V/GND/SDA21/SCL22\n", found);
    return false;
  }
  int8_t result = imu.beginI2C(imuAddress, Wire);
  if (result != BMI2_OK) {
    Serial.printf("# ERROR: BMI270 initialization result=%d\n", int(result));
    return false;
  }
  if (imu.disableAdvancedPowerSave() != BMI2_OK) return false;
  bmi2_sens_config cfg[2] = {};
  cfg[0].type = BMI2_ACCEL; cfg[1].type = BMI2_GYRO;
  if (imu.getConfigs(cfg, 2) != BMI2_OK) return false;
  cfg[0].cfg.acc.odr = BMI2_ACC_ODR_100HZ;
  cfg[0].cfg.acc.range = BMI2_ACC_RANGE_16G;
  cfg[0].cfg.acc.bwp = BMI2_ACC_NORMAL_AVG4;
  cfg[0].cfg.acc.filter_perf = BMI2_PERF_OPT_MODE;
  cfg[1].cfg.gyr.odr = BMI2_GYR_ODR_100HZ;
  cfg[1].cfg.gyr.range = BMI2_GYR_RANGE_2000;
  cfg[1].cfg.gyr.bwp = BMI2_GYR_NORMAL_MODE;
  cfg[1].cfg.gyr.filter_perf = BMI2_PERF_OPT_MODE;
  cfg[1].cfg.gyr.noise_perf = BMI2_PERF_OPT_MODE;
  if (imu.setConfigs(cfg, 2) != BMI2_OK || imu.getConfigs(cfg, 2) != BMI2_OK) return false;
  return cfg[0].cfg.acc.odr == BMI2_ACC_ODR_100HZ && cfg[0].cfg.acc.range == BMI2_ACC_RANGE_16G
      && cfg[1].cfg.gyr.odr == BMI2_GYR_ODR_100HZ && cfg[1].cfg.gyr.range == BMI2_GYR_RANGE_2000;
}

void setup() {
  Serial.setTxBufferSize(2048);
  Serial.begin(SERIAL_BAUD);
  delay(500);
  snprintf(deviceId, sizeof(deviceId), "%012llx", (unsigned long long)(ESP.getEfuseMac() & 0xffffffffffffULL));
  snprintf(bootId, sizeof(bootId), "%08lx", (unsigned long)esp_random());
  Serial.println("# StepOn 06_bmi270_csv_wroom protocol=v1; USB serial only; no WiFi, AI or simulated data");
  Serial.printf("# device=%s boot=%s baud=%lu SDA=%u SCL=%u; INT is not required\n", deviceId, bootId, (unsigned long)SERIAL_BAUD, SDA_PIN, SCL_PIN);
  ready = initializeImu();
  Serial.printf("# ready=%u address=0x%02X odr_hz=100 accel_range_g=16 gyro_range_dps=2000; accel includes gravity\n", ready, imuAddress);
  if (!ready) Serial.println("# ERROR: no CSV samples will be invented; fix wiring/configuration then press RST");
  Serial.println("record_type,protocol,device_id,boot_id,sequence,device_time_us,dt_us,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,read_errors,tx_drops,gap_events,clip_mask");
  statsAt = millis();
}

void captureOne() {
  uint8_t status = 0;
  if (imu.getStatus(&status) != BMI2_OK) { ++readErrors; return; }
  // Wait for fresh accelerometer AND gyroscope data; never repeat cached values.
  const uint8_t required = BMI2_DRDY_ACC | BMI2_DRDY_GYR;
  if ((status & required) != required) return;
  const uint64_t readUs = uint64_t(esp_timer_get_time());
  if (imu.getSensorData() != BMI2_OK) { ++readErrors; return; }
  const float axes[6] = {imu.data.accelX, imu.data.accelY, imu.data.accelZ,
                         imu.data.gyroX, imu.data.gyroY, imu.data.gyroZ};
  for (float value : axes) if (!isfinite(value)) { ++readErrors; return; }
  const uint64_t dtUs = previousReadUs ? readUs - previousReadUs : 0;
  previousReadUs = readUs;
  if (dtUs > 2 * NOMINAL_PERIOD_US) ++gapEvents; // Observed read gap, NOT an exact lost-sample count.
  uint8_t clipMask = 0;
  for (uint8_t i = 0; i < 6; ++i) {
    if (fabsf(axes[i]) >= 0.98f * (i < 3 ? ACCEL_RANGE_G : GYRO_RANGE_DPS)) clipMask |= uint8_t(1u << i);
  }
  ++sequence; ++validSinceStats;
  char line[256];
  const int length = snprintf(line, sizeof(line),
    "D,v1,%s,%s,%lu,%llu,%llu,%.6f,%.6f,%.6f,%.3f,%.3f,%.3f,%lu,%lu,%lu,%u\n",
    deviceId, bootId, (unsigned long)sequence, (unsigned long long)readUs, (unsigned long long)dtUs,
    double(axes[0]), double(axes[1]), double(axes[2]), double(axes[3]), double(axes[4]), double(axes[5]),
    (unsigned long)readErrors, (unsigned long)txDrops, (unsigned long)gapEvents, clipMask);
  // Keep acquisition responsive when the UART consumer cannot keep up.
  if (length <= 0 || length >= int(sizeof(line)) || Serial.availableForWrite() < length) { ++txDrops; return; }
  if (Serial.write(reinterpret_cast<const uint8_t *>(line), size_t(length)) != size_t(length)) ++txDrops;
}

void loop() {
  if (ready) captureOne();
  const uint32_t now = millis();
  if (uint32_t(now - statsAt) >= 2000) {
    Serial.printf("# STATUS ready=%u valid_read_hz=%.1f read_errors=%lu tx_drops=%lu gap_events=%lu\n",
      ready, validSinceStats * 1000.0f / uint32_t(now - statsAt),
      (unsigned long)readErrors, (unsigned long)txDrops, (unsigned long)gapEvents);
    validSinceStats = 0; statsAt = now;
  }
  delay(1);
}
