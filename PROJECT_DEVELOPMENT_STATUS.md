# StepOn 프로젝트 개발 현황

작성 기준일: 2026-08-28  
목적: 다음 개발자나 AI가 현재 프로젝트의 구조, 구현 범위, 하드웨어 상태, 미완료 작업을 한 번에 이해하기 위한 인수인계 문서

## 1. 프로젝트 한눈에 보기

StepOn은 깔창에 부착한 압력센서와 IMU, 온·습도센서로 보행과 발 상태를 관찰하고, 필요한 경우 진동·레이저·음성 큐를 제공하는 연구용 프로토타입입니다.

현재 프로젝트는 다음 네 부분으로 나뉩니다.

| 영역 | 위치 | 현재 상태 |
|---|---|---|
| 새 사용자 웹 | `cap_web/` · 8000 | 구현 완료된 Mock 기반 대시보드 |
| 디자인 편집기 | `cap_web/` · 8001 | 8000 화면을 직접 편집하고 상태를 공유 |
| ESP32 펌웨어 | `firmware/esp32_c3_ap/` | AP·센서 API·알고리즘·로컬 로그 구현, 실제 보드 업로드 전 |
| Flutter 앱 | `lib/` | 화면 및 Repository 구조 구현, 현재 Mock 중심 |

의료 진단·예방·치료를 목적으로 하는 제품이 아닙니다. 현재 알고리즘은 연구용 관찰·경고 보조 로직이며, 실제 사용 전 센서 보정과 임상 검증이 필요합니다.

## 2. 현재 구현 수준

### 구현되어 있는 부분

- 기존 웹과 분리된 `cap_web/` 모듈형 웹 구조
- 8000 사용자 화면과 8001 디자인 편집기 분리
- Overview, Live, Safety, Reports, Devices, MediaPipe 메뉴
- 첫 진입 사용자 프로필 입력 및 목적별 개인화
- 온보딩 값·편집 문구·센서 위치·발 위치 상태 저장
- 발바닥 실루엣 기반 압력 표시와 센서 번호 표시
- 양발 압력 히트맵과 온·습도 비교 화면 구조
- 모바일 전용 UI와 하단 탭 내비게이션
- ESP32 SoftAP와 `/api/state` 센서 JSON API
- ESP32 내부 50Hz 샘플링, FoG·발 상태·자세 알고리즘의 프로토타입
- LittleFS CSV 로그 및 요약 파일 저장
- MPU6050·DRV2605L·FSR MUX 기반 최신 사용자 배선 프로필

### 아직 Mock 또는 미완료인 부분

- 8000·8001 웹은 아직 ESP32 실측 API가 아닌 Mock 데이터를 표시함
- 웹에서 ESP32의 `/api/state`를 읽는 API 어댑터가 아직 없음
- Flutter는 실제 BLE 연결 전이며 Mock Repository를 사용함
- SHTC3 실제 센서 입력은 최신 펌웨어 설정에서 비활성화됨
- 양발 최종 배선과 양발 데이터 패킷 구조가 확정되지 않음
- 레이저 출력은 안전상 기본 OFF이며, 웹의 출력 버튼도 실제 GPIO와 연결되지 않음
- Arduino IDE에서 실제 보드 컴파일·업로드 검증은 아직 수행하지 않음
- 임계값은 개인 기준선과 실험 데이터로 보정해야 함

## 3. 웹 구조

### 실행 주소

| 주소 | 용도 |
|---|---|
| `http://127.0.0.1:8000/` | 사용자용 데스크톱 웹 |
| `http://127.0.0.1:8000/mobile` | 모바일 전용 UI |
| `http://127.0.0.1:8001/?mode=editor&screen=overview` | 디자인 편집기 |

휴대폰에서는 `127.0.0.1`이 PC가 아니라 휴대폰 자신을 의미합니다. PC와 휴대폰을 같은 Wi-Fi에 연결한 뒤 PC의 LAN 주소를 사용해야 합니다.

예:

```text
http://PC의-LAN-IP:8000/mobile
http://PC의-LAN-IP:8001/?mode=editor&screen=overview
```

### 주요 파일

```text
cap_web/
  index.html                    # HTML 진입점과 CSS 링크
  dev-server.mjs                # 8000·8001 개발 서버
  package.json                  # ES module 및 문법 검사
  .stepon-editor-state.json     # 8000·8001 공유 편집 상태
  assets/                       # 발 실루엣 및 이미지 자산
  src/
    main.js                     # 라우팅, 화면 조립, 이벤트, Mock polling
    mobile/mobile-app.js        # 모바일 전용 화면
    editor/editor-view.js       # 8001 편집기와 상태 저장
    data/dashboard-data.js      # Mock 프레임과 프로필 기본값
    data/gait-algorithms.js     # 웹용 온습도·FoG·큐 계산
    data/foot-layout.js         # 발 이미지 위치·회전·크기 상태
    data/sensor-layout.js       # 압력·온습도 센서 위치 상태
    services/cue-controller.js   # 음성 안내와 향후 ESP32 출력 연결 위치
    components/                 # 카드, 차트, 발 압력맵, 히트맵 등
    views/                      # 메뉴별 독립 화면
    styles/                     # 디자인 토큰, 반응형, 편집기, 모바일 스타일
```

### 8000과 8001의 연결

- 8000은 일반 사용자가 보는 대시보드입니다.
- 8001은 별도 디자인 화면이 아니라 8000의 각 메뉴를 편집하기 위한 화면입니다.
- 8001의 `screen=overview`, `screen=live` 등의 값은 8000의 같은 메뉴와 1:1로 연결됩니다.
- 편집 문구는 `/.stepon-editor-state.json`으로 공유됩니다.
- 프로필은 현재 브라우저 `localStorage`에 저장됩니다.
- 센서 위치와 발 위치 편집값도 공용 상태로 저장됩니다.
- 현재 편집기는 웹 UI의 시각적·문구 상태를 수정하는 기능이며, 하드웨어 배치나 ESP32 펌웨어를 자동으로 변경하지는 않습니다.

### 모바일 UI

`main.js`가 다음 조건으로 모바일 화면을 선택합니다.

- 경로가 `/mobile`
- URL에 `?mobile=1`
- 화면 폭이 약 800px 이하

모바일 UI는 데스크톱 UI를 단순 축소한 것이 아니라 모바일용 카드, 하단 탭, 세로형 온보딩 화면을 별도로 렌더링합니다. 데이터 모델과 프로필·편집 상태는 데스크톱 화면과 공유합니다.

## 4. ESP32 펌웨어 현황

파일:

[firmware/esp32_c3_ap/esp32_c3_ap.ino](firmware/esp32_c3_ap/esp32_c3_ap.ino)

현재 펌웨어 기능:

- Wi-Fi AP 생성
- AP 이름: `StepOn-C3`
- 비밀번호: `stepon1234`
- 주소: `http://192.168.4.1`
- `/api/state` 실시간 센서·알고리즘 JSON
- `/api/summary` 요약 JSON
- `/api/log.csv` 로그 다운로드
- `POST /api/log/clear` 로그 초기화
- `/api/ping` 연결 확인
- 20ms 간격, 약 50Hz 센서 샘플링
- CORS 허용 설정
- 압력·IMU·출력 큐 처리 구조

### 현재 적용한 사용자 배선 프로필

주의: 아래 배선은 ESP32-C3 MINI가 아니라 일반 ESP32 DevKit/WROOM 계열입니다. GPIO25, GPIO26, GPIO34는 ESP32-C3에 존재하지 않습니다. Arduino IDE에서는 `ESP32 Dev Module`을 선택해야 합니다.

| ESP32 GPIO | 용도 |
|---|---|
| GPIO18 | CD74HC4067 S0 |
| GPIO19 | CD74HC4067 S1 |
| GPIO21 | CD74HC4067 S2 |
| GPIO22 | CD74HC4067 S3 |
| GPIO34 | CD74HC4067 SIG, ADC 입력 |
| GPIO25 | MPU6050·DRV2605L SDA |
| GPIO26 | MPU6050·DRV2605L SCL |
| GPIO23 | 레이저 BJT 베이스 제어 |
| 3V3/GND | 센서·모듈 공통 전원/접지 |

압력센서 채널은 다음 순서입니다.

```text
센서 1 → C0
센서 2 → C2
센서 3 → C4
센서 4 → C6
센서 5 → C8
센서 6 → C10
센서 7 → C12
센서 8 → C14
```

코드에는 다음 배열로 반영되어 있습니다.

```cpp
const uint8_t PRESSURE_MUX_CHANNELS[8] =
  {0, 2, 4, 6, 8, 10, 12, 14};
```

현재는 한쪽 깔창용 MUX 하나만 활성화되어 있습니다. `pressure_left[8]`에 실측값이 들어가고 `pressure_right[8]`은 0으로 유지됩니다.

### 현재 센서 및 출력 설정

- FSR406: CD74HC4067을 통한 8채널 입력
- MPU6050: I²C 주소 `0x68`, AD0는 GND
- DRV2605L: I²C 방식, 일반 주소 `0x5A`, 코인모터 연결
- SHTC3: 현재 배선표에 없으므로 펌웨어에서 비활성화
- TCA9548A: 현재 비활성화
- 레이저: GPIO23 BJT 제어 코드 반영, 출력은 안전상 기본 비활성화
- 레이저 설정: `ENABLE_LASER_OUTPUT 0`

레이저를 활성화하려면 센서 검증과 안전 인터록 확인 후에만 `1`로 바꿉니다. 모터와 레이저는 ESP32 GPIO에 직접 연결하지 않습니다.

### 펌웨어 라이브러리

Arduino IDE에서 다음을 설치해야 합니다.

- Adafruit MPU6050
- Adafruit DRV2605
- Adafruit Unified Sensor

## 5. 알고리즘 상태

### 펌웨어 알고리즘

현재 펌웨어에는 다음이 들어 있습니다.

- 압력 합을 이용한 보행·접지 게이트
- MPU6050 가속도·자이로 입력
- 약 6초 이동 윈도우
- 0.5–3Hz 보행대역과 3–8Hz 동결대역 비교
- FI, SpectralEntropy, PitchROM
- Normal → Warning → FoG → Recovery 상태머신
- 접지 시 ZUPT 기반 자세·궤적 보정
- 알고리즘 상태에 따른 진동·레이저 cue 플래그

현재 펌웨어의 출력 cue는 FoG 상태에서 진동을 반복 실행하도록 연결되어 있습니다. 레이저는 기본적으로 차단되어 있습니다.

### 웹 알고리즘

웹의 `src/data/gait-algorithms.js`는 시연을 위한 별도 계산을 사용합니다.

- 온·습도: 좌우 대응 부위 온도·습도 차이
- FoG: 보행대역/동결대역 proxy, cadence, 압력 불균형, 자이로 burst
- 큐: 레이저·진동·음성 출력의 권장 상태

웹 알고리즘과 펌웨어 알고리즘은 현재 동일한 수식·윈도우·임계값이 아닙니다. 실측 데이터를 수집한 뒤 하나의 기준을 정하고 공통 데이터 모델로 통합해야 합니다.

## 6. 데이터 흐름

### 현재 Mock 흐름

```text
dashboard-data.js
       ↓
main.js / mobile-app.js
       ↓
8000 사용자 화면
       ↓
8001 편집기 상태를 선택적으로 반영
```

### 목표 실센서 흐름

```text
FSR406 → CD74HC4067 → ESP32 ADC
MPU6050 ─────────────┐
DRV2605L ────────────┤ I²C
                     ↓
             ESP32 알고리즘·출력
                     ↓
              GET /api/state
                     ↓
             cap_web API adapter
                     ↓
             8000 사용자 화면
```

현재 `cap_web`에는 ESP32 주소를 호출하는 API adapter가 아직 없습니다. 따라서 ESP32의 센서값이 현재 8000/8001 Mock 화면에 자동으로 나타나지는 않습니다.

## 7. 하드웨어 미확정 사항

다음 항목은 최종 설계 전에 확정해야 합니다.

1. 실제 보드가 일반 ESP32 DevKit/WROOM인지 ESP32-C3 MINI인지
2. 현재 한쪽 깔창만 먼저 검증할지, 처음부터 양발을 연결할지
3. 양발 구성 시 FSR406 총 16개를 한 MCU가 읽을지, 발마다 MCU를 둘지
4. SHTC3를 각 발 4개씩 총 8개 사용할지
5. BMI270을 계속 사용할지, 최신 배선처럼 MPU6050을 사용할지
6. BMI/MPU 센서를 한 개 사용할지 발마다 한 개씩 사용할지
7. 배터리 종류와 모터·레이저의 별도 전원 구조
8. 레이저가 정격 전압과 드라이버를 내장한 모듈인지
9. 진동모터가 ERM인지 LRA인지

SHTC3 8개를 추가하려면 TCA9548A 8채널과 BMI/MPU의 연결 위치를 다시 설계해야 합니다. 현재의 `SHTC3 ×4` 화면 및 기존 펌웨어 구조는 최종 양발 8센서 구성과 일치하지 않습니다.

## 8. 권장 검증 순서

### 1단계: 보드·전원 확인

- 보드 실크 인쇄를 확인합니다.
- GPIO34/25/26이 실제로 존재하면 일반 ESP32 계열입니다.
- 3.3V 센서에 5V를 넣지 않습니다.
- 모든 GND를 공통으로 연결합니다.

### 2단계: ESP32 업로드

- `ESP32 Dev Module` 선택
- 위의 Arduino 라이브러리 설치
- 시리얼 모니터 `115200`
- `MPU6050: ready`, `DRV2605L: ready` 확인

### 3단계: API 확인

```text
http://192.168.4.1/api/ping
http://192.168.4.1/api/state
```

PC PowerShell에서는 다음을 실행합니다.

```powershell
while ($true) {
  Invoke-RestMethod http://192.168.4.1/api/state |
    ConvertTo-Json -Depth 8
  Start-Sleep -Milliseconds 500
}
```

### 4단계: 센서별 단독 확인

- FSR 센서 1만 누르고 `pressure_left[0]` 변화 확인
- 센서 2만 누르고 `pressure_left[1]` 변화 확인
- MPU6050을 움직여 `accel`, `gyro` 변화 확인
- DRV2605L 초기화 메시지 확인
- 레이저는 마지막까지 연결하지 않거나 출력 설정을 `0`으로 유지

### 5단계: 웹 연동

먼저 브라우저 개발자 콘솔에서 다음을 실행합니다.

```js
fetch("http://192.168.4.1/api/state", { cache: "no-store" })
  .then((response) => response.json())
  .then(console.log);
```

이 요청이 성공한 뒤 `cap_web`에 ESP32 API adapter와 데이터 정규화기를 추가해야 합니다. 정규화 대상은 다음입니다.

- `pressure_left`, `pressure_right`
- `accel`, `gyro`
- `temperature_sensors`, `humidity_sensors`
- `risk`, `cop_x`, `cop_y`
- `algorithms`
- `cue_vibration`, `cue_laser`

## 9. 다음 개발 우선순위

### P0 — 반드시 먼저 할 일

- 실제 ESP32 모델 확정
- 일반 ESP32 배선과 C3 배선 중 하나 선택
- Arduino IDE 컴파일·업로드
- FSR 8개 단독 입력 검증
- MPU6050·DRV2605L I²C 초기화 검증

### P1 — 실센서 데이터 연결

- `cap_web/src/data/api-adapter.js` 생성
- Mock/Hardware 데이터 소스 전환 옵션 추가
- ESP32 JSON을 웹 데이터 모델로 정규화
- 8000 화면을 실제 `/api/state` polling과 연결
- 연결 끊김·재연결·오래된 데이터 표시 처리

### P2 — 양발 및 온·습도 확장

- 양발 MUX와 두 번째 ADC 입력 확정
- SHTC3 4개 또는 8개 수량 확정
- TCA9548A 채널표 확정
- 좌우 센서 위치와 펌웨어 배열의 일치 검증

### P3 — 출력 안전 및 알고리즘 검증

- 레이저 수동 정지·인터록 추가
- DRV2605L ERM/LRA 설정 확인
- cue 지속시간·반복주기·cooldown 검증
- 실제 보행 데이터 수집
- 개인별 standing baseline 및 임계값 보정
- 연구용 라벨과 알고리즘 결과 비교

## 10. 관련 문서

- [cap_web README](cap_web/README.md)
- [기존 프로젝트 컨텍스트](cap_web/STEPON_PROJECT_CONTEXT.md)
- [펌웨어 README](firmware/esp32_c3_ap/README.md)
- [현재 사용자 배선 안내](firmware/esp32_c3_ap/USER_WIRING_CLASSIC_ESP32.md)
- [ESP32 펌웨어](firmware/esp32_c3_ap/esp32_c3_ap.ino)

이 문서의 “현재 상태”와 “미확정 사항”을 기준으로 다음 작업을 시작하고, 하드웨어·보드·센서 수량이 바뀌면 이 문서도 함께 갱신해야 합니다.
