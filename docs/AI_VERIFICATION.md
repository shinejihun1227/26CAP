# AI integration verification — 2026-09-14

Verified from a separate worktree based on `origin/wongi` (`8cbd7d2`).

- 119 web regression/unit tests: passed (sensor hub, four-channel pressure, UI states, MediaPipe/ROM, trend persistence).
- 1 full HTTP test: passed separately using synthetic bilateral sensors, actual bundled RF/CNN weights, the collector cursor endpoint, Python service and the real web proxy. Also checks calibration start/cancel, one-foot loss, full disconnect and null scores. Final run measured about 60/61 Hz input. Synthetic score values are test outputs, not clinical evidence.
- 16 AI integration tests: passed (real weights, CSV replay, calibration capture/validation, timestamps, missing/invalid/duplicate/slow/stale data, reboot/gap reset, separate feet and yaw diagnostics).
- 6 existing AI runtime tests: passed after updating bridge entry point and explicit calibration-missing status.
- `node tests/check-web.mjs`: passed syntax/imports, four-channel pressure rules and 67 HTTP routes/assets.
- All three deployed model artifact files match the uploaded ZIP by SHA-256. Model weights and thresholds were not changed by the web integration.

A cold Python startup overlapped with heavy parallel ROM file tests and exceeded the initial 25-second test startup timeout once. The full HTTP test passed in isolation (about 9 seconds overall), and the documented test command now serializes test files with a 45-second startup allowance.

Browser UI automation timed out in its provider. HTML/render/API checks passed; a visual browser inspection is not claimed. Physical ESP32 sensor capture, wearer-specific calibration and clinical model accuracy remain unverified here. The running local service reports `calibration_missing`, `coverage: 0` and null scores because no real devices/calibration are supplied. No synthetic calibration was installed into the user's runtime data directory.


## 2026-09-14 CSV 데이터 연결 추가 검증

- `node --test --test-concurrency=1 cap_web/tests/*.test.mjs`: **124/124 통과**. 실제 RF/CNN 가중치를 이용한 CSV 업로드 → 별도 분석 프로세스 → 결과 다운로드 HTTP 테스트와 기존 양발 센서 HTTP 테스트 포함.
- `python -m unittest discover -s web/ai_bridge/tests -v`: **26/26 통과**. USB 열/시간 변환, 중복·NaN·센서 범위·포화·보정 실패·장치 혼합, 실제 가중치 CSV 추론, CSV 기록/중단/다운로드, 기존 실시간 보정·판단 회귀 검사.
- `tests/test_ai_runtime.py`: **6/6 통과**. 파일 경로 기반 서버 로딩의 새 모듈 import 호환성도 보완하고 재검증.
- `firmware/stepon_c3/06_bmi270_csv_wroom/tests`: **17/17 통과**. 기존 USB 수집기 소스를 연동 배포에 포함하며 개인 recordings와 의존성 폴더는 제외.
- `node tests/check-web.mjs`: 구문·모듈·4채널 압력·67개 HTTP 경로/자산 검사 통과.
- 새 테스트의 데이터는 합성 fixture이며 임시 디렉터리에서만 사용. 실제 사용자 보정 파일을 만들거나 실시간 보정에 설치하지 않음. 모델 점수의 임상 정확도 검증을 주장하지 않음.
- Windows에서 완료 표시 직후 worker.log 파일이 닫히기 전 테스트 정리가 실행되는 문제를 확인했고, 실제 프로세스 종료 상태 확인 및 제한된 파일 정리 재시도로 해결. 재실행 통과.
- 실제 기존 USB CSV는 원본을 읽어 형식과 품질만 검사. 644행 / 6.471초 / 약 99.37Hz, 좌우 발·부착 위치 unknown. 해당 참가자의 25초 보정이 없어 실제 점수는 계산하지 않음.
- 브라우저 화면의 육안/클릭 자동 검증 및 실물 센서 착용 수집은 수행하지 않음. 새 화면의 HTML·JS 경로, 렌더링 함수, 업로드·다운로드 API와 실제 모델 경로는 자동 검증.

사용 방법: [데이터 수집·CSV·모델 연결 안내](DATA_PIPELINE.md).
