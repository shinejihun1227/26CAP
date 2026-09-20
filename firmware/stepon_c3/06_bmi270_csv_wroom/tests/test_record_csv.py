"""Synthetic UART fixtures only. No serial ports, sensors or real gait recordings."""
import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("record_csv", ROOT / "record_csv.py")
record = importlib.util.module_from_spec(spec)
spec.loader.exec_module(record)


def packet(sequence=1, stamp=10000, boot="12345678", **changes):
    fields = dict(zip(record.WIRE_FIELDS, ["D", "v1", "aabbccddeeff", boot, str(sequence), str(stamp),
                     "0" if sequence == 1 else "10000", "0.001", "-0.002", "1.000", "0.1", "-0.2", "0.3", "0", "0", "0", "0"]))
    fields.update({key: str(value) for key, value in changes.items()})
    return ",".join(fields[key] for key in record.WIRE_FIELDS)


class FakeClock:
    def __init__(self):
        self.value = 0.0
    def __call__(self):
        return self.value


class FakeSerial:
    def __init__(self, clock, chunks=(), failure=None):
        self.clock, self.chunks, self.failure = clock, list(chunks), failure
    @property
    def in_waiting(self):
        return len(self.chunks[0]) if self.chunks else 0
    def read(self, size):
        self.clock.value += 0.01
        if self.chunks:
            return self.chunks.pop(0)
        if self.failure:
            raise self.failure
        return b""


class ProtocolTests(unittest.TestCase):
    def test_valid_units_and_64_bit_clock(self):
        sample = record.parse_sample(packet(stamp=5_000_000_000))
        self.assertEqual(sample["device_time_us"], 5_000_000_000)
        self.assertEqual(sample["az_g"], 1.0)
        self.assertEqual(sample["gy_dps"], -0.2)

    def test_comments_headers_and_legacy_logs_are_not_data(self):
        for line in ("# STATUS ready=0", ",".join(record.WIRE_FIELDS), "[STATE] IMU=0 rate=64.0Hz", "ESP-ROM:"):
            self.assertIsNone(record.parse_sample(line))

    def test_nonfinite_out_of_range_and_bad_schema_rejected(self):
        for changes in ({"ax_g": "nan"}, {"gy_dps": "inf"}, {"ax_g": 17}, {"gz_dps": -2100},
                        {"device_id": "not-a-board"}, {"boot_id": "0"}, {"protocol": "v2"},
                        {"sequence": -1}, {"sequence": 0}, {"clip_mask": 64}, {"dt_us": 10001}, {"tx_drops": 1 << 32}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                record.parse_sample(packet(**changes))
        with self.assertRaises(ValueError):
            record.parse_sample(packet() + ",extra")

    def test_partial_uart_lines_survive_timeouts(self):
        framer = record.LineFramer()
        raw = (packet() + "\r\n").encode()
        self.assertEqual(framer.feed(raw[:21]), [])
        self.assertEqual(framer.feed(b""), [])
        self.assertEqual(framer.feed(raw[21:]), [packet()])

    def test_long_garbage_is_bounded_and_recovers(self):
        framer = record.LineFramer(limit=256)
        self.assertEqual(framer.feed(b"X" * 5000), [])
        self.assertLessEqual(len(framer.buffer), 256)
        self.assertEqual(framer.feed(b"\n" + (packet() + "\n").encode()), [packet()])
        self.assertEqual(framer.oversized_lines, 1)

    def test_operator_labels_reject_formula_and_path_characters(self):
        self.assertEqual(record.label_code("walking_trial-01"), "walking_trial-01")
        for label in ("=1+1", "../other", "", "a,b", "x" * 49):
            with self.assertRaises(Exception):
                record.label_code(label)


class RecordingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.clock = FakeClock()
        self.writer = record.CsvRecording(Path(self.temp.name), label="walking", side="left", placement="shoe", clock=self.clock)
    def tearDown(self):
        self.writer.finish("test_cleanup")
        self.temp.cleanup()
    def csv_rows(self):
        with self.writer.csv_path.open(encoding="utf-8-sig", newline="") as source:
            return list(csv.DictReader(source))
    def summary(self):
        return json.loads(self.writer.json_path.read_text(encoding="utf-8"))

    def test_csv_round_trip_and_quality_metadata(self):
        self.writer.consume(packet())
        self.clock.value = 0.02
        self.writer.consume(packet(3, 30000, tx_drops=1, clip_mask=1, ax_g=15.99))
        self.writer.finish("user_stopped")
        rows = self.csv_rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual(list(rows[0]), list(record.CSV_FIELDS))
        self.assertEqual(rows[0]["label"], "walking")
        self.assertEqual(rows[1]["sequence"], "3")
        summary = self.summary()
        self.assertEqual(summary["missing_uart_sequences"], 1)
        self.assertEqual(summary["counter_deltas"]["tx_drops"], 1)
        self.assertEqual(summary["near_limit_rows"], 1)
        self.assertEqual(summary["status"], "completed")
        self.assertEqual(summary["effective_recorded_hz"], 50)

    def test_failure_is_not_zero_filled(self):
        self.writer.consume("# ERROR: IMU failed")
        self.writer.consume(packet(ax_g="nan"))
        self.writer.finish("no_valid_samples")
        self.assertEqual(self.csv_rows(), [])
        self.assertEqual(self.summary()["invalid_data_lines"], 1)
        self.assertEqual(self.summary()["status"], "stopped_with_warning")

    def test_reset_does_not_mix_boots(self):
        self.writer.consume(packet())
        with self.assertRaisesRegex(record.CaptureStopped, "board_reset"):
            self.writer.consume(packet(2, 20000, boot="87654321"))
        self.assertEqual(self.writer.rows, 1)

    def test_device_change_and_regression_stop(self):
        self.writer.consume(packet(2, 20000, read_errors=1))
        for row, reason in ((packet(3, 30000, device_id="001122334455"), "device_changed"),
                            (packet(2, 20000), "regressed"), (packet(3, 30000), "quality_counter_regressed")):
            with self.assertRaisesRegex(record.CaptureStopped, reason):
                self.writer.consume(row)

    def test_new_file_never_overwrites_existing_capture(self):
        other = record.CsvRecording(Path(self.temp.name), clock=self.clock)
        try:
            self.assertNotEqual(self.writer.csv_path, other.csv_path)
            self.assertTrue(self.writer.csv_path.exists())
        finally:
            other.finish("test_cleanup")

    def test_capture_duration_and_split_stream(self):
        raw = ("# ready=1\n" + packet() + "\n" + packet(2, 20000) + "\n").encode()
        stream = FakeSerial(self.clock, [raw[:35], raw[35:]])
        code = record.capture_stream(stream, self.writer, seconds=0.03, clock=self.clock, report=lambda _: None)
        self.assertEqual(code, 0)
        self.assertEqual(len(self.csv_rows()), 2)
        self.assertEqual(self.summary()["stop_reason"], "duration_reached")

    def test_startup_timeout_reports_no_samples(self):
        code = record.capture_stream(FakeSerial(self.clock), self.writer, startup_timeout=0.03, clock=self.clock, report=lambda _: None)
        self.assertEqual(code, 1)
        self.assertEqual(self.summary()["rows"], 0)

    def test_idle_timeout_preserves_partial_csv(self):
        stream = FakeSerial(self.clock, [(packet() + "\n").encode()])
        code = record.capture_stream(stream, self.writer, idle_timeout=0.03, clock=self.clock, report=lambda _: None)
        self.assertEqual(code, 1)
        self.assertEqual(len(self.csv_rows()), 1)

    def test_disconnect_and_ctrl_c_preserve_rows(self):
        stream = FakeSerial(self.clock, [(packet() + "\n").encode()], OSError("USB removed"))
        code = record.capture_stream(stream, self.writer, clock=self.clock, report=lambda _: None)
        self.assertEqual(code, 1)
        self.assertEqual(len(self.csv_rows()), 1)
        self.assertEqual(self.summary()["stop_reason"], "io_error:OSError")

    def test_keyboard_interrupt_is_clean_stop(self):
        stream = FakeSerial(self.clock, [(packet() + "\n").encode()], KeyboardInterrupt())
        code = record.capture_stream(stream, self.writer, clock=self.clock, report=lambda _: None)
        self.assertEqual(code, 0)
        self.assertEqual(self.summary()["stop_reason"], "user_stopped")


class FirmwareContractTests(unittest.TestCase):
    def test_wroom_pinmap_and_data_ready_contract(self):
        source = (ROOT / "06_bmi270_csv_wroom.ino").read_text(encoding="utf-8")
        for phrase in ("CONFIG_IDF_TARGET_ESP32", "SDA_PIN = 21, SCL_PIN = 22", "SERIAL_BAUD = 230400",
                       "BMI2_ACC_ODR_100HZ", "BMI2_GYR_ODR_100HZ", "BMI2_DRDY_ACC | BMI2_DRDY_GYR",
                       "imu.getSensorData() != BMI2_OK", "!isfinite(value)", "esp_timer_get_time()",
                       "Serial.availableForWrite() < length", ",".join(record.WIRE_FIELDS)):
            self.assertIn(phrase, source)
        for forbidden in ("WiFi.begin", "softAP(", "sensor_core.h", "../04_"):
            self.assertNotIn(forbidden, source)
        # esp_random() creates only the boot ID. It must never synthesize axes.
        capture = source.split("void captureOne()", 1)[1].split("void loop()", 1)[0]
        self.assertNotIn("random", capture)


if __name__ == "__main__":
    unittest.main()
