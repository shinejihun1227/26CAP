#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include <atomic>

// Temporary radio/USB diagnostic. No sensors, AI, vibration or laser commands.
// Keep a different SSID so this cannot be mistaken for the real sensor firmware.
constexpr char AP_SSID[] = "StepOn-C3-DIAG";
constexpr char AP_PASSWORD[] = "stepon1234";
constexpr uint8_t AP_CHANNEL = 1;
constexpr uint8_t LASER_PIN = 10;
constexpr uint32_t LOG_INTERVAL_MS = 2000;

WebServer server(80);
std::atomic<bool> apRunning{false};
std::atomic<uint32_t> apStarts{0};
std::atomic<uint32_t> apStops{0};
std::atomic<uint32_t> stationConnections{0};
std::atomic<uint32_t> stationDisconnections{0};
bool modeOk = false;
bool apCallOk = false;
uint32_t lastLogMs = 0;
uint32_t httpRequests = 0;

void onWifiEvent(WiFiEvent_t event) {
  // Arduino dispatches Wi-Fi events on a different task. Share only atomics.
  switch (event) {
    case ARDUINO_EVENT_WIFI_AP_START:
      apStarts.fetch_add(1);
      apRunning.store(true);
      break;
    case ARDUINO_EVENT_WIFI_AP_STOP:
      apStops.fetch_add(1);
      apRunning.store(false);
      break;
    case ARDUINO_EVENT_WIFI_AP_STACONNECTED:
      stationConnections.fetch_add(1);
      break;
    case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED:
      stationDisconnections.fetch_add(1);
      break;
    default:
      break;
  }
}

String diagnosticJson() {
  wifi_mode_t actualMode = WIFI_MODE_NULL;
  wifi_config_t config = {};
  uint8_t channel = 0;
  wifi_second_chan_t secondary = WIFI_SECOND_CHAN_NONE;
  int8_t txPowerQuarterDbm = 0;
  const esp_err_t modeError = esp_wifi_get_mode(&actualMode);
  const esp_err_t configError = esp_wifi_get_config(WIFI_IF_AP, &config);
  const esp_err_t channelError = esp_wifi_get_channel(&channel, &secondary);
  const esp_err_t powerError = esp_wifi_get_max_tx_power(&txPowerQuarterDbm);
  const bool ready = modeOk && apCallOk && apRunning.load() &&
    modeError == ESP_OK && actualMode == WIFI_MODE_AP;

  String json;
  json.reserve(1000);
  json = "{\"firmware\":\"00_wifi_diagnostic\",\"sensors_enabled\":false,\"ok\":";
  json += ready ? "true" : "false";
  json += ",\"uptime_ms\":" + String(millis());
  json += ",\"reset_reason\":" + String(static_cast<int>(esp_reset_reason()));
  json += ",\"mode_call_ok\":";
  json += modeOk ? "true" : "false";
  json += ",\"softap_call_ok\":";
  json += apCallOk ? "true" : "false";
  json += ",\"ap_running\":";
  json += apRunning.load() ? "true" : "false";
  json += ",\"ssid\":\"" + WiFi.softAPSSID() + "\"";
  json += ",\"ip\":\"" + WiFi.softAPIP().toString() + "\"";
  json += ",\"mac\":\"" + WiFi.softAPmacAddress() + "\"";
  json += ",\"mode\":" + String(static_cast<int>(actualMode));
  json += ",\"channel\":" + String(channel);
  json += ",\"hidden\":" + String(config.ap.ssid_hidden);
  json += ",\"auth_mode\":" + String(static_cast<int>(config.ap.authmode));
  json += ",\"max_tx_power_dbm\":" + String(txPowerQuarterDbm / 4.0f, 2);
  json += ",\"clients\":" + String(WiFi.softAPgetStationNum());
  json += ",\"ap_starts\":" + String(apStarts.load());
  json += ",\"ap_stops\":" + String(apStops.load());
  json += ",\"station_connections\":" + String(stationConnections.load());
  json += ",\"station_disconnections\":" + String(stationDisconnections.load());
  json += ",\"free_heap\":" + String(ESP.getFreeHeap());
  json += ",\"min_free_heap\":" + String(ESP.getMinFreeHeap());
  json += ",\"http_requests\":" + String(httpRequests);
  json += ",\"mode_error\":" + String(modeError);
  json += ",\"config_error\":" + String(configError);
  json += ",\"channel_error\":" + String(channelError);
  json += ",\"power_error\":" + String(powerError) + "}";
  return json;
}

void sendDiagnostic() {
  ++httpRequests;
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", diagnosticJson());
}

void setup() {
  // Keep the existing laser control line LOW even in the diagnostic sketch.
  digitalWrite(LASER_PIN, LOW);
  pinMode(LASER_PIN, OUTPUT);
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT && ARDUINO_USB_MODE
  Serial.setTxTimeoutMs(10);
#endif
  delay(800);  // Bounded wait: Wi-Fi must start without an open Serial Monitor.
  Serial.println("\nStepOn 00_wifi_diagnostic: sensors and outputs disabled");
  Serial.printf("[BOOT] reset_reason=%d sdk=%s heap=%lu\n",
    static_cast<int>(esp_reset_reason()), ESP.getSdkVersion(),
    static_cast<unsigned long>(ESP.getFreeHeap()));

  WiFi.persistent(false);  // Do not replace saved Wi-Fi credentials in NVS.
  WiFi.onEvent(onWifiEvent);
  modeOk = WiFi.mode(WIFI_AP);
  Serial.printf("[AP] WiFi.mode(WIFI_AP)=%s\n", modeOk ? "OK" : "FAILED");
  if (modeOk) apCallOk = WiFi.softAP(AP_SSID, AP_PASSWORD, AP_CHANNEL, 0, 4);
  Serial.printf("[AP] softAP=%s SSID=%s channel=%u\n",
    apCallOk ? "OK" : "FAILED", AP_SSID, AP_CHANNEL);

  server.on("/", HTTP_GET, sendDiagnostic);
  server.on("/api/ping", HTTP_GET, sendDiagnostic);
  server.on("/api/diag", HTTP_GET, sendDiagnostic);
  server.on("/api/state", HTTP_GET, []() {
    server.send(503, "application/json",
      "{\"ok\":false,\"firmware\":\"00_wifi_diagnostic\",\"error\":\"sensors_disabled_for_diagnostic\"}");
  });
  server.onNotFound([]() {
    server.send(404, "application/json", "{\"error\":\"diagnostic_endpoint_not_found\"}");
  });
  if (modeOk && apCallOk) {
    server.begin();
    Serial.println("[HTTP] GET /api/ping or /api/diag (not sensor data)");
  }
  Serial.println(diagnosticJson());
}

void loop() {
  if (modeOk && apCallOk) server.handleClient();
  const uint32_t now = millis();
  if (static_cast<uint32_t>(now - lastLogMs) >= LOG_INTERVAL_MS) {
    lastLogMs = now;
    Serial.println(diagnosticJson());
  }
  delay(2);  // Yield to system tasks; no I2C, ADC, sensor or model work.
}
