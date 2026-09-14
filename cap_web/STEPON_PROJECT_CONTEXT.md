# StepOn 프로젝트 컨텍스트 핸드오프

> 2026-09-09 센서 구성 갱신: 현재 연결 대상은 한쪽 깔창의 압력 4개(P1 앞쪽/C0, P2 가운데 안쪽/C2, P3 가운데 바깥쪽/C4, P4 뒤꿈치/C6), 온습도 4개(TCA CH3·4·5·6)입니다. 아래 2026-08-26 본문의 8개 압력센서·8개 온습도 확장 계획은 이전 기록입니다. 실제 코드와 업로드 기준은 [4채널 적용 안내](./SENSOR_4CH_GUIDE.md)와 `firmware/stepon_c3/README.md`를 사용하세요.

이 파일은 다른 AI 프롬프트나 개발자에게 현재 StepOn 앱·웹·하드웨어·알고리즘 상태를 전달하기 위한 기준 문서입니다. 다른 작업을 시작하기 전에 이 파일과 `cap_web/README.md`를 먼저 읽고, 명시되지 않은 사항은 아래의 “미확정 사항”으로 취급합니다.

작성 기준일: 2026-08-26

## 1. 프로젝트 목적

StepOn은 깔창형 센서 시스템으로 보행과 발 상태를 관찰하고, 필요한 순간에 사용자에게 시각·촉각·음성 안내를 제공하는 연구용 프로토타입입니다.

핵심 관찰 기능은 다음 세 가지입니다.

1. 양발의 같은 위치에 부착된 SHTC3 온·습도 센서값을 비교해 발 상태의 비대칭 변화를 단계적으로 관찰
2. BMI270 IMU와 FSR406 압력값을 융합해 보행동결(FoG) 가능성과 보행 상태를 관찰
3. 상태에 따라 레이저 모듈, 진동 모터, 휴대폰 음성 안내를 조합해 사용자에게 큐잉(cueing) 제공

중요한 안전 문구: 이 시스템은 당뇨병이나 파킨슨병을 진단·예방·치료하는 의료기기가 아닙니다. 현재 구현은 관찰·경고 보조를 위한 연구용 휴리스틱이며, 실제 사용 전 센서 보정과 임상 검증이 필요합니다.

## 2. 현재 웹 상태

새 웹은 기존 프로젝트와 분리된 `cap_web/`에 있습니다. 기존 `web/local_dashboard/`, `firmware/`, `site/`는 새 웹 작업의 대상이 아니며, 사용자가 명시하지 않는 한 수정하지 않습니다.

- 웹 위치: 저장소 기준 `./cap_web` (절대 경로는 PC의 저장 위치에 따라 달라질 수 있음)
- 현재 실행 방식: Python 정적 서버
- 기본 미리보기: `http://127.0.0.1:8000/`
- 보조 미리보기: `http://127.0.0.1:8001/`
- 실행 예시:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 8000 --directory cap_web
```

`cap_web`은 빌드 도구 없이 브라우저 native ES module로 동작합니다. CSS는 `main.js`에서 import하지 않고 `index.html`의 `<link rel="stylesheet">`로 불러옵니다. 이 규칙을 바꾸면 Python 정적 서버에서 흰 화면이 발생할 수 있습니다.

현재 화면 흐름:

- 첫 진입: 프로필 온보딩 화면
- 제출 후: `localStorage`에 프로필을 저장하고 Overview로 이동
- 상단 프로필 버튼: 온보딩 설정을 다시 열어 사용자 정보·목적·출력 방식을 수정
- 센서 mock 값: 대시보드 진입 후 5초마다 갱신
- 온보딩 중에는 mock polling으로 화면을 다시 그리지 않아 작성 중인 입력값을 보존

## 3. 현재 웹 파일 구조

```text
cap_web/
  index.html                    # 진입점, CSS 링크, main.js 연결
  package.json                  # type: module, 문법 확인용 스크립트
  README.md                     # 실행법과 폴더 구조
  STEPON_PROJECT_CONTEXT.md     # 이 핸드오프 문서
  assets/                       # 향후 이미지·로고 자산
  src/
    main.js                     # 화면 조립, 메뉴 전환, 이벤트, mock polling, localStorage
    data/
      dashboard-data.js         # mock 센서 프레임, 프로필·목적·출력 옵션
      gait-algorithms.js        # 온습도 비교, FoG 관찰, cue plan 계산식
    services/
      cue-controller.js         # Web Speech API와 향후 ESP32 출력 어댑터 위치
    components/
      charts.js                 # sparkline·progress
      icons.js                  # 인라인 아이콘 컴포넌트
      metric-card.js            # 요약 지표 카드
      pressure-map.js           # FSR 압력 시각화
      sidebar.js                # 좌측 메뉴
      topbar.js                 # 상단 프로필·알림 영역
    views/
      onboarding-view.js        # 첫 사용자 설정
      overview-view.js          # 오늘의 요약
      live-view.js              # 센서 실시간 상태
      safety-view.js            # 알고리즘 3종과 출력 안내
      reports-view.js           # 보행 리포트
      devices-view.js           # 하드웨어 구성·연결 상태
    utils/
      text.js                   # 사용자 입력 HTML escape
    styles/
      tokens.css                # 색상·간격·반경 디자인 토큰
      base.css                  # 기본 reset·타이포그래피
      layout.css                # 페이지·사이드바·반응형 레이아웃
      components.css            # 카드·차트·알고리즘·온보딩 컴포넌트 스타일
      onboarding.css            # 온보딩 추가 반응형 스타일
      design-polish.css         # 공통 대비·간격·터치·히트맵 폴리시
```

수정 원칙:

- 센서 데이터 mock을 바꾸려면 `src/data/dashboard-data.js`만 우선 수정
- 계산식·임계값을 바꾸려면 `src/data/gait-algorithms.js`만 우선 수정
- 화면 배치를 바꾸려면 해당 `src/views/*.js`만 수정
- 공통 UI를 바꾸려면 `src/components/`를 수정
- 색상·간격·반응형 기준을 바꾸려면 `src/styles/`를 수정
- 실제 API 연결 시 `src/data/api-adapter.js`를 새로 만들고 mock 데이터와 API 데이터의 차이를 그곳에서 정규화

## 4. 사용자 맞춤 설정 상태

현재 온보딩에서 받는 값은 다음과 같습니다.

```json
{
  "name": "사용자 이름 또는 별명",
  "age": 68,
  "gender": "female | male | none",
  "healthState": "parkinson | diabetes | balance | preventive",
  "goals": ["fog", "foot", "balance", "daily"],
  "preferredCues": ["laser", "vibration", "voice"],
  "mode": "선택한 첫 번째 관찰 목적의 표시명",
  "configured": true
}
```

`healthState`와 `goals`는 의료 진단을 확정하는 값이 아니라 사용자가 어떤 관찰 화면과 안내를 우선적으로 받을지 정하는 값입니다.

출력 설정은 다음과 같습니다.

```json
{
  "auto": true,
  "laser": true,
  "vibration": true,
  "voice": true
}
```

프로필은 현재 브라우저의 `localStorage` 키 `stepon-cap-web-profile`에만 저장됩니다. 서버나 ESP32로 전송하지 않습니다.

## 5. 웹 데이터 모델

현재 mock 프레임의 핵심 형태는 아래와 같습니다.

```json
{
  "connected": true,
  "profile": {
    "name": "김서준",
    "age": 68,
    "healthState": "preventive",
    "goals": ["fog"],
    "preferredCues": ["laser", "vibration", "voice"]
  },
  "pressure": [72, 54, 68, 44, 38, 81, 63, 49],
  "thermal": {
    "left": [
      {"site": "heel", "temp": 31.4, "humidity": 46},
      {"site": "arch", "temp": 31.8, "humidity": 48},
      {"site": "forefoot", "temp": 32.1, "humidity": 51},
      {"site": "toe", "temp": 31.9, "humidity": 49}
    ],
    "right": [
      {"site": "heel", "temp": 31.8, "humidity": 47},
      {"site": "arch", "temp": 32.2, "humidity": 50},
      {"site": "forefoot", "temp": 33.0, "humidity": 54},
      {"site": "toe", "temp": 32.1, "humidity": 49}
    ]
  },
  "imu": {
    "accel": {"x": 0.12, "y": -0.03, "z": 0.98},
    "gyro": {"x": 1.4, "y": 0.2, "z": 4.1},
    "freezeBandEnergy": 0.34,
    "locomotorBandEnergy": 1.72
  },
  "outputs": {"auto": true, "laser": true, "vibration": true, "voice": true}
}
```

현재 web mock은 양발 각각 SHTC3 4개, 즉 4개 부위의 좌·우 대응값을 표현합니다. `pressure`는 한 화면의 8개 압력 노드이며, 펌웨어 API 연결 시 좌·우 압력 배열을 별도로 받을 수 있도록 확장해야 합니다.

## 6. 알고리즘 형성 방식

### 6.1 양발 온·습도 비대칭 관찰

구현 위치: `src/data/gait-algorithms.js`의 `analyzeThermalDifference()`

대응 부위:

- 뒤꿈치 `heel`
- 발바닥 중앙 `arch`
- 앞꿈치 `forefoot`
- 발가락 `toe`

각 부위에서 다음 값을 계산합니다.

```text
temperatureDelta(site) = abs(leftTemp(site) - rightTemp(site))
humidityDelta(site)    = abs(leftHumidity(site) - rightHumidity(site))
meanTemperatureDelta   = average(all temperatureDelta)
maxTemperatureDelta    = maximum(all temperatureDelta)
maxHumidityDelta       = maximum(all humidityDelta)
```

현재 웹 demo 임계값:

- `stable`: 평균 온도 차이 `< 1.0°C`이고 최대 온도 차이 `< 2.0°C`
- `observe`: 평균 온도 차이 `< 2.0°C`이고 최대 온도 차이 `< 3.0°C`
- `priority`: 위 조건을 벗어남
- 습도 차이 `>= 15%p`인 부위는 관찰 필요 부위로 추가 표시

이 값들은 개인 기준선과 실제 임상 프로토콜로 교체해야 합니다. 온도 차이가 크다는 사실만으로 당뇨병이나 궤양을 판정하지 않습니다. 실제 장치에서는 일정 시간·날짜 동안 반복 관찰, 피부 상태 확인, 필요 시 의료진 확인 절차가 필요합니다.

### 6.2 BMI270 + FSR406 FoG 관찰

구현 위치: `src/data/gait-algorithms.js`의 `analyzeFog()`

현재 웹 demo는 실제 FFT 버퍼 대신 다음 특징값을 조합한 proxy 점수를 사용합니다.

```text
freezeIndex       = freezeBandEnergy / locomotorBandEnergy
freezeBandScore   = clamp(freezeIndex / 1.6, 0, 1)
cadenceDropScore  = clamp((100 - cadenceSpm) / 35, 0, 1)
pressureStall     = 좌·우 압력 합 차이 / 전체 압력의 32% 기준
gyroBurstScore    = gyroMagnitude / 16을 0~1로 제한

fogScore =
  0.50 * freezeBandScore +
  0.20 * cadenceDropScore +
  0.20 * pressureStall +
  0.10 * gyroBurstScore
```

상태 구분:

- `walking`: score `< 0.36`
- `caution`: `0.36 <= score < 0.62`
- `freeze`: score `>= 0.62`

표시용 FI 설명은 `3–8 Hz 동결 대역 / 0.5–3 Hz 보행 대역`입니다. 이 웹 계산은 시연용 proxy이므로 현재 펌웨어의 50 Hz, 약 6초 창, FI·SpectralEntropy·PitchROM·압력 게이트·연속 상태머신과 동일한 구현이 아닙니다.

### 6.3 출력 큐잉 계획

구현 위치: `buildCuePlan()`과 `services/cue-controller.js`

- FoG `freeze`: 사용자 설정이 켜져 있으면 레이저·진동·음성 모두 권장
- FoG `caution`: 레이저와 음성 중심, 진동은 기본적으로 끔
- 온습도 `priority`: 레이저는 끄고 진동·음성으로 발 상태 확인 안내
- 정상: 자동 출력 없음
- 자동 안내 `auto=false`: 모든 출력 권장값을 끔

음성은 휴대폰 브라우저의 Web Speech API로 테스트합니다. 레이저와 진동은 현재 화면에서만 시뮬레이션하며, 실제 ESP32 GPIO 제어는 아직 연결되지 않았습니다.

## 7. 하드웨어 상태

### 7.1 확정 또는 현재 코드에 반영된 항목

- MCU: ESP32-C3 MINI
- 압력: FSR406, 한 깔창당 8개를 기본 화면 모델로 사용
- 아날로그 입력: ADC가 적은 ESP32-C3를 위해 아날로그 MUX 사용
- IMU: BMI270, 현재 펌웨어 구조상 1개
- 온·습도: SHTC3, 같은 I²C 주소를 가지므로 I²C MUX 필요
- 출력: 레이저 모듈, 진동 모터, 두 출력 모두 MOSFET 사용을 전제로 함
- 휴대폰 연동: ESP32 AP 웹 또는 향후 BLE/Wi-Fi API 연동

### 7.2 현재 펌웨어의 핀맵

파일: `firmware/esp32_c3_ap/esp32_c3_ap.ino`

| ESP32-C3 GPIO | 현재 용도 | 주의 |
|---|---|---|
| GPIO4 | I²C SDA | TCA9548A, BMI270, SHTC3 버스 |
| GPIO5 | I²C SCL | TCA9548A, BMI270, SHTC3 버스 |
| GPIO6/7/10/20 | MUX S0/S1/S2/S3 | GPIO20은 UART0 RX와 중복 |
| GPIO0 | 왼발 MUX SIG | ADC1_CH0 |
| GPIO1 | 오른발 MUX SIG | ADC1_CH1 |
| GPIO3 | 진동 모터 EN 예비 | MOSFET 게이트로만 사용 |
| GPIO21 | 레이저 EN 예비 | MOSFET 게이트로만 사용, UART0 TX와 중복 |

피해야 할 핀:

- GPIO2/8/9: 부트 스트랩 관련
- GPIO18/19: native USB D-/D+
- GPIO12~17: 플래시/SPI 관련
- GPIO20/21: UART 디버깅과 중복되므로 최종 보드에서 재검토

### 7.3 아날로그 MUX

현재 펌웨어 README와 코드의 기본 계획은 좌·우에 CD74HC4067 계열 MUX를 하나씩 사용하고, S0~S3 선택선을 공유하는 구조입니다. 각 MUX가 16채널이어도 현재 압력 센서에는 한쪽당 8채널만 사용하고 나머지는 예비입니다.

사용자가 8채널 MUX를 고려한 상태이므로 다음을 결정해야 합니다.

- 한쪽당 FSR406이 정말 8개인지
- 좌·우 각각 별도 8채널 MUX를 쓸지
- 16채널 MUX 2개에서 8채널만 사용할지
- 좌·우 압력을 한 MCU가 모두 읽을지, 깔창별 MCU를 둘지

현재 코드의 데이터 필드는 `pressureLeft[8]`, `pressureRight[8]`를 사용합니다.

### 7.4 I²C MUX와 SHTC3 수량의 불일치

이 부분은 반드시 다른 프롬프트에 전달해야 하는 미확정 핵심 사항입니다.

사용자 요구:

- 양발의 같은 부위 온도 차이를 비교
- 각 발에 SHTC3 4개씩 부착
- 총 SHTC3 8개가 되는 방향

현재 펌웨어 코드:

- `SHTC3_SENSOR_COUNT = 4`
- TCA9548A 주소 `0x71`
- CH0: BMI270
- CH1: 왼발 뒤꿈치
- CH2: 왼발 앞발
- CH3: 오른발 뒤꿈치
- CH4: 오른발 앞발

즉 현재 펌웨어는 총 4개의 SHTC3를 전제로 하고, 각 발 4개씩의 8센서 구조와 일치하지 않습니다. 총 8개를 사용하려면 TCA9548A의 CH1~CH8에 센서 하나씩 연결하고, 펌웨어 배열·보정·API 응답을 8개로 확장하는 방안을 우선 검토해야 합니다. BMI270은 주소 `0x68`, SHTC3는 고정 주소 `0x70`이므로, 같은 MUX 채널에 동일 주소 센서를 여러 개 병렬로 연결하면 안 됩니다.

### 7.5 BMI270 수량의 불일치

초기 요구는 한쪽 깔창 기준 BMI270 1개였고, 현재 펌웨어도 BMI270 1개를 읽습니다. 하지만 양발 압력·온습도 비교를 위해 깔창을 2개로 만들 경우 다음 중 하나를 정해야 합니다.

- 한쪽 깔창만 BMI270을 가지고 전체 보행을 추정
- 양쪽 깔창에 BMI270을 각각 1개씩 배치
- 별도 본체에 BMI270을 1개 배치

이 선택에 따라 BLE 패킷, API 데이터 구조, 보행동결 알고리즘 입력이 달라집니다.

### 7.6 전원·출력부

전원 구조는 아직 최종 확정되지 않았습니다. ESP32-C3의 Wi-Fi/BLE 순간전류와 진동 모터·레이저의 출력 전류를 고려하면 일반 코인셀 단독 전원은 적합하지 않을 가능성이 높습니다. 최종 부품의 정격전압·소비전류·최대전류를 확인한 뒤 다음을 설계해야 합니다.

- 배터리 종류와 용량
- 3.3V ESP32/센서 레일
- 레이저·진동 출력 레일
- 5V가 필요한 모듈이 있는지와 승압 회로
- 모터용 MOSFET, 게이트 저항, 풀다운, 플라이백 다이오드
- 레이저 안전 인터록과 물리적 수동 정지

GPIO에서 모터나 레이저를 직접 구동하지 않습니다. 진동 모터는 역기전력 보호가 필요하고, 레이저는 눈 방향·피부 조사·우발 점등을 막는 안전 구조가 필요합니다.

## 8. 현재 펌웨어 API와 웹 연결 목표

펌웨어 파일: `firmware/esp32_c3_ap/esp32_c3_ap.ino`

현재 엔드포인트:

- `GET /api/state`: 실시간 센서·알고리즘 상태
- `GET /api/summary`: LittleFS 요약
- `GET /api/log.csv`: 로그 다운로드
- `POST /api/log/clear`: 로그 초기화
- `POST /api/profile`: 프로필 저장
- `GET /api/ping`: 연결 확인

펌웨어 `/api/state`에는 현재 다음 계열의 값이 포함됩니다.

- `pressure_left`, `pressure_right`
- `accel`, `gyro`
- 평균 `temperature`, `humidity`
- `temperature_sensors[4]`, `humidity_sensors[4]`
- `battery`, `risk`
- `cop_x`, `cop_y`
- FoG/파킨슨 알고리즘 결과
- 당뇨발 관찰 결과
- 자세·궤적 결과
- `storage`

웹 mock과 API 사이의 차이:

- 웹은 `thermal.left[4]`, `thermal.right[4]` 구조를 사용
- 펌웨어는 현재 `temperature_sensors[4]` 단일 배열을 사용
- 웹은 `freezeBandEnergy`, `locomotorBandEnergy`를 직접 사용
- 펌웨어는 6초 모션 창에서 FI·SpectralEntropy·PitchROM을 계산
- 웹은 출력 계획을 브라우저에서 계산
- 펌웨어는 현재 `cue_vibration`, `cue_laser` boolean을 알고리즘 결과에 포함

실제 연결을 시작할 때는 바로 화면 컴포넌트를 고치지 말고 다음 순서로 처리합니다.

1. `src/data/api-adapter.js`에서 `/api/state` 응답을 웹 상태 모델로 정규화
2. 센서 수량과 좌·우 매핑을 확정
3. mock 모드와 API 모드를 전환하는 `dataSource` 설정 추가
4. 연결 끊김·오래된 데이터·잘못된 센서값을 화면에 별도 표시
5. 출력 명령은 `cue-controller.js`에 HTTP/BLE 어댑터로 추가

## 9. 다른 프롬프트에 붙여넣을 시작 문장

```text
StepOn 프로젝트를 이어서 개발한다.

먼저 cap_web/STEPON_PROJECT_CONTEXT.md와 cap_web/README.md를 읽는다.
새 웹은 기존 web/, firmware/, site/와 분리된 cap_web/에서 작업한다.
현재 cap_web은 Python 정적 서버에서 동작하는 native ES module 웹이며, CSS는 index.html의 link로 로드한다.
기존 디자인 토큰과 teal 배경, navy/coral/mint 색상을 유지한다.

현재 우선 기능은 다음과 같다.
1. 양발 동일 부위 SHTC3 온·습도 차이 관찰
2. BMI270 + FSR406 기반 FoG 관찰
3. 레이저·진동·휴대폰 음성 큐잉
4. 사용자 프로필·현재 상태·관찰 목적·출력 방식 맞춤화

의료 진단이나 치료 효과로 표현하지 말고 연구용 관찰·경고 보조로 표현한다.
하드웨어 수량이나 좌·우 센서 매핑이 불명확하면 임의로 확정하지 말고 미확정 사항으로 표시한다.
수정 후에는 cap_web:8000 정적 서버에서 파일 응답과 JavaScript 문법을 확인한다.
```

## 10. 우선순위가 높은 다음 작업

1. SHTC3가 실제로 총 4개인지 총 8개인지 확정하고, 양발 같은 부위 매핑 정의
2. FSR406이 한쪽 8개인지 양쪽 총 8개인지 확정
3. BMI270 수량과 깔창별 MCU 구조 확정
4. 실제 API 응답을 `cap_web` 데이터 모델로 정규화
5. 개인별 온도 기준선과 BMI270 standing baseline 저장
6. FoG 상태머신과 출력 지속시간·쿨다운·재알림 조건을 안전하게 정의
7. 레이저·진동 MOSFET 회로와 배터리 전원 구조 검증
8. 휴대폰 음성 안내와 실제 ESP32 출력 제어를 분리해 통합 테스트
