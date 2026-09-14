# StepOn cap_web

현재 센서 구성은 **한쪽 깔창당 압력 4개(C0·2·4·6), 온습도 4개(CH3·4·5·6)**입니다. 부착 위치, 수정 파일, 업로드와 확인 순서는 [4채널 적용 안내](./SENSOR_4CH_GUIDE.md)를 참고하세요.

기존 ESP32 로컬 대시보드와 분리한 새 웹 디자인입니다. 현재는 브라우저에서 바로 실행할 수 있는 모듈형 웹으로 구성되어 있으며, 8000·8001 사이의 편집 문구는 `/api/editor-state`로 공유합니다.

다른 프롬프트나 개발자에게 현재 앱·하드웨어·알고리즘 상태를 전달할 때는 [STEPON_PROJECT_CONTEXT.md](./STEPON_PROJECT_CONTEXT.md)를 함께 사용합니다.

## 노트북 웹캠 관절 분석

정면·좌측면·우측면을 하나로 묶으려면 MediaPipe 화면에서 **새 세트 만들기**를 사용하세요. 새로 저장한 기록을 세트에 함께 연결하거나, 기존 방향별 기록의 **세트에 추가**로 묶을 수 있습니다. 통합 자료는 방향·관절·촬영 조건을 보존한 JSON/CSV로 내보냅니다. 서로 다른 시점의 2D 관찰 기록 묶음이며 3D 영상 복원은 아닙니다.

[MediaPipe 전용 화면](http://127.0.0.1:8000/?view=mediapipe&preview=1&mobile=0&esp32=0&ai=0)에서 정면·좌측면·우측면별 관절 각도, 15초 기록, 개인 기준선 비교, 외부 각도계 오차 확인을 사용할 수 있습니다. FoG RF/CNN과 독립적이며 영상·음성은 저장하지 않습니다. 기록은 웹 공개 폴더 밖의 `.stepon-data/mediapipe/`에 저장됩니다.

사용 순서, 각도 정의, 수정할 파일, 개인정보, 자동 테스트 및 실제 웹캠 확인 항목은 [MEDIAPIPE_GUIDE.md](./MEDIAPIPE_GUIDE.md)를 참고하세요. 8000에서 실제 카메라를 사용하며, 8001은 디자인 미리보기입니다. 임상적 진단이나 치료 효과 판정을 제공하지 않습니다. 이전 서버가 실행 중이면 새 API 적용을 위해 재시작해야 합니다.

## 실행

## 개인 변화 추이

새 **변화 추이** 탭에서 MediaPipe 저장 기록과 명시적으로 기록한 실제 센서·알고리즘 관찰값을 전날/직전 기록일/이전 7일 평균과 비교합니다. [사용 안내 및 저장 구조](./TRENDS_GUIDE.md)를 참고하세요. 실제 사용은 8000의 `?view=trends&preview=1`, 편집은 8001의 `?mode=editor&screen=trends`입니다. 시연값은 개인 기록에 섞지 않습니다.

### 서버 실행

프로젝트 루트에서 `run.bat`을 실행하거나, 아래 명령으로 두 포트를 각각 실행합니다.

```powershell
$node = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
Start-Process $node -ArgumentList "dev-server.mjs 8000 0.0.0.0" -WorkingDirectory "$pwd\cap_web"
Start-Process $node -ArgumentList "dev-server.mjs 8001 0.0.0.0" -WorkingDirectory "$pwd\cap_web"
```

- 사용자용 화면: [http://127.0.0.1:8000/?view=overview](http://127.0.0.1:8000/?view=overview)
- 메뉴별 편집기: [http://127.0.0.1:8001/?mode=editor&screen=overview](http://127.0.0.1:8001/?mode=editor&screen=overview)
- 모바일 전용 화면: [http://127.0.0.1:8000/mobile](http://127.0.0.1:8000/mobile)

`127.0.0.1`은 현재 컴퓨터에서만 접근하는 주소입니다. 실제 ESP32 AP 모드에서는 `http://192.168.4.1`을 사용합니다.

휴대폰·아이패드에서 확인하려면 PC와 같은 Wi-Fi에 연결한 뒤, PC의 Wi-Fi IPv4 주소를 확인합니다.

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*'}
```

표시된 주소가 예를 들어 `192.168.0.23`이면 휴대폰에서 아래 주소를 엽니다.

- 사용자 화면: `http://192.168.0.23:8000/?view=overview`
- 모바일 전용 화면: `http://192.168.0.23:8000/mobile`
- 편집기: `http://192.168.0.23:8001/?mode=editor&screen=overview`

8000은 휴대폰의 화면 폭을 감지하면 모바일 전용 UI를 자동으로 표시합니다. PC에서 모바일 화면을 미리 보려면 주소 뒤에 `?mobile=1`을 붙이거나 `/mobile`을 사용하세요. 데스크톱 화면을 강제로 보려면 `?mobile=0`을 사용합니다. 모바일 화면과 데스크톱 화면은 같은 프로필·센서·편집 상태를 읽습니다.

Windows 방화벽에서 Node.js의 사설 네트워크 연결을 허용해야 할 수 있습니다. 공용 Wi-Fi에서는 외부 기기 접속을 열지 않는 것을 권장합니다.

## 8001 디자인 편집 모드

- `http://127.0.0.1:8000`은 일반 사용자용 대시보드입니다.
- `http://127.0.0.1:8001`은 화면을 직접 구성하는 Design Lab입니다.
- 8001 상단의 `8000과 동일한 실제 화면`이 유일한 편집 화면입니다. 별도의 하단 `DIRECT EDITING CANVAS`는 사용하지 않습니다.
- 실제 미리보기의 카드나 제목을 클릭하면 선택되고, 글씨를 직접 누르거나 오른쪽 `속성 편집`에서 제목·설명·글씨 크기를 수정할 수 있습니다.
- 수정한 문구는 8001의 로컬 상태와 두 포트가 함께 읽는 `/.stepon-editor-state.json`에 저장됩니다. 8000은 약 1.2초마다 공용 상태를 확인해 변경 문구를 반영합니다.
- 메뉴 탭은 8000의 Overview·Live·Safety·Reports·Devices·MediaPipe와 1:1로 연결됩니다.
- `저장`, `실행 취소`, `다시 실행`, `설계 요약 복사`, `JSON 내보내기`는 계속 사용할 수 있습니다.

## 구조

```text
cap_web/
  index.html                 # 앱 진입점
  README.md
  assets/                    # 향후 로고·이미지·아이콘 자산
  src/
    editor/editor-view.js    # 8001 실제 8000 미리보기 직접 편집과 상태 저장
    main.js                  # 화면 조립, 라우팅, 이벤트, ESP32 polling
    data/dashboard-data.js   # 임시 센서 데이터와 상태 변화
    data/gait-algorithms.js   # 양발 온습도 비교, FoG 관찰, 출력 큐 계획
    services/cue-controller.js # 브라우저 음성 안내
    services/esp32-api.js     # ESP32 상태 조회·출력 API·상태 변환
    components/              # 재사용 가능한 UI 조각
      charts.js
      icons.js
      metric-card.js
      pressure-map.js
      bilateral-heatmap.js
      algorithm-summary.js   # 최종 알고리즘 요약·센서→판정→안내 파이프라인
      sidebar.js
      topbar.js
    views/                   # 메뉴별 화면
      overview-view.js
      live-view.js
      safety-view.js
      onboarding-view.js
      reports-view.js
      devices-view.js
      mediapipe-view.js
    mobile/mobile-app.js     # 8000 모바일 전용 화면과 온보딩
    styles/                  # 디자인 토큰과 레이아웃/컴포넌트 스타일
      editor.css              # 8001 Design Lab 전용 스타일
      tokens.css
      base.css
      layout.css
      components.css
      onboarding.css
      app-overhaul.css
      design-polish.css         # 공통 대비·간격·터치·히트맵 폴리시 레이어
      mobile.css                # 모바일 전용 카드·하단 탭·입력 화면
      readability-v2.css        # 공통 글씨 크기·행간·대비·알고리즘 요약 레이아웃
```

## 디자인 원칙

- 기존 웹의 teal 배경(`#d9f2f1`)과 navy/coral/mint 팔레트를 유지합니다.
- 센서 데이터는 `src/data/dashboard-data.js`에서만 관리해 실제 API 교체 지점을 한 곳으로 둡니다.
- 알고리즘 임계값과 계산식은 `src/data/gait-algorithms.js`에서 분리해 실험·검증하기 쉽게 둡니다.
- 음성 안내는 `src/services/cue-controller.js`, 레이저·진동·자동 안내 API는 `src/services/esp32-api.js`에서 관리합니다.
- 각 화면은 `src/views/`에서 독립적으로 수정할 수 있습니다.
- 공통 UI는 `src/components/`, 색상·간격·반응형 기준은 `src/styles/`에서 관리합니다.
- `esp32=1` URL 옵션이 없을 때만 시연용 mock을 사용합니다. 의료적 진단이나 치료 판단에 사용하지 않습니다.
- 첫 진입 프로필 설정은 `localStorage`에만 저장되며, 상단 사용자 영역에서 언제든 다시 수정할 수 있습니다.

## ESP32-C3 MINI 실센서 연결

실제 펌웨어는 `../firmware/stepon_c3/`의 `01_sensor_test` → `02_wifi_api` → `03_final` 순서로 업로드합니다. `03_final`은 `/api/state`, `/api/laser`, `/api/vibrate`, `/api/auto-cue`를 제공합니다.

8000 화면에서 실시간 센서값을 읽으려면 ESP32에 `03_final`을 업로드하고, ESP32와 PC를 같은 네트워크에 둔 뒤 아래 주소로 접속합니다.

```text
http://127.0.0.1:8000/?esp32=1&esp32Url=http%3A%2F%2F192.168.4.1
```

AP 모드에서는 PC를 Wi-Fi `StepOn-C3`(비밀번호 `stepon1234`)에 연결하고 `192.168.4.1`을 사용합니다. STA 모드라면 시리얼 모니터에 출력된 ESP32 IP를 사용합니다. `src/services/esp32-api.js`가 주소 저장·타임아웃·CORS API 호출·웹 상태 형식 변환을 담당합니다. `esp32=1`이 없으면 mock 스트림을 사용하고, 실센서 모드에서 연결이 끊기면 화면에 `ESP32 연결 끊김`을 표시합니다.

연결 확인 순서는 다음과 같습니다.

1. `01_sensor_test`: 시리얼 JSON의 `pressure`, `temperature`, `shtc3_ready` 확인
2. `02_wifi_api`: 브라우저에서 `http://192.168.4.1/api/ping`과 `/api/state` 확인
3. `03_final`: `http://127.0.0.1:8000/?esp32=1&esp32Url=http%3A%2F%2F192.168.4.1` 접속
4. 앱의 `Live monitor`에서 압력센서를 누르거나 온도 변화가 생길 때 히트맵·센서 상태·frame 번호가 변하는지 확인

## StepOn AI 모델 연동

압축본의 Python FOG 모델은 `web/ai_bridge`를 통해 이 웹에 연결합니다. AI 브리지는 PC에서
ESP32 `/api/state`를 읽고, 모델을 실행한 뒤 `/api/ai/state`로 결과를 제공합니다. 먼저
AI 브리지 README의 Python 의존성과 캘리브레이션 절차를 완료한 다음 실행하세요.

```powershell
powershell -ExecutionPolicy Bypass -File web/ai_bridge/run_ai_bridge.ps1 `
  -Calibration C:\data\session.calibration.json `
  -Esp32Url http://192.168.4.1
```

웹은 다음 주소로 열면 AI 카드가 활성화됩니다.

```text
http://127.0.0.1:8000/?esp32=1&ai=1&view=live
```

AI 브리지 주소를 별도로 지정해야 하면 `aiUrl` 쿼리 파라미터를 사용할 수 있습니다.

```text
http://127.0.0.1:8000/?esp32=1&ai=1&aiUrl=http%3A%2F%2F192.168.0.23%3A8787&view=live
```

현재 AI 카드는 Overview·Live monitor·Safety lab에 표시되며, AI 판정에 따른 레이저·진동
자동 출력은 안전을 위해 기본 비활성입니다. 기존 웹의 출력 테스트와 수동 제어는 그대로
사용할 수 있습니다.
