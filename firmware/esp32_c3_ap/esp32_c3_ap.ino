#include <Arduino.h>
#include <DNSServer.h>
#include <FS.h>
#include <LittleFS.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>

// 현재 연결한 사용자 배선은 ESP32-C3 MINI가 아니라 일반 ESP32 DevKit/WROOM 핀맵입니다.
// Arduino IDE에서 "ESP32 Dev Module"을 선택해야 하며, C3로 선택하면 아래 보호 조건이
// 컴파일을 중단시켜 잘못된 핀맵 업로드를 막습니다.
#define USER_WIRING_CLASSIC_ESP32 1

// 1: 센서 연결 전 테스트 모드 / 0: 실제 FSR·IMU 입력 사용
#define USE_MOCK_SENSORS 0

// 현재 배선은 MPU6050 + DRV2605L을 사용하므로 BMI270/SHTC3 경로와 분리합니다.
#define USE_REAL_I2C_SENSORS 1
#define USE_MPU6050 1
#define USE_REAL_SHTC3 0
#define USE_DRV2605 1

// 현재 배선에는 TCA9548A와 SHTC3가 포함되어 있지 않습니다.
// SHTC3를 추가하는 단계에서 1로 바꾸고 채널 배선을 다시 지정해야 합니다.
#define USE_I2C_MUX 0

// 압력 MUX는 현재 한 개(한쪽 깔창)만 연결합니다.
// 양발을 동시에 사용할 때는 두 번째 MUX SIG를 별도 ADC에 연결하고 1로 바꿉니다.
#define USE_SECOND_PRESSURE_MUX 0

// 레이저는 초기 센서 검증 중에는 반드시 OFF로 시작합니다.
// MOSFET/BJT 배선과 안전 인터록을 확인한 뒤에만 1로 변경하세요.
#define ENABLE_LASER_OUTPUT 0

#if USER_WIRING_CLASSIC_ESP32 && defined(CONFIG_IDF_TARGET_ESP32C3)
#error "현재 펌웨어는 일반 ESP32 배선(GPIO25/26/34)을 사용합니다. Arduino 보드를 ESP32 Dev Module로 선택하거나 C3용 핀맵으로 바꾸세요."
#endif

const uint8_t I2C_MUX_ADDRESS = 0x71;
const uint8_t IMU_I2C_CHANNEL = 0;
// SHTC3는 동일한 0x70 주소이므로 TCA9548A의 서로 다른 채널에 하나씩 연결합니다.
// CH1: 왼발 뒤꿈치, CH2: 왼발 앞발, CH3: 오른발 뒤꿈치, CH4: 오른발 앞발
const uint8_t SHTC3_SENSOR_COUNT = 4;
const uint8_t SHTC3_I2C_CHANNELS[SHTC3_SENSOR_COUNT] = {1, 2, 3, 4};

// 사용자 제공 일반 ESP32 배선
#if USER_WIRING_CLASSIC_ESP32
const int I2C_SDA_PIN = 25;
const int I2C_SCL_PIN = 26;
const int MUX_S0_PIN = 18;
const int MUX_S1_PIN = 19;
const int MUX_S2_PIN = 21;
const int MUX_S3_PIN = 22;
const int MUX_LEFT_SIG_PIN = 34;  // GPIO34는 입력 전용 ADC 핀
const int MUX_RIGHT_SIG_PIN = -1;
const int LASER_PIN = 23;
#else
// 기존 ESP32-C3 테스트 배선. USER_WIRING_CLASSIC_ESP32를 0으로 바꿀 때만 사용합니다.
const int I2C_SDA_PIN = 4;
const int I2C_SCL_PIN = 5;
const int MUX_S0_PIN = 6;
const int MUX_S1_PIN = 7;
const int MUX_S2_PIN = 10;
const int MUX_S3_PIN = 20;
const int MUX_LEFT_SIG_PIN = 0;
const int MUX_RIGHT_SIG_PIN = 1;
const int LASER_PIN = 21;
#endif

// 사용자가 연결한 FSR 채널: C0, C2, C4, C6, C8, C10, C12, C14
const uint8_t PRESSURE_MUX_CHANNELS[8] = {0, 2, 4, 6, 8, 10, 12, 14};

// FSR406 분압 회로와 저항값에 맞춰 실측 후 조정합니다.
const int PRESSURE_ADC_MIN = 0;
const int PRESSURE_ADC_MAX = 4095;
const bool PRESSURE_INVERTED = false;
const int PRESSURE_GATE_SUM = 180;
const uint32_t SAMPLE_INTERVAL_MS = 20;  // MPU6050/FSR 내부 샘플링 50 Hz
const uint32_t LOG_INTERVAL_MS = 1000;
const uint32_t SUMMARY_INTERVAL_MS = 5000;
const uint32_t CUE_REPEAT_INTERVAL_MS = 1400;
const uint32_t LASER_CUE_DURATION_MS = 650;
const uint8_t DRV2605_WAVEFORM = 1;
const size_t MAX_LOG_BYTES = 512 * 1024;
const int MOTION_WINDOW_SIZE = 300;      // 약 6초 @ 50 Hz
const uint32_t MOTION_ANALYSIS_INTERVAL_MS = 250;
const float FOG_FI_THRESHOLD = 1.5f;     // 개인별 standing baseline으로 재보정할 값
const float TEMP_ASYMMETRY_THRESHOLD_C = 2.2f; // IWGDF 대응 부위 차이 참고값
const uint8_t TEMP_ASYMMETRY_CONFIRM_WINDOWS = 2; // 장치에서는 연속 관찰창으로 대체

const char *DATA_LOG_PATH = "/stepon_log.csv";
const char *SUMMARY_PATH = "/stepon_summary.json";
const char *PROFILE_PATH = "/stepon_profile.json";

#if USE_REAL_I2C_SENSORS
#if USE_MPU6050
#include <Adafruit_MPU6050.h>
#endif
#if USE_REAL_SHTC3
#include <Adafruit_SHTC3.h>
#endif
#include <Adafruit_Sensor.h>
#if USE_MPU6050
Adafruit_MPU6050 mpu6050;
#endif
#if USE_REAL_SHTC3
Adafruit_SHTC3 shtc3Sensors[SHTC3_SENSOR_COUNT];
#endif
bool imuReady = false;
#if USE_REAL_SHTC3
bool shtc3Ready[SHTC3_SENSOR_COUNT] = {false, false, false, false};
#endif
#endif

#if USE_DRV2605
#include <Adafruit_DRV2605.h>
Adafruit_DRV2605 drv2605;
bool drv2605Ready = false;
#endif

const char *AP_SSID = "StepOn-C3";
const char *AP_PASSWORD = "stepon1234";
const IPAddress AP_IP(192, 168, 4, 1);
const byte DNS_PORT = 53;

WebServer server(80);
DNSServer dnsServer;

struct SensorFrame {
  uint8_t pressureLeft[8];
  uint8_t pressureRight[8];
  float temperature;
  float humidity;
  float temperatureBySensor[SHTC3_SENSOR_COUNT];
  float humidityBySensor[SHTC3_SENSOR_COUNT];
  float accelX;
  float accelY;
  float accelZ;
  float gyroX;
  float gyroY;
  float gyroZ;
  float copX;
  float copY;
  uint8_t battery;
  uint8_t risk;
  uint32_t frame;
};

SensorFrame currentFrame{};
uint8_t shtc3ReadyCount = USE_MOCK_SENSORS ? SHTC3_SENSOR_COUNT : 0;
uint32_t lastSampleAt = 0;
uint32_t lastLogAt = 0;
uint32_t lastSummaryAt = 0;
bool storageReady = false;
uint32_t loggedFrames = 0;
uint32_t fogEvents = 0;
float loggedTemperatureSum = 0.0f;
float loggedHumiditySum = 0.0f;
uint8_t loggedMaxRisk = 0;
char lastAlgorithmState[12] = "Normal";

struct AlgorithmFrame {
  bool gateOpen;
  float fi;
  float fiRatio;
  float spectralEntropy;
  float pitchRom;
  float cadenceSpm;
  float score;
  char state[12];
  uint8_t warningStreak;
  uint8_t normalStreak;
  bool cueVibration;
  bool cueLaser;
};

struct DiabetesFrame {
  char state[12];
  float score;
  float peakPressure;
  float pressureHotspot;
  float pressureBalanceGap;
  float temperatureDelta;          // 호환용: 최대 대응부위 온도 차
  float maxTemperatureDelta;
  float meanTemperatureDelta;
  uint8_t temperatureHotRegion;   // 0 LH, 1 LF, 2 RH, 3 RF
  uint8_t attentionStreak;
  uint8_t temperatureAsymmetryStreak;
  bool temperatureAsymmetryAvailable;
  bool temperatureThresholdExceeded;
};

struct PostureFrame {
  char state[12];
  char alignment[32];
  float score;
  float roll;
  float pitch;
  float yaw;
  float stepLengthCm;
  float trajectoryXcm;
  float trajectoryYcm;
  uint32_t stepCount;
  bool stance;
  bool zeroVelocityUpdate;
  bool driftWarning;
};

AlgorithmFrame algorithmFrame = {true, 0, 0, 0, 0, 0, 0, "Normal", 0, 0, false, false};
DiabetesFrame diabetesFrame = {"Stable", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, false};
PostureFrame postureFrame = {"Stance", "기준선 범위", 0, 0, 0, 0, 0, 0, 0, 0, true, true, false};

float motionWindow[MOTION_WINDOW_SIZE] = {0};
float motionPitchWindow[MOTION_WINDOW_SIZE] = {0};
int motionWriteIndex = 0;
int motionSampleCount = 0;
float motionLowPower = 0.0f;
float motionHighPower = 0.0f;
float motionSpectralEntropy = 0.0f;
bool motionAnalysisReady = false;
uint32_t lastMotionAnalysisAt = 0;
uint32_t lastDiabetesUpdateAt = 0;
float diabetesBaselineTemperature = 0.0f;
bool diabetesBaselineReady = false;
bool previousStance = false;
float gaitCadenceSpm = 0.0f;
uint32_t lastStepAt = 0;

const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#243954">
  <title>StepOn C3 / Sensor Lab</title>
  <style>
    :root{--ink:#243954;--muted:#8290a3;--line:#e5ebf1;--bg:#d9f2f1;--coral:#ef7777;--mint:#58bd9a;--lav:#8681d8;--sky:#72acd0;--orange:#cf7b27}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Arial,"Malgun Gothic",sans-serif}
    button{font:inherit}.shell{display:none;max-width:1180px;margin:0 auto;padding:24px 20px 48px}.shell.ready{display:block}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:38px}.brand{display:flex;gap:12px;align-items:center}.mark{width:38px;height:38px;display:grid;place-items:center;border-radius:13px 13px 13px 4px;background:var(--ink);color:white;font:700 23px Georgia;box-shadow:5px 5px #f2beb6}.brand b{display:block;font-size:14px;letter-spacing:.18em}.brand small{display:block;margin-top:3px;color:#6b898a;font-size:10px;letter-spacing:.15em}.connection{display:flex;align-items:center;gap:7px;color:#587879;font-size:11px}.dot{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 4px #e3f7ef}.dot.off{background:var(--coral);box-shadow:0 0 0 4px #ffe6e3}.top-tools{display:flex;align-items:center;gap:14px}.profile-edit{padding:7px 10px;border:1px solid #b7dbd8;border-radius:7px;color:#557c7b;background:#eefafa;font-size:10px;cursor:pointer}
    .hero{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:30px}.eyebrow{color:var(--coral);font-size:10px;font-weight:800;letter-spacing:.16em}.hero h1{margin:13px 0 10px;font:700 clamp(34px,6vw,58px)/.98 Georgia;color:var(--ink);letter-spacing:-.06em}.hero h1 em{color:var(--coral);font-style:normal}.hero p{margin:0;color:#628181;font-size:14px;line-height:1.7}.hero-meta{display:grid;gap:10px;justify-items:end}.ap-badge{padding:12px 14px;border:1px solid #b9dfdb;border-radius:11px;background:#edfafa;white-space:nowrap}.ap-badge small,.ap-badge strong{display:block}.ap-badge small{color:#79a292;font-size:10px}.ap-badge strong{margin-top:4px;color:#397a65;font-size:14px}.profile-summary{min-width:228px;padding:11px 14px;border:1px solid #c5dadd;border-radius:11px;background:#fff}.profile-summary small,.profile-summary strong{display:block}.profile-summary small{color:#8c9da4;font-size:9px}.profile-summary strong{margin-top:5px;color:var(--ink);font-size:11px}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}.stat{padding:18px;border:1px solid var(--line);border-radius:13px;background:#fff}.stat.coral{background:#fff1ef;border-color:#ffe3df}.stat.lav{background:#f2f1ff;border-color:#e7e5ff}.stat.sky{background:#eef8fd;border-color:#e0f0f8}.stat.mint{background:#edf9f4;border-color:#dbf1e8}.stat label{display:block;color:#8e9bad;font-size:10px;font-weight:700}.stat strong{display:block;margin-top:16px;font:700 32px Georgia;color:var(--ink)}.stat strong span{margin-left:4px;color:#8b98a9;font:600 11px Arial}.stat p{margin:6px 0 0;color:#91a0ad;font-size:10px}
    .grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}.panel{padding:22px;border:1px solid var(--line);border-radius:14px;background:#fff}.heading{display:flex;justify-content:space-between;align-items:start;gap:14px}.heading small{color:#9aa6b4;font-size:10px;font-weight:800;letter-spacing:.15em}.heading h2{margin:6px 0 0;font:700 21px Georgia;letter-spacing:-.04em}.live{padding:5px 8px;border-radius:5px;color:#44a580;background:#e8f8f1;font-size:9px;font-weight:800;letter-spacing:.12em}
    .feet{display:grid;grid-template-columns:1fr 1fr;gap:30px;padding:27px 10px 14px}.foot-head{display:flex;align-items:center;gap:7px;color:#788799;font-size:11px;font-weight:700}.foot-map{height:255px;display:grid;place-items:center}.foot-shape{width:164px;height:245px;position:relative;transform:rotate(5deg)}.sole-base,.sole-base i{position:absolute;display:block}.sole-base{inset:0;filter:drop-shadow(0 5px 6px #34465d15)}.sole-base i{border:1px solid #c9e0e1;background:linear-gradient(155deg,#fbfefe,#eaf6f5);box-shadow:inset -4px -5px 10px #90b8b822}.sole-heel{width:82px;height:82px;left:39px;bottom:5px;border-radius:45% 48% 44% 46%}.sole-arch{width:70px;height:118px;left:49px;bottom:61px;border-radius:42% 44% 52% 48%;transform:rotate(-8deg)}.sole-fore{width:99px;height:82px;left:28px;top:45px;border-radius:44% 48% 42% 39%;transform:rotate(5deg)}.toes{width:112px;height:49px;left:25px;top:3px;display:flex;align-items:end;justify-content:center;gap:4px;border:0!important;background:transparent!important;box-shadow:none!important}.toes i{position:relative!important;inset:auto!important;width:22px;height:28px;border-radius:55% 55% 48% 48%;transform:rotate(3deg)}.toes i:nth-child(1){width:28px;height:39px}.toes i:nth-child(2){height:32px}.toes i:nth-child(3){height:29px}.toes i:nth-child(4){height:25px}.toes i:nth-child(5){height:21px}.node{width:31px;height:31px;position:absolute;z-index:2;display:grid;place-items:center;border:3px solid rgba(255,255,255,.86);border-radius:50%;color:#fff;font-size:8px;font-weight:800;transform:translate(-50%,-50%);box-shadow:0 3px 7px #34465d33}.hot{background:#ec6c72}.warm{background:#f29a79}.mid{background:#73b79e}.cool{background:#81a5cb}.scale{display:flex;justify-content:space-between;padding:0 22px;color:#a4afbc;font-size:9px}.scale:before{content:"";height:4px;width:72%;position:absolute;margin:4px 0 0 28px;border-radius:4px;background:linear-gradient(90deg,#81a5cb,#73b79e,#f29a79,#ec6c72)}.scale span{position:relative;padding-top:14px}.pressure-foot{padding-top:14px;border-top:1px solid var(--line);color:#9ba6b5;font-size:10px}.pressure-meter{height:7px;margin:10px 0 6px;border-radius:8px;background:#edf1f5;overflow:hidden}.pressure-meter span{display:block;height:100%;border-radius:8px;background:linear-gradient(90deg,#6ec2a0,#f1bc82,#ea7c78)}.pressure-foot b{color:var(--mint)}
    .imu-main{display:flex;align-items:center;gap:23px;min-height:210px}.orbit{width:170px;height:170px;position:relative;flex:0 0 auto;border-radius:50%;background:repeating-radial-gradient(circle at center,transparent 0 26px,#edf2f6 27px 28px)}.ring{position:absolute;inset:27px;border:1px solid #dfe7ed;border-radius:50%;transform:rotate(-18deg) skewX(20deg)}.ring.two{inset:42px 10px;transform:rotate(22deg) skewX(-21deg);border-color:#efc5c0}.chip{width:57px;height:57px;position:absolute;left:57px;top:57px;display:grid;place-items:center;align-content:center;border-radius:16px;background:var(--ink);color:#fff;box-shadow:0 9px 16px #2439542a;transform:rotate(-10deg)}.chip span{font-size:9px;letter-spacing:.12em}.chip b{font:700 16px Georgia}.point{width:8px;height:8px;position:absolute;border-radius:50%;background:var(--coral);box-shadow:0 0 0 4px #ffe7e2}.p1{left:17px;top:85px}.p2{right:27px;top:33px;background:var(--lav);box-shadow:0 0 0 4px #e9e7ff}.p3{right:18px;bottom:31px;background:var(--mint);box-shadow:0 0 0 4px #e0f7ed}.imu-copy label,.imu-copy strong,.imu-copy p{display:block}.imu-copy label{color:#9ba6b4;font-size:10px}.imu-copy strong{margin-top:7px;font:700 27px Georgia}.imu-copy p{margin:10px 0 0;color:var(--muted);font-size:11px;line-height:1.6}.axis{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;border-top:1px solid var(--line);padding-top:14px}.axis div{padding:10px;border-radius:8px;background:#f8fafc}.axis span{display:block;color:#9ba6b5;font-size:9px}.axis b{display:block;margin-top:5px;font-size:15px}.axis b small{color:#9ba6b5;font-size:9px;font-weight:400}
    .cop{margin-top:18px}.cop-chart{height:180px;position:relative;border-left:1px solid #dfe6ed;border-bottom:1px solid #dfe6ed;background:linear-gradient(#f0f4f7 1px,transparent 1px),linear-gradient(90deg,#f0f4f7 1px,transparent 1px);background-size:20% 25%;overflow:hidden}.cross-x,.cross-y{position:absolute;background:#dce4eb}.cross-x{height:1px;width:100%;top:50%}.cross-y{height:100%;width:1px;left:50%}.line{height:2px;position:absolute;transform-origin:left center;background:linear-gradient(90deg,#b7b6e8,#ef8c88)}.point-small{width:7px;height:7px;position:absolute;border:2px solid #fff;border-radius:50%;background:#a8a6dc;box-shadow:0 0 0 2px #dfdef8;transform:translate(-50%,-50%)}.point-small.current{width:12px;height:12px;background:var(--coral);box-shadow:0 0 0 4px #ffe0dc}.cop-values{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:17px;padding-top:14px;border-top:1px solid var(--line)}.cop-values span,.cop-values b{display:block}.cop-values span{color:#9ca8b6;font-size:9px}.cop-values b{margin-top:5px;font-size:16px}.cop-values small{color:#9ca8b6;font:400 9px Arial}
    .parts{margin-top:18px}.part-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}.part{padding:16px;border:1px solid var(--line);border-radius:12px;background:#fff}.part-icon{width:42px;height:42px;display:grid;place-items:center;margin-bottom:15px;border-radius:12px;color:var(--lav);background:#f0efff;font-size:24px}.part:nth-child(2) .part-icon{color:var(--mint);background:#eaf8f2}.part:nth-child(3) .part-icon{color:var(--sky);background:#edf8fd}.part:nth-child(4) .part-icon{color:var(--coral);background:#fff0ee}.part label{padding:4px 6px;border-radius:4px;color:#8995a6;background:#f3f5f8;font-size:8px;font-weight:800;letter-spacing:.1em}.part h3{margin:11px 0 6px;font:700 16px Georgia}.part p{min-height:38px;margin:0;color:#8f9baa;font-size:10px;line-height:1.6}.part footer{display:flex;justify-content:space-between;margin-top:14px;padding-top:11px;border-top:1px solid var(--line);color:#a0aab7;font-size:9px}.part footer b{color:var(--ink)}
    .notice{display:flex;gap:12px;align-items:center;margin-top:18px;padding:14px 16px;border:1px solid #f2e4c8;border-radius:10px;background:#fffbf1}.notice i{width:21px;height:21px;display:grid;place-items:center;flex:0 0 auto;border:1px solid #e2b661;border-radius:50%;color:#ad7a25;font-style:normal;font-weight:800}.notice p{margin:0;color:#a89066;font-size:9px;line-height:1.6}.notice b{color:#90703d}.footer{margin-top:27px;text-align:center;color:#6b898a;font-size:10px}.toast{position:fixed;right:20px;bottom:20px;padding:12px 15px;border:1px solid #d5eee2;border-radius:9px;background:#effaf5;color:#4d806c;font-size:11px;box-shadow:0 8px 25px #24395422}
    .storage-panel{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-top:18px}.storage-card{padding:18px;border-radius:11px;background:#f4fbfa}.storage-card h3{margin:6px 0 5px;font:700 18px Georgia}.storage-card p{margin:0;color:#8ea2a4;font-size:10px;line-height:1.55}.storage-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.storage-meta span{padding:6px 8px;border-radius:6px;color:#5b817e;background:#e5f5f3;font-size:9px}.storage-actions{display:flex;align-items:center;justify-content:center;gap:9px;flex-wrap:wrap}.storage-actions button{padding:11px 12px;border:1px solid #c8ddde;border-radius:8px;color:#467774;background:#fff;font-size:10px;cursor:pointer}.storage-actions button.primary{color:#fff;border-color:var(--ink);background:var(--ink)}.storage-message{margin-top:11px;color:#8e9ea3;font-size:9px;text-align:center}.onboarding.hidden{display:none}.onboarding{min-height:100vh;display:grid;place-items:center;padding:38px 18px;background:linear-gradient(135deg,#72c4c1 0%,#b9e7e4 100%);position:relative;overflow:hidden}.onboarding:before,.onboarding:after{content:"";position:absolute;border-radius:50%;background:rgba(255,255,255,.13)}.onboarding:before{width:480px;height:480px;right:-180px;top:-150px}.onboarding:after{width:330px;height:330px;left:-130px;bottom:-150px}.onboarding-card{width:min(100%,920px);position:relative;z-index:1;padding:38px 42px;border-radius:26px;background:#fff;box-shadow:0 20px 60px rgba(41,94,96,.18)}.onboarding-header{display:flex;justify-content:space-between;gap:20px;align-items:start}.onboarding-brand{display:flex;align-items:center;gap:12px}.onboarding-brand .mark{background:#fff;color:#54aaa7;box-shadow:none}.onboarding-brand b{color:var(--ink);font-size:14px;letter-spacing:.18em}.onboarding-brand small{display:block;margin-top:4px;color:#9aa7ae;font-size:10px;letter-spacing:.13em}.step-count{color:#9caeb1;font-size:10px}.onboarding h1{margin:28px 0 10px;font:700 clamp(31px,5vw,49px)/1.02 Georgia;color:var(--ink);letter-spacing:-.06em}.onboarding h1 em{color:var(--coral);font-style:normal}.onboarding-lead{max-width:570px;margin:0;color:#7c8d93;font-size:13px;line-height:1.7}.onboarding-section{margin-top:25px}.onboarding-label{display:block;margin-bottom:10px;color:#5f7378;font-size:11px;font-weight:800;letter-spacing:.08em}.choice-row{display:flex;flex-wrap:wrap;gap:9px}.choice{padding:11px 14px;border:1px solid #dfe8ea;border-radius:9px;color:#73848a;background:#fff;font-size:11px;cursor:pointer;transition:.2s}.choice:hover{border-color:#a9d7d4}.choice.selected{border-color:#4ca8a3;color:#247c79;background:#eaf8f6;box-shadow:0 0 0 3px #e6f5f3}.purpose-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.purpose-choice{min-height:104px;padding:15px;text-align:left}.purpose-choice b,.purpose-choice span{display:block}.purpose-choice b{margin-top:15px;color:var(--ink);font:700 16px Georgia}.purpose-choice span{margin-top:5px;color:#94a1a7;font-size:10px;line-height:1.45}.purpose-choice.selected b{color:#247c79}.onboarding-bottom{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:27px;padding-top:18px;border-top:1px solid #edf1f2}.consent{display:flex;align-items:flex-start;gap:8px;color:#8b9aa0;font-size:10px;line-height:1.5}.consent input{margin-top:2px;accent-color:#4ca8a3}.start-button{min-width:150px;padding:13px 18px;border:0;border-radius:9px;color:#fff;background:var(--ink);font-size:11px;font-weight:700;cursor:pointer}.start-button:disabled{cursor:not-allowed;opacity:.4}.algorithm-panel{margin-top:18px}.algorithm-pipeline{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:20px}.algorithm-node{min-height:104px;padding:14px 11px;border-radius:11px;background:#f2f6f7;text-align:center}.algorithm-node:nth-child(2){background:#fff4e7}.algorithm-node:nth-child(3),.algorithm-node:nth-child(4){background:#eaf7f4}.algorithm-node:nth-child(5){background:#fff0ee}.algorithm-node small,.algorithm-node strong,.algorithm-node span{display:block}.algorithm-node small{color:#99a8ac;font-size:8px;font-weight:800}.algorithm-node strong{margin-top:10px;color:#3b6565;font-size:12px}.algorithm-node span{margin-top:7px;color:#819396;font-size:9px;line-height:1.45}.algorithm-node.active{box-shadow:inset 0 -3px var(--mint)}.algorithm-node.warn{box-shadow:inset 0 -3px var(--orange)}.algorithm-node.danger{box-shadow:inset 0 -3px var(--coral)}.algorithm-lower{display:grid;grid-template-columns:1.1fr .9fr;gap:18px;margin-top:18px}.feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.feature{padding:13px;border-radius:10px;background:#f8fafb}.feature span,.feature strong{display:block}.feature span{color:#9aa8ad;font-size:9px}.feature strong{margin-top:8px;color:var(--ink);font:700 20px Georgia}.feature small{display:block;margin-top:4px;color:#a4b0b4;font-size:9px}.state-card{padding:16px;border-radius:11px;background:var(--ink);color:#fff}.state-card small{color:#aec5c8;font-size:9px;letter-spacing:.1em}.state-card strong{display:block;margin-top:7px;font:700 28px Georgia}.state-card p{margin:7px 0 0;color:#bed0d2;font-size:10px;line-height:1.5}.cue-row{display:flex;gap:8px;margin-top:14px}.cue-chip{padding:7px 9px;border-radius:6px;color:#adc3c5;background:#344d66;font-size:9px}.cue-chip.on{color:#fff;background:var(--coral)}.purpose-panels{display:flex;flex-wrap:wrap;gap:7px;margin-top:15px}.purpose-panel{flex:1 1 190px;padding:12px;border:1px solid #e6edef;border-radius:9px;background:#fff}.purpose-panel b,.purpose-panel span{display:block}.purpose-panel b{color:var(--ink);font-size:11px}.purpose-panel span{margin-top:5px;color:#8e9ea3;font-size:9px;line-height:1.5}.algorithm-disclaimer{margin-top:16px;color:#9aa9ad;font-size:9px;line-height:1.5}

    /* Sensor-focused visual layer: clearer plantar silhouette, contact zones, thermal context, and pitch motion. */
    .foot-shape{width:178px;height:274px;transform:none;filter:drop-shadow(0 9px 12px #34465d20)}
    #leftFoot{transform:rotate(-2deg)}#rightFoot{transform:rotate(2deg)}
    .sole-base{inset:0;filter:none}
    .sole-base::before{content:"";position:absolute;inset:16px 16px 5px;border:1px solid #c8dedf;border-radius:49% 48% 43% 44% / 18% 17% 20% 21%;background:linear-gradient(160deg,#fcffff 0%,#eaf6f5 74%,#d6ecea 100%);box-shadow:inset -8px -10px 16px #82aaa822,0 5px 9px #34465d16}
    .sole-base::after{content:"";position:absolute;z-index:1;width:54px;height:112px;top:92px;border-radius:50%;background:#fff;opacity:.9;box-shadow:0 0 0 1px #edf5f4}
    #leftFoot .sole-base::after{right:22px;transform:rotate(-14deg)}#rightFoot .sole-base::after{left:22px;transform:rotate(14deg)}
    .sole-base>.sole-heel,.sole-base>.sole-arch,.sole-base>.sole-fore{z-index:2;border:0!important;background:transparent!important;box-shadow:none!important}
    .sole-heel{width:82px;height:82px;left:48px;bottom:4px}.sole-arch{width:78px;height:116px;left:51px;bottom:60px}.sole-fore{width:108px;height:84px;left:35px;top:49px}
    .toes{z-index:3;width:120px;height:54px;left:29px;top:0;gap:5px}.toes i{border:1px solid #c8dedf!important;background:linear-gradient(155deg,#fcffff,#e5f3f2)!important;box-shadow:inset -3px -4px 7px #82aaa81a,0 3px 5px #34465d14!important}
    .node{z-index:5;width:34px;height:34px;font-size:9px;transition:left .25s ease,top .25s ease,transform .2s ease,filter .2s ease}.node:hover{transform:translate(-50%,-50%) scale(1.12);filter:brightness(1.05)}.node::after{content:attr(data-label);position:absolute;left:50%;top:36px;transform:translateX(-50%);padding:3px 5px;border-radius:4px;color:#6f8188;background:#fff;box-shadow:0 3px 8px #24395418;font-size:7px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .18s}.node:hover::after{opacity:1}
    .sensor-layout{margin:4px 0 0;padding:13px 14px 12px;border:1px solid #e4edef;border-radius:11px;background:#f8fbfb}.sensor-layout-head{display:flex;justify-content:space-between;gap:10px;align-items:center;color:#6d858a;font-size:10px;font-weight:800;letter-spacing:.08em}.sensor-layout-head span{color:#9aacb0;font-size:9px;font-weight:500;letter-spacing:0}.sensor-layout-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}.sensor-layout-grid span{padding:7px 5px;border-radius:7px;background:#fff;color:#819397;font-size:8px;line-height:1.35}.sensor-layout-grid b{display:inline-block;margin-right:3px;color:#3d7774;font-size:9px}.sensor-layout-note{display:block;margin-top:9px;color:#a0adb0;font-size:8px;line-height:1.45}
    .motion-stage{width:214px;height:226px;position:relative;flex:0 0 214px;display:grid;place-items:center;perspective:700px;border-radius:18px;background:radial-gradient(circle at 50% 50%,#ffffff 0 46%,#f3f8f8 47% 48%,transparent 49%),linear-gradient(145deg,#f9fcfc,#eef6f6);overflow:hidden}.motion-stage::before{content:"";position:absolute;inset:19px;border:1px dashed #d8e8e8;border-radius:50%}.motion-grid{position:absolute;inset:31px;background:linear-gradient(90deg,transparent 49.5%,#dceaea 49.5% 50.5%,transparent 50.5%),linear-gradient(transparent 49.5%,#dceaea 49.5% 50.5%,transparent 50.5%);opacity:.65}.motion-shadow{position:absolute;width:88px;height:18px;bottom:29px;border-radius:50%;background:#5c8d8d28;filter:blur(6px);transform:rotate(-3deg)}.motion-foot{z-index:2;transform:perspective(620px) rotateX(var(--pitch,0deg)) rotateZ(var(--roll,0deg)) rotateY(var(--yaw,0deg)) scale(.58);transform-origin:50% 74%;transition:transform .48s cubic-bezier(.22,.74,.28,1);will-change:transform}.motion-foot .node{display:none}.motion-caption{position:absolute;left:12px;bottom:10px;color:#739191;font-size:8px;font-weight:800;letter-spacing:.12em}.motion-angle{position:absolute;right:11px;top:11px;z-index:4;display:grid;justify-items:end;color:#819396;font-size:8px}.motion-angle b{color:var(--ink);font:700 16px Georgia}.motion-angle span{margin-top:2px;color:#9aaeb0;font-size:8px;text-transform:uppercase}.imu-copy{min-width:0}.imu-copy label{color:#6f8e8f;font-weight:800;letter-spacing:.08em}.imu-copy strong{font-size:25px}.imu-copy p{margin-top:9px}.mobility-meter{height:7px;margin-top:14px;border-radius:8px;background:#edf2f3;overflow:hidden}.mobility-meter span{display:block;width:12%;height:100%;border-radius:8px;background:linear-gradient(90deg,#6ab7a6,#f0ba78,#e87979);transition:width .45s ease}.mobility-label{display:block;margin-top:6px;color:#91a4a5;font-size:9px}.orientation-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 10px;padding-top:14px;border-top:1px solid var(--line)}.orientation-grid div{padding:9px 10px;border-radius:8px;background:#f8fafb}.orientation-grid span{display:block;color:#9ba6b5;font-size:9px}.orientation-grid b{display:block;margin-top:5px;color:var(--ink);font-size:15px}.raw-imu{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;color:#9ba6b5;font-size:9px}.raw-imu b{margin-left:3px;color:#526d72;font-size:10px}
    .thermal-panel{margin-top:18px}.thermal-layout{display:grid;grid-template-columns:1.05fr .95fr;gap:22px;align-items:center;margin-top:18px}.thermal-visual{min-height:265px;display:grid;place-items:center;position:relative;border-radius:14px;background:linear-gradient(145deg,#f9fcfc,#eef7f7)}.thermal-visual small{position:absolute;top:12px;left:14px;color:#91a7a8;font-size:9px;letter-spacing:.08em}.thermal-foot{width:156px;height:238px;position:relative;filter:drop-shadow(0 9px 12px #34465d20)}.thermal-foot .thermal-sole{position:absolute;inset:39px 18px 4px;border:1px solid #c8dedf;border-radius:49% 48% 43% 44% / 18% 17% 20% 21%;background:linear-gradient(160deg,#fcffff,#eaf6f5);overflow:hidden}.thermal-foot .thermal-sole::before{content:"";position:absolute;width:49px;height:106px;top:53px;right:15px;border-radius:50%;background:#fff;opacity:.88}.thermal-foot.right .thermal-sole::before{right:auto;left:15px}.thermal-toes{position:absolute;top:2px;left:22px;width:112px;height:53px;display:flex;align-items:end;justify-content:center;gap:5px}.thermal-toes i{display:block;width:22px;height:28px;border:1px solid #c8dedf;border-radius:55% 55% 48% 48%;background:#eef7f6}.thermal-toes i:nth-child(1){width:28px;height:40px}.thermal-toes i:nth-child(2){height:33px}.thermal-toes i:nth-child(3){height:29px}.thermal-toes i:nth-child(4){height:25px}.thermal-toes i:nth-child(5){height:21px}.thermal-field{position:absolute;z-index:2;inset:0;border-radius:50%;background:radial-gradient(circle at 50% 18%,hsl(var(--thermal-hue,120) 86% 60% / var(--thermal-alpha,.35)) 0 11%,transparent 28%),radial-gradient(circle at 31% 42%,hsl(calc(var(--thermal-hue,120) + 12) 86% 60% / var(--thermal-alpha,.35)) 0 12%,transparent 30%),radial-gradient(circle at 70% 45%,hsl(calc(var(--thermal-hue,120) - 12) 86% 60% / var(--thermal-alpha,.35)) 0 13%,transparent 31%),radial-gradient(circle at 48% 79%,hsl(calc(var(--thermal-hue,120) - 8) 86% 60% / var(--thermal-alpha,.35)) 0 14%,transparent 32%);mix-blend-mode:multiply;pointer-events:none}.thermal-legend{position:absolute;right:12px;bottom:14px;width:120px;color:#93a5a7;font-size:8px}.thermal-legend i{display:block;height:6px;margin:5px 0 3px;border-radius:5px;background:linear-gradient(90deg,#6ea8d0,#71bd9d,#f1bb78,#e76e70)}.thermal-legend-row{display:flex;justify-content:space-between}.thermal-summary{display:grid;gap:10px}.thermal-value-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.thermal-value{padding:14px;border-radius:10px;background:#f7fafb}.thermal-value span{display:block;color:#93a2a6;font-size:9px}.thermal-value b{display:block;margin-top:7px;color:var(--ink);font:700 23px Georgia}.thermal-value small{font:400 10px Arial;color:#93a2a6}.thermal-status{padding:13px 14px;border:1px solid #e5edef;border-radius:10px;background:#fff;color:#5c7d7e;font-size:10px;line-height:1.55}.thermal-status b{display:block;margin-bottom:5px;color:#387b70}.thermal-note{margin:0;color:#9aa9ad;font-size:9px;line-height:1.6}
    @media(max-width:850px){.hero{align-items:start;flex-direction:column}.hero-meta{justify-items:start}.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.part-grid{grid-template-columns:repeat(2,1fr)}.algorithm-pipeline{grid-template-columns:repeat(2,1fr)}.algorithm-lower,.storage-panel{grid-template-columns:1fr}.thermal-layout{grid-template-columns:1fr}}
    @media(max-width:520px){.motion-stage{width:180px;flex-basis:180px;height:210px}.motion-foot{transform:perspective(620px) rotateX(var(--pitch,0deg)) rotateZ(var(--roll,0deg)) rotateY(var(--yaw,0deg)) scale(.5)}.sensor-layout-grid{grid-template-columns:repeat(2,1fr)}.orientation-grid{gap:5px}.thermal-layout{gap:10px}}
    @media(max-width:850px){.hero{align-items:start;flex-direction:column}.hero-meta{justify-items:start}.stats{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.part-grid{grid-template-columns:repeat(2,1fr)}.algorithm-pipeline{grid-template-columns:repeat(2,1fr)}.algorithm-lower,.storage-panel{grid-template-columns:1fr}}
    @media(max-width:520px){.shell{padding:18px 13px 40px}.top{margin-bottom:28px}.connection{font-size:0}.connection .dot{margin-right:6px}.stats{grid-template-columns:1fr}.feet{gap:5px;padding-left:0;padding-right:0}.foot-shape{width:136px;transform:scale(.86) rotate(5deg)}.imu-main{gap:5px}.orbit{transform:scale(.82);transform-origin:left center;margin-right:-28px}.panel{padding:17px}.part-grid{grid-template-columns:1fr}.notice{align-items:start}.onboarding-card{padding:25px 21px}.purpose-grid{grid-template-columns:1fr}.onboarding-bottom{align-items:stretch;flex-direction:column}.start-button{width:100%}.storage-actions{justify-content:stretch}.storage-actions button{flex:1}}
    .thermal-pair{display:flex;justify-content:center;align-items:flex-start;gap:22px;width:100%;padding:23px 12px 10px}.thermal-foot-card{display:grid;justify-items:center;gap:6px;color:#789092;font-size:9px;font-weight:800}.thermal-foot-card>span{letter-spacing:.12em}.thermal-foot.compact{width:132px;height:208px}.thermal-zone{position:absolute;z-index:4;border-radius:50%;background:radial-gradient(circle,hsl(var(--zone-hue,120) 86% 58% / var(--zone-alpha,.6)) 0 20%,hsl(var(--zone-hue,120) 86% 58% / .18) 62%,transparent 74%);filter:blur(1px);mix-blend-mode:multiply;transition:background .35s ease}.thermal-zone.fore{left:25px;top:51px;width:82px;height:58px}.thermal-zone.heel{left:42px;bottom:10px;width:52px;height:47px}.thermal-readouts{display:grid;grid-template-columns:repeat(2,1fr);gap:5px;width:100%;padding:0 4px}.thermal-readouts span{display:block;padding:5px 3px;border-radius:6px;background:#fff;color:#899b9d;font-size:8px;text-align:center}.thermal-readouts b{display:block;margin-top:2px;color:var(--ink);font-size:10px}.thermal-summary .thermal-status{margin-top:0}.thermal-note strong{color:#5f8881}.thermal-value-grid small{font-size:10px}@media(max-width:820px){.thermal-layout{grid-template-columns:1fr}.thermal-pair{gap:10px}.thermal-foot.compact{transform:scale(.92);transform-origin:top center;margin-bottom:-15px}}    /* Final visual correction: clean top-view plantar map and a true lateral foot animation. */
    .foot-shape{width:190px;height:282px;position:relative;transform:none!important;display:block;filter:none}
    .foot-shape .sole-base{position:absolute;left:29px;top:32px;right:29px;bottom:10px;inset:auto;z-index:1;filter:drop-shadow(0 8px 9px #24434a20)}
    .foot-shape .sole-base::before{content:"";position:absolute;left:0;right:0;top:0;bottom:0;border:1px solid #c6dfe0;border-radius:50% 48% 42% 44% / 22% 19% 14% 16%;background:linear-gradient(160deg,#fbffff 0%,#eef8f7 66%,#dcefee 100%);box-shadow:inset -7px -10px 15px #7da9aa22,inset 8px 5px 13px #ffffffaa}
    .foot-shape .sole-base::after{content:"";position:absolute;z-index:2;top:74px;width:51px;height:122px;border-radius:50%;background:linear-gradient(90deg,#ffffffd9,#f8fcfcaa);opacity:.82;box-shadow:0 0 0 1px #e5f1f0}
    #leftFoot .sole-base::after{right:8px;transform:rotate(-12deg)}
    #rightFoot .sole-base::after{left:8px;transform:rotate(12deg)}
    .foot-shape .sole-base>i{display:none!important}
    .foot-shape .toes{position:absolute!important;z-index:4;left:50%;top:-25px;width:122px;height:54px;transform:translateX(-50%);display:flex;align-items:flex-end;justify-content:center;gap:5px;border:0!important;background:transparent!important;box-shadow:none!important}
    .foot-shape .toes i{position:relative!important;inset:auto!important;display:block;width:20px;height:27px;border:1px solid #c6dfe0!important;border-radius:55% 55% 47% 47%!important;background:linear-gradient(160deg,#fcffff,#e6f4f3)!important;box-shadow:inset -3px -4px 7px #82aaa81a,0 3px 5px #24434a18!important;transform:none!important}
    .foot-shape .toes i:nth-child(1){width:29px;height:40px;margin-right:2px}.foot-shape .toes i:nth-child(2){height:34px}.foot-shape .toes i:nth-child(3){height:30px}.foot-shape .toes i:nth-child(4){height:26px}.foot-shape .toes i:nth-child(5){height:22px}
    .foot-shape .node{z-index:10;width:34px;height:34px;border-width:3px;font-size:9px;box-shadow:0 4px 8px #24434a33}
    .foot-map{height:300px}
    .motion-stage{width:248px;height:226px;position:relative;display:block;flex:0 0 248px;perspective:none;border-radius:18px;background:linear-gradient(180deg,#f9fcfc 0 61%,#edf6f5 61% 100%);overflow:hidden}
    .motion-stage::before{content:"";position:absolute;left:20px;right:20px;bottom:46px;inset:auto;height:1px;border:0;border-top:1px solid #c9dddd;border-radius:0}
    .motion-grid{position:absolute;left:22px;right:22px;top:26px;bottom:47px;background:linear-gradient(90deg,transparent 49.5%,#d8e9e8 49.5% 50.5%,transparent 50.5%),linear-gradient(transparent 49.5%,#d8e9e8 49.5% 50.5%,transparent 50.5%);opacity:.42}
    .motion-shadow{position:absolute;left:47px;bottom:37px;width:157px;height:15px;border-radius:50%;background:#477a7b2c;filter:blur(6px);transform:none}
    .motion-foot{position:absolute;z-index:2;left:50%;top:58%;width:174px;height:118px;transform:translate(-50%,-50%) rotate(var(--pitch,0deg));transform-origin:24px 96px;transition:transform .48s cubic-bezier(.22,.74,.28,1);will-change:transform}
    .motion-foot .side-shin{position:absolute;left:28px;top:-39px;width:28px;height:61px;border:1px solid #c7dede;border-radius:16px 13px 10px 10px;background:linear-gradient(145deg,#fbffff,#dcefee);transform:rotate(-8deg);box-shadow:inset -4px -5px 9px #78a5a522}
    .motion-foot .side-ankle{position:absolute;left:19px;top:17px;width:45px;height:50px;border:1px solid #c2dada;border-radius:19px 14px 12px 17px;background:linear-gradient(145deg,#fbffff,#e1f2f1);box-shadow:inset -5px -5px 9px #78a5a522}
    .motion-foot .side-heel{position:absolute;left:0;top:58px;width:54px;height:44px;border:1px solid #c2dada;border-radius:17px 10px 12px 21px;background:linear-gradient(155deg,#faffff,#dcefee);box-shadow:inset -5px -5px 9px #78a5a522}
    .motion-foot .side-mid{position:absolute;left:34px;top:63px;width:64px;height:35px;border:1px solid #c2dada;border-radius:12px 38px 13px 11px;background:linear-gradient(155deg,#faffff,#e3f3f2);transform:skewX(-13deg);box-shadow:inset -4px -4px 8px #78a5a522}
    .motion-foot .side-fore{position:absolute;left:79px;top:43px;width:64px;height:50px;border:1px solid #c2dada;border-radius:30px 14px 12px 16px;background:linear-gradient(155deg,#faffff,#dcefee);transform:rotate(-5deg);box-shadow:inset -5px -5px 9px #78a5a522}
    .motion-foot .side-toes{position:absolute;left:126px;top:28px;width:38px;height:35px;border:1px solid #c2dada;border-radius:62% 43% 22% 22%;background:linear-gradient(155deg,#faffff,#dcefee);transform:rotate(-12deg);box-shadow:inset -4px -4px 8px #78a5a522}
    .motion-foot .side-sole-line{position:absolute;z-index:4;left:13px;top:94px;width:143px;height:7px;border-radius:8px;background:linear-gradient(90deg,#6ea9a1,#9fc7bd);box-shadow:0 2px 3px #477a7b28}
    .motion-foot .node{display:none}
    .motion-caption{left:13px;bottom:11px;color:#628987;font-size:8px;letter-spacing:.1em}.motion-angle{right:12px;top:12px}
    @media(max-width:520px){.foot-map{height:278px}.foot-shape{width:166px;height:258px}.foot-shape .sole-base{left:25px;right:25px;top:29px;bottom:8px}.foot-shape .toes{top:-23px;transform:translateX(-50%) scale(.9)}.motion-stage{width:190px;flex-basis:190px;height:210px}.motion-foot{transform:translate(-50%,-50%) rotate(var(--pitch,0deg)) scale(.84)}.motion-grid{left:14px;right:14px}.motion-shadow{left:28px;width:135px}}
    /* Final silhouette pass: one readable plantar body and one continuous lateral foot. */
    .foot-shape{width:190px!important;height:282px!important;position:relative!important;transform:none!important;display:block!important;filter:none!important}
    .foot-shape::before{content:"";position:absolute;z-index:1;left:35px;top:39px;width:120px;height:232px;border:2px solid #9fc9c8;border-radius:47% 49% 42% 44% / 21% 19% 14% 16%;background:linear-gradient(158deg,#eaf7f6 0%,#d5eeec 57%,#bddfdd 100%);box-shadow:inset -11px -14px 18px #659c9b35,inset 7px 6px 12px #ffffffbd,0 8px 12px #446f7024}
    .foot-shape::after{content:"";position:absolute;z-index:2;top:112px;width:48px;height:112px;border-radius:50%;background:linear-gradient(90deg,#ffffffec,#f7fbfbe8);box-shadow:0 0 0 1px #e5f2f1,0 4px 10px #8fb5b31a}
    #leftFoot::after{right:42px;transform:rotate(-13deg)}#rightFoot::after{left:42px;transform:rotate(13deg)}
    .foot-shape .sole-base{position:absolute!important;inset:0!important;z-index:3!important;filter:none!important}
    .foot-shape .sole-base::before,.foot-shape .sole-base::after{display:none!important}
    .foot-shape .sole-base>i{display:none!important}
    .foot-shape .toes{position:absolute!important;z-index:4!important;left:50%!important;top:4px!important;width:122px!important;height:52px!important;transform:translateX(-50%)!important;display:flex!important;align-items:flex-end!important;justify-content:center!important;gap:5px!important;border:0!important;background:transparent!important;box-shadow:none!important}
    .foot-shape .toes i{position:relative!important;inset:auto!important;display:block!important;width:20px!important;height:27px!important;border:2px solid #9fc9c8!important;border-radius:55% 55% 48% 48%!important;background:linear-gradient(160deg,#f8ffff,#d5eceb)!important;box-shadow:inset -3px -4px 7px #61979622,0 3px 5px #446f7022!important;transform:none!important}
    .foot-shape .toes i:nth-child(1){width:30px!important;height:41px!important;margin-right:2px}.foot-shape .toes i:nth-child(2){height:35px!important}.foot-shape .toes i:nth-child(3){height:31px!important}.foot-shape .toes i:nth-child(4){height:27px!important}.foot-shape .toes i:nth-child(5){height:23px!important}
    .foot-shape .node{z-index:10!important;width:34px!important;height:34px!important;border:3px solid #ffffffdd!important;box-shadow:0 4px 8px #24434a33!important}
    .motion-foot{width:188px!important;height:122px!important;top:59%!important;transform:translate(-50%,-50%) rotate(var(--pitch,0deg))!important;transform-origin:22px 101px!important}
    .motion-foot::before{content:"";position:absolute;z-index:1;left:5px;top:45px;width:174px;height:56px;border:2px solid #8fbdbc;border-radius:20px 57px 20px 26px / 24px 39px 18px 24px;background:linear-gradient(155deg,#f7ffff 0%,#d9efed 58%,#b9dad7 100%);box-shadow:inset -10px -10px 15px #5e98962e,inset 8px 5px 12px #ffffffb8,0 8px 10px #476f7028;transform:skewX(-5deg) rotate(-2deg)}
    .motion-foot::after{content:"";position:absolute;z-index:2;left:27px;top:2px;width:37px;height:68px;border:2px solid #8fbdbc;border-radius:19px 15px 10px 12px;background:linear-gradient(145deg,#f8ffff,#cce7e5);transform:rotate(-8deg);box-shadow:inset -6px -7px 10px #5e98962e}
    .motion-foot .side-shin,.motion-foot .side-ankle,.motion-foot .side-heel,.motion-foot .side-mid,.motion-foot .side-fore,.motion-foot .side-toes{display:none!important}
    .motion-foot .side-sole-line{position:absolute!important;z-index:4!important;left:15px!important;top:96px!important;width:145px!important;height:7px!important;border-radius:8px!important;background:linear-gradient(90deg,#5d9d95,#93c6b8)!important;box-shadow:0 2px 3px #477a7b38!important}
    @media(max-width:520px){.foot-shape{width:166px!important;height:258px!important}.foot-shape::before{left:30px;top:36px;width:106px;height:214px}.foot-shape::after{top:102px;right:37px;width:43px;height:102px}#rightFoot::after{right:auto;left:37px}.foot-shape .toes{transform:translateX(-50%) scale(.9)!important}.motion-foot{transform:translate(-50%,-50%) rotate(var(--pitch,0deg)) scale(.84)!important}}
    /* Layout cleanup: keep legends local, align sensor columns, and quiet decorative axis lines. */
    .panel{overflow:hidden}
    .feet{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:24px 6px 12px;align-items:start}
    .feet>div{min-width:0}
    .foot-head{justify-content:center}
    .foot-map{height:286px}
    .scale{position:relative;min-height:28px;padding:0 14px;align-items:flex-start}
    .scale::before{left:22px;right:22px;width:auto;margin:4px 0 0;height:3px;border-radius:4px;opacity:.82}
    .scale span{z-index:1;padding-top:14px}
    .pressure-foot{margin-top:0}
    .imu-main{gap:18px;min-height:226px}
    .motion-stage{flex:0 1 248px;min-width:0}
    .imu-copy{flex:1 1 150px}
    .motion-grid{background:linear-gradient(90deg,transparent 49.5%,#d8e9e8 49.5% 50.5%,transparent 50.5%);opacity:.22}
    @media(max-width:850px){.feet{gap:18px}.imu-main{gap:14px}}
    @media(max-width:520px){.feet{gap:8px;padding-left:0;padding-right:0}.foot-map{height:266px}.foot-head{justify-content:flex-start;padding-left:8px}.scale{padding-left:8px;padding-right:8px}.scale::before{left:14px;right:14px}.imu-main{gap:8px}.motion-grid{opacity:.16}}
    /* Anatomical plantar silhouette: tapered forefoot, waist, heel, and mirrored arches. */
    .foot-shape::before{content:"";position:absolute;z-index:1;left:26px!important;top:34px!important;width:138px!important;height:238px!important;border:0!important;border-radius:50% 47% 43% 44% / 20% 19% 15% 16%!important;background:linear-gradient(155deg,#f0faf9 0%,#d7eeec 48%,#b7d9d6 100%)!important;clip-path:path("M 48 4 C 34 5 26 16 21 31 C 16 47 13 62 14 77 C 15 91 20 101 28 109 C 32 114 31 121 26 131 C 19 143 13 160 13 179 C 13 202 22 220 40 230 C 57 240 85 241 104 233 C 123 225 130 208 128 187 C 126 167 119 149 111 133 C 106 122 107 116 113 107 C 122 95 127 81 125 65 C 123 47 115 28 104 16 C 95 6 83 2 72 6 C 62 1 54 1 48 4 Z")!important;filter:drop-shadow(0 8px 8px #416c6b2c)}
    .foot-shape::after{content:"";position:absolute;z-index:2;top:112px!important;width:45px!important;height:108px!important;border:0!important;border-radius:0!important;background:linear-gradient(90deg,#ffffffd9 0%,#f8fdfcbd 66%,#e7f4f2a6 100%)!important;clip-path:path("M 25 0 C 13 13 8 29 11 44 C 14 57 9 70 7 83 C 5 96 10 108 20 112 C 30 108 37 98 38 85 C 39 70 34 60 36 47 C 39 30 35 12 25 0 Z")!important;box-shadow:none!important;opacity:.72!important}
    #leftFoot::after{right:36px!important;left:auto!important;transform:rotate(-16deg)!important}
    #rightFoot::after{left:36px!important;right:auto!important;transform:rotate(16deg)!important}
    .foot-shape .toes{top:6px!important;z-index:4!important;gap:4px!important}
    #leftFoot .toes{flex-direction:row-reverse}
    #rightFoot .toes{flex-direction:row}
    .foot-shape .toes i{border-radius:62% 55% 47% 42% / 60% 50% 42% 38%!important;background:linear-gradient(150deg,#f8ffff 0%,#d6eceb 100%)!important}
    #leftFoot .toes i:nth-child(1){transform:rotate(-10deg)!important}
    #rightFoot .toes i:nth-child(1){transform:rotate(10deg)!important}
    .foot-shape .toes i:nth-child(2){transform:rotate(-5deg)!important}
    .foot-shape .toes i:nth-child(3){transform:rotate(0deg)!important}
    .foot-shape .toes i:nth-child(4){transform:rotate(4deg)!important}
    .foot-shape .toes i:nth-child(5){transform:rotate(8deg)!important}
    @media(max-width:520px){.foot-shape::before{left:24px!important;top:31px!important;width:118px!important;height:222px!important}.foot-shape::after{top:103px!important}.foot-shape .toes{top:4px!important}}
    /* Reference-shaped plantar and lateral silhouettes. */
    .foot-shape::before{content:"";position:absolute;z-index:1;left:12px!important;top:4px!important;width:166px!important;height:274px!important;border:0!important;border-radius:0!important;background:linear-gradient(155deg,#f2fbfa 0%,#d8efed 50%,#b9dad7 100%)!important;-webkit-clip-path:path("M 31 11 C 19 10 11 18 10 31 C 9 47 14 61 23 73 C 29 80 38 84 45 80 C 48 76 46 68 45 62 C 44 53 48 47 55 45 C 64 43 71 50 72 61 C 73 69 70 77 72 82 C 74 87 80 89 85 84 C 89 79 87 71 88 64 C 89 55 95 50 103 52 C 111 54 115 61 113 70 C 111 78 109 85 113 89 C 117 93 122 91 126 87 C 130 82 129 75 131 70 C 134 61 142 59 148 64 C 155 70 153 81 149 90 C 146 98 143 105 145 112 C 147 120 154 125 157 134 C 163 150 162 173 157 196 C 153 217 148 240 137 256 C 126 271 108 278 86 278 C 63 278 44 272 33 258 C 21 243 19 220 20 198 C 20 176 21 151 27 134 C 33 118 36 105 31 91 C 28 83 22 77 17 70 C 8 58 5 43 8 29 C 10 18 18 11 31 11 Z")!important;clip-path:path("M 31 11 C 19 10 11 18 10 31 C 9 47 14 61 23 73 C 29 80 38 84 45 80 C 48 76 46 68 45 62 C 44 53 48 47 55 45 C 64 43 71 50 72 61 C 73 69 70 77 72 82 C 74 87 80 89 85 84 C 89 79 87 71 88 64 C 89 55 95 50 103 52 C 111 54 115 61 113 70 C 111 78 109 85 113 89 C 117 93 122 91 126 87 C 130 82 129 75 131 70 C 134 61 142 59 148 64 C 155 70 153 81 149 90 C 146 98 143 105 145 112 C 147 120 154 125 157 134 C 163 150 162 173 157 196 C 153 217 148 240 137 256 C 126 271 108 278 86 278 C 63 278 44 272 33 258 C 21 243 19 220 20 198 C 20 176 21 151 27 134 C 33 118 36 105 31 91 C 28 83 22 77 17 70 C 8 58 5 43 8 29 C 10 18 18 11 31 11 Z")!important;filter:drop-shadow(0 8px 8px #416c6b2c)}
    #leftFoot::before{transform:scaleX(-1)!important;transform-origin:center}
    #rightFoot::before{transform:none!important}
    .foot-shape::after{content:"";position:absolute;z-index:2;top:108px!important;width:43px!important;height:111px!important;border:0!important;border-radius:0!important;background:linear-gradient(90deg,#f6fcfbdc,#edf8f6b4 70%,#e0f1efa0)!important;-webkit-clip-path:path("M 23 0 C 12 14 8 30 11 45 C 14 58 9 72 7 85 C 5 99 10 110 20 111 C 30 108 36 97 37 84 C 38 70 33 59 35 46 C 38 29 34 12 23 0 Z")!important;clip-path:path("M 23 0 C 12 14 8 30 11 45 C 14 58 9 72 7 85 C 5 99 10 110 20 111 C 30 108 36 97 37 84 C 38 70 33 59 35 46 C 38 29 34 12 23 0 Z")!important;box-shadow:none!important;opacity:.55!important}
    #leftFoot::after{right:31px!important;left:auto!important;transform:rotate(-14deg)!important}
    #rightFoot::after{left:31px!important;right:auto!important;transform:rotate(14deg)!important}
    .foot-shape .toes{display:none!important}
    .foot-shape .sole-base{z-index:3!important}
    .foot-shape .node{z-index:10!important}
    .motion-foot{width:205px!important;height:126px!important;top:59%!important;transform:translate(-50%,-50%) rotate(var(--pitch,0deg))!important;transform-origin:23px 108px!important}
    .motion-foot::before{content:"";position:absolute;z-index:1;left:0;top:0;width:205px;height:126px;border:0;background:linear-gradient(155deg,#f7ffff 0%,#d9efed 55%,#b8d9d6 100%);-webkit-clip-path:path("M 39 6 C 26 7 20 21 21 40 C 22 52 17 61 10 70 C 1 82 7 101 26 108 C 52 117 96 112 130 113 C 158 114 187 109 198 96 C 206 84 198 72 185 67 C 166 60 146 59 126 53 C 108 48 93 41 79 32 C 68 25 61 13 52 8 C 47 5 43 5 39 6 Z");clip-path:path("M 39 6 C 26 7 20 21 21 40 C 22 52 17 61 10 70 C 1 82 7 101 26 108 C 52 117 96 112 130 113 C 158 114 187 109 198 96 C 206 84 198 72 185 67 C 166 60 146 59 126 53 C 108 48 93 41 79 32 C 68 25 61 13 52 8 C 47 5 43 5 39 6 Z");filter:drop-shadow(0 0 0 #8fbdbc) drop-shadow(0 7px 8px #476f7028)}
    .motion-foot::after{content:"";position:absolute;z-index:2;left:22px;top:8px;width:43px;height:76px;background:linear-gradient(145deg,#f9ffff,#cce7e5);-webkit-clip-path:path("M 20 0 C 10 4 5 15 7 31 C 8 45 4 59 0 74 L 34 76 C 39 58 39 35 34 17 C 31 7 26 1 20 0 Z");clip-path:path("M 20 0 C 10 4 5 15 7 31 C 8 45 4 59 0 74 L 34 76 C 39 58 39 35 34 17 C 31 7 26 1 20 0 Z");opacity:.7}
    .motion-foot .side-sole-line{display:none!important}
    @media(max-width:520px){.foot-shape::before{left:9px!important;top:4px!important;width:148px!important;height:250px!important}.foot-shape::after{top:101px!important}.motion-foot{width:190px!important;height:118px!important}.motion-foot::before{width:190px;height:118px}.motion-foot::after{left:20px;top:7px;transform:scale(.94)}}
    /* Smooth reference pass: continuous skin-like contour with quiet shading. */
    .foot-shape::before{left:12px!important;top:4px!important;width:166px!important;height:274px!important;border-radius:47% 49% 42% 45% / 15% 14% 17% 17%!important;background:linear-gradient(154deg,#f7fcfb 0%,#dcefed 47%,#b8d9d6 100%)!important;-webkit-clip-path:path("M 31 7 C 18 6 8 15 7 30 C 5 47 11 64 22 77 C 28 84 37 87 45 82 C 51 78 52 71 49 64 C 46 55 50 47 58 44 C 66 41 74 47 76 57 C 78 65 75 74 78 81 C 80 88 87 91 93 86 C 98 82 98 74 96 67 C 94 58 99 51 107 50 C 115 49 122 55 123 64 C 124 72 120 80 123 87 C 126 94 133 96 139 91 C 145 86 143 79 145 72 C 147 64 154 61 160 65 C 167 70 166 80 162 89 C 158 99 154 107 157 116 C 160 126 167 132 169 143 C 173 163 169 185 164 207 C 159 232 152 254 140 267 C 128 281 108 286 86 286 C 63 286 43 279 31 263 C 19 247 17 223 18 201 C 18 179 19 154 25 136 C 31 119 35 105 30 91 C 27 82 21 76 16 69 C 7 56 3 40 6 26 C 8 14 17 7 31 7 Z")!important;clip-path:path("M 31 7 C 18 6 8 15 7 30 C 5 47 11 64 22 77 C 28 84 37 87 45 82 C 51 78 52 71 49 64 C 46 55 50 47 58 44 C 66 41 74 47 76 57 C 78 65 75 74 78 81 C 80 88 87 91 93 86 C 98 82 98 74 96 67 C 94 58 99 51 107 50 C 115 49 122 55 123 64 C 124 72 120 80 123 87 C 126 94 133 96 139 91 C 145 86 143 79 145 72 C 147 64 154 61 160 65 C 167 70 166 80 162 89 C 158 99 154 107 157 116 C 160 126 167 132 169 143 C 173 163 169 185 164 207 C 159 232 152 254 140 267 C 128 281 108 286 86 286 C 63 286 43 279 31 263 C 19 247 17 223 18 201 C 18 179 19 154 25 136 C 31 119 35 105 30 91 C 27 82 21 76 16 69 C 7 56 3 40 6 26 C 8 14 17 7 31 7 Z")!important;filter:drop-shadow(0 7px 7px #416c6b2b)}
    #leftFoot::before{transform:scaleX(-1)!important;transform-origin:center}
    #rightFoot::before{transform:none!important}
    .foot-shape::after{top:112px!important;width:42px!important;height:103px!important;background:linear-gradient(90deg,#f9fdfcd8,#edf8f5a8 74%,#dcefeb80)!important;-webkit-clip-path:path("M 22 0 C 12 13 8 28 10 42 C 12 55 8 67 6 79 C 4 92 9 102 19 103 C 29 100 35 91 36 78 C 37 65 32 55 34 43 C 37 27 33 11 22 0 Z")!important;clip-path:path("M 22 0 C 12 13 8 28 10 42 C 12 55 8 67 6 79 C 4 92 9 102 19 103 C 29 100 35 91 36 78 C 37 65 32 55 34 43 C 37 27 33 11 22 0 Z")!important;opacity:.42!important}
    #leftFoot::after{right:31px!important;left:auto!important;transform:rotate(-13deg)!important}
    #rightFoot::after{left:31px!important;right:auto!important;transform:rotate(13deg)!important}
    .foot-shape .sole-base{inset:0!important;z-index:3!important;pointer-events:none!important;background:radial-gradient(ellipse at 19% 13%,#ffffff68 0 8%,transparent 22%),radial-gradient(ellipse at 48% 16%,#ffffff44 0 7%,transparent 20%),radial-gradient(ellipse at 75% 22%,#ffffff38 0 7%,transparent 18%),radial-gradient(ellipse at 50% 89%,#6eaaa82a 0 13%,transparent 28%)!important;mix-blend-mode:soft-light}
    #leftFoot .sole-base{transform:scaleX(-1)}
    #rightFoot .sole-base{transform:none}
    .foot-shape .toes{display:none!important}
    .foot-shape .node{z-index:10!important}
    .motion-foot::before{background:linear-gradient(155deg,#fbffff 0%,#dcefed 56%,#b7d8d5 100%)!important;filter:drop-shadow(0 0 0 #8db9b6) drop-shadow(0 6px 8px #476f7028)!important}
    .motion-foot::after{background:linear-gradient(145deg,#ffffffaa,#c5e3e0aa)!important;opacity:.55!important}
    .motion-foot .side-sole-line{display:none!important}
    @media(max-width:520px){.foot-shape::before{left:9px!important;top:4px!important;width:148px!important;height:250px!important}.foot-shape::after{top:103px!important}.foot-shape .sole-base{transform:scaleX(1)!important}#leftFoot .sole-base{transform:scaleX(-1)!important}}
    /* Canvas plantar renderer: one continuous smooth silhouette beneath live pressure nodes. */
    .foot-canvas{position:absolute;left:0;top:0;width:100%;height:100%;z-index:1;display:block;pointer-events:none}
    .foot-shape::before,.foot-shape::after{display:none!important}
    .foot-shape .sole-base{inset:0!important;z-index:2!important;background:transparent!important;mix-blend-mode:normal!important;pointer-events:none!important}
    .foot-shape .toes{display:none!important}
    .foot-shape .node{z-index:10!important}
  </style>
</head>
<body>
  <section class="onboarding" id="onboarding">
    <div class="onboarding-card">
      <div class="onboarding-header"><div class="onboarding-brand"><div class="mark">S</div><div><b>STEPON</b><small>FOG-GUARD INSOLE</small></div></div><span class="step-count">01 / 01 · 맞춤 설정</span></div>
      <h1>당신의 보행을<br><em>어떤 방식으로 볼까요?</em></h1>
      <p class="onboarding-lead">간단한 사용자 정보와 관찰 목적을 선택하면, 압력·IMU·온습도 데이터를 목적에 맞는 화면으로 구성합니다. 목적은 여러 개를 선택할 수 있습니다.</p>
      <div class="onboarding-section"><span class="onboarding-label">성별</span><div class="choice-row" data-group="gender"><button class="choice" type="button" data-value="female">여성</button><button class="choice" type="button" data-value="male">남성</button><button class="choice" type="button" data-value="other">기타</button><button class="choice" type="button" data-value="unspecified">선택하지 않음</button></div></div>
      <div class="onboarding-section"><span class="onboarding-label">연령대</span><div class="choice-row" data-group="ageBand"><button class="choice" type="button" data-value="20s">20대</button><button class="choice" type="button" data-value="30-49">30–49세</button><button class="choice" type="button" data-value="50-69">50–69세</button><button class="choice" type="button" data-value="70plus">70세 이상</button><button class="choice" type="button" data-value="unspecified">선택하지 않음</button></div></div>
      <div class="onboarding-section"><span class="onboarding-label">관찰 목적 · 중복 선택 가능</span><div class="purpose-grid" data-group="purposes"><button class="choice purpose-choice" type="button" data-value="parkinson"><b>보행 동결 관찰</b><span>6초 FI·보행 게이트·연속 Warning·cueing</span></button><button class="choice purpose-choice" type="button" data-value="diabetes"><b>당뇨발 위험 관찰</b><span>압력 hotspot·온도 컨텍스트·습도 기록</span></button><button class="choice purpose-choice" type="button" data-value="posture"><b>자세·궤적 추적</b><span>자세각·stance·ZUPT 궤적·보폭</span></button></div></div>
      <div class="onboarding-bottom"><label class="consent"><input type="checkbox" id="consentCheck"><span>연구용 프로토타입이며 의료 진단·치료를 대신하지 않는다는 내용을 확인했습니다.</span></label><button class="start-button" id="startButton" type="button" disabled>맞춤 화면 시작 →</button></div>
    </div>
  </section>
  <main class="shell" id="dashboard">
    <header class="top"><div class="brand"><div class="mark">S</div><div><b>STEPON</b><small>ESP32 C3 / LOCAL LAB</small></div></div><div class="top-tools"><button class="profile-edit" id="profileEdit" type="button">프로필 수정</button><div class="connection"><i class="dot" id="connectionDot"></i><span id="connectionText">AP 연결됨 · 테스트 스트림</span></div></div></header>
    <section class="hero"><div><span class="eyebrow" id="heroEyebrow">CUSTOM SENSOR DASHBOARD</span><h1 id="heroTitle">보행 데이터를<br><em id="heroAccent">바로 확인하세요.</em></h1><p>선택한 목적에 맞춰 압력·관성·온습도 센서를 함께 보고<br>개인 보행 기준선과 변화 신호를 확인합니다.</p></div><div class="hero-meta"><div class="ap-badge"><small>접속 주소</small><strong>http://192.168.4.1</strong></div><div class="profile-summary"><small>현재 맞춤 분석</small><strong id="profileSummary">프로필을 불러오는 중</strong></div></div></section>
    <section class="stats"><article class="stat coral"><label>보행 연구지표</label><strong id="risk">--<span>/ 100</span></strong><p>낮을수록 안정적인 패턴</p></article><article class="stat lav"><label>좌우 하중 밸런스</label><strong id="balance">--<span> : --</span></strong><p>왼발 : 오른발 상대 압력</p></article><article class="stat sky"><label>피부·환경 컨텍스트</label><strong id="temperature">--<span>°C</span></strong><p id="humidity">습도 --% · SHTC3 ×4</p></article><article class="stat mint"><label>디바이스 배터리</label><strong id="battery">--<span>%</span></strong><p>3.7V Li-ion · 충전 모듈</p></article></section>
    <section class="grid"><article class="panel"><div class="heading"><div><small>PRESSURE / FSR406</small><h2>발바닥 압력 분포</h2></div><span class="live">LIVE</span></div><div class="feet"><div><div class="foot-head"><i class="dot"></i>왼발</div><div class="foot-map"><div class="foot-shape" id="leftFoot"><div class="sole-base"><i class="sole-heel"></i><i class="sole-arch"></i><i class="sole-fore"></i><span class="toes"><i></i><i></i><i></i><i></i><i></i></span></div></div></div><div class="scale"><span>낮음</span><span>높음</span></div></div><div><div class="foot-head"><i class="dot"></i>오른발</div><div class="foot-map"><div class="foot-shape" id="rightFoot"><div class="sole-base"><i class="sole-heel"></i><i class="sole-arch"></i><i class="sole-fore"></i><span class="toes"><i></i><i></i><i></i><i></i><i></i></span></div></div></div><div class="scale"><span>낮음</span><span>높음</span></div></div></div><div class="pressure-foot"><span>현재 프레임 <b id="frame">#----</b></span><div class="pressure-meter"><span id="riskMeter" style="width:20%"></span></div><b id="riskText">수집 중</b></div></article>
      <article class="panel"><div class="heading"><div><small>BMI270 / 6-AXIS IMU</small><h2>발의 움직임</h2></div><span class="live">LIVE</span></div><div class="imu-main"><div class="orbit"><i class="ring"></i><i class="ring two"></i><div class="chip"><span>IMU</span><b>270</b></div><i class="point p1"></i><i class="point p2"></i><i class="point p3"></i></div><div class="imu-copy"><label>현재 자세 변화</label><strong id="gaitState">보행 중</strong><p>가속도와 회전값을<br>프레임 단위로 확인합니다.</p></div></div><div class="axis"><div><span>X 가속도</span><b id="accelX">-- <small>g</small></b></div><div><span>Y 가속도</span><b id="accelY">-- <small>g</small></b></div><div><span>Z 가속도</span><b id="accelZ">-- <small>g</small></b></div><div><span>회전 속도 Z</span><b id="gyroZ">-- <small>°/s</small></b></div></div></article></section>
    <section class="panel cop"><div class="heading"><div><small>CENTER OF PRESSURE</small><h2>발의 궤적 샘플</h2></div><span class="live">RECENT</span></div><div class="cop-chart" id="copChart"><i class="cross-x"></i><i class="cross-y"></i></div><div class="cop-values"><div><span>평균 보폭</span><b>42.8 <small>cm</small></b></div><div><span>보행 주기</span><b>1.14 <small>s</small></b></div><div><span>현재 COP</span><b id="cop">-- / -- <small>%</small></b></div></div></section>
    <section class="panel algorithm-panel"><div class="heading"><div><small id="algorithmTarget">ALGORITHM / PERSONALIZED FLOW</small><h2 id="algorithmHeading">맞춤 보행 알고리즘</h2></div><span class="live" id="algorithmStateBadge">NORMAL</span></div><div class="algorithm-pipeline"><div class="algorithm-node" id="gateNode"><small>01 · GATE</small><strong id="gateTitle">보행 맥락 게이트</strong><span id="gateState">총압력·CoP·움직임 확인</span></div><div class="algorithm-node" id="featureNode"><small>02 · FEATURES</small><strong id="featureTitle">3개 위험 특징</strong><span id="featureState">FI · SpectralEntropy · PitchROM</span></div><div class="algorithm-node" id="scoreNode"><small>03 · SCORE</small><strong id="scoreTitle">윈도우 점수</strong><span id="scoreState">0.00 · 0.5초 간격</span></div><div class="algorithm-node" id="stateNode"><small>04 · STATE</small><strong id="stateTitle">상태머신</strong><span id="stateState">Normal → Warning → FoG → Recovery</span></div><div class="algorithm-node" id="cueNode"><small>05 · OUTPUT</small><strong id="cueState">대기</strong><span id="cueDetail">불필요한 cueing 차단</span></div></div><div class="algorithm-lower"><div><div class="feature-grid"><div class="feature"><span id="featureLabel1">FI · Freeze Index</span><strong id="fiValue">--</strong><small id="featureHelp1">가속도 주파수 비율</small></div><div class="feature"><span id="featureLabel2">SpectralEntropy</span><strong id="entropyValue">--</strong><small id="featureHelp2">움직임 복잡도</small></div><div class="feature"><span id="featureLabel3">PitchROM</span><strong id="pitchValue">--</strong><small id="featureHelp3">발목 기울기 범위</small></div></div><div class="purpose-panels" id="purposePanels"></div></div><div class="state-card"><small id="stateCardCaption">현재 상태 · 연속 조건 적용</small><strong id="algorithmState">Normal</strong><p id="algorithmMessage">지금 걷고 있는지 확인한 뒤 위험도를 계산합니다.</p><div class="cue-row"><span class="cue-chip" id="vibrationCue">진동 OFF</span><span class="cue-chip" id="laserCue">레이저 OFF</span></div></div></div><p class="algorithm-disclaimer">목적별 연구 알고리즘을 분리한 프로토타입입니다. 실제 착용 데이터와 개인 기준선으로 임계값·보정·라벨 검증이 필요하며 의료 진단용이 아닙니다.</p></section>
    <section class="storage-panel"><div class="storage-card"><small>ON-DEVICE DATA</small><h3>센서 로그와 요약 파일</h3><p>ESP32 LittleFS에 원시 프레임을 CSV로 누적하고, 최근 상태·평균·FoG 이벤트를 요약 JSON으로 갱신합니다.</p><div class="storage-meta"><span id="storageStatus">저장소 확인 중</span><span id="storageFrames">frames --</span><span id="storageEvents">FoG events --</span></div></div><div><div class="storage-actions"><button class="primary" id="downloadLog" type="button">CSV 다운로드</button><button id="refreshSummary" type="button">요약 새로고침</button><button id="clearLog" type="button">로그 초기화</button></div><div class="storage-message" id="storageMessage">실시간 데이터 수집 화면과 파일 저장 상태를 함께 확인합니다.</div></div></section>
    <section class="parts"><div class="heading"><div><small>CAPSTONE KIT</small><h2>연결 예정 부품</h2></div></div><div class="part-grid"><article class="part"><div class="part-icon">◌</div><label>MOTION</label><h3>BMI270 IMU</h3><p>6축 가속도·자이로로 발의 자세와 궤적을 추적합니다.</p><footer><span>I²C</span><b>6-axis</b></footer></article><article class="part"><div class="part-icon">⌁</div><label>CONTEXT</label><h3>SHTC3 ×4</h3><p>온도·습도를 피부·환경 컨텍스트로 기록합니다.</p><footer><span>I²C</span><b>2 values</b></footer></article><article class="part"><div class="part-icon">▦</div><label>PRESSURE</label><h3>FSR406 × 8–16</h3><p>아날로그 MUX를 거쳐 발바닥 하중 분포를 수집합니다.</p><footer><span>ADC / MUX</span><b>8–16 ch</b></footer></article><article class="part"><div class="part-icon">⌁</div><label>CONTROL</label><h3>ESP32-C3 MINI</h3><p>AP 모드·센서 융합·로컬 대시보드를 실행합니다.</p><footer><span>Wi‑Fi AP</span><b>192.168.4.1</b></footer></article></div></section>
    <section class="notice"><i>!</i><p><b>연구용 프로토타입 안내.</b> 온·습도는 당뇨를 직접 측정하지 않으며, 압력·IMU값도 질환을 진단하거나 치료하기 위한 의료기기가 아닙니다. 실제 센서 연결과 연구 설계 단계에서 전문가 검토가 필요합니다.</p></section>
    <div class="footer">StepOn local dashboard · ESP32-C3 SoftAP · <span id="mode">MOCK SENSOR MODE</span></div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const points = [[18,68],[28,57],[39,64],[48,46],[57,51],[68,33]];
    const profileKey = 'stepon-profile-v2';
    const labels = {gender:{female:'여성',male:'남성',other:'기타',unspecified:'성별 미선택'},ageBand:{'20s':'20대','30-49':'30–49세','50-69':'50–69세','70plus':'70세 이상',unspecified:'연령대 미선택'},purposes:{parkinson:'보행 동결 관찰',diabetes:'당뇨발 위험 관찰',posture:'자세·궤적 추적'}};
    let profile = {gender:'',ageBand:'',purposes:[]};
    let algorithmMemory = {state:'Normal',warning_streak:0,normal_streak:0};
    let latestAlgorithms = {};
    function tone(v){return v>76?'hot':v>56?'warm':v>36?'mid':'cool'}
    const PRESSURE_SENSOR_MAP = [{x:24,y:16,label:'엄지'}, {x:40,y:19,label:'2·3지'}, {x:61,y:22,label:'4·5지'}, {x:38,y:37,label:'앞발 안쪽'}, {x:72,y:40,label:'앞발 바깥'}, {x:42,y:57,label:'중족부 안쪽'}, {x:69,y:63,label:'중족부 바깥'}, {x:50,y:88,label:'뒤꿈치'}];
    function drawPlantarShape(id){const el=$(id);if(!el)return;let canvas=el.querySelector('.foot-canvas');if(!canvas){canvas=document.createElement('canvas');canvas.className='foot-canvas';el.insertBefore(canvas,el.firstChild)}const width=190,height=282,dpr=Math.min(window.devicePixelRatio||1,2);if(canvas.width!==width*dpr||canvas.height!==height*dpr){canvas.width=width*dpr;canvas.height=height*dpr}const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.save();if(id==='leftFoot'){ctx.translate(width,0);ctx.scale(-1,1)}const sole=new Path2D();sole.moveTo(31,7);sole.bezierCurveTo(18,6,8,15,7,30);sole.bezierCurveTo(5,47,11,64,22,77);sole.bezierCurveTo(28,84,37,87,45,82);sole.bezierCurveTo(51,78,52,71,49,64);sole.bezierCurveTo(46,55,50,47,58,44);sole.bezierCurveTo(66,41,74,47,76,57);sole.bezierCurveTo(78,65,75,74,78,81);sole.bezierCurveTo(80,88,87,91,93,86);sole.bezierCurveTo(98,82,98,74,96,67);sole.bezierCurveTo(94,58,99,51,107,50);sole.bezierCurveTo(115,49,122,55,123,64);sole.bezierCurveTo(124,72,120,80,123,87);sole.bezierCurveTo(126,94,133,96,139,91);sole.bezierCurveTo(145,86,143,79,145,72);sole.bezierCurveTo(147,64,154,61,160,65);sole.bezierCurveTo(167,70,166,80,162,89);sole.bezierCurveTo(158,99,154,107,157,116);sole.bezierCurveTo(160,126,167,132,169,143);sole.bezierCurveTo(173,163,169,185,164,207);sole.bezierCurveTo(159,230,152,250,140,264);sole.bezierCurveTo(128,275,108,280,86,280);sole.bezierCurveTo(63,280,43,274,31,259);sole.bezierCurveTo(19,244,17,222,18,201);sole.bezierCurveTo(18,179,19,154,25,136);sole.bezierCurveTo(31,119,35,105,30,91);sole.bezierCurveTo(27,82,21,76,16,69);sole.bezierCurveTo(7,56,3,40,6,26);sole.bezierCurveTo(8,14,17,7,31,7);sole.closePath();const fill=ctx.createLinearGradient(28,18,160,270);fill.addColorStop(0,'#f8fcfb');fill.addColorStop(.48,'#dcefed');fill.addColorStop(1,'#b8d8d5');ctx.fillStyle=fill;ctx.shadowColor='rgba(56,105,103,.22)';ctx.shadowBlur=8;ctx.shadowOffsetY=7;ctx.fill(sole);ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.strokeStyle='rgba(116,167,163,.72)';ctx.lineWidth=1.35;ctx.stroke(sole);const arch=new Path2D();arch.moveTo(45,111);arch.bezierCurveTo(38,129,39,145,45,158);arch.bezierCurveTo(50,170,45,188,42,205);arch.bezierCurveTo(40,216,45,224,54,225);arch.bezierCurveTo(65,221,71,210,71,196);arch.bezierCurveTo(72,179,65,167,68,151);arch.bezierCurveTo(72,133,65,119,55,111);arch.closePath();ctx.fillStyle='rgba(249,255,253,.34)';ctx.fill(arch);const pads=[[25,30,19,24],[59,34,16,20],[101,47,15,19],[132,70,14,17],[62,146,27,25],[112,157,22,28],[88,246,31,25]];pads.forEach(([x,y,rx,ry])=>{const g=ctx.createRadialGradient(x,y,1,x,y,Math.max(rx,ry));g.addColorStop(0,'rgba(255,255,255,.22)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill()});ctx.restore()}
    function renderFoot(id, values){drawPlantarShape(id);const el=$(id);el.querySelectorAll('.node').forEach((node)=>node.remove());const isRight=id==='rightFoot';values.forEach((v,i)=>{const point=PRESSURE_SENSOR_MAP[i]||PRESSURE_SENSOR_MAP[7];const n=document.createElement('span');n.className='node '+tone(v);n.dataset.label='P'+(i+1)+' · '+point.label;n.title=n.dataset.label;n.textContent=v;const x=isRight?point.x:100-point.x;n.style.left=x+'%';n.style.top=point.y+'%';el.appendChild(n)})}
    function renderCop(x,y){const chart=$('copChart');chart.querySelectorAll('.line,.point-small').forEach((n)=>n.remove());const path=points.concat([[x,100-y]]);path.slice(0,-1).forEach((p,i)=>{const q=path[i+1],dx=q[0]-p[0],dy=q[1]-p[1],len=Math.sqrt(dx*dx+dy*dy),angle=Math.atan2(dy,dx)*180/Math.PI;const l=document.createElement('i');l.className='line';l.style.left=p[0]+'%';l.style.top=p[1]+'%';l.style.width=len+'%';l.style.transform='rotate('+angle+'deg)';chart.appendChild(l)});path.forEach((p,i)=>{const d=document.createElement('i');d.className='point-small '+(i===path.length-1?'current':'');d.style.left=p[0]+'%';d.style.top=p[1]+'%';chart.appendChild(d)})}
    function enhanceMotionCard(){const motion=document.querySelector('.imu-main');if(!motion||motion.querySelector('.motion-stage'))return;const orbit=motion.querySelector('.orbit');if(orbit)orbit.outerHTML='<div class="motion-stage" id="motionStage" aria-label="발 측면 움직임"><div class="motion-grid"></div><div class="motion-shadow"></div><div class="motion-foot" id="motionFoot"><div class="side-shin"></div><div class="side-ankle"></div><div class="side-heel"></div><div class="side-mid"></div><div class="side-fore"></div><div class="side-toes"></div><div class="side-sole-line"></div></div><div class="motion-angle"><b id="motionPitch">+0.0°</b><span>pitch</span></div><div class="motion-caption">SIDE VIEW / 발목–발끝</div></div>';const copy=motion.querySelector('.imu-copy');if(copy)copy.innerHTML='<label>측면 가동성 축 · PITCH</label><strong id="gaitState">보행 중</strong><p id="motionSummary">발목을 기준으로 발끝이 올라가고 내려가는 움직임을 표시합니다.</p><div class="mobility-meter"><span id="mobilityMeter"></span></div><small class="mobility-label" id="mobilityLabel">가동성 분석 준비 중</small>';const panel=motion.closest('.panel');const axis=panel&&panel.querySelector('.axis');if(axis&&!panel.querySelector('.orientation-grid'))axis.insertAdjacentHTML('beforebegin','<div class="orientation-grid"><div><span>Pitch · 발끝 상하</span><b id="imuPitch">--°</b></div><div><span>Roll · 좌우 기울기</span><b id="imuRoll">--°</b></div><div><span>Yaw · 회전</span><b id="imuYaw">--°</b></div></div>')}
    function ensureDashboardEnhancements(){enhanceMotionCard();const feet=document.querySelector('.feet');if(feet&&!document.querySelector('.sensor-layout'))feet.insertAdjacentHTML('afterend','<div class="sensor-layout"><div class="sensor-layout-head">FSR406 센서 배치 · 접촉 영역<span>8개 / 발 · 실제 깔창에서 위치 보정</span></div><div class="sensor-layout-grid"><span><b>P1</b>엄지</span><span><b>P2</b>2·3지</span><span><b>P3</b>4·5지</span><span><b>P4</b>앞발 안쪽</span><span><b>P5</b>앞발 바깥</span><span><b>P6</b>중족부 안쪽</span><span><b>P7</b>중족부 바깥</span><span><b>P8</b>뒤꿈치</span></div><small class="sensor-layout-note">원형 마커는 현재 압력값이며, 압력이 실제로 집중되는 앞발·뒤꿈치·중족부 위치를 센서 배치와 함께 확인합니다.</small></div>');const cop=document.querySelector('section.panel.cop');if(cop&&!document.querySelector('.thermal-panel'))cop.insertAdjacentHTML('beforebegin','<section class="panel thermal-panel"><div class="heading"><div><small>SHTC3 / 4-POINT THERMAL MAP</small><h2>양발 온·습도 히트맵</h2></div><span class="live">4-POINT LIVE</span></div><div class="thermal-layout"><div class="thermal-visual"><small>실측 4점 · 좌/우 앞발·뒤꿈치</small><div class="thermal-pair"><div class="thermal-foot-card"><span>LEFT FOOT</span><div class="thermal-foot compact" id="leftThermalFoot"><div class="thermal-sole"></div><div class="thermal-toes"><i></i><i></i><i></i><i></i><i></i></div><div class="thermal-zone fore" id="leftThermalFore"></div><div class="thermal-zone heel" id="leftThermalHeel"></div></div><div class="thermal-readouts"><span>앞발<b id="leftThermalForeValue">--</b></span><span>뒤꿈치<b id="leftThermalHeelValue">--</b></span></div></div><div class="thermal-foot-card"><span>RIGHT FOOT</span><div class="thermal-foot compact right" id="rightThermalFoot"><div class="thermal-sole"></div><div class="thermal-toes"><i></i><i></i><i></i><i></i><i></i></div><div class="thermal-zone fore" id="rightThermalFore"></div><div class="thermal-zone heel" id="rightThermalHeel"></div></div><div class="thermal-readouts"><span>앞발<b id="rightThermalForeValue">--</b></span><span>뒤꿈치<b id="rightThermalHeelValue">--</b></span></div></div></div><div class="thermal-legend"><span>상대 열감</span><i></i><div class="thermal-legend-row"><em>낮음</em><em>높음</em></div></div></div><div class="thermal-summary"><div class="thermal-value-grid"><div class="thermal-value"><span>평균 온도</span><b id="thermalTemp">--<small>°C</small></b></div><div class="thermal-value"><span>평균 습도</span><b id="thermalHumidity">--<small>%</small></b></div></div><div class="thermal-status"><b id="thermalStatus">4점 온·습도 분석 중</b><span id="thermalDetail">좌·우 앞발과 뒤꿈치 센서값을 기다리는 중입니다.</span></div><p class="thermal-note"><strong>SHTC3 배치:</strong> CH1 좌 뒤꿈치 · CH2 좌 앞발 · CH3 우 뒤꿈치 · CH4 우 앞발. 이 히트맵은 혈당 측정이 아니라 피부 온도 비대칭과 압력 관찰을 위한 연구용 시각화입니다.</p></div></div></section>')}
    function renderMotion(s){const posture=(s.algorithms&&s.algorithms.posture)||{};const safe=(value,limit)=>Math.max(-limit,Math.min(limit,Number.isFinite(Number(value))?Number(value):0));const pitch=safe(posture.pitch_deg,28);const roll=safe(posture.roll_deg,24);const yaw=safe(posture.yaw_deg,45);const foot=$('motionFoot');if(foot){foot.style.setProperty('--pitch',(-pitch)+'deg');foot.style.setProperty('--roll',(roll*.35)+'deg');foot.style.setProperty('--yaw',(yaw*.16)+'deg')}setText('motionPitch',(pitch>=0?'+':'')+pitch.toFixed(1)+'°');setText('imuPitch',(pitch>=0?'+':'')+pitch.toFixed(1)+'°');setText('imuRoll',(roll>=0?'+':'')+roll.toFixed(1)+'°');setText('imuYaw',(yaw>=0?'+':'')+yaw.toFixed(1)+'°');const mobility=Math.round(Math.min(100,Math.abs(pitch)/28*65+Math.abs(roll)/24*25+Math.min(10,Math.abs(yaw)/45*10)));const meter=$('mobilityMeter');if(meter)meter.style.width=Math.max(8,mobility)+'%';setText('mobilityLabel',mobility<25?'작은 가동성 · 안정 구간':mobility<60?'중간 가동성 · 움직임 관찰': '큰 가동성 · 각도 변화 확인');setText('gaitState',posture.state==='Stance'?'접지 구간':'발 들림 구간');setText('motionSummary','Pitch는 발 앞뒤 기울기를 기준으로 계산합니다. 현재 '+(pitch>=0?'+':'')+pitch.toFixed(1)+'° · Roll '+(roll>=0?'+':'')+roll.toFixed(1)+'°')}
    function renderThermal(s){const fallbackTemp=Number(s.temperature)||0;const fallbackHum=Number(s.humidity)||0;const temps=(Array.isArray(s.temperature_sensors)?s.temperature_sensors:[fallbackTemp,fallbackTemp,fallbackTemp,fallbackTemp]).map(Number);const hums=(Array.isArray(s.humidity_sensors)?s.humidity_sensors:[fallbackHum,fallbackHum,fallbackHum,fallbackHum]).map(Number);while(temps.length<4)temps.push(fallbackTemp);while(hums.length<4)hums.push(fallbackHum);const allTemps=temps.slice(0,4);const allHums=hums.slice(0,4);const setZone=(id,temp,hum)=>{const node=$(id);if(!node)return;const warmth=Math.max(0,Math.min(1,(temp-24)/12*.8+(hum-40)/60*.2));const hue=Math.round(210-warmth*205);node.style.setProperty('--zone-hue',hue);node.style.setProperty('--zone-alpha',(0.28+warmth*.5).toFixed(2));node.title='온도 '+temp.toFixed(1)+'°C · 습도 '+hum.toFixed(1)+'%'};setZone('leftThermalHeel',allTemps[0],allHums[0]);setZone('leftThermalFore',allTemps[1],allHums[1]);setZone('rightThermalHeel',allTemps[2],allHums[2]);setZone('rightThermalFore',allTemps[3],allHums[3]);setText('leftThermalHeelValue',allTemps[0].toFixed(1)+'°C');setText('leftThermalForeValue',allTemps[1].toFixed(1)+'°C');setText('rightThermalHeelValue',allTemps[2].toFixed(1)+'°C');setText('rightThermalForeValue',allTemps[3].toFixed(1)+'°C');const averageTemp=allTemps.reduce((a,b)=>a+b,0)/4;const averageHum=allHums.reduce((a,b)=>a+b,0)/4;const heelDelta=Math.abs(allTemps[0]-allTemps[2]);const foreDelta=Math.abs(allTemps[1]-allTemps[3]);const maxDelta=Math.max(heelDelta,foreDelta);setText('thermalTemp',averageTemp.toFixed(1)+'°C');setText('thermalHumidity',averageHum.toFixed(1)+'%');setText('thermalStatus',maxDelta>=2.2?'대응 부위 온도 차이 확인 필요':maxDelta>=1.0?'좌·우 온도 변화 추적 중':'4점 온도 분포 안정 구간');setText('thermalDetail','좌 앞발 '+allTemps[1].toFixed(1)+'°C · 우 앞발 '+allTemps[3].toFixed(1)+'°C · 최대 차 '+maxDelta.toFixed(1)+'°C')}
    function setText(id,value){$(id).textContent=value}
    function selectedValues(group){return [...document.querySelectorAll('[data-group="'+group+'"] .choice.selected')].map((button)=>button.dataset.value)}
    function syncStartButton(){const ready=selectedValues('gender').length===1&&selectedValues('ageBand').length===1&&selectedValues('purposes').length>0&&$('consentCheck').checked;$('startButton').disabled=!ready}
    function primaryPurpose(){return ['parkinson','diabetes','posture'].find((purpose)=>profile.purposes.includes(purpose))||'parkinson'}
    function applyProfile(){const gender=labels.gender[profile.gender]||'성별 미선택';const age=labels.ageBand[profile.ageBand]||'연령대 미선택';const purposes=profile.purposes.map((value)=>labels.purposes[value]).join(' · ');setText('profileSummary',gender+' · '+age+' · '+purposes);document.querySelectorAll('[data-group="gender"] .choice').forEach((button)=>button.classList.toggle('selected',button.dataset.value===profile.gender));document.querySelectorAll('[data-group="ageBand"] .choice').forEach((button)=>button.classList.toggle('selected',button.dataset.value===profile.ageBand));document.querySelectorAll('[data-group="purposes"] .choice').forEach((button)=>button.classList.toggle('selected',profile.purposes.includes(button.dataset.value)));renderPurposePanels(latestAlgorithms)}
    function renderPurposePanels(algorithms){const panel=$('purposePanels');const cards=[];const p=algorithms.parkinson||{};const d=algorithms.diabetes||{};const t=algorithms.posture||{};if(profile.purposes.includes('parkinson'))cards.push('<div class="purpose-panel"><b>파킨슨 FoG 감지</b><span>FI '+Number(p.fi_ratio||0).toFixed(2)+' · '+(p.state||'Normal')+' · 3–8 Hz / 0.5–3 Hz · 6초 창</span></div>');if(profile.purposes.includes('diabetes'))cards.push('<div class="purpose-panel"><b>당뇨발 위험 관찰</b><span>최대 압력 '+Math.round(d.peak_pressure||0)+'/100 · 온도 차 '+Number(d.max_temperature_delta_c||d.temperature_delta_c||0).toFixed(1)+'°C · '+(d.state||'Stable')+'</span></div>');if(profile.purposes.includes('posture'))cards.push('<div class="purpose-panel"><b>자세·궤적 추적</b><span>Roll '+Number(t.roll_deg||0).toFixed(1)+'° · Pitch '+Number(t.pitch_deg||0).toFixed(1)+'° · 보폭 '+Number(t.step_length_cm||0).toFixed(1)+' cm</span></div>');panel.innerHTML=cards.join('')}
    function showOnboarding(){ $('dashboard').classList.remove('ready');$('onboarding').classList.remove('hidden'); }
    function activateDashboard(){applyProfile();$('onboarding').classList.add('hidden');$('dashboard').classList.add('ready');window.scrollTo(0,0)}
    function deriveAlgorithms(s){if(s.algorithms)return s.algorithms;const total=s.pressure_left.reduce((a,b)=>a+b,0)+s.pressure_right.reduce((a,b)=>a+b,0);const fi=Math.min(1,Math.abs(s.accel.x)*2.2+Math.abs(s.gyro.z)/40);const p={target:'parkinson_fog',gate_open:total>180,fi_ratio:fi,fi,spectral_entropy:Math.min(1,.25+Math.abs(s.accel.y)*2.2),pitch_rom:Math.min(1,.12+Math.abs(s.gyro.x)/9),score:fi,state:algorithmMemory.state,warning_streak:algorithmMemory.warning_streak,normal_streak:algorithmMemory.normal_streak,cue_vibration:algorithmMemory.state==='Warning'||algorithmMemory.state==='FoG',cue_laser:algorithmMemory.state==='FoG'};const temps=(Array.isArray(s.temperature_sensors)?s.temperature_sensors:[s.temperature,s.temperature,s.temperature,s.temperature]).map(Number);const hums=(Array.isArray(s.humidity_sensors)?s.humidity_sensors:[s.humidity,s.humidity,s.humidity,s.humidity]).map(Number);const heelDelta=Math.abs(temps[0]-temps[2]);const foreDelta=Math.abs(temps[1]-temps[3]);const maxDelta=Math.max(heelDelta,foreDelta);const peak=Math.max(...s.pressure_left,...s.pressure_right);const d={target:'diabetic_foot_context',state:peak>=75||maxDelta>=2.2?'Observe':'Stable',score:Math.min(1,Math.max(0,(peak-55)/45*.45+maxDelta/2.2*.4)),peak_pressure:peak,pressure_hotspot:Math.min(1,Math.max(0,(peak-55)/45)),pressure_balance_gap:Math.abs(s.pressure_left.reduce((a,b)=>a+b,0)-s.pressure_right.reduce((a,b)=>a+b,0))/Math.max(1,total),temperature_c:s.temperature,temperature_delta_c:maxDelta,max_temperature_delta_c:maxDelta,mean_temperature_delta_c:(heelDelta+foreDelta)/2,humidity_pct:s.humidity,temperature_sensors:temps,humidity_sensors:hums,temperature_asymmetry_available:temps.length>=4,temperature_threshold_exceeded:maxDelta>=2.2,two_window_confirmation_ready:maxDelta>=2.2,temperature_asymmetry_streak:maxDelta>=2.2?1:0};const t={target:'posture_trajectory',state:'Swing',alignment:'기준선 범위',score:Math.min(1,(Math.abs(s.accel.x)+Math.abs(s.accel.y))/2),roll_deg:0,pitch_deg:0,yaw_deg:0,step_count:0,step_length_cm:0,trajectory_x_cm:0,trajectory_y_cm:0,stance:false,zero_velocity_update:false,drift_warning:false};return {parkinson:p,diabetes:d,posture:t}}
    function renderAlgorithm(algorithms,s){latestAlgorithms=algorithms;const mode=primaryPurpose();const a=algorithms[mode]||algorithms.parkinson||{};const state=a.state||'Normal';const score=Number(a.score||0);const isParkinson=mode==='parkinson';const isDiabetes=mode==='diabetes';setText('algorithmTarget',isParkinson?'PARKINSON / FOG DETECTION':isDiabetes?'DIABETIC FOOT / CONTEXT':'POSTURE / ZUPT TRAJECTORY');setText('algorithmHeading',isParkinson?'파킨슨 보행동결 감지':isDiabetes?'당뇨발 위험 관찰':'자세·궤적 추적');setText('algorithmState',state);setText('algorithmStateBadge',state.toUpperCase());if(isParkinson){setText('gateTitle','보행·하중 게이트');setText('gateState',a.gate_open?'OPEN · 6초 윈도우 분석':'CLOSED · 보행 아님');setText('featureTitle','FoG 주파수 특징');setText('featureState','FI · SpectralEntropy · PitchROM');setText('scoreTitle','FoG 점수');setText('scoreState',score.toFixed(2)+' · '+Number(a.fi_ratio||0).toFixed(2)+' FI ratio');setText('stateTitle','FoG 상태머신');setText('stateState','Normal → Warning → FoG → Recovery');setText('featureLabel1','FI ratio · 3–8 / 0.5–3 Hz');setText('featureHelp1','개인 기준선 필요');setText('featureLabel2','SpectralEntropy');setText('featureHelp2','6초 움직임 복잡도');setText('featureLabel3','PitchROM');setText('featureHelp3','발 기울기 범위');setText('fiValue',Number(a.fi_ratio||0).toFixed(2));setText('entropyValue',Number(a.spectral_entropy||0).toFixed(2));setText('pitchValue',Number(a.pitch_rom||0).toFixed(2));setText('cueState',a.cue_laser?'진동 + 레이저':a.cue_vibration?'진동 cue':'대기');setText('cueDetail',a.cue_laser?'FoG · on-demand cueing':a.cue_vibration?'Warning · 다음 윈도우 확인':'정상 보행 · cueing 차단');setText('stateCardCaption','FoG 판정 · 연속 조건 적용');setText('algorithmMessage',state==='FoG'?'3회 연속 Warning으로 FoG 상태에 진입했습니다.':state==='Warning'?'고주파 흔들림과 보행 변화가 연속 관찰됩니다.':state==='Recovery'?'정상 윈도우가 이어져 회복 상태를 확인합니다.':'FI와 보행 게이트를 함께 관찰합니다.')}else if(isDiabetes){setText('gateTitle','하중·환경 게이트');setText('gateState',Number(s.pressure_total||0)>=180?'OPEN · 착지 프레임 관찰':'CLOSED · 무부하 대기');setText('featureTitle','발 건강 특징');setText('featureState','Peak pressure · thermal context · humidity');setText('scoreTitle','관찰 점수');setText('scoreState',score.toFixed(2)+' · 진단 점수 아님');setText('stateTitle','위험 관찰 상태');setText('stateState','Stable → Observe → Attention · 2창 연속 확인');setText('featureLabel1','Peak pressure');setText('featureHelp1','FSR 최대 상대값');setText('featureLabel2','온도 변화');setText('featureHelp2','4점 온도 비대칭');setText('featureLabel3','습도');setText('featureHelp3','피부·환경 컨텍스트');setText('fiValue',Math.round(a.peak_pressure||0)+'/100');setText('entropyValue',Number(a.max_temperature_delta_c ?? a.temperature_delta_c ?? 0).toFixed(1)+'°C');setText('pitchValue',Math.round(a.humidity_pct||0)+'%');setText('cueState',state==='Attention'?'발 확인 알림':'관찰 기록');setText('cueDetail',a.temperature_asymmetry_available?(a.two_window_confirmation_ready?'2개 관찰창 연속 · 일일 확인 필요':'4점 공간 비교 · 현재 '+(a.temperature_asymmetry_streak||0)+'/2창'):'4점 센서 대기');setText('stateCardCaption','발 건강 컨텍스트 · 혈당/진단 아님');setText('algorithmMessage',state==='Attention'?'압력 hotspot·좌우 하중·온도 비대칭이 반복됩니다. 발 상태를 확인하고 필요하면 전문가와 상의하세요.':state==='Observe'?'압력·온습도 변화가 있어 관찰 기록을 남깁니다.':'현재 프레임은 안정 범위의 발 건강 컨텍스트입니다.')}else{setText('gateTitle','stance / ZUPT 게이트');setText('gateState',a.stance?'STANCE · 속도 0 보정':'SWING · 궤적 적분');setText('featureTitle','자세·궤적 특징');setText('featureState','Roll · Pitch · step length');setText('scoreTitle','정렬 변화');setText('scoreState',score.toFixed(2)+' · ZUPT '+(a.zero_velocity_update?'ON':'OFF'));setText('stateTitle','보행 위상');setText('stateState','Stance ↔ Swing · drift check');setText('featureLabel1','Roll');setText('featureHelp1','발 좌우 기울기');setText('featureLabel2','Pitch');setText('featureHelp2','발 앞뒤 기울기');setText('featureLabel3','Step count');setText('featureHelp3','stance 전환 누적');setText('fiValue',Number(a.roll_deg||0).toFixed(1)+'°');setText('entropyValue',Number(a.pitch_deg||0).toFixed(1)+'°');setText('pitchValue',String(a.step_count||0));setText('cueState',a.drift_warning?'드리프트 확인':'궤적 기록');setText('cueDetail',a.zero_velocity_update?'접지 구간 속도 0 보정':'공중 구간 위치 적분');setText('stateCardCaption','자세·궤적 · ZUPT 적용');setText('algorithmMessage',a.drift_warning?'yaw 누적 오차가 커지고 있어 기준 방향 재설정이 필요합니다.':a.alignment||'BMI270 기반 자세와 궤적을 기록합니다.')}const vibration=!!(isParkinson&&a.cue_vibration);const laser=!!(isParkinson&&a.cue_laser);$('vibrationCue').classList.toggle('on',vibration);$('laserCue').classList.toggle('on',laser);$('vibrationCue').textContent=vibration?'진동 ON':'진동 OFF';$('laserCue').textContent=laser?'레이저 ON':'레이저 OFF';$('gateNode').className='algorithm-node '+(a.gate_open||a.stance?'active':'');$('featureNode').className='algorithm-node active';$('scoreNode').className='algorithm-node '+(score>=.62?'warn':'active');$('stateNode').className='algorithm-node '+(state==='FoG'||state==='Attention'?'danger':state==='Warning'||state==='Observe'?'warn':'active');$('cueNode').className='algorithm-node '+(laser?'danger':vibration||state==='Attention'?'warn':'active');renderPurposePanels(algorithms)}
    function startProfile(){profile={gender:selectedValues('gender')[0],ageBand:selectedValues('ageBand')[0],purposes:selectedValues('purposes')};localStorage.setItem(profileKey,JSON.stringify(profile));fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(profile)}).catch(()=>{});activateDashboard()}
    async function loadSummary(){try{const res=await fetch('/api/summary',{cache:'no-store'});if(!res.ok)throw new Error('summary');const summary=await res.json();setText('storageStatus',summary.storage||'LittleFS 준비됨');setText('storageFrames','frames '+(summary.frames||0));setText('storageEvents','FoG events '+(summary.fog_events||0));setText('storageMessage','마지막 갱신 '+(summary.updated_at||('device ms '+(summary.updated_at_ms||0))))}catch(e){setText('storageStatus','로컬 서버 요약 대기');setText('storageMessage','ESP32 연결 후 LittleFS 요약 파일을 표시합니다.')}}
    $('downloadLog').addEventListener('click',()=>{window.location.href='/api/log.csv'});$('refreshSummary').addEventListener('click',loadSummary);$('clearLog').addEventListener('click',async()=>{try{await fetch('/api/log/clear',{method:'POST'});setText('storageMessage','로그 초기화 요청을 보냈습니다.');loadSummary()}catch(e){setText('storageMessage','로그 초기화는 ESP32 연결 후 사용할 수 있습니다.')}});document.querySelectorAll('.choice').forEach((button)=>button.addEventListener('click',()=>{const group=button.closest('[data-group]').dataset.group;if(group==='purposes'){button.classList.toggle('selected')}else{document.querySelectorAll('[data-group="'+group+'"] .choice').forEach((other)=>other.classList.remove('selected'));button.classList.add('selected')}syncStartButton()}));$('consentCheck').addEventListener('change',syncStartButton);$('startButton').addEventListener('click',startProfile);$('profileEdit').addEventListener('click',()=>{localStorage.removeItem(profileKey);showOnboarding()});
    const saved=localStorage.getItem(profileKey);if(saved){try{profile=JSON.parse(saved);activateDashboard()}catch(e){showOnboarding()}}else{showOnboarding()}
    async function loadState(){try{const res=await fetch('/api/state',{cache:'no-store'});if(!res.ok)throw new Error('state');const s=await res.json();setText('connectionText',(s.mock?'로컬 테스트 스트림':'실센서 스트림')+' · 연결됨');$('connectionDot').className='dot';$('risk').innerHTML=Math.round(s.risk)+'<span>/ 100</span>';const left=s.pressure_left.reduce((a,b)=>a+b,0),right=s.pressure_right.reduce((a,b)=>a+b,0),balance=Math.round(left/(left+right)*100);$('balance').innerHTML=balance+'<span> : '+(100-balance)+'</span>';$('temperature').innerHTML=s.temperature.toFixed(1)+'<span>°C</span>';setText('humidity','습도 '+s.humidity.toFixed(1)+'% · SHTC3 ×4');$('battery').innerHTML=Math.round(s.battery)+'<span>%</span>';setText('frame','#'+String(s.frame).padStart(4,'0'));setText('riskText',s.risk<36?'안정 패턴에 가까움':'변화 확인 필요');$('riskMeter').style.width=Math.max(16,s.risk)+'%';renderFoot('leftFoot',s.pressure_left);renderFoot('rightFoot',s.pressure_right);setText('accelX',s.accel.x.toFixed(2)+' g');setText('accelY',s.accel.y.toFixed(2)+' g');setText('accelZ',s.accel.z.toFixed(2)+' g');setText('gyroZ',s.gyro.z.toFixed(1)+' °/s');setText('cop',Math.round(s.cop_x)+' / '+Math.round(s.cop_y));renderCop(s.cop_x,s.cop_y);renderMotion(s);renderThermal(s);renderAlgorithm(deriveAlgorithms(s),s);$('mode').textContent=s.mock?'MOCK SENSOR MODE':'LIVE SENSOR MODE'}catch(e){setText('connectionText','서버 연결을 확인하세요');$('connectionDot').className='dot off'}}
    ensureDashboardEnhancements();
    loadState();loadSummary();setInterval(loadState,800);setInterval(loadSummary,5000);
  </script>
</body>
</html>
)rawliteral";

int readPressureChannel(int signalPin, int channel) {
  digitalWrite(MUX_S0_PIN, channel & 0x01);
  digitalWrite(MUX_S1_PIN, (channel >> 1) & 0x01);
  digitalWrite(MUX_S2_PIN, (channel >> 2) & 0x01);
  digitalWrite(MUX_S3_PIN, (channel >> 3) & 0x01);
  delayMicroseconds(4);
  const int raw = analogRead(signalPin);
  int value = map(raw, PRESSURE_ADC_MIN, PRESSURE_ADC_MAX, 0, 100);
  if (PRESSURE_INVERTED) value = 100 - value;
  return constrain(value, 0, 100);
}

void initPressureMux() {
  pinMode(MUX_S0_PIN, OUTPUT);
  pinMode(MUX_S1_PIN, OUTPUT);
  pinMode(MUX_S2_PIN, OUTPUT);
  pinMode(MUX_S3_PIN, OUTPUT);
  pinMode(MUX_LEFT_SIG_PIN, INPUT);
#if USE_SECOND_PRESSURE_MUX
  pinMode(MUX_RIGHT_SIG_PIN, INPUT);
#endif
  digitalWrite(MUX_S0_PIN, LOW);
  digitalWrite(MUX_S1_PIN, LOW);
  digitalWrite(MUX_S2_PIN, LOW);
  digitalWrite(MUX_S3_PIN, LOW);
  analogReadResolution(12);
}

void samplePressureSensors() {
  for (int i = 0; i < 8; i++) {
    currentFrame.pressureLeft[i] = readPressureChannel(MUX_LEFT_SIG_PIN, PRESSURE_MUX_CHANNELS[i]);
#if USE_SECOND_PRESSURE_MUX
    currentFrame.pressureRight[i] = readPressureChannel(MUX_RIGHT_SIG_PIN, PRESSURE_MUX_CHANNELS[i]);
#else
    currentFrame.pressureRight[i] = 0;
#endif
  }
}

#if USE_REAL_I2C_SENSORS
bool selectI2cMuxChannel(uint8_t channel) {
#if USE_I2C_MUX
  if (channel > 7) return false;
  Wire.beginTransmission(I2C_MUX_ADDRESS);
  Wire.write(static_cast<uint8_t>(1u << channel));
  return Wire.endTransmission() == 0;
#else
  (void)channel;
  return true;
#endif
}

void initI2CSensors() {
  const bool imuChannelReady = selectI2cMuxChannel(IMU_I2C_CHANNEL);
#if USE_MPU6050
  imuReady = imuChannelReady && mpu6050.begin(0x68, &Wire);
  if (imuReady) {
    mpu6050.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu6050.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu6050.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }
  Serial.print("MPU6050: ");
  Serial.println(imuReady ? "ready" : "not found");
#else
  imuReady = false;
#endif

#if USE_REAL_SHTC3
  uint8_t readyCount = 0;
  shtc3ReadyCount = 0;
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) {
    const bool channelReady = selectI2cMuxChannel(SHTC3_I2C_CHANNELS[i]);
    shtc3Ready[i] = channelReady && shtc3Sensors[i].begin(&Wire);
    if (shtc3Ready[i]) {
      readyCount++;
      shtc3ReadyCount++;
    }
    Serial.print("SHTC3[");
    Serial.print(i);
    Serial.print("] CH");
    Serial.print(SHTC3_I2C_CHANNELS[i]);
    Serial.print(": ");
    Serial.println(shtc3Ready[i] ? "ready" : "not found");
  }
  Serial.print("SHTC3 ready count: ");
  Serial.println(readyCount);
#else
  shtc3ReadyCount = 0;
  Serial.println("SHTC3: disabled for current wiring");
#endif
}

void sampleI2CSensors() {
  if (imuReady && selectI2cMuxChannel(IMU_I2C_CHANNEL)) {
    sensors_event_t accel;
    sensors_event_t gyro;
    sensors_event_t temperature;
#if USE_MPU6050
    mpu6050.getEvent(&accel, &gyro, &temperature);
#endif
    currentFrame.accelX = accel.acceleration.x / 9.80665f;
    currentFrame.accelY = accel.acceleration.y / 9.80665f;
    currentFrame.accelZ = accel.acceleration.z / 9.80665f;
    currentFrame.gyroX = gyro.gyro.x * 57.29578f;
    currentFrame.gyroY = gyro.gyro.y * 57.29578f;
    currentFrame.gyroZ = gyro.gyro.z * 57.29578f;
  }

  float temperatureSum = 0.0f;
  float humiditySum = 0.0f;
  uint8_t readyCount = 0;
#if USE_REAL_SHTC3
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) {
    if (!shtc3Ready[i] || !selectI2cMuxChannel(SHTC3_I2C_CHANNELS[i])) continue;
    sensors_event_t humidity;
    sensors_event_t temperature;
    shtc3Sensors[i].getEvent(&humidity, &temperature);
    currentFrame.temperatureBySensor[i] = temperature.temperature;
    currentFrame.humidityBySensor[i] = humidity.relative_humidity;
    temperatureSum += currentFrame.temperatureBySensor[i];
    humiditySum += currentFrame.humidityBySensor[i];
    readyCount++;
  }
  if (readyCount > 0) {
    currentFrame.temperature = temperatureSum / readyCount;
    currentFrame.humidity = humiditySum / readyCount;
  }
#else
  (void)temperatureSum;
  (void)humiditySum;
  (void)readyCount;
#endif
}
#endif

void initCueOutputs() {
#if ENABLE_LASER_OUTPUT
  pinMode(LASER_PIN, OUTPUT);
  digitalWrite(LASER_PIN, LOW);
#endif
#if USE_DRV2605
  drv2605Ready = drv2605.begin();
  if (drv2605Ready) {
    drv2605.selectLibrary(1);
    drv2605.setMode(DRV2605_MODE_INTTRIG);
    drv2605.setWaveform(0, 0);
    drv2605.setWaveform(1, 0);
  }
  Serial.print("DRV2605L: ");
  Serial.println(drv2605Ready ? "ready" : "not found");
#endif
}

void serviceCueOutputs() {
  static uint32_t lastCueAt = 0;
  static uint32_t laserOffAt = 0;
  const uint32_t now = millis();
  const bool cueActive = algorithmFrame.cueVibration || algorithmFrame.cueLaser;

  if (cueActive && (lastCueAt == 0 || now - lastCueAt >= CUE_REPEAT_INTERVAL_MS)) {
    lastCueAt = now;
#if USE_DRV2605
    if (drv2605Ready && algorithmFrame.cueVibration) {
      drv2605.setWaveform(0, DRV2605_WAVEFORM);
      drv2605.setWaveform(1, 0);
      drv2605.go();
    }
#endif
#if ENABLE_LASER_OUTPUT
    if (algorithmFrame.cueLaser) {
      digitalWrite(LASER_PIN, HIGH);
      laserOffAt = now + LASER_CUE_DURATION_MS;
    }
#endif
  }

#if ENABLE_LASER_OUTPUT
  if (laserOffAt != 0 && static_cast<int32_t>(now - laserOffAt) >= 0) {
    digitalWrite(LASER_PIN, LOW);
    laserOffAt = 0;
  }
#endif

  if (!cueActive) {
    lastCueAt = 0;
#if ENABLE_LASER_OUTPUT
    digitalWrite(LASER_PIN, LOW);
    laserOffAt = 0;
#endif
  }
}

void sampleMockSensors() {
  const float t = millis() / 900.0f;
  const float seconds = millis() / 1000.0f;
  const float cycle = fmod(seconds, 18.0f);
  const bool fogPhase = cycle > 5.0f && cycle < 10.0f;
  const bool hotspotPhase = cycle > 10.0f && cycle < 13.0f;
  for (int i = 0; i < 8; i++) {
    currentFrame.pressureLeft[i] = constrain(34 + i * 5 + sin(t + i) * 10, 8, 96);
    currentFrame.pressureRight[i] = constrain(40 + i * 5 + cos(t * 0.9f + i) * 12, 8, 96);
  }
  if (hotspotPhase) {
    currentFrame.pressureLeft[2] = 88;
    currentFrame.pressureRight[3] = 82;
  }
  const float baseTemperature = 31.8f + sin(t / 3.0f) * 0.2f;
  const float baseHumidity = 48.2f + cos(t / 4.0f) * 1.4f;
  currentFrame.temperatureBySensor[0] = baseTemperature + 0.05f; // 왼발 뒤꿈치
  currentFrame.temperatureBySensor[1] = baseTemperature + (hotspotPhase ? 2.35f : 0.15f); // 왼발 앞발
  currentFrame.temperatureBySensor[2] = baseTemperature - 0.05f; // 오른발 뒤꿈치
  currentFrame.temperatureBySensor[3] = baseTemperature + 0.10f; // 오른발 앞발
  currentFrame.humidityBySensor[0] = baseHumidity + 0.5f;
  currentFrame.humidityBySensor[1] = baseHumidity + (hotspotPhase ? 8.0f : 1.2f);
  currentFrame.humidityBySensor[2] = baseHumidity - 0.3f;
  currentFrame.humidityBySensor[3] = baseHumidity + 0.8f;
  currentFrame.temperature = 0.0f;
  currentFrame.humidity = 0.0f;
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) {
    currentFrame.temperature += currentFrame.temperatureBySensor[i];
    currentFrame.humidity += currentFrame.humidityBySensor[i];
  }
  currentFrame.temperature /= SHTC3_SENSOR_COUNT;
  currentFrame.humidity /= SHTC3_SENSOR_COUNT;
  currentFrame.accelX = 0.12f + sin(t) * 0.08f + (fogPhase ? 0.12f * sin(seconds * 2.0f * PI * 5.2f) : 0.0f);
  currentFrame.accelY = -0.03f + cos(t * 0.8f) * 0.06f;
  currentFrame.accelZ = 0.98f + sin(t * 0.55f) * 0.04f;
  currentFrame.gyroX = 1.4f + sin(t) * 1.2f;
  currentFrame.gyroY = 0.2f + cos(t * 0.7f) * 0.8f;
  currentFrame.gyroZ = 12.1f + sin(t * 0.6f) * 3.2f + (fogPhase ? 16.0f * sin(seconds * 2.0f * PI * 5.2f) : 0.0f);
  currentFrame.copX = constrain(54.0f + sin(t * 0.7f) * 17.0f, 15.0f, 85.0f);
  currentFrame.copY = constrain(62.0f + cos(t * 0.8f) * 18.0f, 15.0f, 85.0f);
  currentFrame.battery = 86;
  currentFrame.frame++;
}

void calculateCopAndFusion() {
  const float x[8] = {20, 38, 56, 74, 31, 48, 64, 50};
  const float y[8] = {14, 14, 15, 17, 39, 44, 64, 84};
  float total = 0.0f;
  float weightedX = 0.0f;
  float weightedY = 0.0f;
  for (int i = 0; i < 8; i++) {
    const float left = currentFrame.pressureLeft[i];
    const float right = currentFrame.pressureRight[i];
    total += left + right;
    weightedX += left * (18.0f + x[i] * 0.34f) + right * (50.0f + x[i] * 0.34f);
    weightedY += (left + right) * y[i];
  }
  if (total > 0.0f) {
    currentFrame.copX = constrain(weightedX / total, 5.0f, 95.0f);
    currentFrame.copY = constrain(weightedY / total, 5.0f, 95.0f);
  } else {
    currentFrame.copX = 50.0f;
    currentFrame.copY = 50.0f;
  }
}

float pressureTotalValue() {
  float total = 0.0f;
  for (int i = 0; i < 8; i++) total += currentFrame.pressureLeft[i] + currentFrame.pressureRight[i];
  return total;
}

void updatePostureAlgorithm() {
  static float velocityX = 0.0f;
  static float velocityY = 0.0f;
  const float dt = SAMPLE_INTERVAL_MS / 1000.0f;
  const float accelMagnitude = sqrt(currentFrame.accelX * currentFrame.accelX + currentFrame.accelY * currentFrame.accelY + currentFrame.accelZ * currentFrame.accelZ);
  const float gyroMagnitude = sqrt(currentFrame.gyroX * currentFrame.gyroX + currentFrame.gyroY * currentFrame.gyroY + currentFrame.gyroZ * currentFrame.gyroZ);
  const float rollFromAccel = atan2(currentFrame.accelY, currentFrame.accelZ) * 57.29578f;
  const float pitchFromAccel = atan2(-currentFrame.accelX, sqrt(currentFrame.accelY * currentFrame.accelY + currentFrame.accelZ * currentFrame.accelZ)) * 57.29578f;

  postureFrame.roll = 0.98f * (postureFrame.roll + currentFrame.gyroX * dt) + 0.02f * rollFromAccel;
  postureFrame.pitch = 0.98f * (postureFrame.pitch + currentFrame.gyroY * dt) + 0.02f * pitchFromAccel;
  postureFrame.yaw += currentFrame.gyroZ * dt;
  if (postureFrame.yaw > 180.0f) postureFrame.yaw -= 360.0f;
  if (postureFrame.yaw < -180.0f) postureFrame.yaw += 360.0f;

  const bool stance = pressureTotalValue() >= PRESSURE_GATE_SUM && gyroMagnitude < 35.0f && fabs(accelMagnitude - 1.0f) < 0.25f;
  if (stance && !previousStance) {
    postureFrame.stepCount++;
    const uint32_t now = millis();
    if (lastStepAt > 0) {
      const uint32_t intervalMs = now - lastStepAt;
      if (intervalMs >= 300 && intervalMs <= 3000) {
        const float instantaneousCadence = 60000.0f / intervalMs;
        gaitCadenceSpm = gaitCadenceSpm <= 0.0f
          ? instantaneousCadence
          : 0.75f * gaitCadenceSpm + 0.25f * instantaneousCadence;
      }
    }
    lastStepAt = now;
  }
  previousStance = stance;
  postureFrame.stance = stance;
  postureFrame.zeroVelocityUpdate = stance;
  if (stance) {
    velocityX = 0.0f;
    velocityY = 0.0f;
  } else {
    velocityX += currentFrame.accelX * 9.80665f * dt;
    velocityY += currentFrame.accelY * 9.80665f * dt;
    postureFrame.trajectoryXcm += velocityX * dt * 100.0f;
    postureFrame.trajectoryYcm += velocityY * dt * 100.0f;
  }
  postureFrame.stepLengthCm = constrain(42.0f + fabs(velocityX) * 8.0f, 0.0f, 120.0f);
  postureFrame.score = constrain((fabs(postureFrame.roll) / 30.0f + fabs(postureFrame.pitch) / 35.0f) * 0.5f, 0.0f, 1.0f);
  strncpy(postureFrame.state, stance ? "Stance" : "Swing", sizeof(postureFrame.state));
  strncpy(postureFrame.alignment, postureFrame.score >= 0.42f ? "정렬 확인 필요" : "기준선 범위", sizeof(postureFrame.alignment));
  postureFrame.driftWarning = fabs(postureFrame.yaw) > 35.0f;
  postureFrame.state[sizeof(postureFrame.state) - 1] = '\0';
  postureFrame.alignment[sizeof(postureFrame.alignment) - 1] = '\0';
}

float motionFrequencyPower(float frequency) {
  if (motionSampleCount < MOTION_WINDOW_SIZE) return 0.0f;
  float mean = 0.0f;
  for (int n = 0; n < MOTION_WINDOW_SIZE; n++) mean += motionWindow[n];
  mean /= MOTION_WINDOW_SIZE;
  float realPart = 0.0f;
  float imaginaryPart = 0.0f;
  for (int n = 0; n < MOTION_WINDOW_SIZE; n++) {
    const int index = (motionWriteIndex + n) % MOTION_WINDOW_SIZE;
    const float angle = 2.0f * PI * frequency * n / 50.0f;
    const float sample = motionWindow[index] - mean;
    realPart += sample * cos(angle);
    imaginaryPart -= sample * sin(angle);
  }
  return (realPart * realPart + imaginaryPart * imaginaryPart) / (MOTION_WINDOW_SIZE * MOTION_WINDOW_SIZE);
}

void updateMotionWindow() {
  motionWindow[motionWriteIndex] = currentFrame.accelX;
  motionPitchWindow[motionWriteIndex] = postureFrame.pitch;
  motionWriteIndex = (motionWriteIndex + 1) % MOTION_WINDOW_SIZE;
  motionSampleCount = min(motionSampleCount + 1, MOTION_WINDOW_SIZE);
  if (motionSampleCount < MOTION_WINDOW_SIZE || millis() - lastMotionAnalysisAt < MOTION_ANALYSIS_INTERVAL_MS) return;
  lastMotionAnalysisAt = millis();
  motionLowPower = 0.0f;
  motionHighPower = 0.0f;
  float totalPower = 0.0f;
  int powerBins = 0;
  for (int bin = 3; bin <= 48; bin++) {
    const float frequency = bin * 50.0f / MOTION_WINDOW_SIZE;
    const float power = motionFrequencyPower(frequency);
    totalPower += power;
    powerBins++;
    if (frequency >= 0.5f && frequency < 3.0f) motionLowPower += power;
    if (frequency >= 3.0f && frequency <= 8.0f) motionHighPower += power;
  }
  motionSpectralEntropy = 0.0f;
  if (totalPower > 0.000001f) {
    for (int bin = 3; bin <= 48; bin++) {
      const float frequency = bin * 50.0f / MOTION_WINDOW_SIZE;
      const float probability = motionFrequencyPower(frequency) / totalPower;
      if (probability > 0.000001f) motionSpectralEntropy -= probability * log(probability);
    }
    motionSpectralEntropy = constrain(motionSpectralEntropy / log((float)powerBins), 0.0f, 1.0f);
  }
  motionAnalysisReady = true;
}

void updateParkinsonAlgorithm() {
  if (!motionAnalysisReady) return;
  motionAnalysisReady = false;
  const float low = max(motionLowPower, 0.000001f);
  const float fiRatio = motionHighPower / low;
  const float fi = constrain(fiRatio / (fiRatio + FOG_FI_THRESHOLD), 0.0f, 1.0f);
  const float shuffling = constrain(motionHighPower / max(motionLowPower + motionHighPower, 0.000001f), 0.0f, 1.0f);
  float pitchMin = 180.0f;
  float pitchMax = -180.0f;
  for (int n = 0; n < MOTION_WINDOW_SIZE; n++) {
    const int index = (motionWriteIndex + n) % MOTION_WINDOW_SIZE;
    pitchMin = min(pitchMin, motionPitchWindow[index]);
    pitchMax = max(pitchMax, motionPitchWindow[index]);
  }
  const float pitchRange = constrain(pitchMax - pitchMin, 0.0f, 90.0f);
  const float pitchRom = constrain(pitchRange / 30.0f, 0.0f, 1.0f);
  const float cadenceSpm = gaitCadenceSpm;
  const float cadencePenalty = constrain(fabs(cadenceSpm - 55.0f) / 55.0f, 0.0f, 1.0f);
  const float score = constrain(0.55f * fi + 0.25f * (1.0f - pitchRom) + 0.20f * cadencePenalty, 0.0f, 1.0f);
  const bool gateOpen = pressureTotalValue() >= PRESSURE_GATE_SUM;
  const bool warning = gateOpen && fiRatio >= FOG_FI_THRESHOLD && shuffling >= 0.35f;
  const bool clear = gateOpen && fiRatio < 0.8f && pitchRom >= 0.35f;
  char previous[12];
  strncpy(previous, algorithmFrame.state, sizeof(previous));
  previous[sizeof(previous) - 1] = '\0';
  algorithmFrame.gateOpen = gateOpen;
  algorithmFrame.fi = fi;
  algorithmFrame.fiRatio = fiRatio;
  algorithmFrame.spectralEntropy = motionSpectralEntropy;
  algorithmFrame.pitchRom = pitchRom;
  algorithmFrame.cadenceSpm = cadenceSpm;
  algorithmFrame.score = score;
  if (!gateOpen) {
    algorithmFrame.warningStreak = 0;
    algorithmFrame.normalStreak = 0;
    strncpy(algorithmFrame.state, "Normal", sizeof(algorithmFrame.state));
  } else if (warning) {
    algorithmFrame.warningStreak = min<uint8_t>(algorithmFrame.warningStreak + 1, 255);
    algorithmFrame.normalStreak = 0;
    strncpy(algorithmFrame.state, algorithmFrame.warningStreak >= 3 ? "FoG" : "Warning", sizeof(algorithmFrame.state));
  } else if (clear) {
    algorithmFrame.normalStreak = min<uint8_t>(algorithmFrame.normalStreak + 1, 255);
    algorithmFrame.warningStreak = 0;
    if ((strcmp(previous, "Warning") == 0 || strcmp(previous, "FoG") == 0) && algorithmFrame.normalStreak >= 2) {
      strncpy(algorithmFrame.state, "Recovery", sizeof(algorithmFrame.state));
    } else if (strcmp(previous, "Recovery") == 0 && algorithmFrame.normalStreak >= 4) {
      strncpy(algorithmFrame.state, "Normal", sizeof(algorithmFrame.state));
    }
  }
  algorithmFrame.state[sizeof(algorithmFrame.state) - 1] = '\0';
  algorithmFrame.cueVibration = strcmp(algorithmFrame.state, "Warning") == 0 || strcmp(algorithmFrame.state, "FoG") == 0;
  algorithmFrame.cueLaser = strcmp(algorithmFrame.state, "FoG") == 0;
}

void updateDiabetesAlgorithm() {
  if (millis() - lastDiabetesUpdateAt < LOG_INTERVAL_MS) return;
  lastDiabetesUpdateAt = millis();

  uint8_t peak = 0;
  float leftTotal = 0.0f;
  float rightTotal = 0.0f;
  for (int i = 0; i < 8; i++) {
    peak = max(peak, max(currentFrame.pressureLeft[i], currentFrame.pressureRight[i]));
    leftTotal += currentFrame.pressureLeft[i];
    rightTotal += currentFrame.pressureRight[i];
  }

  const float total = leftTotal + rightTotal;
  const float balanceGap = fabs(leftTotal - rightTotal) / max(total, 1.0f);
  const float hotspot = constrain((peak - 55.0f) / 45.0f, 0.0f, 1.0f);
  const float heelDelta = fabs(currentFrame.temperatureBySensor[0] - currentFrame.temperatureBySensor[2]);
  const float foreDelta = fabs(currentFrame.temperatureBySensor[1] - currentFrame.temperatureBySensor[3]);
  const float maxDelta = max(heelDelta, foreDelta);
  const float meanDelta = (heelDelta + foreDelta) * 0.5f;
  const float humidityContext = constrain(fabs(currentFrame.humidity - 50.0f) / 35.0f, 0.0f, 1.0f);
  const bool thermalAvailable = shtc3ReadyCount >= SHTC3_SENSOR_COUNT;
  const bool thermalThreshold = thermalAvailable && maxDelta >= TEMP_ASYMMETRY_THRESHOLD_C;
  const bool pressureGate = total >= PRESSURE_GATE_SUM;
  const bool attentionSignal = (pressureGate && (peak >= 75 || balanceGap >= 0.28f)) || thermalThreshold;

  diabetesFrame.peakPressure = peak;
  diabetesFrame.pressureHotspot = hotspot;
  diabetesFrame.pressureBalanceGap = balanceGap;
  diabetesFrame.temperatureDelta = maxDelta;
  diabetesFrame.maxTemperatureDelta = maxDelta;
  diabetesFrame.meanTemperatureDelta = meanDelta;
  diabetesFrame.temperatureHotRegion = foreDelta >= heelDelta
    ? (currentFrame.temperatureBySensor[1] >= currentFrame.temperatureBySensor[3] ? 1 : 3)
    : (currentFrame.temperatureBySensor[0] >= currentFrame.temperatureBySensor[2] ? 0 : 2);
  diabetesFrame.temperatureAsymmetryAvailable = thermalAvailable;
  diabetesFrame.temperatureThresholdExceeded = thermalThreshold;

  if (thermalThreshold) {
    diabetesFrame.temperatureAsymmetryStreak = min<uint8_t>(diabetesFrame.temperatureAsymmetryStreak + 1, 255);
  } else {
    diabetesFrame.temperatureAsymmetryStreak = 0;
  }
  if (attentionSignal) {
    diabetesFrame.attentionStreak = min<uint8_t>(diabetesFrame.attentionStreak + 1, 255);
  } else {
    diabetesFrame.attentionStreak = 0;
  }

  const float thermalScore = constrain(maxDelta / TEMP_ASYMMETRY_THRESHOLD_C, 0.0f, 1.0f);
  diabetesFrame.score = constrain(
    0.45f * hotspot + 0.40f * thermalScore + 0.10f * balanceGap + 0.05f * humidityContext,
    0.0f, 1.0f
  );
  const bool confirmed = diabetesFrame.temperatureAsymmetryStreak >= TEMP_ASYMMETRY_CONFIRM_WINDOWS;
  if (attentionSignal) {
    strncpy(diabetesFrame.state, diabetesFrame.attentionStreak >= 2 ? "Attention" : "Observe", sizeof(diabetesFrame.state));
  } else {
    strncpy(diabetesFrame.state, diabetesFrame.score >= 0.35f ? "Observe" : "Stable", sizeof(diabetesFrame.state));
  }
  if (confirmed && diabetesFrame.state[0] == 'S') {
    strncpy(diabetesFrame.state, "Observe", sizeof(diabetesFrame.state));
  }
  diabetesFrame.state[sizeof(diabetesFrame.state) - 1] = '\0';
}

void writeLogHeader() {
  if (!storageReady) return;
  File file = LittleFS.open(DATA_LOG_PATH, "w");
  if (!file) return;
  file.println("frame,millis,temperature_c,humidity_pct,temperature_1_c,temperature_2_c,temperature_3_c,temperature_4_c,humidity_1_pct,humidity_2_pct,humidity_3_pct,humidity_4_pct,pressure_total,cop_x,cop_y,accel_x_g,accel_y_g,accel_z_g,gyro_x_dps,gyro_y_dps,gyro_z_dps,risk,parkinson_state,parkinson_fi_ratio,parkinson_warning_streak,parkinson_normal_streak,cue_vibration,cue_laser,diabetes_state,diabetes_score,peak_pressure,pressure_hotspot,pressure_balance_gap,temperature_delta_c,temperature_max_delta_c,temperature_mean_delta_c,temperature_asymmetry_streak,temperature_threshold_exceeded,posture_state,roll_deg,pitch_deg,yaw_deg,step_count,step_length_cm,trajectory_x_cm,trajectory_y_cm,zero_velocity_update,drift_warning,pressure_left_1,pressure_left_2,pressure_left_3,pressure_left_4,pressure_left_5,pressure_left_6,pressure_left_7,pressure_left_8,pressure_right_1,pressure_right_2,pressure_right_3,pressure_right_4,pressure_right_5,pressure_right_6,pressure_right_7,pressure_right_8");;
  file.close();
}

uint32_t summaryNumber(const String &body, const char *key) {
  String marker = String("\"") + key + "\":";
  int start = body.indexOf(marker);
  if (start < 0) return 0;
  start += marker.length();
  return strtoul(body.substring(start).c_str(), nullptr, 10);
}

float summaryFloat(const String &body, const char *key) {
  String marker = String("\"") + key + "\":";
  int start = body.indexOf(marker);
  if (start < 0) return 0.0f;
  start += marker.length();
  return body.substring(start).toFloat();
}

void writeSummaryFile() {
  if (!storageReady) return;
  File file = LittleFS.open(SUMMARY_PATH, "w");
  if (!file) return;
  const float avgTemperature = loggedFrames == 0 ? 0.0f : loggedTemperatureSum / loggedFrames;
  const float avgHumidity = loggedFrames == 0 ? 0.0f : loggedHumiditySum / loggedFrames;
  String json = "{\"storage\":\"LittleFS\",\"file\":\"/stepon_log.csv\",\"summary_file\":\"/stepon_summary.json\"";
  json += ",\"frames\":" + String(loggedFrames);
  json += ",\"fog_events\":" + String(fogEvents);
  json += ",\"avg_temperature_c\":" + String(avgTemperature, 2);
  json += ",\"avg_humidity_pct\":" + String(avgHumidity, 2);
  json += ",\"max_risk\":" + String(loggedMaxRisk);
  json += ",\"last_state\":\"" + String(lastAlgorithmState) + "\"";
  json += ",\"updated_at_ms\":" + String(millis()) + "}";
  file.print(json);
  file.close();
}

void initializeStorage() {
  storageReady = LittleFS.begin(true);
  if (!storageReady) {
    Serial.println("LittleFS mount failed");
    return;
  }
  if (LittleFS.exists(SUMMARY_PATH)) {
    File summary = LittleFS.open(SUMMARY_PATH, "r");
    if (summary) {
      String body = summary.readString();
      loggedFrames = summaryNumber(body, "frames");
      fogEvents = summaryNumber(body, "fog_events");
      loggedMaxRisk = (uint8_t)constrain((int)summaryNumber(body, "max_risk"), 0, 100);
      loggedTemperatureSum = summaryFloat(body, "avg_temperature_c") * loggedFrames;
      loggedHumiditySum = summaryFloat(body, "avg_humidity_pct") * loggedFrames;
      if (body.indexOf("\"last_state\":\"FoG\"") >= 0) strncpy(lastAlgorithmState, "FoG", sizeof(lastAlgorithmState));
      summary.close();
    }
  }
  if (!LittleFS.exists(DATA_LOG_PATH)) writeLogHeader();
  writeSummaryFile();
  Serial.println("LittleFS storage ready");
}

void appendLogSample() {
  if (!storageReady || millis() - lastLogAt < LOG_INTERVAL_MS) return;
  lastLogAt = millis();
  File file = LittleFS.open(DATA_LOG_PATH, "a");
  if (!file) return;
  if (file.size() > MAX_LOG_BYTES) {
    file.close();
    LittleFS.remove(DATA_LOG_PATH);
    loggedFrames = 0;
    fogEvents = 0;
    loggedTemperatureSum = 0.0f;
    loggedHumiditySum = 0.0f;
    loggedMaxRisk = 0;
    strncpy(lastAlgorithmState, "Normal", sizeof(lastAlgorithmState));
    writeLogHeader();
    file = LittleFS.open(DATA_LOG_PATH, "a");
  }
  if (!file) return;
  float pressureTotal = 0.0f;
  for (int i = 0; i < 8; i++) pressureTotal += currentFrame.pressureLeft[i] + currentFrame.pressureRight[i];
  String line;
  line.reserve(420);
  line += String(currentFrame.frame) + "," + String(millis()) + "," + String(currentFrame.temperature, 2) + "," + String(currentFrame.humidity, 2);
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) line += "," + String(currentFrame.temperatureBySensor[i], 2);
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) line += "," + String(currentFrame.humidityBySensor[i], 2);
  line += "," + String(pressureTotal, 1) + "," + String(currentFrame.copX, 2) + "," + String(currentFrame.copY, 2);
  line += "," + String(currentFrame.accelX, 3) + "," + String(currentFrame.accelY, 3) + "," + String(currentFrame.accelZ, 3) + "," + String(currentFrame.gyroX, 2) + "," + String(currentFrame.gyroY, 2) + "," + String(currentFrame.gyroZ, 2);
  line += "," + String(currentFrame.risk) + "," + String(algorithmFrame.state) + "," + String(algorithmFrame.fiRatio, 3) + "," + String(algorithmFrame.warningStreak) + "," + String(algorithmFrame.normalStreak) + "," + String(algorithmFrame.cueVibration ? 1 : 0) + "," + String(algorithmFrame.cueLaser ? 1 : 0);
  line += "," + String(diabetesFrame.state) + "," + String(diabetesFrame.score, 3) + "," + String(diabetesFrame.peakPressure) + "," + String(diabetesFrame.pressureHotspot, 3) + "," + String(diabetesFrame.pressureBalanceGap, 3) + "," + String(diabetesFrame.temperatureDelta, 2) + "," + String(diabetesFrame.maxTemperatureDelta, 2) + "," + String(diabetesFrame.meanTemperatureDelta, 2) + "," + String(diabetesFrame.temperatureAsymmetryStreak) + "," + String(diabetesFrame.temperatureThresholdExceeded ? 1 : 0);
  line += "," + String(postureFrame.state) + "," + String(postureFrame.roll, 2) + "," + String(postureFrame.pitch, 2) + "," + String(postureFrame.yaw, 2) + "," + String(postureFrame.stepCount) + "," + String(postureFrame.stepLengthCm, 2) + "," + String(postureFrame.trajectoryXcm, 2) + "," + String(postureFrame.trajectoryYcm, 2) + "," + String(postureFrame.zeroVelocityUpdate ? 1 : 0) + "," + String(postureFrame.driftWarning ? 1 : 0);
  for (int i = 0; i < 8; i++) line += "," + String(currentFrame.pressureLeft[i]);
  for (int i = 0; i < 8; i++) line += "," + String(currentFrame.pressureRight[i]);
  file.println(line);
  file.close();

  if (strcmp(lastAlgorithmState, "FoG") != 0 && strcmp(algorithmFrame.state, "FoG") == 0) fogEvents++;
  strncpy(lastAlgorithmState, algorithmFrame.state, sizeof(lastAlgorithmState));
  lastAlgorithmState[sizeof(lastAlgorithmState) - 1] = '\0';
  loggedFrames++;
  loggedTemperatureSum += currentFrame.temperature;
  loggedHumiditySum += currentFrame.humidity;
  loggedMaxRisk = max(loggedMaxRisk, currentFrame.risk);
}

void serviceStorage() {
  appendLogSample();
  if (storageReady && millis() - lastSummaryAt >= SUMMARY_INTERVAL_MS) {
    lastSummaryAt = millis();
    writeSummaryFile();
  }
}

String makeStateJson() {
  String json = "{\"frame\":" + String(currentFrame.frame);
  json += ",\"mock\":" + String(USE_MOCK_SENSORS ? "true" : "false");
  json += ",\"pressure_left\":[";
  for (int i = 0; i < 8; i++) json += String(currentFrame.pressureLeft[i]) + (i == 7 ? "]" : ",");
  json += ",\"pressure_right\":[";
  for (int i = 0; i < 8; i++) json += String(currentFrame.pressureRight[i]) + (i == 7 ? "]" : ",");
  json += ",\"temperature\":" + String(currentFrame.temperature, 2);
  json += ",\"humidity\":" + String(currentFrame.humidity, 2);
  json += ",\"temperature_sensors\":[";
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) json += String(currentFrame.temperatureBySensor[i], 2) + (i + 1 == SHTC3_SENSOR_COUNT ? "]" : ",");
  json += ",\"humidity_sensors\":[";
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) json += String(currentFrame.humidityBySensor[i], 2) + (i + 1 == SHTC3_SENSOR_COUNT ? "]" : ",");
  json += ",\"shtc3_ready_count\":" + String(shtc3ReadyCount);
  json += ",\"accel\":{\"x\":" + String(currentFrame.accelX, 3) + ",\"y\":" + String(currentFrame.accelY, 3) + ",\"z\":" + String(currentFrame.accelZ, 3) + "}";
  json += ",\"gyro\":{\"x\":" + String(currentFrame.gyroX, 2) + ",\"y\":" + String(currentFrame.gyroY, 2) + ",\"z\":" + String(currentFrame.gyroZ, 2) + "}";
  json += ",\"cop_x\":" + String(currentFrame.copX, 2) + ",\"cop_y\":" + String(currentFrame.copY, 2);
  json += ",\"battery\":" + String(currentFrame.battery) + ",\"risk\":" + String(currentFrame.risk);
  json += ",\"pressure_total\":" + String(pressureTotalValue(), 1);
  json += ",\"primary_algorithm\":\"parkinson\"";
  json += ",\"algorithms\":{\"parkinson\":{\"target\":\"parkinson_fog\",\"gate_open\":" + String(algorithmFrame.gateOpen ? "true" : "false");
  json += ",\"fi_ratio\":" + String(algorithmFrame.fiRatio, 3) + ",\"fi\":" + String(algorithmFrame.fi, 3) + ",\"spectral_entropy\":" + String(algorithmFrame.spectralEntropy, 3) + ",\"pitch_rom\":" + String(algorithmFrame.pitchRom, 3);
  json += ",\"cadence_spm\":" + String(algorithmFrame.cadenceSpm, 1) + ",\"score\":" + String(algorithmFrame.score, 3) + ",\"state\":\"" + String(algorithmFrame.state) + "\"";
  json += ",\"warning_streak\":" + String(algorithmFrame.warningStreak) + ",\"normal_streak\":" + String(algorithmFrame.normalStreak);
  json += ",\"cue_vibration\":" + String(algorithmFrame.cueVibration ? "true" : "false") + ",\"cue_laser\":" + String(algorithmFrame.cueLaser ? "true" : "false") + "},";
  json += "\"diabetes\":{\"target\":\"diabetic_foot_context\",\"state\":\"" + String(diabetesFrame.state) + "\",\"score\":" + String(diabetesFrame.score, 3);
  json += ",\"peak_pressure\":" + String(diabetesFrame.peakPressure) + ",\"pressure_hotspot\":" + String(diabetesFrame.pressureHotspot, 3) + ",\"pressure_balance_gap\":" + String(diabetesFrame.pressureBalanceGap, 3);
  json += ",\"temperature_c\":" + String(currentFrame.temperature, 2) + ",\"temperature_delta_c\":" + String(diabetesFrame.temperatureDelta, 2) + ",\"max_temperature_delta_c\":" + String(diabetesFrame.maxTemperatureDelta, 2) + ",\"mean_temperature_delta_c\":" + String(diabetesFrame.meanTemperatureDelta, 2) + ",\"humidity_pct\":" + String(currentFrame.humidity, 2);
  json += ",\"temperature_sensors\":[";
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) json += String(currentFrame.temperatureBySensor[i], 2) + (i + 1 == SHTC3_SENSOR_COUNT ? "]" : ",");
  json += ",\"humidity_sensors\":[";
  for (uint8_t i = 0; i < SHTC3_SENSOR_COUNT; i++) json += String(currentFrame.humidityBySensor[i], 2) + (i + 1 == SHTC3_SENSOR_COUNT ? "]" : ",");
  json += ",\"temperature_asymmetry_available\":" + String(diabetesFrame.temperatureAsymmetryAvailable ? "true" : "false") + ",\"temperature_threshold_exceeded\":" + String(diabetesFrame.temperatureThresholdExceeded ? "true" : "false") + ",\"two_window_confirmation_ready\":" + String(diabetesFrame.temperatureAsymmetryStreak >= TEMP_ASYMMETRY_CONFIRM_WINDOWS ? "true" : "false") + ",\"temperature_asymmetry_streak\":" + String(diabetesFrame.temperatureAsymmetryStreak) + ",\"temperature_hot_region\":" + String(diabetesFrame.temperatureHotRegion) + ",\"attention_streak\":" + String(diabetesFrame.attentionStreak) + "},";
  json += "\"posture\":{\"target\":\"posture_trajectory\",\"state\":\"" + String(postureFrame.state) + "\",\"alignment\":\"" + String(postureFrame.alignment) + "\",\"score\":" + String(postureFrame.score, 3);
  json += ",\"roll_deg\":" + String(postureFrame.roll, 2) + ",\"pitch_deg\":" + String(postureFrame.pitch, 2) + ",\"yaw_deg\":" + String(postureFrame.yaw, 2) + ",\"stance\":" + String(postureFrame.stance ? "true" : "false");
  json += ",\"step_count\":" + String(postureFrame.stepCount) + ",\"step_length_cm\":" + String(postureFrame.stepLengthCm, 2) + ",\"trajectory_x_cm\":" + String(postureFrame.trajectoryXcm, 2) + ",\"trajectory_y_cm\":" + String(postureFrame.trajectoryYcm, 2) + ",\"zero_velocity_update\":" + String(postureFrame.zeroVelocityUpdate ? "true" : "false") + ",\"drift_warning\":" + String(postureFrame.driftWarning ? "true" : "false") + "}},";
  json += "\"algorithm\":{\"mode\":\"parkinson\",\"gate_open\":" + String(algorithmFrame.gateOpen ? "true" : "false");
  json += ",\"fi\":" + String(algorithmFrame.fi, 3) + ",\"fi_ratio\":" + String(algorithmFrame.fiRatio, 3) + ",\"spectral_entropy\":" + String(algorithmFrame.spectralEntropy, 3) + ",\"pitch_rom\":" + String(algorithmFrame.pitchRom, 3);
  json += ",\"score\":" + String(algorithmFrame.score, 3) + ",\"state\":\"" + String(algorithmFrame.state) + "\",\"warning_streak\":" + String(algorithmFrame.warningStreak) + ",\"normal_streak\":" + String(algorithmFrame.normalStreak);
  json += ",\"cue_vibration\":" + String(algorithmFrame.cueVibration ? "true" : "false") + ",\"cue_laser\":" + String(algorithmFrame.cueLaser ? "true" : "false") + "}";
  json += ",\"storage\":{\"ready\":" + String(storageReady ? "true" : "false") + ",\"file\":\"/stepon_log.csv\",\"summary_file\":\"/stepon_summary.json\"}}";
  return json;
}

void handleRoot() { server.send_P(200, "text/html; charset=utf-8", INDEX_HTML); }
void handleState() { server.send(200, "application/json; charset=utf-8", makeStateJson()); }
void handlePing() { server.send(200, "text/plain; charset=utf-8", "StepOn-C3 OK"); }

void handleProfile() {
  if (storageReady) {
    File file = LittleFS.open(PROFILE_PATH, "w");
    if (file) {
      file.print(server.arg("plain"));
      file.close();
    }
  }
  server.send(200, "application/json; charset=utf-8", "{\"ok\":true}");
}

void handleSummary() {
  if (!storageReady) {
    server.send(503, "application/json; charset=utf-8", "{\"storage\":\"unavailable\"}");
    return;
  }
  writeSummaryFile();
  File file = LittleFS.open(SUMMARY_PATH, "r");
  if (!file) {
    server.send(404, "application/json; charset=utf-8", "{\"error\":\"summary missing\"}");
    return;
  }
  server.streamFile(file, "application/json; charset=utf-8");
  file.close();
}

void handleLogDownload() {
  if (!storageReady || !LittleFS.exists(DATA_LOG_PATH)) {
    server.send(404, "text/plain; charset=utf-8", "log missing");
    return;
  }
  File file = LittleFS.open(DATA_LOG_PATH, "r");
  if (!file) {
    server.send(500, "text/plain; charset=utf-8", "log open failed");
    return;
  }
  server.sendHeader("Content-Disposition", "attachment; filename=stepon_log.csv", true);
  server.streamFile(file, "text/csv; charset=utf-8");
  file.close();
}

void handleLogClear() {
  if (!storageReady) {
    server.send(503, "application/json; charset=utf-8", "{\"ok\":false,\"error\":\"storage unavailable\"}");
    return;
  }
  LittleFS.remove(DATA_LOG_PATH);
  LittleFS.remove(SUMMARY_PATH);
  loggedFrames = 0;
  fogEvents = 0;
  loggedTemperatureSum = 0.0f;
  loggedHumiditySum = 0.0f;
  loggedMaxRisk = 0;
  strncpy(lastAlgorithmState, "Normal", sizeof(lastAlgorithmState));
  algorithmFrame = {true, 0, 0, 0, 0, 0, 0, "Normal", 0, 0, false, false};
  diabetesFrame = {"Stable", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, false};
  postureFrame = {"Stance", "기준선 범위", 0, 0, 0, 0, 0, 0, 0, 0, true, true, false};
  motionWriteIndex = 0;
  motionSampleCount = 0;
  motionAnalysisReady = false;
  for (int i = 0; i < MOTION_WINDOW_SIZE; i++) {
    motionWindow[i] = 0.0f;
    motionPitchWindow[i] = 0.0f;
  }
  diabetesBaselineReady = false;
  gaitCadenceSpm = 0.0f;
  lastStepAt = 0;
  previousStance = false;
  writeLogHeader();
  writeSummaryFile();
  server.send(200, "application/json; charset=utf-8", "{\"ok\":true}");
}

void handleNotFound() {
  server.sendHeader("Location", String("http://") + AP_IP.toString() + "/", true);
  server.send(302, "text/plain", "Redirecting to StepOn dashboard");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(400000);
  initPressureMux();
#if USE_REAL_I2C_SENSORS
  initI2CSensors();
#endif
  initCueOutputs();
  initializeStorage();

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_IP, IPAddress(255, 255, 255, 0));
  WiFi.softAP(AP_SSID, AP_PASSWORD, 6, false, 4);
  dnsServer.start(DNS_PORT, "*", AP_IP);

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/summary", HTTP_GET, handleSummary);
  server.on("/api/log.csv", HTTP_GET, handleLogDownload);
  server.on("/api/log/clear", HTTP_POST, handleLogClear);
  server.on("/api/profile", HTTP_POST, handleProfile);
  server.on("/api/ping", HTTP_GET, handlePing);
  server.enableCORS(true);
  server.onNotFound(handleNotFound);
  server.begin();

  sampleSensors();
  Serial.println();
  Serial.println("StepOn-C3 AP started");
  Serial.print("SSID: ");
  Serial.println(AP_SSID);
  Serial.print("Dashboard: http://");
  Serial.println(AP_IP);
}

void sampleSensors() {
#if USE_MOCK_SENSORS
  sampleMockSensors();
#else
  samplePressureSensors();
#if USE_REAL_I2C_SENSORS
  sampleI2CSensors();
#endif
  currentFrame.battery = 86;  // 배터리 ADC를 확정하면 이 값을 실제 전압 환산으로 교체
  currentFrame.frame++;
  calculateCopAndFusion();
#endif
  updatePostureAlgorithm();
  updateMotionWindow();
  updateParkinsonAlgorithm();
  updateDiabetesAlgorithm();
  serviceCueOutputs();
  const float fusedRisk = max(algorithmFrame.score, max(diabetesFrame.score, postureFrame.score));
  currentFrame.risk = constrain((int)round(fusedRisk * 100.0f), 0, 100);
  serviceStorage();
}

void loop() {
  dnsServer.processNextRequest();
  server.handleClient();
  if (millis() - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = millis();
    sampleSensors();
  }
}



























