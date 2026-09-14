# StepOn AI 작업 인수인계 문서

작성 기준일: 2026-09-04

이 문서는 다른 AI 모델이나 개발자가 StepOn 프로젝트를 이어서 수정할 때 먼저 읽는 최신 작업 안내서입니다. 아래 내용과 실제 코드가 다르면 실제 코드를 우선 확인하되, 명시하지 않은 파일은 임의로 수정하지 않습니다.

## 1. 작업 범위

StepOn은 양발 압력센서·온습도센서·BMI270 IMU를 이용해 보행 상태를 관찰하고, 필요한 경우 웹 안내와 진동 큐를 제공하는 연구용 프로토타입입니다.

이번 웹의 주 작업 폴더는 저장소의 `cap_web/`입니다. 사용자가 별도로 요청하지 않는 한 기존 `web/local_dashboard/`, `site/` 또는 다른 프로젝트 파일은 수정하지 않습니다.

## 2. 실행 방법

프로젝트 루트의 `run.bat`을 더블클릭하면 Node 기반 정적 서버 두 개가 백그라운드로 실행됩니다.

- 사용자 대시보드: `http://127.0.0.1:8000/?view=overview`
- 실시간 모니터: `http://127.0.0.1:8000/?view=live`
- 모바일 화면: `http://127.0.0.1:8000/mobile`
- 8001 Design Lab: `http://127.0.0.1:8001/?mode=editor&screen=overview`

서버 파일은 `cap_web/dev-server.mjs`이며 빌드 도구 없이 브라우저 native ES module로 동작합니다. CSS는 `cap_web/index.html`에서 link로 불러옵니다. 프레임워크나 번들러를 새로 도입하지 않는 것을 기본 원칙으로 합니다.

PowerShell에서 직접 실행할 때:

```powershell
cd "E:\duawl-data\Documents\cau_capstone"
$nodePath = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$webRoot = "$pwd\cap_web"
Start-Process $nodePath -ArgumentList "dev-server.mjs 8000 0.0.0.0" -WorkingDirectory $webRoot
Start-Process $nodePath -ArgumentList "dev-server.mjs 8001 0.0.0.0" -WorkingDirectory $webRoot
```

## 3. 데이터 흐름

실제 센서 모드의 핵심 흐름은 다음과 같습니다.

```text
ESP32 /api/state
  → src/services/esp32-api.js의 normalizeEsp32State()
  → src/data/gait-algorithms.js의 analyzeRehabFrame()
  → main.js 상태 갱신
  → desktop view 또는 mobile-app.js 렌더링
```

실제 ESP32를 읽으려면 `03_final` 펌웨어를 업로드하고 아래처럼 접속합니다.

```text
http://127.0.0.1:8000/?esp32=1&esp32Url=http%3A%2F%2F192.168.4.1&view=overview
```

`esp32=1`이 없으면 로컬 mock 데이터를 사용합니다. 실센서 모드에서 연결이 끊기면 화면에는 `ESP32 연결 끊김`과 `--`가 표시되어 mock 값으로 대체하지 않습니다.

## 4. 주요 파일

- `src/main.js`: 라우팅, 상태, ESP32 polling, 재활 분석 호출, 기준선 버튼, 일일 로그 저장, 8001 상태 동기화
- `src/data/gait-algorithms.js`: 압력·IMU 지표, CoP, FoG, 재활 경고, 반복 판정, 진동 피드백 계획
- `src/data/dashboard-data.js`: mock 데이터와 초기 상태
- `src/services/esp32-api.js`: ESP32 API 요청과 한쪽/양쪽 센서 데이터 정규화
- `src/components/rehab-panel.js`: 재활 설정·지표·CoP·피드백 패널
- `src/components/bilateral-heatmap.js`: 양발 압력/온도/습도 표시
- `src/views/overview-view.js`: 요약 화면
- `src/views/live-view.js`: 실시간 센서 화면
- `src/views/safety-view.js`: 안전 알고리즘 화면
- `src/views/reports-view.js`: 날짜별 재활 로그 화면
- `src/mobile/mobile-app.js`: 모바일 Overview/Live/Safety/Reports 화면
- `src/editor/editor-view.js`: 8001 편집기와 `/api/editor-state` 저장
- `src/styles/app-overhaul.css`: 재활 패널과 리포트 스타일
- `dev-server.mjs`: 8000·8001 공용 정적 서버 및 편집 상태 API
- `.stepon-editor-state.json`: 8001과 8000이 공유하는 편집 문구·센서 위치 상태

## 5. 현재 재활 알고리즘

`analyzeRehabFrame()`은 다음 지표를 계산합니다.

- 왼발·오른발 총압력, 앞꿈치·중족부·뒤꿈치 압력
- 내측·외측 압력 비율과 압력중심(CoP)
- 뒤꿈치 착지 점수, 앞꿈치 추진 점수, 발 들림 지표, 착지 충격
- 좌우 하중 비율, 지지시간 차이, 반복 경고 수
- FoG 우선 처리와 피로 누적 조건

현재 설정값 기본값:

```js
{
  activeFoot: "right",
  allowedLoadPct: 50,
  targetLoadRatio: 50,
  asymmetryTolerancePct: 15,
  supportTimeTolerancePct: 10,
  repeatRequired: 3,
  windowSize: 5,
  clearRequired: 3,
  cooldownMs: 5000
}
```

공통 규칙은 한 번의 이상으로 경고하지 않고, 최근 관찰값에서 반복될 때만 피드백합니다. FoG 가능성이 높으면 일반 재활 피드백보다 FoG 안내를 우선합니다.

사용자 기준선은 재활 패널의 `현재값으로 기준선 생성` 버튼으로 저장합니다. 양발 기준선이 생성되기 전에는 raw 압력을 체중 퍼센트로 환산하지 않으며, 허용 하중 경고를 확정하지 않습니다. FSR raw 값만으로 실제 kg을 알 수 없으므로 의료진·실측 하중을 이용한 별도 보정이 필요합니다.

## 6. 8001 → 8000 동기화

8001은 문구·센서 위치를 `POST /api/editor-state`로 `cap_web/.stepon-editor-state.json`에 저장합니다. 8000은 약 1.2초마다 이 API를 캐시 없이 읽어 현재 화면에 반영합니다.

저장 버튼은 로컬 저장과 공용 API 저장을 모두 수행하고, 성공하면 `8000에 동기화했어요`라는 안내를 표시합니다. 문구를 수정한 뒤에는 입력창에서 빠져나오거나 8001의 `저장` 버튼을 눌러야 합니다.

## 7. 하드웨어 관련 참고

현재 알려진 ESP32-C3 MINI 핀맵은 다음과 같습니다.

- I²C SDA GPIO6, SCL GPIO7: TCA9548A·BMI270·DRV2605L 상위 버스
- CD74HC4067: S0 GPIO1, S1 GPIO3, S2 GPIO4, S3 GPIO5, SIG GPIO0, EN GND
- 압력 입력 4개: P1 앞쪽 C0, P2 가운데 안쪽 C2, P3 가운데 바깥쪽 C4, P4 뒤꿈치 C6
- SHTC3 4개: TCA CH3 뒤꿈치, CH4 중앙, CH5 앞꿈치, CH6 발가락. 자세한 변경/확인 순서는 [4채널 적용 안내](./SENSOR_4CH_GUIDE.md) 참고
- TCA9548A 주소: A0=3.3V, A1/A2=GND → `0x71`
- 진동 출력: DRV2605L I²C, 레이저 제어 GPIO10 (기본 비활성)

펌웨어 작업 폴더는 `firmware/stepon_c3/`이며 업로드 순서는 `01_sensor_test` → `02_wifi_api` → `03_final`입니다. 발등 IMU만으로 발목 관절각을 정확히 측정한다고 표현하지 않습니다.

## 8. 다른 AI에게 보낼 기본 프롬프트

다음 문장을 이 파일과 함께 전달합니다.

```text
이 프로젝트는 StepOn 재활용 웹 프로토타입입니다.

먼저 cap_web/AI_HANDOFF.md와 cap_web/README.md를 읽고, 그 다음 요청과 관련된 실제 코드를 확인해 주세요. 주 작업 범위는 cap_web/이며 사용자가 요청하지 않은 기존 프로젝트 폴더는 수정하지 마세요.

현재 구조는 빌드 없는 native ES module입니다. run.bat으로 8000 사용자 화면과 8001 Design Lab을 실행합니다. 실제 데이터 흐름은 /api/state → esp32-api.js 정규화 → gait-algorithms.js의 analyzeRehabFrame → desktop/mobile 렌더링입니다.

요청:
[여기에 수정할 내용을 작성]

작업 규칙:
1. 먼저 관련 파일과 현재 동작을 확인하세요.
2. 기존 ESP32 실센서 모드와 한쪽 센서의 -- 표시를 깨뜨리지 마세요.
3. 재활 알고리즘의 의료적 진단 표현을 추가하지 마세요.
4. 수정 후 JavaScript 문법 검사와 8000·8001·/mobile 접속을 확인하세요.
5. 변경 파일, 테스트 결과, 사용자가 열 URL을 마지막에 요약하세요.
```

## 9. 검증 명령

```powershell
$nodePath = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $nodePath --check cap_web/src/main.js
Test-NetConnection 127.0.0.1 -Port 8000
Test-NetConnection 127.0.0.1 -Port 8001
```

다른 AI가 코드를 수정한 뒤에는 8000 Overview, 8000 `/mobile`, 8001 Editor를 모두 열어 재활 패널과 편집 동기화를 확인합니다.
