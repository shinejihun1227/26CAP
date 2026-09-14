# StepOn 펌웨어 선택

실제 보드와 수집 방식에 맞는 폴더의 `.ino`를 여세요. 폴더 이름에 stepon_c3가 있어도 4-2와 06은 WROOM용입니다.

| 보드·목적 | 스케치와 안내 | Arduino 보드 선택 |
|---|---|---|
| ESP32-C3 MINI · Wi-Fi 양발 웹·AI | [04_sta_bilateral](04_sta_bilateral/README.md) | ESP32C3 Dev Module |
| ESP32-WROOM-32 · Wi-Fi 양발 웹·AI | [04_2_sta_bilateral_wroom](04_2_sta_bilateral_wroom/README.md) | ESP32 Dev Module |
| ESP32-WROOM-DA · Wi-Fi 양발 웹·AI | [04_2_sta_bilateral_wroom](04_2_sta_bilateral_wroom/README.md) | ESP32-WROOM-DA Module |
| ESP32-WROOM-32 · BMI270 USB CSV 수집 | [06_bmi270_csv_wroom](06_bmi270_csv_wroom/README.md) | ESP32 Dev Module |

**C3와 WROOM은 배선이 다릅니다.** 4-2는 사용자 배선표에 따라 I²C GPIO13·14, 압력 MUX S0/S1/S2/S3 GPIO32·33·18·26, SIG GPIO34, 2N2222 제어 GPIO27을 사용합니다. 사진의 GPIO25=MUX S2 선만 GPIO18로 옮겨 WROOM-32와 WROOM-DA의 공통 핀맵으로 사용합니다. 각 폴더의 배선표·왼발/오른발 설정을 확인하고 `.ino`와 헤더 파일을 함께 사용하세요.

기존 [03_final](03_final/README.md)은 이전 구현으로 보존되어 있습니다. 현재 웹·AI 실행은 [전체 실행 안내](../../docs/RUNNING.md)를 따릅니다.
