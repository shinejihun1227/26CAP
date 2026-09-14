# 04 STA 양발 검증 기록 — 2026-09-12

## 기존 검증 완료 (Wi-Fi 상세 진단 추가 전)

- Arduino ESP32 2.0.11, ESP32C3 Dev Module, USB CDC Enabled: 왼발(0)·오른발(1) 모두 컴파일 성공. 각각 flash 838,920 bytes, global RAM 39,700 bytes. 업로드는 하지 않음.
- `node --test cap_web/tests/*.test.mjs`: **98/98 통과**. 양발 수집·정지 프레임·단절·재부팅·자동 등록·명령 대상과 기존 웹/MediaPipe/추이 회귀 검사 포함.
- 별도 가상 장치 서버에서 왼발/오른발 압력·온습도·IMU 값이 각각 표시됨을 실제 브라우저로 확인. 시험용 장치는 `SIMULATED-*` 및 가상 데이터 안내로 표시.
- 오른발 단절 시 오른발의 수치만 `--`로 전환되고 왼발은 계속 갱신. 재접속·재부팅 표시, 온도 히트맵, IP 직접 등록, 분석·출력 대상 왼발 전환 확인.
- 실제 8000 STA 화면에서 양발 미등록 시 수치가 모두 대기 상태이며 시연값으로 대체되지 않음. 저장된 편집 문구가 실제 연결 상태를 덮어쓰지 않도록 수정.
- 8000·8001 `/api/insoles/state`가 같은 수집 상태를 반환. 8001은 디자인 편집용 시연 미리보기이며 실제 측정은 8000 STA 화면에서 확인.
- 8000 실제 화면과 8001 편집 화면의 브라우저 error/warn 로그 없음.
- 기존 `03_final.ino`, `03_final/sensor_core.h`, `03_final/sensor_core_local.h`의 SHA-256이 작업 전과 동일함을 확인.
- 로컬 Wi-Fi 비밀 설정과 컴파일 출력이 Git 제외 대상임을 확인. Git push 없음.
- 가상 장치 서버 및 시험 탭 종료. 실제 8000·8001 서버는 실행 상태로 유지.

## 실물에서 반드시 확인할 항목

1. 핫스팟 공유 방식 Wi-Fi / 2.4GHz, PC 방화벽의 TCP 8000 접근 허용.
2. 실제 TCA9548A 주소 0x71, SHTC3 CH3·4·5·6, 압력 C0·2·4·6 및 핀맵 일치.
3. 양발을 각각 올바른 side로 업로드하고 시리얼의 STA IP / 등록 HTTP 200 확인.
4. 실제 측정 주기와 누락 frame, USB/배터리 전압·전류 안정성, I²C·진동 출력 동작.
5. 손으로 각 압력 부위를 눌러 웹의 해당 발·위치가 변하는지 확인. 임상·치료 효과 검증은 별도.

컴파일·가상 시험 통과는 실물 Wi-Fi 안정성이나 64Hz 무손실 수집을 보장하지 않습니다. RF/CNN은 이번 STA 펌웨어에 내장하지 않았고 기존 PC AI 브리지에서 별도로 실행합니다.

## Wi-Fi 상세 진단 추가 — wifi-diag-v1 / 2026-09-12

- 추가: `wifi_diagnostics.h`, `tests/wifi-diagnostics.test.mjs`. 수정: `04_sta_bilateral.ino`의 진단 호출과 README/검증 기록.
- `STA_START/STOP`, 연결 완료, IP 할당/유실, 보안 방식 변경, 연결 해제 이유 번호·이름·시각을 출력. 드라이버 이벤트 RSSI와 BSSID도 기록하며 암호는 출력하지 않음.
- 이벤트 콜백은 비차단 큐 기록·원자적 요약 갱신만 수행. 루프에서 최대 4개씩 출력하고, 2초 주기로 과거 마지막 해제 사유와 누적 횟수·로그 누락 수를 표시.
- 기존 15초 타이머 재접속은 호출 시각/반환값만 추가 출력. 자동 재접속, 센서 처리 주기, Wi-Fi 절전 설정, 연결 대상, 전송 방식은 변경하지 않음. 추가 AP/스캔이나 네트워크 삭제 없음.
- 소스 비교: 센서 작업·API JSON·PC 등록·라우트/작업 생성 부분이 변경 전과 동일함. `config.h`, `sensor_core.h`, 로컬 `wifi_secrets.h`의 SHA-256이 작업 전후 동일함.
- 소스 계약/회귀 검사: 이번 진단 7/7, 기존 I²C 진단 6/6 통과. 실제 무선 이벤트를 구동하는 하드웨어 시험은 아님.
- 기존 웹/양발/카메라/추이 자동 검사 98/98 통과. 웹 파일 수정 없음.
- 양발 전체 빌드 성공 (각 exit 0). Arduino ESP32 2.0.11 / ESP32C3 Dev Module / USB CDC Enabled / Core Debug Level None / side 0·1 각각 빌드. 왼발 flash 816,608 bytes, 오른발 flash 816,616 bytes, 양쪽 global RAM 39,636 bytes. 이전 검증과 디버그 옵션이 달라 사용량을 같은 조건의 최적화 결과로 비교하지 않음.
- 실제 보드 업로드와 접속 실패 재현은 아직 하지 않음. 사용자에게 RST 후 30~40초 로그를 받아 원인을 확인해야 함. 이번 변경은 원인 진단이며 Wi-Fi 복구 완료를 의미하지 않음.

## STA 송신 출력 8.5dBm 설정 추가 — 2026-09-12

- 사용자 요청에 따라 메인 스케치의 `WiFi.begin` 직후 `WiFi.setTxPower(WIFI_POWER_8_5dBm)` 추가. 시작 이벤트 대기를 위한 최대 20회/10ms 재시도와 `[WIFI-TX] applied=...` 로그 포함. 설정 성공과 연결 성공은 구분해서 표시.
- STA 전용 모드, 자동 재접속/15초 타이머, SSID·암호, 핀맵, 센서 주기, API 및 PC 등록 방식은 유지. IMU 인식 문제를 고치는 변경은 아님.
- `node --test firmware/stepon_c3/04_sta_bilateral/tests/wifi-diagnostics.test.mjs`: **8/8 통과**. 적용 시점·유한 재시도·AP 미생성·자격정보 비출력 검사 및 센서 작업/API/PC 등록 코드의 기존 해시 일치 확인. 소스 계약 검사이며 무선 인증 시뮬레이션은 아님.
- Arduino ESP32 **2.0.11**, ESP32C3 Dev Module, USB CDC Enabled, Core Debug Level None으로 양발 컴파일 성공 (각 exit 0). 왼발 flash **816,964 bytes**, 오른발 **816,972 bytes**, 양쪽 global RAM **39,636 bytes**.
- 빌드 경로: `.codex-build/04-sta-tx85-left`, `.codex-build/04-sta-tx85-right`. 자격정보가 포함될 수 있는 컴파일 산출물과 `wifi_secrets.h`는 Git 제외 대상임을 확인. Git push 없음.
- 실제 보드 업로드·초기화·핫스팟 설정 변경은 수행하지 않음. 업로드 후 `applied=1`, `GOT_IP`/`wifi=3`, PC 등록 HTTP 200과 장시간 안정성은 실물에서 별도 검증해야 함. 성공하더라도 전원/안테나가 원인이라고 확정하지 않음.
