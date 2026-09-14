# 4-2 WROOM 검증 기록 — 2026-09-14

## 변경 범위

기존 C3 04와 별도 폴더에 WROOM 스케치를 추가했습니다. UART0 시리얼 초기화, WROOM 핀맵, 보드 대상 검사, 펌웨어 이름·장치 ID·호스트 이름을 변경했습니다. 센서 처리와 Wi-Fi 진단 헤더는 기존 04와 바이트 단위로 동일합니다. 기존 04의 모든 직접 파일은 작업 전후 SHA-256이 같습니다.

웹 수집 서버는 기존 C3와 새로운 WROOM 펌웨어 두 이름을 허용합니다. 발·장치 ID·STA 모드·압력 채널·IMU 유효성 검사를 유지합니다. 모델 가중치나 점수 계산은 변경하지 않았습니다.

## 실제 Arduino 컴파일

Windows의 Arduino CLI 1.2.0, Arduino ESP32 2.0.11, SparkFun BMI270 1.0.3, Adafruit DRV2605 1.2.4, Adafruit BusIO 1.17.4를 사용했습니다. 두 빌드 모두 종료 코드 0입니다.

| 보드 / FQBN | 발 설정 | Flash | 정적 RAM | 결과 |
|---|---|---:|---:|---|
| ESP32 Dev Module / `esp32:esp32:esp32:DebugLevel=none` | LEFT, 기본 0 | 853,473 bytes (65%) | 46,056 bytes (14%) | 성공 |
| ESP32-WROOM-DA Module / `esp32:esp32:esp32da:DebugLevel=none` | RIGHT, 빌드 옵션 1 | 854,801 bytes (65%) | 46,056 bytes (14%) | 성공 |

빌드 대상은 `firmware/stepon_c3/04_2_sta_bilateral_wroom`이며, DA 오른발 빌드는 `--build-property "compiler.cpp.extra_flags=-DSTEPON_RIGHT_FOOT=1"`을 사용했습니다. 배포한 `config.h`의 기본값은 왼발 0입니다. 정적 RAM 수치는 런타임 최대 메모리 사용량을 뜻하지 않습니다. 컴파일 산출물과 로컬 Wi-Fi 암호는 Git에 포함하지 않습니다.

## 자동 검사 133 / 133 통과

저장소 최상위에서:

```powershell
node --test --test-concurrency=1 cap_web/tests/*.test.mjs firmware/stepon_c3/04_sta_bilateral/tests/wifi-diagnostics.test.mjs
```

- 웹·데이터·연동 검사 125개, 기존 04 Wi-Fi 진단 회귀 검사 8개. 실패·건너뜀 0개.
- C3와 WROOM 프레임을 모두 수용하고, 다른 펌웨어·AP 모드·잘못된 압력 채널·유효하지 않은 IMU를 거부합니다.
- HTTP 자동 등록은 두 펌웨어를 모두 받고 요청한 보드의 IP를 사용합니다. USB 수집용 06 등록은 거부합니다.
- 왼발 C3 / 오른발 WROOM 형식의 **합성 센서 데이터**를 수집 서버 → 실제 Python 브리지 → 저장소의 RF/CNN 가중치 → 웹 프록시로 전달하여 양발 추론과 연결 단절 처리를 검증했습니다. 실제 착용 측정은 아닙니다.
- 별도 임시 CSV 업로드 → 개인 보정 → 실제 RF/CNN 작업 → 결과 다운로드 검사가 통과했습니다. 테스트의 기록·보정은 임시 폴더를 사용합니다.
- 실행 중 기록·분석·보정이 없는 것을 확인하고 로컬 웹 8000·8001을 갱신했습니다. `/data/` HTTP 200, AI API 응답을 확인했습니다. 실제 보정이 없는 상태는 `calibration_missing`, 점수는 `null`로 유지됩니다.

## 하드웨어 확인 범위

보드에 업로드하지 않았습니다. WROOM 실물의 배선, I²C 센서 응답, Wi-Fi 접속·실제 수신률, 진동 출력, 착용 시 모델 정확도는 아직 확인하지 않았습니다. [README의 배선·업로드 절차](README.md)를 따라 확인하세요.
