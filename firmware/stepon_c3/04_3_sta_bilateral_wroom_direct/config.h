#pragma once
#include <Arduino.h>
// 4-3: four independent FSR inputs; no analog multiplexer.
constexpr uint8_t STEPON_SENSOR_PROFILE = 4;
#ifndef STEPON_RIGHT_FOOT
#define STEPON_RIGHT_FOOT 1  // LEFT upload: 0. RIGHT upload: 1.
#endif
static_assert(STEPON_RIGHT_FOOT == 0 || STEPON_RIGHT_FOOT == 1, "Foot must be 0 or 1");
constexpr const char *FOOT_SIDE = STEPON_RIGHT_FOOT ? "right" : "left";
constexpr const char *DEVICE_HOSTNAME = STEPON_RIGHT_FOOT ? "stepon-wroom-right" : "stepon-wroom-left";
// Empty uses the DHCP gateway: valid only when the laptop hosts the hotspot.
// Phone hotspot/router: enter the laptop's Wi-Fi IPv4, NOT the phone/gateway.
// Local phone-hotspot address; recheck with check-network.bat after reconnecting.
constexpr const char *PC_HOST = "10.23.57.153";
constexpr uint16_t PC_PORT = 8000;
constexpr bool WIFI_POWER_SAVE = false; // Low-latency polling. true trades latency for idle power saving.
// P1 front, P2 middle medial, P3 middle lateral, P4 heel.
// Remove the old CD74HC4067 S0/S1 wires from GPIO32/33 before using these inputs.
constexpr uint8_t PRESSURE_ADC_PINS[4] = {34, 35, 32, 33};
constexpr uint8_t I2C_SDA = 21, I2C_SCL = 22; // BMI270 + DRV2605L + upstream TCA9548A.
constexpr bool isPressureAdc1(uint8_t pin) {
  return pin == 32 || pin == 33 || pin == 34 || pin == 35 || pin == 36 || pin == 39;
}
static_assert(isPressureAdc1(PRESSURE_ADC_PINS[0]) && isPressureAdc1(PRESSURE_ADC_PINS[1]) &&
              isPressureAdc1(PRESSURE_ADC_PINS[2]) && isPressureAdc1(PRESSURE_ADC_PINS[3]),
              "All four pressure inputs must use exposed ADC1 pins for Wi-Fi");
static_assert(PRESSURE_ADC_PINS[0] != PRESSURE_ADC_PINS[1] && PRESSURE_ADC_PINS[0] != PRESSURE_ADC_PINS[2] &&
              PRESSURE_ADC_PINS[0] != PRESSURE_ADC_PINS[3] && PRESSURE_ADC_PINS[1] != PRESSURE_ADC_PINS[2] &&
              PRESSURE_ADC_PINS[1] != PRESSURE_ADC_PINS[3] && PRESSURE_ADC_PINS[2] != PRESSURE_ADC_PINS[3],
              "Each FSR requires its own ADC pin");
// SHTC3 has fixed address 0x70. The upstream TCA9548A must NOT also be 0x70.
constexpr uint8_t TCA_ADDRESS = 0x71;
// Logical P1..P4 indices for the web contract, NOT mux or ADC channel numbers.
constexpr uint8_t PRESSURE_CHANNELS[4] = {0, 1, 2, 3};
constexpr uint8_t THERMAL_CHANNELS[4] = {3, 4, 5, 6};
constexpr uint32_t IMU_INTERVAL_US = 15625, AUX_INTERVAL_MS = 50;
constexpr uint8_t LASER_PIN = 27; // Base resistor -> 2N2222 base (existing laser output).
constexpr bool ENABLE_LASER_OUTPUT = true; // GPIO27 -> transistor driver, never power a laser directly from GPIO.
constexpr uint32_t FOG_CUE_LEASE_MS = 1500;
constexpr uint8_t FOG_VIBRATION_LEVEL = 70; // DRV2605 real-time amplitude (0..127).
constexpr uint8_t FOG_VIBRATION_LEVEL_MAX = 127;
// Triple-stomp candidate; the PC checks it before suppressing both feet for 5 s.
constexpr float TAP_THRESHOLD_G = 2.2f;
constexpr uint32_t TAP_MIN_GAP_MS = 200;
constexpr uint32_t TAP_MAX_GAP_MS = 900;
constexpr uint32_t TAP_WINDOW_MS = 2000;
constexpr uint8_t TAP_REQUIRED = 3;
#if defined(BOARD_HAS_DUAL_ANTENNA)
constexpr bool isAntennaPin(uint8_t pin) { return pin == ANT1 || pin == ANT2; }
static_assert(!(isAntennaPin(I2C_SDA) || isAntennaPin(I2C_SCL) ||
                isAntennaPin(PRESSURE_ADC_PINS[0]) || isAntennaPin(PRESSURE_ADC_PINS[1]) ||
                isAntennaPin(PRESSURE_ADC_PINS[2]) || isAntennaPin(PRESSURE_ADC_PINS[3]) || isAntennaPin(LASER_PIN)),
              "WROOM-DA antenna GPIO2/25 must not be used for sensors or outputs");
#endif
