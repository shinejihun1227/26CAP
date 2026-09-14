#pragma once
#ifndef STEPON_RIGHT_FOOT
#define STEPON_RIGHT_FOOT 0  // LEFT upload: 0. RIGHT upload: 1.
#endif
static_assert(STEPON_RIGHT_FOOT == 0 || STEPON_RIGHT_FOOT == 1, "Foot must be 0 or 1");
constexpr const char *FOOT_SIDE = STEPON_RIGHT_FOOT ? "right" : "left";
constexpr const char *DEVICE_HOSTNAME = STEPON_RIGHT_FOOT ? "stepon-right" : "stepon-left";
// Empty = the DHCP gateway (the PC when using a Windows hotspot).
// When using a router, set this to the PC's LAN IPv4 address instead.
constexpr const char *PC_HOST = "";
constexpr uint16_t PC_PORT = 8000;
constexpr bool WIFI_POWER_SAVE = false; // Low-latency polling. true trades latency for idle power saving.
constexpr uint8_t I2C_SDA = 6, I2C_SCL = 7;
constexpr uint8_t MUX_S0 = 1, MUX_S1 = 3, MUX_S2 = 4, MUX_S3 = 5, MUX_SIG = 0;
// SHTC3 has fixed address 0x70. The upstream TCA9548A must NOT also be 0x70.
constexpr uint8_t TCA_ADDRESS = 0x71;
constexpr uint8_t PRESSURE_CHANNELS[4] = {0, 2, 4, 6};
constexpr uint8_t THERMAL_CHANNELS[4] = {3, 4, 5, 6};
constexpr uint32_t IMU_INTERVAL_US = 15625, AUX_INTERVAL_MS = 50;
constexpr uint8_t LASER_PIN = 10;
constexpr bool ENABLE_LASER_OUTPUT = false; // Keep disabled until hardware safety verification.
