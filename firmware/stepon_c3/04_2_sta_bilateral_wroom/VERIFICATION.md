# 4-2 WROOM 검증 기록 — 2026-09-14

## 최종 공통 핀맵 변경

사용자가 제공한 배선표에서 MUX S2만 GPIO25 → GPIO18로 옮겨 WROOM-32와 WROOM-DA의 공통 핀맵으로 정리했습니다. 최종 핀은 SDA13 / SCL14, MUX S0·S1·S2·S3 = 32·33·18·26, 압력 ADC34, 2N2222 제어27입니다. 레이저 출력은 기본 비활성화를 유지합니다.

GPIO2·25(DA 안테나), GPIO6~11(플래시), GPIO1·3(UART0), GPIO0·2·5·12·15(부팅 설정)를 센서·출력 핀에서 제외했습니다. 할당한 8개 GPIO에는 중복이 없고 압력 입력은 ADC1을 사용합니다. DA 설정에서 안테나 핀을 센서·출력에 잘못 배정하면 static_assert로 컴파일을 중단합니다.

## 이번 변경의 검증 결과

Arduino CLI 1.2.0 / ESP32 core 2.0.11과 기존 설치 라이브러리로 최종 코드의 전체 빌드를 확인했습니다. 아래는 GPIO18 공통 핀맵의 결과이며, 변경 도중 GPIO25를 썼던 빌드는 포함하지 않습니다.

| 최종 보드 설정 | 발 | Flash | 정적 RAM | 결과 |
|---|---|---:|---:|---|
| ESP32 Dev Module (`esp32:esp32:esp32:DebugLevel=none`) | 왼발 0 | 853,473 bytes (65%) | 46,056 bytes (14%) | 성공, 종료 코드 0 |
| ESP32-WROOM-DA Module (`esp32:esp32:esp32da:DebugLevel=none`) | 오른발 1 | 854,801 bytes (65%) | 46,056 bytes (14%) | 성공, 종료 코드 0 |

오른발 빌드는 `--build-property "compiler.cpp.extra_flags=-DSTEPON_RIGHT_FOOT=1"`로 확인했으며 저장된 기본 설정은 왼발 0입니다. Arduino가 추가한 `#line` 지시문을 제외하면 두 빌드의 config·센서·Wi-Fi 헤더는 현재 소스와 동일합니다.

- ESP32 C++ 컴파일러로 핀 설정 검사를 별도로 실행했습니다. 현재 왼발·오른발 설정은 통과했고, 테스트용 복사본에서 MUX S2=25 또는 출력=2로 변경하면 안테나 충돌 문구와 함께 실패했습니다. 테스트의 DA 상수 ANT1=2 / ANT2=25는 설치된 보드 정의를 따랐습니다.
- `pinmap-summary.png`를 config.h의 실제 값으로 생성하고 표기와 이미지 잘림 여부를 확인했습니다. GPIO 번호를 기능별로 정리한 연결도이며 실물 보드의 핀 위치 배열도가 아닙니다.
- 기존 C3 04는 작업 전후 해시가 동일합니다. 센서 처리, Wi-Fi 비밀번호, API·웹·AI 모델 처리는 변경하지 않았습니다. 이번에는 핀 설정·충돌 검사·안내문·요약도를 변경했습니다.
- 웹·AI 전체 133개 검사는 아래 최초 4-2 생성 시 통과한 기록입니다. 핀 변경 후에는 해당 검사를 다시 실행하지 않았고 위의 컴파일과 핀 검사를 수행했습니다.
- 보드 업로드, 배선 이동, 무선 접속·센서·출력 실측은 수행하지 않았습니다. 전체 전원·부하 회로의 안전성 검증은 별도입니다.

---

## 참고: 최초 4-2 생성 시 검증 (핀 변경 전)

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
