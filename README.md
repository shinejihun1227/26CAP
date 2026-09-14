> **센서 데이터 수집·CSV 분석:** `run.bat` 실행 후 http://127.0.0.1:8000/data/ — [수집 항목·CSV 형식·연결 안내](docs/DATA_PIPELINE.md)

# StepOn — 양발 웹 · RF/CNN AI 통합

2026-09-14: 첨부 `ai_engine_updated_20260909.zip`의 엔진으로 교체하고 최신 양발 STA 웹과 연결했습니다.

1. 최초 1회 `setup-ai.bat` 실행 (Python 3.12 / Node.js 20+).
2. `run.bat` 실행 → 웹 8000, 편집기 8001, AI 8787.
3. 양발 장치를 PC 핫스팟에 연결하고 웹 **기기 연결**에서 확인.
4. **보행 분석 센터 → 왼발/오른발 개인 IMU 보정** (3초 준비, 5초 정지, 20초 보행).
5. 새 4초 창부터 실제 RF/CNN 점수와 최종 판단을 표시합니다.

[전체 실행·보정·CSV 분석·점수 정의](docs/AI_INTEGRATION.md) · [양발 STA 펌웨어](firmware/stepon_c3/04_sta_bilateral/README.md)

합성 신호로 실제 가중치와 HTTP 연동을 검증했습니다. 실제 착용자 보정/센서 검증은 별도로 필요합니다. 센서·보정·분석 창이 없으면 점수를 표시하지 않습니다.

최신 웹은 양발 수집, 재활 지표, 관절 움직임 기록, 변화 기록을 포함합니다. 개인 기록·Wi-Fi 자격증명·보정 파일은 저장소에 포함하지 않습니다.

아래는 2026-09-08 공유본 기록입니다. 현재 기본값은 위 STA 통합 경로입니다. 03_final AP 단일 장치는 `--esp32-url` 옵션으로 계속 사용할 수 있습니다.

---

# StepOn — 웹 · ESP32-C3 · FoG AI 공유본

`wongi`는 **현재 사용하는 웹, 최종 펌웨어, PC AI 추론 파일**을 팀원이 실행·수정할 수 있도록 정리한 브랜치입니다. 기존 `master`는 변경하지 않습니다. 기준일: 2026-09-08.

## 어떤 파일을 받으면 되나요?

**이 브랜치 전체를 받는 것이 가장 안전합니다.** ESP32 코드만 전달할 때는 `firmware/stepon_c3/03_final` 폴더의 세 코드 파일을 모두 전달하세요. `.ino` 하나만 보내면 안 됩니다.

```powershell
git clone --branch wongi --single-branch https://github.com/shinejihun1227/26CAP.git
cd 26CAP
```

Git을 사용하지 않으면 GitHub에서 `wongi` 브랜치를 선택한 뒤 **Code → Download ZIP**으로 받으세요. 웹 서버·Python 환경은 각자 PC에서 실행합니다. GitHub 코드 공유와 웹 서비스 배포는 다릅니다.

```text
26CAP/
├─ cap_web/                         웹 · 모바일/편집 화면 · 웹 규칙 알고리즘
├─ firmware/stepon_c3/03_final/      ESP32-C3 최종 스케치와 센서 헤더 2개
├─ web/ai_bridge/                   ESP32 HTTP → PC AI → 웹 결과 API
├─ ai_engine/
│  ├─ src/fog_validation/           RF/CNN · 보정 · 윈도우 · 상태 판정
│  ├─ data/processed/ml/model_artifact/  RF/CNN 가중치와 판정 설정
│  └─ scripts/                      센서 축 보정 / 선택적 학습·평가
├─ scripts/run-web.mjs              8000/8001 웹 서버 동시 실행
├─ tests/                          공유본 점검 도구
├─ docs/                           파일 역할 · 알고리즘 · 남은 확인 사항
└─ run.bat                         Windows 웹 실행 진입점
```

참고: [수정할 파일](docs/FILE_MAP.md) · [알고리즘 구조](docs/ALGORITHMS.md) · [미구현/검증 필요 사항](docs/KNOWN_LIMITATIONS.md) · [공유본 검증 기록](docs/VERIFICATION.md).

## 1. 웹만 실행 — ESP32와 AI 없이 화면 확인

Node.js를 설치하고 `node --version`이 출력되는지 확인합니다. 별도의 `npm install`은 필요 없습니다.

```powershell
node scripts/run-web.mjs
```

Windows에서는 `run.bat`을 더블클릭해도 됩니다. 종료는 실행 터미널에서 Ctrl+C를 누르세요.

- 사용자 화면: [8000 오늘의 요약](http://127.0.0.1:8000/?view=overview)
- 편집 화면: [8001 편집기](http://127.0.0.1:8001/?mode=editor&screen=overview)
- 모바일 화면: [8000 모바일](http://127.0.0.1:8000/mobile)

처음에는 **코드에 포함된 모의 데이터**로 동작합니다. 실제 사람의 기록이나 실기기 검증 결과가 아닙니다. 기존 브라우저에 실센서 설정이 저장돼 있으면 새 브라우저 프로필로 확인하세요.

8000과 8001은 같은 `cap_web` 파일을 제공합니다. 현재 화면 문구·센서 위치·발 그림 배치는 개인정보가 없는 디자인 설정 `cap_web/editor-state.default.json`으로 포함했습니다. 새 PC에서는 이 기본 배치를 읽습니다. 이후 편집 내용은 로컬 `cap_web/.stepon-editor-state.json`에 저장되고 기본값보다 우선하며 Git에는 포함하지 않습니다. 추가 편집 결과를 공유하려면 개인정보를 확인한 뒤 기본 설정을 갱신하세요.

## 2. ESP32 실제 센서 연결 — AI를 끈 상태부터

1. [펌웨어 안내](firmware/stepon_c3/03_final/README.md)에 따라 라이브러리와 보드를 설정합니다.
2. `firmware/stepon_c3/03_final/03_final.ino`를 ESP32-C3에 업로드합니다.
3. 시리얼 모니터 **115200 baud**에서 리셋 후 부팅 로그를 확인합니다.
4. AP가 정상 시작되면 노트북 Wi-Fi를 `StepOn-C3`에 연결합니다. 기본 시연 암호: `stepon1234`.
5. [장치 ping](http://192.168.4.1/api/ping)과 [센서 JSON](http://192.168.4.1/api/state)을 확인합니다.
6. PC의 웹 서버를 켜고 [실센서 화면·AI 끔](http://127.0.0.1:8000/?esp32=1&ai=0&view=live&esp32Url=http%3A%2F%2F192.168.4.1)을 엽니다.

`127.0.0.1:8000`은 **노트북 웹 서버**, `192.168.4.1`은 **ESP32 센서 API**입니다. ESP32의 `/`에는 웹 화면이 없습니다. AP에 인터넷이 없어도 로컬 웹은 실행할 수 있습니다. 프로그램/라이브러리 설치는 인터넷이 되는 환경에서 먼저 하세요.

> 현재 보드에서 AP가 나타나지 않는다는 제보는 아직 해결 검증 전입니다. 공유본은 Wi-Fi 수정판이 아니며 기존 최종 펌웨어를 그대로 포함했습니다. [알려진 한계](docs/KNOWN_LIMITATIONS.md)를 참고하세요.

## 3. PC AI 추론까지 연결

Python 3.12 환경에서 아래 명령을 저장소 최상위에서 실행합니다. `.venv`는 PC마다 생성합니다.

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r ai_engine/requirements.txt
.venv\Scripts\python.exe -m pip install --no-deps -e ai_engine
```

설치된 Python 명령이 `python`이면 첫 줄의 `py -3.12`를 `python`으로 바꾸세요. RF 파일에 기록된 학습 버전이 `scikit-learn 1.9.0`이므로 해당 버전을 지정했습니다. `rf` 모드도 현재 import 구조상 PyTorch가 필요합니다.

**실제 사용자와 부착 방향으로 만든 축 보정 JSON이 필요합니다.** 다른 사람의 보정값이나 가짜 값을 실제 판정에 사용하지 마세요. 생성 방법은 [AI 실행 안내](ai_engine/README.md)를 참고하세요.

```powershell
.venv\Scripts\python.exe web/ai_bridge/server.py --esp32-url http://192.168.4.1 --calibration recordings/session.calibration.json --model ensemble
```

[AI 상태 API](http://127.0.0.1:8787/api/ai/state)에서 `detector_loaded`, `device_connected`, `window_ready`가 모두 `true`인지 확인하고 [실센서 + AI 웹](http://127.0.0.1:8000/?esp32=1&ai=1&view=live&esp32Url=http%3A%2F%2F192.168.4.1)을 엽니다. 첫 판정까지 최소 약 4초의 유효 IMU 데이터가 필요합니다.

## 전체 연결

```text
압력 · 온습도 · BMI270 → ESP32-C3 → GET /api/state
                                     ├─ 웹(8000): 센서 표시, 발 디딤/온습도 규칙 계산
                                     └─ PC Python(8787): 축 보정 → 64 Hz 보간
                                          → 4초 창 / 0.5초 간격 → RF + CNN
                                          → yaw 억제 · 연속 판정 · motion 등급
                                          → /api/ai/state → 웹 표시
웹 편집기(8001) → 같은 cap_web의 로컬 화면 설정
```

FoG 모델은 **PC에서 실행**됩니다. ESP32에 RF/CNN을 올리는 구조가 아닙니다. 압력·온습도는 RF/CNN 입력이 아니며 웹의 별도 규칙에 사용합니다. AI 상태 API가 하드웨어를 직접 제어하는 구조도 아닙니다.

## 공유 범위와 주의

- 포함: 웹 코드·실사용 이미지·모의 데이터, 최종 스케치 전체, AI 추론/보정과 관련 전처리 코드, RF/CNN 가중치, 실행 안내.
- 제외: 이전 Flutter/웹/펌웨어, 개인 기록·보정값·편집 상태, 학습 원본/실험 중간 산출물, 가상환경/캐시, PPT·스크린샷·CAD/PCB 자료.
- MediaPipe는 **설정 UI 단계**이며 카메라 랜드마크 추론과 개인 ROM 자동 측정은 미연결입니다.
- 한 발 장치만 연결된 현재 펌웨어로 양발 비교를 검증했다고 해석하면 안 됩니다.
- 기본 레이저 출력과 펌웨어 자동 큐는 꺼져 있습니다. 안전 확인 없이 활성화하지 마세요.
- 서버는 인증이 없는 로컬 시연용입니다. 공개 인터넷에 그대로 노출하지 마세요.
- 연구/시연용 보조 시스템이며 모델의 `confirmed`는 임상 확진이 아닙니다.
- 이 공유본이 외부 재배포/상용 사용 권한을 새로 부여하는 것은 아닙니다. 원저작자와 데이터 출처 조건을 별도 확인하세요.
