#include <Arduino.h>
// Original ESP32 family only. C3/S3 have a different peripheral/pin layout.
#if !defined(CONFIG_IDF_TARGET_ESP32)
#error "04_2 requires ESP32 Dev Module (WROOM-32) or ESP32-WROOM-DA Module. For C3 use 04_sta_bilateral."
#endif
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <esp_system.h>
#include "config.h"
#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#else
#error "Copy wifi_secrets.example.h to wifi_secrets.h and enter hotspot credentials"
#endif
#include "sensor_core.h"
#include "wifi_diagnostics.h"

WebServer server(80);
StaSensors::Frame latest;
portMUX_TYPE frameLock = portMUX_INITIALIZER_UNLOCKED;
QueueHandle_t vibrationQueue;
String deviceId, bootId;
volatile uint32_t lastVibrationAt = 0;
volatile bool autoCue = false;
bool laserOn = false;
uint32_t laserOffAt = 0;

void sendJson(int code, const String &body) {
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(code, "application/json", body);
}
StaSensors::Frame copyFrame() {
  StaSensors::Frame result;
  portENTER_CRITICAL(&frameLock); result = latest; portEXIT_CRITICAL(&frameLock);
  return result;
}
void publish(const StaSensors::Frame &f) {
  portENTER_CRITICAL(&frameLock); latest = f; portEXIT_CRITICAL(&frameLock);
}
bool candidate(const StaSensors::Frame &f) {
  if (!f.imuReady || !f.pressureReady) return false;
  float sum = 0, gyro = 0;
  for (uint8_t i = 0; i < 4; ++i) sum += f.pressure[i];
  for (uint8_t i = 0; i < 3; ++i) gyro += f.gyro[i] * f.gyro[i];
  return sum / 4 > 10 && sqrtf(gyro) > 55; // Prototype rule, NOT RF/CNN inference.
}
void setLaserOutput(bool enabled) {
  laserOn = ENABLE_LASER_OUTPUT && enabled;
  digitalWrite(LASER_PIN, laserOn ? HIGH : LOW);
  if (laserOn) laserOffAt = millis() + 650;
}
String stateJson() {
  const auto f = copyFrame();
  const bool sensorFresh = f.sequence > 0 && uint32_t(millis() - f.atMs) < 1000;
  String s; s.reserve(2100);
  s = "{\"device\":\"StepOn-WROOM\",\"firmware\":\"04_2_sta_bilateral_wroom\",\"wifi_mode\":\"STA\",\"device_id\":\"" + deviceId + "\",\"boot_id\":\"" + bootId + "\",\"foot_side\":\"" + FOOT_SIDE + "\",\"bilateral_available\":false";
  s += ",\"frame\":" + String(f.sequence) + ",\"millis\":" + String(f.atMs) + ",\"uptime_ms\":" + String(millis());
  s += ",\"sample_hz\":64,\"actual_sample_hz\":" + String(sensorFresh ? f.actualHz : 0, 1) + ",\"aux_sample_hz\":20,\"missed_deadlines\":" + String(f.missedDeadlines);
  s += ",\"rssi\":" + String(WiFi.RSSI()) + ",\"free_heap\":" + String(ESP.getFreeHeap());
  s += ",\"pressure_count\":4,\"pressure_layout\":\"stepon-pressure-4-v1\",\"pressure_channels\":[";
  for (uint8_t i = 0; i < 4; ++i) { if (i) s += ','; s += PRESSURE_CHANNELS[i]; }
  s += "],\"shtc3_channels\":[3,4,5,6]";
  s += ",\"pressure_ready\":" + String(f.pressureReady && uint32_t(millis() - f.pressureAtMs) < 1000 ? "true" : "false");
  s += ",\"pressure\":[";
  for (uint8_t i = 0; i < 4; ++i) { if (i) s += ','; s += f.pressure[i]; }
  s += "],\"pressure_raw\":[";
  for (uint8_t i = 0; i < 4; ++i) { if (i) s += ','; s += f.pressureRaw[i]; }
  s += "],\"temperature\":[";
  for (uint8_t i = 0; i < 4; ++i) { if (i) s += ','; s += String(f.temperature[i], 2); }
  s += "],\"humidity\":[";
  for (uint8_t i = 0; i < 4; ++i) { if (i) s += ','; s += String(f.humidity[i], 2); }
  s += "],\"shtc3_ready\":[";
  for (uint8_t i = 0; i < 4; ++i) { if (i) s += ','; s += f.thermalReady[i] && uint32_t(millis() - f.thermalAtMs[i]) < 1000 ? "true" : "false"; }
  s += "],\"tca_ready\":" + String(f.tcaReady ? "true" : "false") + ",\"drv2605_ready\":" + String(f.drvReady && sensorFresh ? "true" : "false") + ",\"imu_ready\":" + String(f.imuReady && sensorFresh ? "true" : "false");
  s += ",\"accel\":{\"x\":" + String(f.accel[0], 4) + ",\"y\":" + String(f.accel[1], 4) + ",\"z\":" + String(f.accel[2], 4) + "},\"gyro\":{\"x\":" + String(f.gyro[0], 4) + ",\"y\":" + String(f.gyro[1], 4) + ",\"z\":" + String(f.gyro[2], 4) + "}";
  s += ",\"derived\":{\"fog_candidate\":" + String(candidate(f) && sensorFresh ? "true" : "false") + "},\"output\":{\"laser\":" + String(laserOn ? "true" : "false") + ",\"vibration\":" + String(lastVibrationAt && uint32_t(millis() - lastVibrationAt) < 400 ? "true" : "false") + ",\"auto_cue\":" + String(autoCue ? "true" : "false") + "}}";
  return s;
}
void sensorTask(void *) {
  StaSensors::Frame f;
  StaSensors::initialize(f);
  uint32_t lastImu = micros(), lastAux = 0, rateAt = millis(), rateCount = 0, lastCue = 0;
  while (true) {
    const uint32_t nowUs = micros(), nowMs = millis();
    if (uint32_t(nowUs - lastImu) >= IMU_INTERVAL_US) {
      const uint32_t intervals = uint32_t(nowUs - lastImu) / IMU_INTERVAL_US;
      f.missedDeadlines += intervals - 1; lastImu += intervals * IMU_INTERVAL_US;
      StaSensors::readImu(f); rateCount++;
    }
    if (uint32_t(nowMs - lastAux) >= AUX_INTERVAL_MS) { lastAux = nowMs; StaSensors::readPressure(f); }
    StaSensors::thermalTick(f);
    uint8_t effect = 0;
    if (autoCue && candidate(f) && uint32_t(nowMs - lastCue) > 1800) { effect = 47; lastCue = nowMs; }
    uint8_t requested = 0;
    if (xQueueReceive(vibrationQueue, &requested, 0) == pdTRUE) effect = requested;
    if (effect && f.drvReady) { StaSensors::driver.setWaveform(0, effect); StaSensors::driver.setWaveform(1, 0); StaSensors::driver.go(); lastVibrationAt = millis(); }
    if (uint32_t(nowMs - rateAt) >= 2000) { f.actualHz = rateCount * 1000.0f / uint32_t(nowMs - rateAt); rateAt = nowMs; rateCount = 0; }
    publish(f);
    vTaskDelay(1);
  }
}
void registrationTask(void *) {
  int lastCode = 0;
  while (true) {
    if (WiFi.status() == WL_CONNECTED) {
      const String pc = strlen(PC_HOST) ? String(PC_HOST) : WiFi.gatewayIP().toString();
      WiFiClient client; HTTPClient http;
      http.setConnectTimeout(600); http.setTimeout(600);
      http.begin(client, "http://" + pc + ":" + String(PC_PORT) + "/api/insoles/register");
      http.addHeader("Content-Type", "application/json");
      const int code = http.POST("{\"firmware\":\"04_2_sta_bilateral_wroom\",\"foot_side\":\"" + String(FOOT_SIDE) + "\",\"device_id\":\"" + deviceId + "\"}");
      if (code != lastCode) Serial.printf("[PC] registration HTTP=%d host=%s:%u (200=registered; check run.bat/firewall if failed)\n", code, pc.c_str(), PC_PORT);
      lastCode = code; http.end();
    }
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
}
void setup() {
  // WROOM uses HardwareSerial (UART0); native-USB TX timeout is not available.
  Serial.begin(115200); delay(800);
  pinMode(LASER_PIN, OUTPUT); digitalWrite(LASER_PIN, LOW);
  bootId = String(esp_random(), HEX);
  deviceId = "wroom-" + String(uint32_t(ESP.getEfuseMac() >> 32), HEX) + String(uint32_t(ESP.getEfuseMac()), HEX);
  Serial.printf("\nStepOn 04_2_sta_bilateral_wroom foot=%s reset=%d\n", FOOT_SIDE, int(esp_reset_reason()));
  WifiDiagnostics::begin(); // Register the observer before Wi-Fi starts.
  WiFi.persistent(false);
  const bool modeOk = WiFi.mode(WIFI_STA);
  const bool hostnameOk = WiFi.setHostname(DEVICE_HOSTNAME);
  const bool sleepOk = WiFi.setSleep(WIFI_POWER_SAVE);
  const bool reconnectOk = WiFi.setAutoReconnect(true);
  const wl_status_t initialStatus = WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  // Limit STA transmit power while connecting, not after authentication succeeds.
  // The STA-start event is asynchronous; retry briefly (at most 200 ms).
  bool txPowerOk = false;
  for (int i = 0; i < 20 && !txPowerOk; ++i) {
    txPowerOk = WiFi.setTxPower(WIFI_POWER_8_5dBm);
    if (!txPowerOk) delay(10);
  }
  Serial.printf("[WIFI-TX] applied=%d requested=8.5dBm (setting only, NOT connection success)\n", int(txPowerOk));
  WifiDiagnostics::printStartup(WIFI_SSID, modeOk, hostnameOk, sleepOk, reconnectOk, initialStatus);
  Serial.println("[WiFi] STA only. Waiting for the 2.4GHz PC hotspot; retrying without creating a network.");
  vibrationQueue = xQueueCreate(4, sizeof(uint8_t));
  server.on("/api/state", HTTP_GET, [] { sendJson(200, stateJson()); });
  server.on("/api/ping", HTTP_GET, [] { sendJson(200, "{\"ok\":true,\"firmware\":\"04_2_sta_bilateral_wroom\",\"foot_side\":\"" + String(FOOT_SIDE) + "\",\"device_id\":\"" + deviceId + "\"}"); });
  server.on("/api/vibrate", HTTP_GET, [] {
    const auto f = copyFrame(); const uint8_t effect = 47;
    if (!f.drvReady || uint32_t(millis() - f.atMs) > 1000 || !vibrationQueue || xQueueSend(vibrationQueue, &effect, 0) != pdTRUE) { sendJson(503, "{\"error\":\"vibration_unavailable\"}"); return; }
    sendJson(200, "{\"ok\":true,\"queued\":true}");
  });
  server.on("/api/laser", HTTP_GET, [] {
    if (!ENABLE_LASER_OUTPUT && server.arg("on") == "1") { sendJson(409, "{\"error\":\"laser_disabled_for_safety\"}"); return; }
    setLaserOutput(server.arg("on") == "1"); sendJson(200, stateJson());
  });
  server.on("/api/auto-cue", HTTP_GET, [] { autoCue = server.arg("enabled") == "1"; sendJson(200, stateJson()); });
  server.onNotFound([] { sendJson(404, "{\"error\":\"not_found\"}"); });
  server.begin();
  // All I2C operations live in one task. HTTP and registration never take its bus lock.
  if (!vibrationQueue || xTaskCreate(sensorTask, "sensors", 8192, nullptr, 1, nullptr) != pdPASS) Serial.println("[ERROR] Sensor task could not start");
  if (xTaskCreate(registrationTask, "pc-register", 6144, nullptr, 1, nullptr) != pdPASS) Serial.println("[ERROR] Registration task could not start; enter IP in Devices");
}
void loop() {
  static uint32_t retryAt = 0, logAt = 0;
  static bool wasConnected = false;
  WifiDiagnostics::drain();
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wasConnected) Serial.printf("[WiFi] STA connected foot=%s IP=%s gateway=%s\n", FOOT_SIDE, WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str());
  if (!connected && wasConnected) { autoCue = false; setLaserOutput(false); Serial.println("[WiFi] disconnected; outputs disarmed"); }
  wasConnected = connected;
  if (!connected && uint32_t(millis() - retryAt) >= 15000) {
    retryAt = millis();
    Serial.printf("[WIFI-DIAG] [RETRY] at=%lu source=existing_15s_timer; reconnect may itself emit a disconnect event\n", (unsigned long)retryAt);
    const bool retryOk = WiFi.reconnect();
    Serial.printf("[WIFI-DIAG] [RETRY] call_ok=%u (request accepted, NOT connection success)\n", retryOk);
  }
  server.handleClient();
  if (laserOn && int32_t(millis() - laserOffAt) >= 0) setLaserOutput(false);
  if (uint32_t(millis() - logAt) >= 2000) {
    logAt = millis(); const auto f = copyFrame();
    Serial.printf("[STATE] foot=%s wifi=%d uptime=%lu frame=%lu IMU=%u rate=%.1fHz missed=%lu heap=%u\n", FOOT_SIDE, int(WiFi.status()), (unsigned long)millis(), (unsigned long)f.sequence, f.imuReady, f.actualHz, (unsigned long)f.missedDeadlines, ESP.getFreeHeap());
    Serial.printf("[PRESSURE] S0=%u S1=%u S2=%u S3=%u SIG=%u raw C%u=%u C%u=%u C%u=%u C%u=%u\n",
      MUX_S0, MUX_S1, MUX_S2, MUX_S3, MUX_SIG,
      PRESSURE_CHANNELS[0], f.pressureRaw[0], PRESSURE_CHANNELS[1], f.pressureRaw[1],
      PRESSURE_CHANNELS[2], f.pressureRaw[2], PRESSURE_CHANNELS[3], f.pressureRaw[3]);
    WifiDiagnostics::printStatus();
  }
  delay(1);
}
