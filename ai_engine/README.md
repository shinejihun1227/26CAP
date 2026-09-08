# FoG AI 실행과 보정

학습이 끝난 `data/processed/ml/model_artifact`의 세 파일을 사용합니다. 웹을 켤 때마다 새 모델을 학습하지 않습니다. 설치/실행은 [루트 README](../README.md)를 따르세요.

## 실제 센서 축 보정

`scripts/run_calibration.py`는 **이미 수집된 CSV를 읽는 도구**입니다. 이 공유본에 실기기 CSV 자동 녹화기는 없습니다. ESP32 `/api/calibrate`도 실제 축 보정 파일을 생성하지 않습니다.

실제 장치로 측정한 균일 시간 간격의 CSV를 `recordings/session.csv`에 준비합니다. 시간 기록으로 실제 샘플링률을 확인하고 지터가 있으면 균일 시간축으로 정리한 후 `--fs`를 지정하세요. HTTP 요청 빈도만 보고 64 Hz로 가정하면 안 됩니다.

필수 열:

```csv
raw_acc_x,raw_acc_y,raw_acc_z
```

선택 열: `raw_gyro_x,raw_gyro_y,raw_gyro_z` (세 열을 모두 넣어야 gyro 사용). 가속도는 g, 자이로는 deg/s입니다. 헤더만 있는 위 예시는 실제 기록이 아니며 보정에 사용할 수 없습니다.

실제 사용할 위치에 장착하고 정지 구간 뒤 일반 보행 구간을 기록합니다. 예를 들어 첫 5초 정지, 이후 20초까지 일반 보행인 **실제 64 Hz 기록**은 다음처럼 처리합니다. 참여자의 안전을 확보하고 어려운 회전 동작을 강요하지 마세요.

```powershell
.venv\Scripts\python.exe ai_engine/scripts/run_calibration.py recordings/session.csv --fs 64 --still-end 5 --out recordings/session.calibration.json
```

기록 끝에 회전 구간이 있고 그 시작이 20초라면 `--walk-end 20`을 추가할 수 있습니다. 회전 구간이 없으면 생략합니다. yaw 축은 검출된 경우에만 억제 규칙에서 사용합니다. 보정 신뢰도 경고가 있으면 부착 방향/기록 구간을 확인합니다.

보정 파일에는 축 방향과 정규화 평균/표준편차가 저장됩니다. **브라우저 재활 기준선, MediaPipe 개인 설정, Python IMU 축 보정은 서로 다른 기능**입니다. `recordings/`와 `*.calibration.json`은 Git에서 제외합니다.

## 포함 코드

- `ml/live_detector.py`: 실시간 추론/최종 상태 등급.
- `ml/models_baseline.py`, `ml/features.py`: RF/6개 특징.
- `ml/models_cnn.py`: 3축 시계열 1D-CNN.
- `ml/model_io.py`: 학습 모델 저장/로드.
- `ml/calibration.py`, `ml/realtime.py`: 축 보정·정규화·실시간 창.
- `ml/state_machine.py`, `ml/motion_gate.py`: 연속 판정·움직임 등급.
- `ml/loaders.py`, `ml/windowing.py`, `ml/channel_map.py`, `ml/resampling.py` 등은 실시간 import 의존성 또는 관련 학습 전처리입니다. 실행만 한다고 임의 삭제하지 마세요.

## 선택: 재학습/평가

현재 모델의 입력 구성과 학습 함수를 보존했습니다. `ml/build_dataset.py`, `scripts/train_fog.py`는 원본 데이터가 있을 때 사용하는 선택적 전처리/학습·평가 도구입니다. 기본 실행에는 필요하지 않습니다.

Daphnet/FoG-STAR/HuGaDB 원본 데이터, train/val/test NPZ, 과거 실험 전체는 포함하지 않습니다. **저장소만 받아 현재 가중치를 완전히 재현하는 패키지는 아닙니다.** 데이터 사용 조건과 `ml/config.py`의 입력 경로를 별도 준비해야 합니다. FoG-STAR 경로는 `FOGSTAR_RAW_CSV` 환경변수로 지정할 수 있습니다.

`train_fog.py`는 평가용이며 실행 중인 가중치를 자동 교체하지 않습니다. 과거 `train_final_model.py`는 현재 ensemble 설정을 완전히 생성하지 않으므로 공유 실행 경로에서 제외했습니다. 새 모델 배포 시 검증 후 RF/CNN 파일과 그 모델에 맞는 `deploy_config.json`을 함께 관리해야 합니다.

모델 파일은 신뢰할 수 있는 출처의 것만 로드하세요. RF joblib은 Python 직렬화 파일입니다.
