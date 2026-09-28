#include <WiFi.h>
#include <WebServer.h>
#include "sensor_core.h"

// STA를 쓰려면 두 값을 입력하세요. 비워 두면 바로 AP 모드로 시작합니다.
const char *WIFI_SSID = "";
const char *WIFI_PASSWORD = "";
const char *AP_SSID = "StepOn-C3";
const char *AP_PASSWORD = "stepon1234";

constexpr uint32_t SAMPLE_INTERVAL_MS = 50; // 20 Hz API frame
WebServer server(80);
StepOn::SensorFrame latestFrame;
uint32_t lastSampleAt = 0;

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

void handlePing() {
  sendJson(200, "{\"ok\":true,\"device\":\"StepOn-C3\",\"firmware\":\"02_wifi_api\"}");
}

void handleState() {
  sendJson(200, StepOn::frameToJson(latestFrame));
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
  Serial.println("StepOn 02_wifi_api");
  StepOn::initSensorCore();
  startNetwork();

  server.on("/api/ping", HTTP_GET, handlePing);
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/ping", HTTP_OPTIONS, handleOptions);
  server.on("/api/state", HTTP_OPTIONS, handleOptions);
  server.onNotFound([]() { sendJson(404, "{\"error\":\"not_found\"}"); });
  server.begin();
  Serial.println("HTTP API ready: GET /api/ping, GET /api/state");
}

void loop() {
  server.handleClient();
  if (millis() - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = millis();
    StepOn::readSensorFrame(latestFrame);
  }
}
