#include <WiFi.h>
#include <WebServer.h>
#include "sensor_core.h"

// STA를 쓰려면 두 값을 입력하세요. 비워 두면 StepOn-C3 AP를 만듭니다.
const char *WIFI_SSID = "";
const char *WIFI_PASSWORD = "";
const char *AP_SSID = "StepOn-C3";
const char *AP_PASSWORD = "stepon1234";

// 안전을 위해 기본값은 0입니다. 실제 레이저 연결·검증 후 1로 바꾸세요.
#define ENABLE_LASER_OUTPUT 0
constexpr uint8_t LASER_PIN = 10;
constexpr uint16_t LASER_CUE_MS = 650;
constexpr uint8_t HAPTIC_EFFECT = 47;
// BMI270 IMU frame rate for the AI input. 64 Hz = 15,625 microseconds.
constexpr uint32_t IMU_SAMPLE_INTERVAL_US = 15625;
// Pressure and SHTC3 reads are slower auxiliary data. Their latest values
// remain in /api/state while the IMU frame advances at 64 Hz.
constexpr uint32_t AUX_SENSOR_INTERVAL_MS = 50;

WebServer server(80);
StepOn::SensorFrame latestFrame;
uint32_t lastImuSampleAtUs = 0;
uint32_t lastAuxSampleAtMs = 0;
uint32_t lastCueAt = 0;
uint32_t laserOffAt = 0;
uint32_t lastVibrationAt = 0;
bool laserOn = false;
bool autoCueEnabled = false;

void cors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Cache-Control", "no-store");
}

void sendJson(int status, const String &json) {
  cors();
  server.send(status, "application/json", json);
}

float pressureTotal() {
  float total = 0;
  for (uint8_t i = 0; i < StepOn::PRESSURE_COUNT; i++) total += latestFrame.pressure[i];
  return total;
}

float gyroMagnitude() {
  return sqrtf(latestFrame.gyroX * latestFrame.gyroX +
               latestFrame.gyroY * latestFrame.gyroY +
               latestFrame.gyroZ * latestFrame.gyroZ);
}

bool fogCandidate() {
  return pressureTotal() > 80 && gyroMagnitude() > 55;
}

uint8_t observationRisk() {
  return static_cast<uint8_t>(constrain((pressureTotal() > 250 ? 25 : 0) +
                                         (fogCandidate() ? 60 : 8), 0, 100));
}

void setLaser(bool enabled) {
#if ENABLE_LASER_OUTPUT
  digitalWrite(LASER_PIN, enabled ? HIGH : LOW);
  laserOn = enabled;
  if (enabled) laserOffAt = millis() + LASER_CUE_MS;
#else
  digitalWrite(LASER_PIN, LOW);
  laserOn = false;
  (void)enabled;
#endif
}

bool triggerVibration(uint8_t effect = HAPTIC_EFFECT) {
  if (!StepOn::drv2605Ready) return false;
  StepOn::drv2605.setWaveform(0, effect);
  StepOn::drv2605.setWaveform(1, 0);
  StepOn::drv2605.go();
  lastVibrationAt = millis();
  return true;
}

String stateJson() {
  String json = StepOn::frameToJson(latestFrame);
  if (json.endsWith("}")) json.remove(json.length() - 1);
  const float total = pressureTotal();
  const bool fog = fogCandidate();
  json += ",\"risk\":";
  json += observationRisk();
  json += ",\"derived\":{\"pressure_total\":";
  json += String(total, 1);
  json += ",\"gyro_magnitude\":";
  json += String(gyroMagnitude(), 2);
  json += ",\"foot_loaded\":";
  json += (total > 18 ? "true" : "false");
  json += ",\"fog_candidate\":";
  json += (fog ? "true" : "false");
  json += ",\"fog_state\":\"";
  json += (fog ? "observe" : "normal");
  json += "\"},\"output\":{\"laser\":";
  json += (laserOn ? "true" : "false");
  json += ",\"vibration\":";
  json += (lastVibrationAt != 0 && millis() - lastVibrationAt < 400 ? "true" : "false");
  json += ",\"auto_cue\":";
  json += (autoCueEnabled ? "true" : "false");
  json += "}}";
  return json;
}

void handlePing() {
  sendJson(200, "{\"ok\":true,\"device\":\"StepOn-C3\",\"firmware\":\"03_final\"}");
}

void handleState() {
  sendJson(200, stateJson());
}

void handleLaser() {
  setLaser(server.hasArg("on") && server.arg("on") == "1");
  sendJson(200, stateJson());
}

void handleVibrate() {
  const uint8_t effect = server.hasArg("effect")
    ? static_cast<uint8_t>(server.arg("effect").toInt()) : HAPTIC_EFFECT;
  if (!triggerVibration(effect)) {
    sendJson(503, "{\"ok\":false,\"error\":\"drv2605_not_ready\"}");
    return;
  }
  sendJson(200, "{\"ok\":true,\"action\":\"vibrate\"}");
}

void handleAutoCue() {
  autoCueEnabled = server.hasArg("enabled") && server.arg("enabled") == "1";
  sendJson(200, stateJson());
}

void handleCalibrate() {
  sendJson(200, "{\"ok\":true,\"action\":\"calibrate\",\"note\":\"개인 기준선 저장은 다음 단계에서 연결하세요\"}");
}

void handleOptions() {
  cors();
  server.send(204);
}

void startNetwork() {
  const bool hasStaCredentials = strlen(WIFI_SSID) > 0 && strlen(WIFI_PASSWORD) > 0;
  if (hasStaCredentials) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Wi-Fi STA connecting");
    const uint32_t started = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - started < 15000) {
      delay(250);
      Serial.print('.');
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("\nSTA URL: http://");
      Serial.println(WiFi.localIP());
      return;
    }
    WiFi.disconnect(true);
  }

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.print("\nAP SSID: ");
  Serial.println(AP_SSID);
  Serial.print("AP URL: http://");
  Serial.println(WiFi.softAPIP());
}

void setup() {
  Serial.begin(115200);
  delay(800);
  pinMode(LASER_PIN, OUTPUT);
  digitalWrite(LASER_PIN, LOW);
  Serial.println("StepOn 03_final");
  StepOn::initSensorCore();
  startNetwork();

  server.on("/api/ping", HTTP_GET, handlePing);
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/laser", HTTP_GET, handleLaser);
  server.on("/api/vibrate", HTTP_GET, handleVibrate);
  server.on("/api/auto-cue", HTTP_GET, handleAutoCue);
  server.on("/api/calibrate", HTTP_GET, handleCalibrate);
  server.on("/api/ping", HTTP_OPTIONS, handleOptions);
  server.on("/api/state", HTTP_OPTIONS, handleOptions);
  server.onNotFound([]() { sendJson(404, "{\"error\":\"not_found\"}"); });
  server.begin();
  Serial.println("HTTP API ready: GET /api/state");
}

void loop() {
  server.handleClient();
  const uint32_t nowUs = micros();
  if (lastImuSampleAtUs == 0) lastImuSampleAtUs = nowUs;
  if (static_cast<uint32_t>(nowUs - lastImuSampleAtUs) >= IMU_SAMPLE_INTERVAL_US) {
    lastImuSampleAtUs += IMU_SAMPLE_INTERVAL_US;
    // If Wi-Fi or an auxiliary sensor read caused a long stall, restart the
    // phase instead of trying to emit a burst of stale frames.
    if (static_cast<uint32_t>(nowUs - lastImuSampleAtUs) > IMU_SAMPLE_INTERVAL_US * 4) {
      lastImuSampleAtUs = nowUs;
    }
    StepOn::readFastImuFrame(latestFrame);
    if (autoCueEnabled && fogCandidate() && millis() - lastCueAt > 1800) {
      lastCueAt = millis();
      triggerVibration();
      setLaser(true);
    }
  }
  const uint32_t nowMs = millis();
  if (nowMs - lastAuxSampleAtMs >= AUX_SENSOR_INTERVAL_MS) {
    lastAuxSampleAtMs = nowMs;
    StepOn::readSlowSensors(latestFrame);
  }
  if (laserOn && static_cast<int32_t>(millis() - laserOffAt) >= 0) setLaser(false);
}
