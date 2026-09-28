#include "sensor_core.h"

// 1로 바꾸면 사람이 읽는 출력 아래에 JSON 한 줄도 추가합니다.
#define PRINT_JSON_FRAME 0

void printDivider() {
  Serial.println("============================================================");
}

void printSensorFrame(const StepOn::SensorFrame &frame) {
  printDivider();
  Serial.printf("측정 프레임: %lu   경과 시간: %lu ms\n",
    static_cast<unsigned long>(frame.frame),
    static_cast<unsigned long>(frame.millisValue));

  Serial.println();
  Serial.println("[센서 연결 상태]");
  Serial.printf("  I2C          : SDA=GPIO%u, SCL=GPIO%u\n",
    StepOn::I2C_SDA_PIN, StepOn::I2C_SCL_PIN);
  Serial.printf("  TCA9548A     : %s (주소 0x%02X)\n",
    frame.tcaReady ? "정상" : "연결 안 됨",
    StepOn::tca9548aAddress);
  Serial.printf("  BMI270       : %s\n", frame.imuReady ? "정상" : "연결 안 됨");
  Serial.printf("  DRV2605L     : %s\n", frame.drv2605Ready ? "정상" : "연결 안 됨");
  Serial.printf("  SHTC3        : %u/%u개 정상\n",
    static_cast<unsigned>(StepOn::readyThermalCount()),
    static_cast<unsigned>(StepOn::THERMAL_COUNT));

  Serial.println();
  Serial.println("[압력센서 값]");
  Serial.println("  센서   MUX채널   원시값(raw)   상대압력");
  for (uint8_t i = 0; i < StepOn::PRESSURE_COUNT; i++) {
    Serial.printf("  FSR%-2u   C%-2u      %4u         %3u%%\n",
      static_cast<unsigned>(i + 1),
      static_cast<unsigned>(StepOn::PRESSURE_CHANNELS[i]),
      static_cast<unsigned>(frame.pressureRaw[i]),
      static_cast<unsigned>(frame.pressure[i]));
  }

  Serial.println();
  Serial.println("[온습도센서 값]");
  for (uint8_t i = 0; i < StepOn::THERMAL_COUNT; i++) {
    if (frame.temperature[i] < -100.0f) {
      Serial.printf("  SHTC3 #%u (TCA CH%u): 측정 실패 또는 연결 안 됨\n",
        static_cast<unsigned>(i + 1),
        static_cast<unsigned>(StepOn::THERMAL_CHANNELS[i]));
    } else {
      Serial.printf("  SHTC3 #%u (TCA CH%u): 온도 %6.2f °C, 습도 %6.2f %%\n",
        static_cast<unsigned>(i + 1),
        static_cast<unsigned>(StepOn::THERMAL_CHANNELS[i]),
        frame.temperature[i],
        frame.humidity[i]);
    }
  }

  Serial.println();
  Serial.println("[BMI270 IMU 값]");
  if (frame.imuReady) {
    Serial.printf("  가속도 [g]    X=%8.3f   Y=%8.3f   Z=%8.3f\n",
      frame.accelX, frame.accelY, frame.accelZ);
    Serial.printf("  자이로 [deg/s] X=%8.3f   Y=%8.3f   Z=%8.3f\n",
      frame.gyroX, frame.gyroY, frame.gyroZ);
  } else {
    Serial.println("  BMI270이 연결되지 않아 값을 읽을 수 없습니다.");
  }

#if PRINT_JSON_FRAME
  Serial.println();
  Serial.println("[JSON]");
  Serial.println(StepOn::frameToJson(frame));
#endif

  printDivider();
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("StepOn 01_sensor_test");
  Serial.println("Pin map: I2C SDA=GPIO6, SCL=GPIO7 | MUX S0=GPIO1 S1=GPIO3 S2=GPIO4 S3=GPIO5 SIG=GPIO0");
  Serial.println("Serial Monitor 속도: 115200 baud");
  StepOn::initSensorCore();
}

void loop() {
  StepOn::SensorFrame frame;
  StepOn::readSensorFrame(frame);
  printSensorFrame(frame);
  delay(1000);
}
