# StepOn 단계별 펌웨어 — C3 MINI / WROOM

00~05의 기존 번호 폴더는 ESP32-C3 MINI용 독립 펌웨어입니다. 추가한 **04_2는 WROOM-32/WROOM-DA의 Wi-Fi 양발 웹 연결용**, **06은 일반 ESP32-WROOM-32 + BMI270의 USB CSV 기록용**입니다. 04_2의 사용자 배선은 SDA13·SCL14, MUX 32·33·18·26, SIG34, 2N2222 제어27이며 사진의 GPIO25 선을 GPIO18로 옮겨 두 모듈에서 함께 사용할 수 있게 했습니다. 기존 `../esp32_c3_ap/`는 일반 ESP32용 레거시 스케치이므로 보존했습니다.

## 단계별 스케치

STA 양발 운영은 C3이면 [04_sta_bilateral](04_sta_bilateral/README.md), WROOM이면 [04_2_sta_bilateral_wroom](04_2_sta_bilateral_wroom/README.md)을 사용합니다. **WROOM의 핀·보드 선택은 4-2 안내를 따르세요. 아래 C3 핀맵과 업로드 설정을 그대로 사용하면 안 됩니다.** C3 주소 확인용 [05_i2c_scan](05_i2c_scan/README.md)은 진단 전용으로 Wi-Fi를 사용하지 않으며, 검사 후 C3의 04를 다시 업로드합니다. 아래 01~03은 기존 단계별 구현입니다.

보행 원본 CSV 수집은 [06_bmi270_csv_wroom](06_bmi270_csv_wroom/README.md)을 사용합니다. **ESP32 Dev Module / SDA21·SCL22 / 230400 baud / 100Hz 설정**으로, 기존 C3 GPIO6·7 배선이나 04 웹 연결과 혼동하지 마세요. PC의 `record.bat`이 CSV 파일을 저장합니다.

```text
stepon_c3/
├─ 01_sensor_test/      # 센서와 MUX 값 확인
├─ 02_wifi_api/         # Wi‑Fi + GET /api/state 확인
└─ 03_final/            # 센서 + API + 레이저·진동 출력
```

`01_sensor_test/sensor_core.h`는 센서 테스트의 기준 구현입니다. `02_wifi_api`는 해당 구현을 같은 폴더의 `sensor_core_local.h`에 포함하고, `03_final`도 자체 `sensor_core_local.h`를 사용합니다. Arduino 임시 빌드에서 다른 스케치 폴더를 찾지 못하는 문제를 피하기 위한 구조이므로, 공유할 때 각 단계 폴더의 `.ino`와 `.h` 파일을 함께 전달하세요. 센서 핀맵을 변경하면 사용하는 단계의 로컬 헤더도 함께 확인해야 합니다. 압력 MUX 전환 뒤 첫 ADC 변환을 버려 채널 잔상을 줄이는 동작은 유지합니다.

2번 Wi-Fi 테스트의 파일 구성과 실행 순서는 [02_wifi_api/README.md](./02_wifi_api/README.md)를 참고하세요.

## C3 MINI 핀맵

| GPIO | 기능 |
|---:|---|
| 0 | CD74HC4067 SIG / 압력 ADC |
| 1 | CD74HC4067 S0 |
| 3 | CD74HC4067 S1 |
| 4 | CD74HC4067 S2 |
| 5 | CD74HC4067 S3 |
| 6 | I²C SDA |
| 7 | I²C SCL |
| 10 | 레이저 BJT 제어 |

FSR406 4개는 P1 앞쪽=C0, P2 가운데 안쪽=C2, P3 가운데 바깥쪽=C4, P4 뒤꿈치=C6을 사용합니다. C8~C15는 사용하지 않습니다. 각 FSR에는 별도의 10 kΩ 풀다운 저항을 달아야 합니다(`3.3V → FSR → MUX 채널`, `MUX 채널 → 10 kΩ → GND`). 저항을 하나만 공유하거나 저항을 모두 빼면 다른 센서 값이 같이 오르거나 입력이 뜰 수 있습니다. TCA9548A는 A0/A1/A2=GND일 때 `0x70`, A0=3.3V·A1/A2=GND일 때 `0x71`이며, `01_sensor_test`는 두 주소를 자동 검색합니다. BMI270은 `0x68`, DRV2605L은 보통 `0x5A`입니다. SHTC3는 TCA 채널 3, 4, 5, 6에 하나씩 연결합니다.

## 업로드

1. Arduino IDE에서 `ESP32C3 Dev Module`, USB CDC On Boot `Enabled`, 시리얼 115200을 선택합니다.
2. 라이브러리 매니저에서 SparkFun BMI270 Arduino Library, Adafruit SHTC3, Adafruit DRV2605, Adafruit BusIO, Adafruit Unified Sensor를 설치합니다.
3. `01_sensor_test` → `02_wifi_api` → `03_final` 순서로 업로드하며 각 단계의 시리얼/API를 확인합니다. 시리얼 모니터는 115200 baud입니다.
4. `03_final`의 `ENABLE_LASER_OUTPUT 0`은 레이저 안전 확인 전까지 바꾸지 않습니다.

## 웹 연결

실제 센서값은 아래 주소로 8000 화면에 연결합니다.

```text
http://127.0.0.1:8000/?esp32=1&esp32Url=http%3A%2F%2F192.168.4.1
```

STA 모드라면 `192.168.4.1` 대신 시리얼 모니터에 출력된 ESP32 IP를 사용합니다. 현재는 한쪽 깔창 기준이라 `sensor_core.h`의 `FOOT_SIDE` 설정값(`left` 또는 `right`)을 JSON으로 반환합니다. 양발 실제 히트맵과 좌우 비교에는 오른발 측정계가 추가로 필요합니다. SHTC3가 일부만 응답하면 JSON의 `shtc3_ready`에 채널별 상태가 들어가며, 웹 앱은 해당 칸을 `--`로 표시합니다.

> 이 프로젝트는 연구용 관찰 프로토타입이며 당뇨병·파킨슨병의 진단·예방·치료를 제공하지 않습니다.
