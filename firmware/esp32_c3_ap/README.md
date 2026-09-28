# StepOn ESP32 AP 웹 대시보드

> 현재 기본 설정은 사용자가 제공한 일반 ESP32 DevKit/WROOM 배선(GPIO18/19/21/22, GPIO23, GPIO25/26, GPIO34)에 맞춰져 있습니다. Arduino IDE에서 `ESP32 Dev Module`을 선택하세요. C3 MINI를 사용할 때는 `USER_WIRING_CLASSIC_ESP32`를 0으로 바꾸고 C3 전용 핀맵을 사용해야 합니다. 상세 배선은 [사용자 배선 안내](USER_WIRING_CLASSIC_ESP32.md)를 참고하세요.

ESP32가 직접 Wi‑Fi AP를 만들고, 연결된 휴대폰/노트북에 센서 대시보드를 제공하는 첫 번째 테스트 버전입니다.

## 현재 동작

- AP 이름: `StepOn-C3`
- 비밀번호: `stepon1234`
- 접속 주소: `http://192.168.4.1`
- `/api/state`: 압력 8채널(현재 한쪽 깔창), MPU6050 형태의 IMU, 선택형 SHTC3 온·습도 배열, 배터리, COP, 목적별 알고리즘 결과를 JSON으로 반환
- `/api/summary`: LittleFS에 기록된 프레임 수·FoG 이벤트·평균 온습도·최대 위험도 요약 JSON
- `/api/log.csv`: ESP32 내부 `/stepon_log.csv` 다운로드
- `POST /api/log/clear`: CSV와 요약 파일 초기화
- 센서가 아직 연결되지 않은 상태에서는 `USE_MOCK_SENSORS 1`로 테스트값을 생성할 수 있음
- 첫 접속 시 성별·연령대·관찰 목적을 선택하는 온보딩 화면이 표시되며, 선택값은 브라우저에 저장됩니다.
- 웹 화면에는 보행 맥락 게이트, FI·SpectralEntropy·PitchROM, Normal·Warning·FoG·Recovery 상태머신, 진동·레이저 cueing 흐름이 포함되어 있습니다.
- 발바닥 압력맵은 좌우 각각 발꿈치·아치·전족부·발가락 5개 실루엣 위에 FSR 값을 겹쳐 표시합니다.
- 센서 프레임은 `/stepon_log.csv`에 1초 간격으로 누적되고 `/stepon_summary.json`은 5초 간격으로 갱신됩니다. 파일이 약 512 KB를 넘으면 CSV를 새로 시작합니다.
- 선택 목적에 따라 분석이 달라집니다.
  - `parkinson`: 50 Hz IMU, 300샘플 약 6초 창에서 0.5–3 Hz 보행대역과 3–8 Hz freeze 대역의 FI, SpectralEntropy, Pitch 기반 보조 특징, 압력 보행 게이트를 계산하고 3회 연속 Warning 시 FoG로 전환합니다.
  - `diabetes`: 혈당을 계산하지 않고, 좌·우 앞발/뒤꿈치 4점 온도 비대칭(최대·평균), 상대 압력 hotspot, 좌우 하중 차이, 습도를 융합합니다. 2.2°C 참고값이 2개 관찰창 이어질 때 확인 필요로 표시하지만, 임상 기준의 “2일” 확인은 별도로 수행해야 합니다.
  - `posture`: complementary filter로 Roll/Pitch/Yaw를 추정하고, 접지 구간에서 ZUPT를 적용해 발 궤적·보폭·stance/swing을 계산합니다.

## 업로드 방법

1. Arduino IDE에 Espressif ESP32 보드 패키지를 설치합니다.
2. `firmware/esp32_c3_ap/esp32_c3_ap.ino`를 엽니다.
3. 보드를 `ESP32C3 Dev Module`로 선택하고 업로드합니다.
4. 휴대폰 또는 노트북에서 `StepOn-C3` Wi‑Fi에 접속합니다.
5. 브라우저에 `http://192.168.4.1`을 입력합니다.

## 실제 센서 연결 순서

현재 기본 프로필은 사용자가 제공한 일반 ESP32 배선입니다. `esp32_c3_ap.ino` 상단에는 다음이 설정되어 있습니다.

```cpp
#define USER_WIRING_CLASSIC_ESP32 1
#define USE_MOCK_SENSORS 0
#define USE_REAL_I2C_SENSORS 1
#define USE_MPU6050 1
#define USE_REAL_SHTC3 0
#define USE_I2C_MUX 0
#define USE_SECOND_PRESSURE_MUX 0
```

1. Arduino IDE에서 보드를 `ESP32 Dev Module`로 선택합니다.
2. 라이브러리 관리자로 `Adafruit MPU6050`, `Adafruit DRV2605`, `Adafruit Unified Sensor`를 설치합니다.
3. FSR406은 CD74HC4067의 C0/C2/C4/C6/C8/C10/C12/C14에 연결하고, 센서 출력은 GPIO34로 읽습니다. 각 센서는 고정저항과 전압분배를 구성해야 합니다.
4. MPU6050과 DRV2605L은 SDA GPIO25, SCL GPIO26을 공유합니다. MPU6050 AD0를 GND에 연결하면 주소는 `0x68`입니다.
5. `PRESSURE_ADC_MIN`, `PRESSURE_ADC_MAX`, `PRESSURE_INVERTED`를 무부하·최대 하중 실측값으로 보정합니다.
6. 초기에는 레이저를 연결하지 않고 센서와 DRV2605L만 확인합니다. 레이저 출력은 `ENABLE_LASER_OUTPUT 0`으로 기본 차단되어 있습니다.

SHTC3와 TCA9548A는 현재 배선에 포함되지 않았습니다. 나중에 SHTC3를 추가할 때는 `USE_REAL_SHTC3 1`, `USE_I2C_MUX 1`로 바꾸고 TCA9548A 채널 배선을 다시 지정해야 합니다.

## 기존 ESP32-C3 MINI 핀맵 요약(대체 프로필)

아래 표는 `USER_WIRING_CLASSIC_ESP32 0`으로 바꾸고 C3를 사용할 때만 적용됩니다. 현재 사용자가 제공한 GPIO25/26/34 배선에는 적용하지 않습니다.

전체 연결도는 [ESP32-C3 MINI 핀맵 요약도](../../esp32_c3_mini_pinmap_summary.svg)에서 확인할 수 있습니다.

| ESP32-C3 GPIO | 연결 대상 | 비고 |
|---|---|---|
| GPIO4 | I²C SDA | TCA9548A, BMI270, SHTC3 버스 |
| GPIO5 | I²C SCL | TCA9548A, BMI270, SHTC3 버스 |
| GPIO6/7/10/20 | 두 CD74HC4067의 S0/S1/S2/S3 | 두 아날로그 MUX가 선택선을 공유 |
| GPIO0 | 왼발 MUX SIG | ADC1_CH0 |
| GPIO1 | 오른발 MUX SIG | ADC1_CH1 |
| GPIO2 | 비워 둠 | 부트 스트랩 핀이므로 압력 ADC에 배정하지 않음 |
| GPIO3 | 진동모터 EN 예비 | 모터는 GPIO에 직접 연결하지 않고 트랜지스터/MOSFET 사용 |
| GPIO21 | 레이저 EN 예비 | 레이저는 GPIO에 직접 연결하지 않고 트랜지스터/MOSFET 사용 |

현재 핀맵에서 `GPIO20/21`은 UART0 RX/TX 기능과 겹칩니다. USB-Serial 또는 UART 디버깅을 계속 사용할 예정이면 이 두 GPIO를 MUX/출력에 배정하지 말고, 아날로그 MUX 선택선을 GPIO 확장기(MCP23017/TCA9535)로 옮기는 구성을 검토하세요. `GPIO18/19`는 native USB D−/D+, `GPIO2/8/9`는 부트 스트랩, `GPIO12~17`은 모듈 플래시/SPI 관련 핀이므로 일반 센서선으로 피하는 것이 안전합니다.

### TCA9548A 주소와 채널

SHTC3의 I²C 주소는 고정 `0x70`이고, TCA9548A도 기본 주소가 `0x70`입니다. 따라서 TCA9548A의 `A0=3V3`, `A1=A2=GND`로 `0x71`을 만들고 아래처럼 사용합니다.

- TCA9548A CH0 → BMI270 `0x68`
- TCA9548A CH1 → SHTC3 `0x70` / 왼발 뒤꿈치
- TCA9548A CH2 → SHTC3 `0x70` / 왼발 앞발
- TCA9548A CH3 → SHTC3 `0x70` / 오른발 뒤꿈치
- TCA9548A CH4 → SHTC3 `0x70` / 오른발 앞발
- `USE_I2C_MUX 1`, `I2C_MUX_ADDRESS 0x71`

SHTC3는 네 개 모두 주소가 같으므로 서로 다른 TCA 채널에 한 개씩만 연결해야 합니다. 채널 하나에 두 개를 병렬 연결하면 주소 충돌이 발생합니다.

TCA9548A를 아직 장착하지 않고 BMI270만 테스트할 때는 `USE_I2C_MUX 0`으로 둘 수 있습니다. SHTC3 4개 실측 모드에서는 주소 충돌을 피하기 위해 `USE_I2C_MUX 1`이 필수입니다.

`USE_REAL_I2C_SENSORS 1` 경로는 Adafruit Unified Sensor 이벤트를 사용합니다. 가속도는 g, 자이로는 deg/s로 변환해 웹과 CSV에 기록합니다. FI 임계값은 `FOG_FI_THRESHOLD`로 조정하며, standing baseline을 확보한 뒤 개인별로 보정해야 합니다. SHTC3 4개가 모두 정상 연결되면 IWGDF의 대응 부위 온도 차이 참고값을 계산하고 화면에 반복 관찰창과 확인 필요 상태를 표시합니다. 이 값은 “2일 연속” 임상 관찰을 장치의 1초 관찰창으로 대체한 것이 아니므로, 실제 적용에서는 날짜 단위 기록을 별도로 확인해야 합니다.

## 데이터 API 예시

```text
GET http://192.168.4.1/api/state
```

응답에는 `pressure_left`, `pressure_right`, `accel`, `gyro`, 평균 `temperature`/`humidity`, `temperature_sensors[4]`, `humidity_sensors[4]`, `battery`, `risk`, `cop_x`, `cop_y`, 목적별 `algorithms`, `storage`가 포함됩니다. Flutter 앱이나 별도 웹 클라이언트도 같은 API를 읽을 수 있습니다.

## 주의

이 화면은 연구용 프로토타입입니다. 온·습도는 당뇨를 직접 측정하지 않으며, 압력·IMU 데이터도 파킨슨병을 진단하거나 예방한다고 표시할 수 없습니다. 실제 연구·의료 사용 전에는 센서 검증, 안전 설계, 임상 프로토콜 검토가 필요합니다. 진동모터·라인레이저 출력은 실제 착용 전에 반드시 별도 안전 인터록과 수동 정지 절차를 두세요.

