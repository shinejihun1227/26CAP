# 웹 수정 안내

저장소 최상위에서 `node scripts/run-web.mjs`를 실행합니다. 의존성 설치/빌드는 없습니다. 개별 서버는 `node cap_web/dev-server.mjs 8000 127.0.0.1`로 실행할 수 있습니다.

- `src/views/*-view.js`: 요약, 실시간, 안전, 리포트, 장치, 개인화.
- `src/mobile/mobile-app.js`: 모바일 전용 화면.
- `src/editor/editor-view.js`: 8001 편집기.
- `src/styles/`: 타이포그래피/색상/간격/반응형. `index.html`의 CSS 로드 순서가 중요합니다.
- `src/components/`: 압력 지도, 양발 히트맵, 차트, 재활 패널.
- `src/data/gait-algorithms.js`: 발 디딤·온습도·재활 규칙.
- `src/data/dashboard-data.js`: 초기 데이터와 모의 센서 데이터. 실제 계측 기록이 아닙니다.
- `src/services/esp32-api.js`: 장치 API 주소/응답 해석/명령 요청.
- `src/services/ai-api.js`: PC AI API 응답 처리.
- `src/main.js`: 모드 선택/상태 관리/갱신/이벤트 연결.
- `editor-state.default.json`: 현재 화면 문구/센서 위치/발 배치의 공유 기본값. 개인 기록은 없으며, 편집 후에는 로컬 `.stepon-editor-state.json`이 우선합니다.

| URL 설정 | 의미 |
|---|---|
| `view=overview`, `view=live` | 사용자 화면 종류 |
| `esp32=1` | ESP32 실센서 사용 |
| `ai=0` / `ai=1` | 실센서 모드에서 PC AI 사용 여부 |
| `esp32Url=http%3A%2F%2F192.168.4.1` | ESP32 API 주소 |
| `mode=editor&screen=overview` | 편집기 화면 |
| `mobile=1` 또는 `/mobile` | 모바일 UI |

8001/편집 모드는 실센서와 AI를 비활성화합니다. 실제 연결 시험은 8000에서 하세요. 웹의 약 750 ms 갱신과 PC AI 브리지의 64 Hz 목표 수집 주기는 서로 다릅니다.

실행에 사용하는 발 실루엣 2개를 `assets/`에 포함했습니다. 작업용 원본 이미지와 추출 도구는 제외했습니다. 서버는 신뢰하는 로컬 시연 환경용입니다.
