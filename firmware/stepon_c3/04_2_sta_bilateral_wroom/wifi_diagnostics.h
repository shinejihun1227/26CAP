#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// Observation only: no scan, reconnect, credential changes, HTTP or sensor work.
// Arduino invokes the callback on its event task, not on loop().
namespace WifiDiagnostics {
struct Event {
  WiFiEvent_t kind;
  uint32_t atMs;
  uint16_t reason;
  uint8_t channel;
  uint8_t auth;
  uint8_t oldAuth;
  int8_t rssi;
  uint8_t bssid[6];
  uint32_t ip;
  uint32_t gateway;
};
static QueueHandle_t events = nullptr;
static std::atomic<uint32_t> disconnectCount{0}, droppedEvents{0};
static std::atomic<uint32_t> lastDisconnectAt{0};
static std::atomic<uint16_t> lastReason{0};

inline const char *statusName(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS: return "IDLE";
    case WL_NO_SSID_AVAIL: return "NO_SSID_AVAILABLE";
    case WL_SCAN_COMPLETED: return "SCAN_COMPLETED";
    case WL_CONNECTED: return "CONNECTED";
    case WL_CONNECT_FAILED: return "CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "CONNECTION_LOST";
    case WL_DISCONNECTED: return "DISCONNECTED";
    case WL_NO_SHIELD: return "NO_SHIELD";
    default: return "UNKNOWN";
  }
}
inline const char *reasonName(uint16_t reason) {
  const char *name = WiFi.disconnectReasonName(static_cast<wifi_err_reason_t>(reason));
  return name && name[0] ? name : "UNKNOWN"; // Preserve the raw numeric code too.
}
inline const char *authName(uint8_t auth) {
  switch (auth) {
    case WIFI_AUTH_OPEN: return "OPEN";
    case WIFI_AUTH_WEP: return "WEP";
    case WIFI_AUTH_WPA_PSK: return "WPA_PSK";
    case WIFI_AUTH_WPA2_PSK: return "WPA2_PSK";
    case WIFI_AUTH_WPA_WPA2_PSK: return "WPA_WPA2_PSK";
    case WIFI_AUTH_WPA2_ENTERPRISE: return "WPA2_ENTERPRISE";
    case WIFI_AUTH_WPA3_PSK: return "WPA3_PSK";
    case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2_WPA3_PSK";
    default: return "UNKNOWN";
  }
}
inline const char *reasonHint(uint16_t reason) {
  switch (reason) {
    case WIFI_REASON_NO_AP_FOUND: return "Target AP not found/eligible; inspect visibility, security and signal.";
    case WIFI_REASON_AUTH_FAIL: return "Authentication failed; this alone does not prove a wrong password.";
    case WIFI_REASON_AUTH_EXPIRE: return "Authentication expired/timed out or AP reported expiration.";
    case WIFI_REASON_ASSOC_FAIL: return "Association failed; inspect AP compatibility and rejection reason.";
    case WIFI_REASON_ASSOC_EXPIRE: return "Association timed out or AP reported inactivity.";
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT: return "Key exchange timed out; check credentials, security compatibility and signal.";
    case WIFI_REASON_BEACON_TIMEOUT: return "AP beacons lost; inspect signal, AP state and power stability.";
    case WIFI_REASON_ASSOC_LEAVE: return "May follow a local reconnect; compare [RETRY] timestamps, not password proof.";
    default: return "Keep the numeric reason and surrounding lines; cause is not yet established.";
  }
}
inline void onEvent(WiFiEvent_t kind, WiFiEventInfo_t info) {
  Event e{};
  e.kind = kind;
  e.atMs = millis();
  switch (kind) {
    case ARDUINO_EVENT_WIFI_STA_START:
    case ARDUINO_EVENT_WIFI_STA_STOP:
    case ARDUINO_EVENT_WIFI_STA_LOST_IP:
      break;
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      e.channel = info.wifi_sta_connected.channel;
      e.auth = static_cast<uint8_t>(info.wifi_sta_connected.authmode);
      memcpy(e.bssid, info.wifi_sta_connected.bssid, sizeof(e.bssid));
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      e.reason = info.wifi_sta_disconnected.reason;
      e.rssi = info.wifi_sta_disconnected.rssi;
      memcpy(e.bssid, info.wifi_sta_disconnected.bssid, sizeof(e.bssid));
      // Keep the latest reason even if the bounded log queue overflows.
      lastReason.store(e.reason);
      lastDisconnectAt.store(e.atMs);
      disconnectCount.fetch_add(1);
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      e.ip = info.got_ip.ip_info.ip.addr;
      e.gateway = info.got_ip.ip_info.gw.addr;
      break;
    case ARDUINO_EVENT_WIFI_STA_AUTHMODE_CHANGE:
      e.oldAuth = static_cast<uint8_t>(info.wifi_sta_authmode_change.old_mode);
      e.auth = static_cast<uint8_t>(info.wifi_sta_authmode_change.new_mode);
      break;
    default: return;
  }
  if (!events || xQueueSend(events, &e, 0) != pdTRUE) droppedEvents.fetch_add(1);
}
inline void begin() {
  events = xQueueCreate(12, sizeof(Event));
  if (!events) Serial.println("[WIFI-DIAG] event queue unavailable; periodic last-reason summary still enabled");
  WiFi.onEvent(onEvent);
  Serial.printf("[WIFI-DIAG] version=wifi-diag-v1 build=%s %s sdk=%s (password never logged)\n",
    __DATE__, __TIME__, ESP.getSdkVersion());
}
inline void printStartup(const char *ssid, bool modeOk, bool hostnameOk, bool sleepOk,
                         bool reconnectOk, wl_status_t initialStatus) {
  Serial.printf("[WIFI-DIAG] target_ssid=\"%s\" mac=%s mode_ok=%u hostname_ok=%u sleep_ok=%u autoreconnect_ok=%u\n",
    ssid, WiFi.macAddress().c_str(), modeOk, hostnameOk, sleepOk, reconnectOk);
  Serial.printf("[WIFI-DIAG] BEGIN return=%d(%s) auto_reconnect=%u power_save=%d; return is NOT connection success\n",
    int(initialStatus), statusName(initialStatus), WiFi.getAutoReconnect(), int(WiFi.getSleep()));
}
inline void drain() {
  if (!events) return;
  Event e{};
  // Never wait for an event or drain an unbounded burst in the main loop.
  for (uint8_t n = 0; n < 4 && xQueueReceive(events, &e, 0) == pdTRUE; ++n) {
    switch (e.kind) {
      case ARDUINO_EVENT_WIFI_STA_CONNECTED:
        Serial.printf("[WIFI-DIAG] at=%lu event=STA_CONNECTED channel=%u auth=%u(%s) bssid=%02X:%02X:%02X:%02X:%02X:%02X (link ready; wait for GOT_IP)\n",
          (unsigned long)e.atMs, e.channel, e.auth, authName(e.auth),
          e.bssid[0], e.bssid[1], e.bssid[2], e.bssid[3], e.bssid[4], e.bssid[5]);
        break;
      case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
        Serial.printf("[WIFI-DIAG] at=%lu event=STA_DISCONNECTED reason=%u(%s) event_rssi=%d bssid=%02X:%02X:%02X:%02X:%02X:%02X\n",
          (unsigned long)e.atMs, e.reason, reasonName(e.reason), int(e.rssi),
          e.bssid[0], e.bssid[1], e.bssid[2], e.bssid[3], e.bssid[4], e.bssid[5]);
        Serial.printf("[WIFI-DIAG] hint=%s\n", reasonHint(e.reason));
        break;
      case ARDUINO_EVENT_WIFI_STA_GOT_IP:
        Serial.printf("[WIFI-DIAG] at=%lu event=GOT_IP ip=%s gateway=%s (Wi-Fi/IP ready; PC HTTP is a separate stage)\n",
          (unsigned long)e.atMs, IPAddress(e.ip).toString().c_str(), IPAddress(e.gateway).toString().c_str());
        break;
      case ARDUINO_EVENT_WIFI_STA_AUTHMODE_CHANGE:
        Serial.printf("[WIFI-DIAG] at=%lu event=AUTHMODE_CHANGE old=%u(%s) new=%u(%s)\n",
          (unsigned long)e.atMs, e.oldAuth, authName(e.oldAuth), e.auth, authName(e.auth));
        break;
      default:
        Serial.printf("[WIFI-DIAG] at=%lu event=%s\n", (unsigned long)e.atMs, WiFi.eventName(e.kind));
        break;
    }
  }
}
inline void printStatus() {
  const auto status = WiFi.status();
  const uint32_t count = disconnectCount.load();
  const uint16_t reason = lastReason.load();
  Serial.printf("[WIFI-DIAG] status=%d(%s) last_reason=%u(%s) last_at=%lu disconnects=%lu dropped_events=%lu\n",
    int(status), statusName(status), reason, count ? reasonName(reason) : "NONE",
    (unsigned long)lastDisconnectAt.load(), (unsigned long)count, (unsigned long)droppedEvents.load());
  // last_reason is historical, including after recovery; it is not the current status.
}
} // namespace WifiDiagnostics
