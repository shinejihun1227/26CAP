# 사용자 배선 기준 펌웨어 설정

현재 사용자가 제공한 배선은 `ESP32-C3 MINI`가 아니라 일반 ESP32 DevKit/WROOM 계열 기준입니다. 따라서 Arduino IDE에서 `ESP32 Dev Module`을 선택해야 합니다. 펌웨어 파일명에 `c3`가 남아 있는 것은 기존 프로젝트 파일명을 유지한 것입니다.

## 핀맵

| ESP32 GPIO | 연결 대상 |
|---|---|
| 3V3 | CD74HC4067, MPU6050, DRV2605L 전원 |
| GND | 모든 모듈 공통 접지 |
| GPIO18 | MUX S0 |
| GPIO19 | MUX S1 |
| GPIO21 | MUX S2 |
| GPIO22 | MUX S3 |
| GPIO34 | MUX SIG, ADC 입력 |
| GPIO25 | MPU6050·DRV2605L SDA |
| GPIO26 | MPU6050·DRV2605L SCL |
| GPIO23 | BJT 베이스 저항을 거친 레이저 제어 |

현재는 한쪽 깔창 기준으로 CD74HC4067 하나와 압력센서 8개를 사용합니다. 센서의 MUX 채널은 다음 배열로 코드에 반영되어 있습니다.

```cpp
const uint8_t PRESSURE_MUX_CHANNELS[8] = {0, 2, 4, 6, 8, 10, 12, 14};
```

MPU6050의 AD0를 GND에 연결하면 주소는 `0x68`입니다. DRV2605L은 일반적으로 `0x5A`이며 MPU6050과 주소가 겹치지 않으므로 두 장치를 같은 I2C 버스에 연결할 수 있습니다.

## 전원·출력 주의

- FSR406은 반드시 고정저항과 전압분배로 연결합니다. 센서 입력에 5V를 넣지 않습니다.
- 코인모터는 DRV2605L의 `OUT+`, `OUT-`에 연결하고 ESP32 GPIO에 직접 연결하지 않습니다.
- 레이저는 GPIO23에 직접 연결하지 않고, 사용자가 적은 것처럼 BJT의 베이스 저항을 거쳐 저측 스위칭합니다.
- 레이저의 전원은 레이저 정격전압을 사용하고 ESP32와 GND를 공통으로 연결합니다.
- 레이저 출력은 코드에서 안전상 기본 비활성화되어 있습니다. 센서 검증 후 `ENABLE_LASER_OUTPUT`을 `1`로 바꾸세요.

## 코드 설정

`esp32_c3_ap.ino` 상단에는 현재 배선에 맞춰 다음이 설정되어 있습니다.

```cpp
#define USER_WIRING_CLASSIC_ESP32 1
#define USE_MOCK_SENSORS 0
#define USE_REAL_I2C_SENSORS 1
#define USE_MPU6050 1
#define USE_REAL_SHTC3 0
#define USE_I2C_MUX 0
#define USE_SECOND_PRESSURE_MUX 0
#define ENABLE_LASER_OUTPUT 0
```

필요한 Arduino 라이브러리:

- Adafruit MPU6050
- Adafruit Unified Sensor
- Adafruit DRV2605

## 확인 순서

1. Arduino IDE에서 보드를 `ESP32 Dev Module`로 선택합니다.
2. 시리얼 속도를 `115200`으로 엽니다.
3. 업로드 후 `MPU6050: ready`, `DRV2605L: ready`를 확인합니다.
4. `StepOn-C3` Wi-Fi에 연결합니다.
5. `http://192.168.4.1/api/ping`과 `http://192.168.4.1/api/state`를 확인합니다.
6. 압력센서를 하나씩 눌러 `pressure_left[0]`, `pressure_left[1]` 등의 값이 각 채널에 맞게 변하는지 확인합니다.

현재 펌웨어는 `/api/state`를 제공하지만, PC의 `cap_web` 8000/8001 화면은 아직 Mock 데이터 모드입니다. 웹 화면을 실센서로 바꾸려면 다음 단계에서 `http://192.168.4.1/api/state`를 읽는 API 어댑터를 연결해야 합니다.
