# 왼발·오른발 ESP32를 웹에 연결하기

핫스팟에 장치 2대가 보여도 웹에 양발이 등록된 것은 아닙니다. 각 보드가 서로 다른 IP를 받고, 펌웨어에서 왼발과 오른발을 구분하며, PC가 두 보드의 `/api/state`를 읽을 수 있어야 합니다.

## 1. 보드별 좌우 설정

WROOM 보드는 [`04_2_sta_bilateral_wroom`](../firmware/stepon_c3/04_2_sta_bilateral_wroom/README.md)을 사용합니다. 같은 폴더의 `config.h`에서 다음 값을 바꿔 **각각 해당 보드에 업로드**합니다.

| 업로드 대상 | `config.h` 설정 | 시리얼 및 `/api/state`의 `foot_side` |
|---|---|---|
| 왼발 | `#define STEPON_RIGHT_FOOT 0` | `left` |
| 오른발 | `#define STEPON_RIGHT_FOOT 1` | `right` |

설정 파일만 바꾸면 이미 업로드한 보드는 바뀌지 않습니다. 오른발에 업로드할 때 Arduino IDE의 포트도 오른발 보드인지 확인하세요. 두 보드에 기본값 `0`으로 업로드하면 둘 다 왼발로 등록을 요청합니다. 웹의 **분석·출력 대상 → 오른발** 선택은 보드의 좌우 설정을 변경하지 않습니다.

배선은 기존 4-2 공통 핀맵을 유지합니다. MUX S2는 **GPIO18**입니다. Wi-Fi 정보는 각 보드에 업로드하는 `wifi_secrets.h`에 넣습니다.

## 2. PC 자동 등록 주소

저장소 최상위의 `run.bat`을 실행합니다. 보드는 `PC_HOST`의 TCP 8000번으로 약 5초마다 자동 등록을 요청합니다.

- **Windows 모바일 핫스팟에 직접 연결:** 기본값 `PC_HOST = ""`는 보드가 받은 DHCP 게이트웨이를 사용합니다. 게이트웨이가 서버를 실행하는 PC일 때 맞는 설정입니다.
- **공유기 Wi-Fi에 PC와 보드가 함께 연결:** 게이트웨이는 공유기이므로 `PC_HOST`에 **PC의 Wi-Fi IPv4 주소**를 넣고 보드에 다시 업로드합니다. `ipconfig`에서 현재 주소를 확인합니다.
- **휴대폰 핫스팟에 PC와 보드가 함께 연결:** 게이트웨이는 휴대폰입니다. `check-network.bat`으로 확인한 **노트북 IPv4**를 `PC_HOST`에 넣습니다. [휴대폰 핫스팟 연결 안내](PHONE_HOTSPOT.md)를 참고하세요.

예를 들어 PC가 `192.168.0.103`이라면:

```cpp
constexpr const char *PC_HOST = "192.168.0.103"; // 예시: 실제 PC IPv4로 변경
constexpr uint16_t PC_PORT = 8000;
```

여기에 ESP32 주소나 PC의 `127.0.0.1`을 넣지 않습니다. PC가 여러 네트워크에 연결돼 있다면 보드와 같은 네트워크의 주소를 사용합니다. PC 주소가 바뀌면 다시 설정하거나 아래 IP 직접 등록을 사용합니다. 방화벽에서 해당 로컬 네트워크의 Node/TCP 8000 접근을 허용해야 자동 등록이 가능합니다.

## 3. 웹에서 IP 직접 등록

1. [기기 관리 화면](http://127.0.0.1:8000/?view=devices&esp32=1&transport=sta&ai=1&mobile=0)을 열고 업데이트 직후에는 `Ctrl+F5`를 누릅니다.
2. 각 보드의 시리얼 모니터를 **115200 baud**로 열어 `[WiFi] STA connected foot=right IP=... gateway=...`와 같은 로그를 확인합니다. 핫스팟 장치 목록의 주소와 비교합니다.
3. 오른발 카드의 **IP 직접 등록 / 기기 교체**를 열고 오른발 주소를 `http://192.168.x.x` 형식으로 넣은 뒤 **주소 등록**을 누릅니다. 왼발에는 왼발의 서로 다른 IP를 입력합니다.
4. **주소 등록 완료** 메시지는 주소를 저장했다는 뜻입니다. 이후 카드가 **실센서 연결**로 바뀌고 프레임 수신이 계속되는지 확인해야 센서 연결이 완료된 것입니다.
5. 양발이 연결되면 **분석·출력 대상**에서 사용할 발을 선택합니다. 실시간 AI 점수에는 해당 발의 개인 IMU 보정도 필요합니다. [실행 안내](RUNNING.md)를 참고하세요.

IP 직접 등록은 PC에서 보드로 연결하므로, PC가 보드에 접근 가능한 경우 잘못된 자동 등록 주소를 우회할 수 있습니다. 보드 자체가 응답하지 않으면 먼저 네트워크/전원/펌웨어를 확인해야 합니다.

## 4. 연결되지 않을 때

PC 브라우저에서 `http://보드IP/api/ping`, `http://보드IP/api/state`를 엽니다. 상태에는 `firmware: "04_2_sta_bilateral_wroom"`, 오른발의 경우 `foot_side: "right"`가 있어야 합니다. `/api/state`를 다시 읽을 때 `frame`이 증가하는지도 확인합니다.

| 증상 | 확인할 내용 |
|---|---|
| 두 API 모두 응답 없음 / `device_timeout` | 보드 전원, 시리얼의 현재 STA IP, PC와 같은 네트워크인지 확인. 공유기의 장치 간 통신 차단 여부도 확인 |
| `foot_side_mismatch` | 입력한 IP의 보드 좌우와 카드가 다름. 주소를 바로잡거나 오른발에 `STEPON_RIGHT_FOOT 1`로 다시 업로드 |
| `duplicate_device` | 같은 IP/기기를 양발에 중복 등록함. 실제 왼발과 오른발의 서로 다른 IP 사용 |
| `side_already_assigned` / `side_address_conflict` | 동일한 발로 등록하려는 보드가 겹침. 좌우 설정을 먼저 확인. 실제 기기 교체라면 해당 발의 등록 해제 후 새 보드 등록 |
| `sta_firmware_required` | 웹 연결용 04 C3 / 4-2 WROOM 펌웨어인지 확인. USB CSV용 06은 이 연결 방식이 아님 |
| 보드는 응답하지만 자동 등록만 실패 | 시리얼의 `[PC] registration HTTP=... host=...` 확인. PC 주소·`run.bat`·TCP 8000 방화벽 확인 또는 IP 직접 등록 |

## 화면 수정 검증

2026-09-14: 250ms 자동 갱신 중 오른발·왼발 IP 입력, 입력 후 포커스 이동, 드롭다운 키보드 선택, 입력 중 연결 상태 변경, 비동기 등록 성공/실패, 다른 화면 이동 및 모바일 화면을 브라우저로 검증했습니다. 검증 데이터는 모의 데이터이며 실제 보드 연결을 증명하지 않습니다.

검증 스크립트는 [`cap_web/tools/verify-insole-controls.mjs`](../cap_web/tools/verify-insole-controls.mjs)입니다. 별도로 준비한 Playwright와 Chrome으로, 실행 중인 웹의 정적 파일만 사용하고 모든 `/api/` 요청은 모의 응답으로 처리합니다. 실제 센서 등록이나 출력 명령은 보내지 않습니다. 일반 웹 실행에는 Playwright가 필요하지 않습니다.

```powershell
# Playwright를 별도로 설치한 검증 환경에서 저장소 최상위 기준
node cap_web/tools/verify-insole-controls.mjs
```

기본 검증 주소는 `http://127.0.0.1:8000`입니다. 필요하면 `STEPON_VERIFY_URL`, `STEPON_PLAYWRIGHT_MODULE`(설치된 모듈 경로), `STEPON_BROWSER_PATH`(브라우저 실행 파일)를 지정합니다. 검증 스크린샷은 `output/playwright/`에 저장됩니다.
