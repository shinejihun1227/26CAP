# 04 — STA 전용 양발 / 노트북 핫스팟

기존 00·01·02·03 스케치는 변경하지 않습니다. 이 폴더에는 AP 생성이나 AP 폴백이 없습니다.
센서는 한 발마다 압력 4개, SHTC3 4개, BMI270 1개입니다.

## 파일

- `04_sta_bilateral.ino`: Wi-Fi 접속·재접속, HTTP API, PC 자동 등록, 센서 작업 분리.
- `config.h`: 왼발/오른발 선택, 핀, PC 주소, 절전 설정. 양발을 구분하는 유일한 수정 지점입니다.
- `wifi_secrets.h`: 사진의 핫스팟 이름·암호를 입력한 로컬 파일. Git에서 제외합니다.
- `wifi_secrets.example.h`: 다른 사람에게 공유할 예제. 실제 암호를 넣고 `wifi_secrets.h`로 복사하세요.
- `sensor_core.h`: 이 스케치 전용 센서 처리. 다른 스케치 폴더가 없어도 컴파일됩니다.
- `wifi_diagnostics.h`: Wi-Fi 이벤트·실패 사유·IP 할당 진단 로그. 암호는 출력하지 않습니다.

## 최초 실행 순서

1. 노트북을 기존 인터넷에 연결하고 Windows 모바일 핫스팟을 켭니다. 공유 방식 Wi-Fi, 대역 2.4GHz, 이름 StepOn. 암호는 로컬 secrets 파일과 일치시킵니다. 핫스팟 절전 자동 종료는 끕니다.
2. 프로젝트 루트의 `run.bat` 실행. 8000은 양발 수집 서버+사용자 웹, 8001은 편집 화면입니다. Node의 방화벽 허용이 필요하면 신뢰하는 로컬 네트워크에 한해 허용하세요. 방화벽 전체를 끄지 마세요.
3. Arduino IDE에서 **이 폴더의 ino**를 엽니다. 보드 ESP32C3 Dev Module, USB CDC On Boot Enabled, 시리얼 115200. 현재 검증 환경은 Arduino ESP32 2.0.11입니다.
4. `config.h`의 `#define STEPON_RIGHT_FOOT 0`으로 **왼발 보드**에 업로드합니다.
5. 같은 줄을 `1`로 바꾼 뒤 **오른발 보드**에 업로드합니다. COM 포트와 보드를 반드시 확인하세요. 두 보드 모두 0이면 오른발이 아니라 왼발 충돌로 거부됩니다.
6. 시리얼에서 `STA connected foot=left/right IP=...`와 `[PC] registration HTTP=200` 확인.
7. `http://127.0.0.1:8000/?view=live&esp32=1&transport=sta&ai=0&mobile=0`에서 양발 값 확인. `기기 관리`에서 주소와 상태를 자세히 볼 수 있습니다.

필요한 Arduino 라이브러리: SparkFun BMI270 Arduino Library, Adafruit DRV2605 Library 및 라이브러리 관리자가 설치하는 의존성. SHTC3 읽기는 이 코드의 제한시간/CRC 확인 방식으로 처리합니다.

## 핀·주소

| 대상 | 설정 |
|---|---|
| I²C | SDA GPIO6 / SCL GPIO7 |
| 압력 MUX S0/S1/S2/S3 | GPIO1 / GPIO3 / GPIO4 / GPIO5 |
| 압력 MUX SIG | GPIO0 (ADC1) |
| 압력 4채널 | C0 앞쪽 / C2 가운데 안쪽 / C4 가운데 바깥쪽 / C6 뒤꿈치 |
| SHTC3 4개 | I²C MUX CH3 / CH4 / CH5 / CH6 |
| TCA9548A | **0x71** (보드의 주소 설정을 확인) |
| BMI270 / DRV2605L | 0x68 / 0x5A |
| 레이저 | GPIO10, 기본 비활성화 |

**중요:** SHTC3 주소는 0x70으로 고정됩니다. 상위 TCA9548A도 0x70이면 선택된 SHTC3와 주소가 충돌하므로, 04는 TCA 0x71을 사용합니다. TCA의 일반적인 주소 설정은 A0=High, A1/A2=Low가 0x71입니다. 실제 모듈 설명을 확인하고 전원을 완전히 분리한 뒤 주소 스트랩을 변경하세요. 소프트웨어 값만 바꿔서는 하드웨어 주소가 바뀌지 않습니다. 0x71이 없으면 온습도는 미연결로 표시하지만 Wi-Fi는 계속 동작합니다.

압력 `ready`는 ADC 읽기 상태이지 FSR의 물리적 연결 검사가 아닙니다. 빠진 센서의 부유 입력이나 배선 오류는 별도 확인해야 합니다. GPIO에 5V를 넣지 마세요. 센서 결선 변경은 USB·배터리를 모두 분리한 상태에서 합니다.

## 연결 원리 / 자동 등록 실패 시

ESP32는 DHCP로 IP를 받습니다. PC 핫스팟의 DHCP 게이트웨이를 PC 주소로 사용하여 8000번 `/api/insoles/register`에 자신의 side/device_id를 5초마다 알립니다. 암호는 전송하지 않습니다. 센서 데이터는 **PC가 각 ESP32의 GET /api/state를 요청**해서 가져옵니다.

- PC 서버가 늦게 시작되어도 다음 등록 주기에 연결됩니다.
- 핫스팟이 꺼져도 STA로 재시도하며 AP를 만들지 않습니다.
- IP가 바뀌면 기존 주소가 오프라인인 것을 확인한 뒤 같은 device_id로 재등록합니다.
- 공유기를 대신 쓰면 게이트웨이는 PC가 아닙니다. 이 경우 config.h의 PC_HOST에 PC IPv4 주소를 입력하세요.
- 자동 등록 HTTP 실패: `run.bat`, TCP 8000 방화벽, PC_HOST를 확인하세요. 기기 관리에서 시리얼의 ESP32 IP를 `http://...`로 직접 등록할 수도 있습니다.
- 다른 보드로 교체할 때 `기기 관리 → IP 직접 등록 / 기기 교체 → 등록 해제`. 기존 보드는 먼저 전원을 끄세요.

## 측정 주기와 한계

- BMI270 자체 ODR 100Hz, 소프트웨어 최신값 읽기 목표 64Hz. 센서 Task의 실제 실행률을 `actual_sample_hz`로 표시합니다.
- 압력 및 온습도 목표 20Hz. SHTC3의 변환 시작과 결과 읽기를 분리하고 CRC/10ms I²C 타임아웃을 확인하여 무한 대기하지 않습니다.
- PC는 발마다 최대 목표 64회/초 최신 상태를 조회합니다. 느린 요청이 겹치거나 쌓이지 않으며 한 발의 실패가 다른 발의 수집을 막지 않습니다.
- **64Hz 무손실 전송 보장이 아닙니다.** latest-only API라 건너뛴 frame은 복구되지 않습니다. 실제 수신 Hz, 누락 frame, 센서 일정 지연, 재부팅 수를 확인하세요.
- 웹 표시 갱신은 250ms입니다. 탭을 여러 개 열어도 PC→ESP32 수집 루프는 8000 서버의 두 개뿐입니다. 8001 API는 8000 캐시를 공유합니다.
- 2초 동안 frame이 전진하지 않거나 요청이 실패하면 그 발의 압력·온습도·IMU를 숨깁니다. 샘플데이터로 대체하지 않습니다.
- 두 보드의 millis는 서로 다른 시계입니다. 현재 양발 비교는 PC 수신 기준이며 정밀 보행 위상 동기화·임상 검증이 아닙니다.
- 절전은 지연을 줄이기 위해 기본 꺼짐입니다. WIFI_POWER_SAVE=true는 평균 전력을 줄일 여지가 있지만 수신 지연과 실측 주기를 다시 확인해야 합니다. STA만으로 전원 부족을 해결하지는 못합니다.

## 출력과 AI

웹의 분석·출력 대상 발을 선택하면 수동 진동·레이저 명령은 그 발에만 전달됩니다. 레이저는 ENABLE_LASER_OUTPUT=false가 기본입니다. Wi-Fi 연결이 끊기면 자동 진동 설정과 레이저는 해제됩니다.

자동 진동은 기존 압력+자이로 휴리스틱이며 기본 꺼짐입니다. **04 펌웨어가 RF/CNN을 실행하는 것은 아닙니다.** 실제 모델은 PC의 별도 AI 브리지에서 실행합니다. 이 변경은 양발 센서 수집·표시이며 양발 학습 모델이나 점수 융합을 새로 만든 것이 아닙니다.

기존 단일 발 AI 브리지에 입력할 때는 두 발을 합치지 말고, 필요한 발의 PC 캐시 경로를 지정할 수 있습니다.

```powershell
python web/ai_bridge/server.py --esp32-url http://127.0.0.1:8000/api/insoles/right --calibration <오른발용_보정파일>
```

브리지가 뒤에 `/api/state`를 붙이면 오른발만 반환되고 오프라인이면 503입니다. 왼발은 경로를 left로 바꾸고 해당 발의 보정파일을 사용하세요. 기본 실행 URL은 ai=0이며, AI 검증 후에만 ai=1로 명시적으로 켭니다. 재부팅·장시간 단절 후 기존 AI 브리지의 윈도우도 새로 시작해야 하므로 AI 브리지를 재시작하세요. 정밀 추론 검증 전 출력과 자동 연결하지 마세요.

## Wi-Fi 상세 진단 — wifi-diag-v1

2026-09-12 추가. **진단 모듈 자체는 연결 설정을 바꾸지 않는 원인 확인용 로그**입니다. 센서·API·PC 등록, 기존 자동 재접속과 15초 재시도는 유지했습니다. AP 생성, 추가 스캔, 채널/보안 설정 변경, 저장된 네트워크 삭제는 하지 않습니다. 송신 출력 제한은 아래 설명처럼 메인 스케치에서 별도로 적용합니다.

1. `04_sta_bilateral.ino`를 열고 이 폴더의 `wifi_diagnostics.h`가 함께 있는지 확인합니다. ino만 따로 복사하지 마세요.
2. ESP32C3 Dev Module / USB CDC On Boot Enabled / `config.h`의 왼발 0·오른발 1 확인 후 다시 업로드합니다. PC 파일 수정만으로 보드에 반영되지는 않습니다.
3. 시리얼 모니터 **115200**으로 열고 RST를 한 번 누릅니다. BOOT는 누르지 않습니다.
4. `[WIFI-DIAG] version=wifi-diag-v1`부터 30~40초 동안의 `[WIFI-DIAG]`, `[STATE]`, `[PC]` 줄을 함께 확인합니다. `Core Debug Level`은 None이어도 이번 로그가 출력됩니다.

출력 형식 예시입니다. 아래 이유 번호는 현재 보드에서 실제 확인한 결과가 아닙니다.

```text
[WIFI-DIAG] version=wifi-diag-v1 build=... sdk=...
[WIFI-DIAG] target_ssid="StepOn" mac=... mode_ok=1 hostname_ok=1 sleep_ok=1 autoreconnect_ok=1
[WIFI-DIAG] at=... event=STA_DISCONNECTED reason=202(AUTH_FAIL) event_rssi=... bssid=...
[WIFI-DIAG] status=4(CONNECT_FAILED) last_reason=202(AUTH_FAIL) last_at=... disconnects=... dropped_events=0
```

- `status=4/6`은 현재 Arduino 연결 상태이고, `reason=...`은 이벤트의 **별도 실패 사유**입니다. 둘의 숫자를 같은 코드로 해석하지 마세요.
- `STA_CONNECTED`: 무선 연결 단계 완료. 이어서 `GOT_IP`가 나와야 IP 통신 준비가 완료됩니다. `[PC] registration HTTP=200`은 그 다음 별도 웹 등록 단계입니다.
- `NO_AP_FOUND`: 대상 AP를 찾지 못했거나 연결 가능한 후보로 선택하지 못함. 대역뿐 아니라 신호·보안 설정도 확인 대상입니다.
- `AUTH_FAIL`: 인증 실패. **이 코드 하나만으로 암호가 틀렸다고 확정하지 않습니다.**
- `HANDSHAKE_TIMEOUT` / `4WAY_HANDSHAKE_TIMEOUT`: 키 교환 제한시간 초과. 암호·보안 호환성·신호 상태를 확인합니다.
- `ASSOC_FAIL` / `ASSOC_EXPIRE`: AP 연결 협상 실패/만료. `BEACON_TIMEOUT`: AP 신호를 연속으로 놓침.
- `[RETRY]`: 기존 15초 타이머의 재시도 시각과 호출 결과. 이 재시도 자체나 라이브러리 자동 재접속도 연결 해제 이벤트를 발생시킬 수 있으므로, 주변 줄과 시각을 함께 봅니다. `call_ok=1`은 접속 성공을 뜻하지 않습니다.
- `last_reason` / `last_at`은 **부팅 이후 마지막 해제 이벤트의 과거 기록**이며, 연결 회복 후에도 남습니다. 늦게 시리얼 모니터를 열어도 2초 요약에서 확인할 수 있습니다. `at`/`last_at`은 부팅 후 밀리초입니다.
- `event_rssi`는 드라이버가 이벤트에 넣은 값입니다. 접속 전 실패에서 0이나 유효하지 않은 값일 수 있으므로 항상 신호 세기 실측으로 해석하지 마세요. 채널·보안 방식은 `STA_CONNECTED`에 도달했을 때 출력되며 실패한 AP를 능동 스캔한 결과가 아닙니다.
- `dropped_events`가 0보다 크면 큐가 차거나 생성되지 않아 일부 개별 로그를 놓친 것입니다. 마지막 해제 사유·누적 횟수는 별도로 유지합니다. 이벤트 콜백은 대기/시리얼 출력 없이 기록만 하고, 메인 루프에서 한 번에 최대 4개를 출력합니다. 로그의 실행시간 영향이 완전히 0인 것은 아닙니다.

진단 로그에 Wi-Fi 암호를 넣지 않습니다. MAC/BSSID와 로컬 IP는 장치 식별용으로 포함되므로 공개 게시 전 가려도 됩니다. 숫자 실패 사유와 이벤트 순서는 남겨주세요.

근거: [Espressif Wi-Fi 연결 단계 및 실패 사유](https://docs.espressif.com/projects/esp-idf/en/v4.4.8/esp32c3/api-guides/wifi.html#wi-fi-reason-code).

검사: `node --test firmware/stepon_c3/04_sta_bilateral/tests/wifi-diagnostics.test.mjs` — 소스 계약·기존 처리 보존 검사이며 실제 무선 인증을 시뮬레이션하지 않습니다.

## STA 송신 출력 제한 — 8.5dBm 설정

`04_sta_bilateral.ino`는 `WiFi.begin(WIFI_SSID, WIFI_PASSWORD)` 직후
`WiFi.setTxPower(WIFI_POWER_8_5dBm)`을 적용합니다. STA 전용 연결은 유지하며
SSID·암호·센서 주기·HTTP API·PC 등록 방식은 변경하지 않습니다. 절전 설정인
`WIFI_POWER_SAVE`와는 별개로 최대 무선 송신 출력을 제한하는 설정입니다.

- Wi-Fi 시작 이벤트가 비동기이므로 설정 실패 시 10ms 간격으로 최대 20회 시도합니다. 연결 완료를 기다리는 무한 루프는 없습니다.
- `[WIFI-TX] applied=1 requested=8.5dBm`: 드라이버가 설정 요청을 받아들였습니다. 실제 RF 출력 실측이나 Wi-Fi 연결 성공을 뜻하지 않습니다.
- `applied=0`: 제한된 시도 안에 설정하지 못했습니다. 이 상태를 저출력 시험 성공으로 해석하지 마세요. 기존 STA 접속 처리는 계속됩니다.
- 변경 후 이 폴더의 04 스케치를 다시 업로드해야 합니다. 왼발/오른발은 기존 `STEPON_RIGHT_FOOT` 선택을 따릅니다. 보드에 자동 업로드하지 않습니다.
- `GOT_IP`, `wifi=3`, `[PC] registration HTTP=200`을 순서대로 확인합니다. `last_reason`은 연결 회복 후에도 남는 과거 기록입니다.
- 같은 핫스팟·암호·전원·센서 구성에서 재시작 3회, 매번 2분 연결 유지 여부를 비교하세요. 낮은 출력은 통신 거리를 줄일 수 있으므로 실제 착용 환경도 별도로 확인해야 합니다.
- 성공하더라도 안테나 불량이나 전원 문제로 원인이 확정되는 것은 아닙니다. 이전 설정으로 비교하려면 추가된 `txPowerOk` 반복문과 `[WIFI-TX]` 출력 블록을 제거하고 다시 업로드합니다. 기존 `WiFi.begin` 줄은 유지하세요.

`IMU=0`일 때 `rate=64.0Hz`가 표시되어도 정상 IMU 데이터 64개를 받았다는 뜻은 아닙니다. 현재 실행률은 읽기 성공 여부와 무관한 처리 주기이며, 센서 유효성은 `IMU`/`imu_ready`를 따로 확인합니다.

근거: [Arduino-ESP32 2.0.11 송신 출력 설정 구현](https://github.com/espressif/arduino-esp32/blob/2.0.11/libraries/WiFi/src/WiFiGeneric.cpp#L1326), [ESP32-C3 최대 송신 출력 API](https://docs.espressif.com/projects/esp-idf/en/v4.4.5/esp32c3/api-reference/network/esp_wifi.html).

## 보안·공유

이 코드는 신뢰하는 PC 핫스팟 안의 프로토타입용입니다. 인터넷에 포트포워딩하지 마세요. 웹에 Wi-Fi 암호를 보내거나 표시하지 않습니다. secrets 파일과 컴파일된 바이너리에는 자격정보가 포함되므로 공개 Git에 올리지 마세요. 모델·ROM·추이 저장 기능은 기존 파일을 그대로 사용합니다.

## 테스트

2026-09-12: 양발 컴파일 성공, 자동 테스트 98/98 통과. 범위와 미검증 항목은 [검증 기록](VERIFICATION.md)을 확인하세요.

`node --test cap_web/tests/*.test.mjs` — 좌우 값 분리, 한 발 단절, 정지 frame, 재부팅, 중복 장치, 잘못된 채널, 명령 대상, 기존 웹/MediaPipe/추이 회귀 검사.
실물 보드의 Wi-Fi·전원·I²C·모터 동작은 업로드 후 별도로 확인해야 합니다. 소프트웨어 테스트 통과는 하드웨어 검증을 대신하지 않습니다.
