#pragma once
#define STEPON_SENSOR_PROFILE_2 2
#define STEPON_SENSOR_PROFILE_4 4
#ifndef STEPON_SENSOR_PROFILE
// Choose 2 or 4. Both feet use the same profile; upload each board with its FOOT_SIDE setting.
#define STEPON_SENSOR_PROFILE STEPON_SENSOR_PROFILE_4
#endif
static_assert(STEPON_SENSOR_PROFILE == STEPON_SENSOR_PROFILE_2 || STEPON_SENSOR_PROFILE == STEPON_SENSOR_PROFILE_4,
              "STEPON_SENSOR_PROFILE must be 2 or 4");
#ifndef STEPON_RIGHT_FOOT
#define STEPON_RIGHT_FOOT 0  // LEFT upload: 0. RIGHT upload: 1.
#endif
static_assert(STEPON_RIGHT_FOOT == 0 || STEPON_RIGHT_FOOT == 1, "Foot must be 0 or 1");
constexpr const char *FOOT_SIDE = STEPON_RIGHT_FOOT ? "right" : "left";
constexpr const char *DEVICE_HOSTNAME = STEPON_RIGHT_FOOT ? "stepon-wroom-right" : "stepon-wroom-left";
// Empty uses the DHCP gateway: valid only when the laptop hosts the hotspot.
// Phone hotspot/router: enter the laptop's Wi-Fi IPv4, NOT the phone/gateway.
// Local phone-hotspot address; recheck with check-network.bat after reconnecting.
constexpr const char *PC_HOST = "172.20.10.2";
constexpr uint16_t PC_PORT = 8000;
constexpr bool WIFI_POWER_SAVE = false; // Low-latency polling. true trades latency for idle power saving.
// Four-sensor wiring: MUX S2 -> GPIO4; pressure sensors -> C0/C2/C4/C6.
// Keep DA antenna pins 2/25, flash pins 6..11, UART0 1/3 and boot strapping pins free.
constexpr uint8_t I2C_SDA = 13, I2C_SCL = 14;
constexpr uint8_t MUX_S0 = 32, MUX_S1 = 33, MUX_S2 = 4, MUX_S3 = 26;
constexpr uint8_t MUX_SIG = 34; // ADC1 input: usable while Wi-Fi runs; no internal pull-up.
constexpr uint8_t PRESSURE_ADC_PINS[2] = {34, 35};
constexpr uint8_t THERMAL2_SDA = 21, THERMAL2_SCL = 22;
static_assert(MUX_SIG >= 32 && MUX_SIG <= 39, "Pressure input must use ADC1 with Wi-Fi");
// SHTC3 has fixed address 0x70. The upstream TCA9548A must NOT also be 0x70.
constexpr uint8_t TCA_ADDRESS = 0x71;
constexpr uint8_t PRESSURE_CHANNELS[4] = {0, 2, 4, 6};
constexpr uint8_t THERMAL_CHANNELS[4] = {3, 4, 5, 6};
constexpr uint32_t IMU_INTERVAL_US = 15625, AUX_INTERVAL_MS = 50;
constexpr uint8_t LASER_PIN = 27; // Base resistor -> 2N2222 base (existing laser output).
constexpr bool ENABLE_LASER_OUTPUT = true; // GPIO27 -> transistor driver, never power a laser directly from GPIO.
constexpr uint32_t FOG_CUE_LEASE_MS = 1500;
constexpr uint8_t FOG_VIBRATION_LEVEL = 70; // DRV2605 real-time amplitude (0..127).
#if defined(BOARD_HAS_DUAL_ANTENNA)
constexpr bool isAntennaPin(uint8_t pin) { return pin == ANT1 || pin == ANT2; }
static_assert(!(isAntennaPin(I2C_SDA) || isAntennaPin(I2C_SCL) ||
                isAntennaPin(MUX_S0) || isAntennaPin(MUX_S1) ||
                isAntennaPin(MUX_S2) || isAntennaPin(MUX_S3) ||
                isAntennaPin(MUX_SIG) || isAntennaPin(LASER_PIN)),
              "WROOM-DA antenna GPIO2/25 must not be used for sensors or outputs");
#endif
