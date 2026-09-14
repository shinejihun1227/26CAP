> **2026-09-14 웹 AI 연결 추가:** 이 수집기의 CSV를 http://127.0.0.1:8000/data/ 에 그대로 넣을 수 있습니다. 보정 25초(5초 정지 + 20초 보행)와 측정 CSV를 각각 준비하세요. [데이터 연결 안내](../../../docs/DATA_PIPELINE.md)

# 06 — ESP32-WROOM-32 + BMI270 보행 CSV 기록

**기존 04 웹/STA 펌웨어와 별개인 USB 기록 전용 코드입니다.** 폴더는 단계 번호를 이어 붙이기 위해 `stepon_c3` 아래에 있지만, **06의 대상은 일반 ESP32-WROOM-32 개발보드**입니다. C3/S3 보드용이 아닙니다.

구성: `BMI270 → I²C → ESP32-WROOM-32 → USB 시리얼 → PC record_csv.py → CSV + 품질 요약 JSON`

- Wi-Fi, 핫스팟, 웹 서버, SD 카드, 압력/온습도 센서, MUX, 진동/레이저가 필요 없습니다.
- 기본 **100Hz 센서 ODR**, 가속도 ±16g, 각속도 ±2000°/s. 기존 04의 64Hz 읽기 코드를 복사하지 않았고 보간하지 않습니다.
- 가속도·각속도가 모두 새 데이터 준비 상태일 때 읽습니다. 읽기 실패 시 가짜 0이나 직전 값을 대신 기록하지 않습니다.
- 이는 보행 중 직접 수집한 6축 시계열입니다. **보행 구간 자동 추출·걸음 수·관절 각도·FoG 판정·AI 학습은 하지 않습니다.** 정지/방향 전환도 그대로 저장됩니다.
- PC에 USB가 연결되어 있어야 저장됩니다. **배터리만 연결한 독립 저장은 지원하지 않습니다.** 그 방식에는 별도 SD 카드 등의 저장 장치가 필요합니다.

## 1. 배선 — 전원을 모두 분리한 뒤 연결

일반 ESP32-WROOM-32 개발보드의 GPIO 번호 기준입니다. 보드의 물리적 다리 순서가 아닙니다.

| BMI270 모듈 | ESP32-WROOM 개발보드 |
|---|---|
| 3.3V / VCC | 3V3 |
| GND | GND |
| SDA | **GPIO21** |
| SCL | **GPIO22** |
| INT | 연결하지 않음 |

**C3에서 쓰던 GPIO6·7을 그대로 사용하지 마세요.** 일반 WROOM-32의 GPIO6~11은 통상 플래시 연결에 쓰입니다. SDA/SCL 및 센서에 5V를 인가하지 마세요. 이 안내는 USB 커넥터·전원 회로가 있는 개발보드 기준이며, 금속 캔 모듈 단품을 USB에 직접 연결하는 안내가 아닙니다.

코드는 0x68·0x69 두 주소의 CHIP_ID=0x24를 확인하고 BMI270 하나만 선택합니다. 주소 선택 핀이 없는 모듈도 이 방식으로 확인합니다. INT 대신 데이터 준비 상태를 I²C로 조회합니다. SDA/SCL 풀업은 모듈 구성을 확인하고 3.3V 기준으로 사용하세요.

## 2. Arduino 업로드

1. `06_bmi270_csv_wroom.ino`를 엽니다.
2. 보드 패키지 `esp32 by Espressif Systems`를 설치하고 **ESP32 Dev Module**을 선택합니다. `ESP32C3 Dev Module`이 아닙니다.
3. 라이브러리 관리자에서 **SparkFun BMI270 Arduino Library**를 설치합니다. 컴파일 검증 버전: ESP32 패키지 2.0.11 / SparkFun BMI270 1.0.3.
4. 연결한 **WROOM 보드의 COM 포트**를 선택하고 업로드합니다. 이전 C3의 COM 번호를 그대로 가정하지 마세요.
5. 필요하면 시리얼 모니터를 **230400 baud**로 열고 RST를 눌러 `# ready=1`과 `D,v1,...` 줄이 출력되는지 확인합니다.
6. **CSV 저장 프로그램을 시작하기 전 시리얼 모니터/플로터를 닫습니다.** 두 프로그램이 COM 포트를 동시에 사용할 수 없습니다.

`# ready=0` 또는 `# ERROR`이면 데이터를 만들지 않습니다. 3.3V/GND, SDA21/SCL22, 모듈 주소를 확인한 뒤 RST로 초기화부터 다시 시험하세요.

## 3. PC 저장 프로그램 준비

Python **3.10 이상**과 pySerial이 필요합니다. `record.bat`은 `py`, 이 PC의 Codex 번들 Python, `python` 순으로 실행기를 찾습니다. 팀원 PC에서는 일반 Python을 설치하면 됩니다.

이 폴더에서 PowerShell/터미널을 열고 최초 한 번 실행합니다.

```powershell
.\record.bat --install
```

pySerial 3.5를 **이 폴더의 `.deps` 안에만 설치**합니다. 프로젝트 밖의 Python 패키지를 바꾸지 않습니다. 또는 본인의 가상환경에서 `python -m pip install -r requirements.txt`를 사용할 수 있습니다.

COM 목록 확인:

```powershell
.\record.bat --list-ports
```

## 4. 실제 CSV 저장

아래의 **COM7은 예시**입니다. 본인의 WROOM COM 번호로 바꾸세요.

```powershell
.\record.bat --port COM7 --seconds 60 --label walking --side left --placement shoe
```

- 첫 정상 샘플 이후 60초 동안 기록합니다.
- `--label walking`은 사용자가 지정한 관찰 조건이지 자동 보행 판정이 아닙니다.
- `--side`/`--placement`는 부착 위치 메모입니다. 값의 좌표축을 자동 회전시키지 않습니다.
- 지정 시간을 생략하면 **Ctrl+C**를 누를 때까지 기록합니다.
- `record.bat`을 더블클릭하면 COM 번호를 직접 입력할 수 있습니다. 이 경우 라벨/좌우/위치는 기본값 `unlabeled`/`unknown`입니다.
- `--out-dir "D:\MyGaitData"`처럼 저장 위치를 선택할 수 있습니다.

표준 Python으로도 같은 프로그램을 실행할 수 있습니다.

```powershell
python record_csv.py --port COM7 --seconds 60 --label walking --side left --placement shoe
```

기본 저장 위치:

```text
06_bmi270_csv_wroom/
└─ recordings/
   ├─ gait_<UTC시각>_<고유번호>.csv   # Excel/Python에서 읽을 실제 측정값
   └─ gait_<UTC시각>_<고유번호>.json  # 조건·단위·품질·종료 이유
```

매번 새 파일을 만들며 기존 기록을 덮어쓰지 않습니다. CSV는 Excel 호환 UTF-8 BOM 형식입니다. 저장 중 파일을 Excel로 열기보다 **기록을 종료한 후** 여세요.

## 5. 저장되는 값

| CSV 열 | 의미 |
|---|---|
| `ax_g`, `ay_g`, `az_g` | 가속도 3축, 단위 g. **중력 포함** |
| `gx_dps`, `gy_dps`, `gz_dps` | 각속도 3축, 단위 °/s. 각도 자체가 아님 |
| `device_time_us` | ESP32가 읽기를 시작한 시각, 부팅 후 마이크로초(64비트). 센서 내부 하드웨어 타임스탬프가 아님 |
| `dt_us` | 직전 정상 IMU 읽기와의 시간 간격. 첫 샘플은 0. UART가 빠뜨린 행과는 별개 |
| `host_utc`, `host_elapsed_s` | PC가 받은 UTC 시각 / 첫 저장 샘플 이후 PC 경과 시간. USB 버퍼 지연이 섞임 |
| `device_id`, `boot_id`, `sequence` | 보드·부팅 식별자와 정상 읽기 번호. 전송되지 않은 행도 번호가 증가함 |
| `read_errors` | 부팅 이후 I²C/센서 읽기 실패 또는 비정상 수치 누적 횟수 |
| `tx_drops` | UART 송신 버퍼 부족 등의 전송 누락 누적 횟수 |
| `gap_events` | 정상 읽기 간격이 20ms를 초과한 횟수. 정확한 센서 누락 개수는 아님 |
| `clip_mask` | 값이 설정 범위의 98% 이상에 근접한 축의 비트 표시. bit0~5 = ax, ay, az, gx, gy, gz |
| `label`, `side`, `placement` | 사용자가 지정한 기록 조건 |

g를 m/s²로 변환하려면 약 9.80665를 곱합니다. 각속도를 적분한 값은 드리프트가 생기므로 이를 관절 각도라고 바로 해석하지 마세요. 센서 내부 필터는 적용되지만 이 프로그램은 추가 평활화·중력 제거·축 회전·사용자 영점 보정·보간을 하지 않습니다.

## 6. 기록 품질 확인

1. 센서를 같은 위치·방향으로 단단히 고정합니다. 전선이 센서를 당기지 않도록 합니다.
2. 먼저 정지 상태 기록과 짧은 보행 기록을 각각 다른 파일/라벨로 남겨 값이 실제 움직임에 반응하는지 확인하세요. 한 축이 반드시 +1g여야 하는 것은 아니며, 정지 시 중력 방향에 따라 분산됩니다.
3. `# STATUS valid_read_hz`는 **정상 읽기 성공 횟수 기반**입니다. 100Hz는 설정값이며 실측 보장은 아닙니다.
4. JSON의 `effective_recorded_hz`, `missing_uart_sequences`, `counter_deltas`, `near_limit_rows`를 확인합니다. 부족한 행을 프로그램이 자동으로 채우지 않습니다.
5. FIFO를 사용하지 않는 최신값 읽기입니다. 긴 지연으로 센서 내부 샘플을 놓칠 수 있으며, UART sequence가 연속이어도 하드웨어 무손실 수집을 증명하지 않습니다.
6. 시작 후 20초 동안 정상 샘플이 없거나, 기록 중 5초 동안 정상 샘플이 끊기면 경고 후 종료합니다. `--startup-timeout`, `--idle-timeout`으로 변경할 수 있습니다.
7. USB 분리·읽기 오류·Ctrl+C에서 이미 받은 CSV를 닫고 요약을 남깁니다. 보드 재부팅/교체가 감지되면 **서로 다른 시간축을 한 기록으로 이어 붙이지 않고 종료**합니다. 프로그램을 다시 실행해 새 파일로 기록하세요.
8. PC 강제 종료/전원 차단까지 완전한 저장을 보장하지는 않습니다. 실행 중 CSV는 약 1초마다 flush하며, 비정상 종료 시 JSON에 `recording`이 남을 수 있습니다.

**보행 중 USB 케이블에 발이 걸리지 않게 하세요.** 우선 안전한 짧은 동선에서 확인하고, 노트북을 안전하게 휴대하거나 보조자가 관리하세요. 무선/독립 저장 기능은 이 코드에 포함되지 않습니다.

## 7. 기존 웹·AI와의 관계 / 수정할 파일

- `06_bmi270_csv_wroom.ino`: WROOM 핀, 센서 설정, 직렬 출력. 현재 v1의 100Hz/±16g/±2000°/s를 바꾸려면 파서·메타데이터의 스키마도 함께 변경해야 합니다.
- `record_csv.py`: CSV 열, 파일 저장, 품질 검사. `record.bat`: 실행/의존성 설치 도우미.
- 기존 00~05 펌웨어, 04의 8.5dBm 설정, 8000/8001 웹은 변경하지 않습니다. **06에는 웹 API가 없으므로 04처럼 웹에 자동 등록되지 않습니다.**
- 06 CSV는 `/data/`에서 장치 시간·단위·부착 정보 검증과 개인 보정 후 64Hz로 재표본화하여 기존 RF/CNN 모델에 연결합니다. 수집 프로그램 자체는 원본 100Hz 시계열을 유지합니다. 성능 평가와 재학습은 별도 정답 데이터가 필요합니다.
- `recordings`와 `.deps`는 Git에서 제외합니다. 다른 경로에 저장한 보행 데이터의 공유 여부는 직접 관리하세요.

## 검증

```powershell
python -m unittest discover -s tests -v
```

테스트 데이터는 테스트 코드 안의 **합성 UART fixture**이고 임시 폴더에서만 사용됩니다. 실제 보행 CSV나 샘플 데이터로 제공하지 않습니다. 컴파일/자동 테스트는 실제 WROOM·BMI270 배선 및 실측 주기 검증을 대신하지 않습니다. 상세 결과는 `VERIFICATION.md`를 확인하세요.

근거: [Espressif I²C API 및 일반 ESP32 기본 핀](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/i2c.html), [SparkFun BMI270 라이브러리](https://github.com/sparkfun/SparkFun_BMI270_Arduino_Library), [pySerial API](https://pyserial.readthedocs.io/en/latest/pyserial_api.html).
