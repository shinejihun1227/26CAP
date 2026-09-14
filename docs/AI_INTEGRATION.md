# AI 엔진 교체 및 웹 연동 — 2026-09-14

## 실행

1. 첫 설치: 저장소 루트에서 `setup-ai.bat` 실행. Python 3.12와 Node.js 20 이상을 사용합니다.
2. `run.bat` 실행: 웹 수집 서버 8000, 편집 화면 8001, AI 서버 8787을 시작합니다.
3. PC의 2.4GHz 핫스팟에 `04_sta_bilateral` 양발 장치를 연결합니다. 웹의 **기기 연결**에서 각 발의 연결 및 IMU 상태를 확인합니다.
4. [보행 분석 센터](http://127.0.0.1:8000/?view=safety&esp32=1&transport=sta&ai=1&mobile=0)의 **왼발/오른발 개인 IMU 보정**을 실행합니다. 센서를 실제 사용할 위치에 착용하고 3초 준비 후 5초 정지, 이어서 20초 일반 보행을 기록합니다. 발마다 별도로 진행하며 진행 문구를 확인합니다.
5. 보정이 성공하면 그 발의 모델을 자동으로 로드합니다. 이후 새로운 약 4초의 유효 데이터를 받으면 RF/CNN 점수와 최종 상태가 표시됩니다.

현재 PC에는 의존성이 설치되어 있습니다. 사용자 개인 보정 파일은 임의로 만들지 않았습니다. 다른 착용자나 센서 부착 방향에는 다시 보정해야 합니다. 브라우저 재활 기준선과 IMU 축 보정은 별도입니다.

휴대폰에서는 같은 네트워크의 `http://PC주소:8000/mobile?esp32=1&transport=sta&ai=1`을 사용합니다. 브라우저는 같은 웹 서버의 `/api/ai/*`를 사용하므로 휴대폰에서 Python 8787 포트를 직접 열 필요가 없습니다. 명시적 `aiUrl`은 고급 진단용이며 일반 사용에서는 생략합니다.

보정 원시 CSV와 JSON은 `.stepon-data/ai/`에 저장되며 Git에 포함하지 않습니다. 보정 시 샘플 시간 간격을 확인한 뒤 64Hz 균일 시간축으로 변환합니다. 정지 구간/단위/축 식별 신뢰도가 부족하면 보정이 실패하며 실패 이유가 표시됩니다. 회전 구간을 수집하지 않는 웹 보정에서는 yaw 축을 임의로 추정하지 않습니다. 기존 회전 보정 JSON은 CLI 인자로 사용할 수 있습니다.

## 입력부터 최종 판단까지

```text
양발 ESP32의 IMU(g, deg/s), 압력 4채널, 온습도
  → Node 수집 서버 (장치별 독립 폴링)
  → 중복 제거된 샘플 이력 /api/insoles/samples?after=cursor
  → Python (양발 독립 축 보정·정규화·시간 보간)
  → 64Hz, 256샘플/4초 창, 32샘플/0.5초 간격
  → RF + CNN 원래 FoG 점수 평균
  → yaw 억제(보정된 경우) → 연속 상태머신 → 움직임/무동작 조건
  → 각 발의 normal / warning / confirmed
  → 분석 가능한 발 중 높은 상태, 같은 상태에서는 높은 판정 점수 선택
  → /api/ai/state → 웹·모바일의 최종 판단 및 근거
```

양발 합산은 별도로 학습된 새 양발 모델이 아닙니다. 한 발 모델을 양쪽에 독립 적용한 뒤 `confirmed > warning > normal` 순서로 표시할 결과를 선택하는 표시 정책입니다. 분석 가능한 발의 수와 선택한 발을 함께 표시합니다. 한 발만 준비되어도 그 발의 결과를 표시하지만 양발 검증으로 표현하지 않습니다.

- **원래 모델 점수**: RF/CNN의 FoG 클래스 출력 평균 × 100.
- **판정 점수**: yaw 규칙을 적용한 뒤 상태머신에 들어가는 값 × 100. 큰 회전 조건이면 0으로 억제될 수 있습니다.
- **최종 상태**: 점수만 반올림해서 분류하지 않습니다. ZIP의 임계값·연속 조건·움직임 게이트를 그대로 사용합니다. 장시간 무동작 규칙은 낮은 점수에서도 `warning`을 만들 수 있어 이유를 함께 표시합니다.
- 첨부 ensemble 설정: 진입 0.36, 이탈 0.21, 진입 2개 연속 창. RF 단독 진입 0.195, CNN 단독 진입 0.425.
- 점수는 질환 발생 확률 또는 임상 진단 결과가 아닙니다.

현재 압력은 **4채널 상대값**이고 힘 단위로 보정되지 않았습니다. ZIP의 압력 게이트는 실제 force 기준값이 없으면 비활성인 설계입니다. 상대값을 Newton으로 간주하거나 임의의 peak-force 기준을 만들어 게이트를 켜지 않았습니다. 압력·온습도·MediaPipe는 현재 웹의 별도 관찰 기능에 연결되며 RF/CNN 점수에 임의로 더하지 않습니다. AI 서버는 레이저/진동 장치를 자동 제어하지 않습니다.

## 데이터 품질과 끊김

- 모델 목표 주파수 64Hz와 실제 수신 주파수를 구분합니다. 현재 전송 보호 기준은 실제 수신 32Hz 이상, 단일 공백 최대 100ms입니다. 이 기준은 전송 품질 보호용이며 실기기 성능을 입증하는 수치가 아닙니다.
- 100ms 초과 공백, 시계 역행, 장치 재부팅/교체, 수집 서버 재시작, 이력 유실이면 모델 창·연속 판정·무동작 누적을 초기화합니다.
- 중복 프레임은 분석 창에 다시 넣지 않습니다. NaN/null/누락 IMU를 0으로 바꾸지 않습니다.
- 2초 이상 새 유효 데이터가 없으면 결과를 숨깁니다. 연결 실패·보정 누락·준비 중에는 `null`/`—`이며 정상 또는 0점으로 대신하지 않습니다.
- 웹 보정에는 장치 ID가 저장됩니다. 장치가 교체되면 해당 보정으로 추론하지 않으며 새 장치에서 보정을 다시 시작할 수 있습니다.

## 이미 수집한 CSV 분석

필수 열: `raw_acc_x,raw_acc_y,raw_acc_z,raw_gyro_x,raw_gyro_y,raw_gyro_z`. 가속도 g, 자이로 deg/s. `timestamp_ms`가 있으면 실제 시각을 사용하고, 없으면 실제 확인한 주파수를 `--fs`로 지정합니다.

```powershell
.venv-ai\Scripts\python.exe web/ai_bridge/analyze_csv.py recordings/session.csv --calibration recordings/session.calibration.json --foot right --out recordings/session.ai.json
```

JSON에는 각 창의 원래 모델 점수·판정 점수·최종 상태·이유가 저장됩니다. CSV 재생은 실시간 상태를 바꾸지 않습니다. 분석 가능한 창이 없으면 성공으로 표시하지 않습니다.

기존 AP/03_final 한 발 입력도 지원합니다. 양발 STA 기본 실행과 동시에 같은 8787 포트를 사용하지 마세요.

```powershell
.venv-ai\Scripts\python.exe web/ai_bridge/server.py --esp32-url http://192.168.4.1 --foot right --calibration recordings/session.calibration.json --model ensemble
```

## API 및 파일

- `GET /api/insoles/samples?after=0&limit=512`: 커서·수집 서버 ID·유실 여부·샘플. Node의 메모리에 최대 4096개를 유지합니다.
- `GET /api/ai/state`: 양발 결과, 선택한 발, 원래/판정 점수, 최종 상태, 진단 근거, 보정 및 수신 상태.
- `GET /api/ai/events`: 최근 상태 변화 200건(메모리).
- `POST /api/ai/calibration/start` 또는 `/cancel`: JSON `{"side":"left"}` 또는 `{"side":"right"}`.
- `ai_engine/`: ZIP의 패키지·모델·설정 전체 교체. 가중치 세 파일은 ZIP과 SHA-256이 같습니다. `live_detector.py`에는 판단 근거 노출, 스트림 초기화, 보정 JSON 검증을 추가했습니다. 모델 수식·가중치·임계값은 변경하지 않았습니다.
- `web/ai_bridge/`: 수집 이력 소비, 양발 추론, 보정 녹화, CSV 재생, 실행 스크립트.
- `cap_web/server/ai-proxy.mjs`: 같은 출처의 웹 API를 Python으로 전달.
- `cap_web/src/services/ai-api.js`, `components/ai-status-card.js`: 점수 및 준비 상태 처리, 보정 버튼.

## 검증

```powershell
node --test --test-concurrency=1 cap_web/tests/*.test.mjs
.venv-ai\Scripts\python.exe -m unittest discover -s web/ai_bridge/tests -v
```

실제 저장된 RF/CNN 가중치를 로드하여 합성 신호로 연동을 검증합니다. 보정 누락, 모델 창 완성, 점수 평균, yaw 억제, 시간 공백, 중복, 재부팅, NaN/null, 낮은 수신률, stale 상태, 양발 결과 선택, 보정 저장/실패를 포함합니다. 이는 연동 검증이며 실제 착용자 정확도/민감도 검증은 아닙니다. 사용자 장치와 실측 보정 데이터가 연결되지 않은 환경에서는 센서 입력부터 실사용 판정까지 검증했다고 주장하지 않습니다.

변화 기록에는 서버의 실제 분석 시각과 모델/보정 식별자를 전달합니다. 다른 모델·개인 보정·분석 발의 기록은 같은 조건으로 합치지 않습니다.
