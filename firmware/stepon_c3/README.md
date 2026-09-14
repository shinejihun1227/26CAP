# StepOn 펌웨어 선택

실제 보드와 수집 방식에 맞는 폴더의 `.ino`를 여세요. 폴더 이름에 stepon_c3가 있어도 4-2와 06은 WROOM용입니다.

| 보드·목적 | 스케치와 안내 | Arduino 보드 선택 |
|---|---|---|
| ESP32-C3 MINI · Wi-Fi 양발 웹·AI | [04_sta_bilateral](04_sta_bilateral/README.md) | ESP32C3 Dev Module |
| ESP32-WROOM-32 · Wi-Fi 양발 웹·AI | [04_2_sta_bilateral_wroom](04_2_sta_bilateral_wroom/README.md) | ESP32 Dev Module |
| ESP32-WROOM-DA · Wi-Fi 양발 웹·AI | [04_2_sta_bilateral_wroom](04_2_sta_bilateral_wroom/README.md) | ESP32-WROOM-DA Module |
| ESP32-WROOM-32 · BMI270 USB CSV 수집 | [06_bmi270_csv_wroom](06_bmi270_csv_wroom/README.md) | ESP32 Dev Module |

**C3와 WROOM은 배선이 다릅니다.** 4-2의 I²C는 GPIO21·22, 압력 ADC는 GPIO34입니다. 각 폴더의 배선표·왼발/오른발 설정을 확인하고 `.ino`와 헤더 파일을 함께 사용하세요.

기존 [03_final](03_final/README.md)은 이전 구현으로 보존되어 있습니다. 현재 웹·AI 실행은 [전체 실행 안내](../../docs/RUNNING.md)를 따릅니다.
