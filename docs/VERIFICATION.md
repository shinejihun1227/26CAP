# 공유본 검증 기록

2026-09-08, Windows의 별도 공유 작업 사본에서 검사했습니다. 원래 작업 폴더의 웹·AI·펌웨어 동작 파일은 변경하지 않았습니다.

## 통과 항목

- 웹/AI/펌웨어/모델 원본 복사 파일을 SHA256으로 비교: 일치. 이후 `dev-server.mjs`에는 공유용 디자인 기본값을 읽는 경로만 추가했습니다. 센서 위치/화면 문구 스냅샷도 원본과 동일하게 별도 포함했습니다.
- JavaScript 문법 및 상대 import 누락 검사: 통과.
- 별도 임시 포트에서 웹 페이지·CSS·JS·이미지·디자인 설정 등 HTTP 경로 48개: 200 응답.
- 새 PC처럼 로컬 편집 파일이 없는 상태에서 `/api/editor-state`가 공유 기본 배치를 읽음: 통과.
- 압력 규칙의 결측/접촉/합계 기본 테스트: 통과.
- Markdown 상대 문서 링크: 누락 없음.
- 별도 Python 가상환경에서 의존성 설치 및 `pip check`: 통과.
- AI 합성 입력 테스트 6개: 전부 통과.
  - 제공 RF/CNN 가중치 로딩과 확률 출력.
  - ensemble 256샘플 창/32샘플 hop.
  - 20 Hz 합성 시계열 → 64 Hz 선형 보간.
  - 진입/이탈 상태 전환.
  - 합성 ESP32 형식 입력 → 브리지 결과.
  - 보정 파일이 없을 때 준비 완료로 표시하지 않음.

## 확인 환경

Node.js 24.19.0, Python 3.12.14. 핵심 AI 의존성은 검증한 버전으로 `ai_engine/requirements.txt`에 지정했습니다. Python 설치 후 로컬 패키지는 `pip install --no-deps -e ai_engine`로 설치합니다.

## 팀원 재검사 명령

저장소 최상위에서:

```powershell
node tests/check-web.mjs
.venv\Scripts\python.exe -m unittest discover -s tests -v
.venv\Scripts\python.exe -m pip check
```

AI 테스트의 임시 보정 데이터는 테스트 함수가 생성하고 삭제하는 **합성 데이터**입니다. 실제 사용자 보정 파일이 아니며 착용 시험에 사용하면 안 됩니다. 테스트에서 ESP32 네트워크나 출력 장치를 호출하지 않습니다.

## 가중치 SHA256

```text
rf_model.joblib
949b94b3367102eb5599667e3fe898bff2ed63fb1093dbc36b7ef34cc147b5a3

cnn_model.pt
daf5c272f440c2e58f4f7073d36cb76e50e1d222b0b7e258ac427636f69ac7f2
```

## 이번에 하지 않은 검증

브라우저 전체 시각/상호작용 검증, Arduino 실제 컴파일·업로드, ESP32 AP 문제 해결, 실센서 연속 수집률 측정, 카메라/MediaPipe 실행, 진동·레이저 구동, 환자/사용자 대상 성능 검증은 수행하지 않았습니다. [알려진 한계](KNOWN_LIMITATIONS.md)를 반드시 함께 확인하세요.
