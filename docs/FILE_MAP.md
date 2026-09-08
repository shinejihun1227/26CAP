# 팀원별 수정 파일 안내

| 수정 내용 | 파일/폴더 |
|---|---|
| 화면 문구/배치 | `cap_web/src/views/`, `cap_web/src/components/` |
| 글꼴/간격/색상 | `cap_web/src/styles/`, 적용 순서는 `cap_web/index.html` |
| 모바일 | `cap_web/src/mobile/mobile-app.js` |
| 8001 편집기 | `cap_web/src/editor/editor-view.js` |
| 공유되는 초기 문구/센서 배치 | `cap_web/editor-state.default.json` |
| 발 그림/센서 위치 | `cap_web/assets/`, `cap_web/src/data/foot-layout.js`, `sensor-layout.js` |
| 압력·온습도·재활 조건 | `cap_web/src/data/gait-algorithms.js` |
| 히트맵 밝기 임계값 | `cap_web/src/components/bilateral-heatmap.js` |
| 웹 상태·갱신·모드 | `cap_web/src/main.js` |
| ESP32 응답/웹 요청 | `cap_web/src/services/esp32-api.js` |
| 웹 AI 표시/API | `cap_web/src/services/ai-api.js`, `cap_web/src/components/ai-status-card.js` |
| PC 수집·보간/API | `web/ai_bridge/server.py` |
| AI 추론 흐름 | `ai_engine/src/fog_validation/ml/live_detector.py` |
| RF 특징/CNN | `ai_engine/src/fog_validation/ml/features.py`, `models_baseline.py`, `models_cnn.py` |
| AI 연속 판정/움직임 등급 | `ai_engine/src/fog_validation/ml/state_machine.py`, `motion_gate.py` |
| 가중치·판정 파라미터 | `ai_engine/data/processed/ml/model_artifact/` |
| 실제 부착 축 보정 | `ai_engine/scripts/run_calibration.py`, `ai_engine/src/fog_validation/ml/calibration.py` |
| ESP32 Wi-Fi/API/주기 | `firmware/stepon_c3/03_final/03_final.ino` |
| 핀맵·센서 주소 | `firmware/stepon_c3/03_final/sensor_core_local.h` |

표의 짧은 파일명은 같은 행의 앞 파일과 동일 폴더입니다. 모델 파일만 복사하거나 `.ino` 하나만 복사하지 마세요. 폴더 상대 경로를 유지해야 현재 로더가 작동합니다.

## 실행에 필요 없어 제외한 것

기존 Flutter `lib/`, 이전 `site/`·로컬 대시보드, 단계별 펌웨어 구버전, 과거 조사 스크립트/BLE 도구, PPT·캡처·CAD/PCB 자료, 학습 원본/중간 NPZ, 보정·개인 설정, 가상환경/캐시는 제외했습니다. 원래 작업 폴더와 `master`는 보존합니다.

학습 알고리즘은 포함하지만 과거 실험 전체를 재현하는 연구 아카이브는 아닙니다. 실행에 필요한 약 57 MB RF 가중치는 별도 다운로드 없이 이 브랜치에 포함합니다.
