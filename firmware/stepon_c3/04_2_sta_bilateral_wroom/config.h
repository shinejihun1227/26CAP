#pragma once
#ifndef STEPON_RIGHT_FOOT
#define STEPON_RIGHT_FOOT 0  // LEFT upload: 0. RIGHT upload: 1.
#endif
static_assert(STEPON_RIGHT_FOOT == 0 || STEPON_RIGHT_FOOT == 1, "Foot must be 0 or 1");
constexpr const char *FOOT_SIDE = STEPON_RIGHT_FOOT ? "right" : "left";
constexpr const char *DEVICE_HOSTNAME = STEPON_RIGHT_FOOT ? "stepon-wroom-right" : "stepon-wroom-left";
// Empty = the DHCP gateway (the PC when using a Windows hotspot).
// When using a router, set this to the PC's LAN IPv4 address instead.
constexpr const char *PC_HOST = "";
constexpr uint16_t PC_PORT = 8000;
constexpr bool WIFI_POWER_SAVE = false; // Low-latency polling. true trades latency for idle power saving.
// GPIO numbers on WROOM-32 / WROOM-DA development boards.
// Keep flash pins 6..11, UART0 pins 1/3, strapping pins and DA antenna pins 2/25 free.
constexpr uint8_t I2C_SDA = 21, I2C_SCL = 22;
constexpr uint8_t MUX_S0 = 16, MUX_S1 = 17, MUX_S2 = 18, MUX_S3 = 19;
constexpr uint8_t MUX_SIG = 34; // ADC1 input: usable while Wi-Fi runs; no internal pull-up.
static_assert(MUX_SIG >= 32 && MUX_SIG <= 39, "Pressure input must use ADC1 with Wi-Fi");
// SHTC3 has fixed address 0x70. The upstream TCA9548A must NOT also be 0x70.
constexpr uint8_t TCA_ADDRESS = 0x71;
constexpr uint8_t PRESSURE_CHANNELS[4] = {0, 2, 4, 6};
constexpr uint8_t THERMAL_CHANNELS[4] = {3, 4, 5, 6};
constexpr uint32_t IMU_INTERVAL_US = 15625, AUX_INTERVAL_MS = 50;
constexpr uint8_t LASER_PIN = 23;
constexpr bool ENABLE_LASER_OUTPUT = false; // Keep disabled until hardware safety verification.
