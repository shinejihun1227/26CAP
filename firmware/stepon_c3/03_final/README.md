# 03_final — ESP32-C3 최종 스케치

Arduino IDE에서 `03_final.ino`를 엽니다. 다음 3개 파일이 **동일한 `03_final` 폴더**에 있어야 합니다.

- `03_final.ino`: Wi-Fi AP/STA, HTTP API, 샘플링 루프, 출력 제어.
- `sensor_core.h`: 같은 폴더의 센서 구현 헤더 연결.
- `sensor_core_local.h`: 핀맵, 센서 초기화/읽기, JSON 직렬화.

`01_...`/`02_...` 폴더나 외부 공유 헤더는 필요하지 않습니다.

## Arduino 설정

- ESP32 Arduino 보드 패키지, 보드 **ESP32C3 Dev Module**.
- USB CDC On Boot: Enabled. 실제 장치 포트 선택.
- 시리얼 모니터: 115200 baud.
- 라이브러리: SparkFun BMI270 Arduino Library, Adafruit SHTC3, Adafruit DRV2605 Library 및 의존 라이브러리 Adafruit BusIO/Unified Sensor.

대상은 ESP32-C3입니다. 일반 ESP32 개발보드 핀 배치로 그대로 연결하지 마세요.

## 현재 코드의 배선 설정

| 부품/신호 | 설정 |
|---|---|
| I2C SDA / SCL | GPIO 6 / 7 |
| CD74HC4067 S0 / S1 / S2 / S3 | GPIO 1 / 3 / 4 / 5 |
| CD74HC4067 SIG | GPIO 0 |
| 압력 P1~P8 | MUX 채널 0, 2, 4, 6, 8, 10, 12, 14 |
| SHTC3 4개 | TCA9548A 채널 3, 4, 5, 6 |
| TCA9548A 주소 | 0x70 우선, 0x71 대체 탐색 |
| BMI270 / DRV2605L | 공통 I2C의 0x68 / 0x5A |
| 레이저 신호 | GPIO 10, 코드에서 기본 비활성 |
| 발 방향 표시 | `FOOT_SIDE="left"`, 한 발 센서 |

**코드에 정의된 값**입니다. 실제 PCB·모듈과 일치하는지 전원 투입 전에 확인해야 합니다. 모터/레이저를 GPIO 전원으로 직접 구동하지 마세요.

## 부팅과 Wi-Fi

현재 순서: 전원 → Serial → `initSensorCore()` → `startNetwork()` → HTTP API 시작.

`WIFI_SSID`, `WIFI_PASSWORD`가 비어 있으면 `StepOn-C3` AP를 만듭니다. 기본 시연 암호는 `stepon1234`입니다. 외부 AP 설정이 있으면 최대 15초 STA 연결을 시도하고 실패 시 AP로 전환합니다. 실제 네트워크 암호를 넣은 파일은 Git에 커밋하지 마세요.

센서 초기화가 멈추면 AP 생성 코드까지 도달하지 못할 수 있습니다. 현재 `WiFi.softAP()` 반환값도 확인하지 않아 SSID/IP 출력만으로 성공을 단정할 수 없습니다. [미해결 상태](../../../docs/KNOWN_LIMITATIONS.md)를 함께 읽어주세요.

## API와 안전 기본값

- `GET /api/ping`, `GET /api/state`: 진단/최신 센서 값.
- `GET /api/vibrate?effect=47`: 진동 실행 요청.
- `GET /api/laser?on=1`: 레이저 요청. 기본 컴파일 옵션에서는 실제 출력 안 함.
- `GET /api/auto-cue?enabled=1`: 펌웨어 단순 규칙 자동 큐. **PC RF/CNN 판정과 다름**.
- `GET /api/calibrate`: 안내 응답만 반환. 실제 보정 저장 미구현.

`ENABLE_LASER_OUTPUT=0`, `autoCueEnabled=false`를 유지했습니다. 안전 확인 없이 자동 출력을 켜지 마세요. IMU는 64 Hz 목표, 압력/온습도 읽기는 50 ms 목표 간격이며 실측 보장이 아닙니다.
