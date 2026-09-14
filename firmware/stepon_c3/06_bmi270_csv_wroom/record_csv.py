"""Record real StepOn 06 UART samples. No simulator, interpolation or gait inference."""
from __future__ import annotations

import argparse
from collections import deque
import csv
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import sys
import time
import uuid

BAUD = 230400
WIRE_FIELDS = (
    "record_type", "protocol", "device_id", "boot_id", "sequence",
    "device_time_us", "dt_us", "ax_g", "ay_g", "az_g", "gx_dps", "gy_dps",
    "gz_dps", "read_errors", "tx_drops", "gap_events", "clip_mask",
)
CSV_FIELDS = ("host_utc", "host_elapsed_s", "label", "side", "placement") + WIRE_FIELDS[2:]
INTEGER_FIELDS = ("sequence", "device_time_us", "dt_us", "read_errors", "tx_drops", "gap_events", "clip_mask")
AXES = ("ax_g", "ay_g", "az_g", "gx_dps", "gy_dps", "gz_dps")
COUNTERS = ("read_errors", "tx_drops", "gap_events")


class CaptureStopped(RuntimeError):
    """A recording must not silently mix devices, boots or regressed clocks."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def parse_sample(line: str) -> dict | None:
    if not line.startswith("D,"):
        return None  # Boot messages, CSV headers and # diagnostics are not samples.
    parts = line.strip().split(",")
    if len(parts) != len(WIRE_FIELDS):
        raise ValueError("wrong_field_count")
    result = dict(zip(WIRE_FIELDS, parts))
    if result["protocol"] != "v1":
        raise ValueError("unsupported_protocol")
    for field, length in (("device_id", 12), ("boot_id", 8)):
        if not re.fullmatch(rf"[0-9a-f]{{{length}}}", result[field]):
            raise ValueError("invalid_identity")
    for field in INTEGER_FIELDS:
        if not re.fullmatch(r"[0-9]{1,20}", result[field]):
            raise ValueError("invalid_integer")
        result[field] = int(result[field])
        limit = (1 << 64) - 1 if field in ("device_time_us", "dt_us") else (1 << 32) - 1
        if result[field] > limit:
            raise ValueError("integer_out_of_range")
    if result["sequence"] < 1 or result["device_time_us"] < 1 or result["dt_us"] > result["device_time_us"] or result["clip_mask"] > 63:
        raise ValueError("invalid_sample_clock_or_flags")
    for field in AXES:
        value = float(result[field])
        limit = 16.001 if field.startswith("a") else 2000.001
        if not math.isfinite(value) or abs(value) > limit:
            raise ValueError("invalid_axis_value")
        result[field] = value
    return result


class LineFramer:
    """Keep partial UART lines across read timeouts, with bounded memory."""
    def __init__(self, limit: int = 1024):
        self.limit = limit
        self.buffer = bytearray()
        self.discarding = False
        self.oversized_lines = 0

    def feed(self, chunk: bytes) -> list[str]:
        lines = []
        for byte in chunk:
            if byte == 10:
                if not self.discarding:
                    lines.append(self.buffer.decode("ascii", errors="replace").rstrip("\r"))
                self.buffer.clear()
                self.discarding = False
            elif not self.discarding:
                self.buffer.append(byte)
                if len(self.buffer) > self.limit:
                    self.buffer.clear()
                    self.discarding = True
                    self.oversized_lines += 1
        return lines


class CsvRecording:
    def __init__(self, directory: Path, *, label="unlabeled", side="unknown", placement="unknown", port="", clock=time.monotonic):
        self.clock = clock
        self.started_at = clock()
        self.first_at = None
        self.last_at = None
        self.first_sample = None
        self.last_sample = None
        self.closed = False
        self.rows = self.bad_lines = self.ignored_lines = self.missing_sequences = 0
        self.near_limit_rows = 0
        self.diagnostics = deque(maxlen=20)
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
        base = f"gait_{stamp}_{uuid.uuid4().hex[:8]}"
        self.csv_path = directory / f"{base}.csv"
        self.json_path = directory / f"{base}.json"
        self.csv_file = self.csv_path.open("x", encoding="utf-8-sig", newline="")
        try:
            self.meta_file = self.json_path.open("x", encoding="utf-8")
        except BaseException:
            self.csv_file.close()
            raise
        self.label, self.side, self.placement = label, side, placement
        self.writer = csv.DictWriter(self.csv_file, fieldnames=CSV_FIELDS)
        self.writer.writeheader()
        self.csv_file.flush()
        self.meta = {
            "schema": "stepon-bmi270-csv-v1", "status": "recording", "created_utc": utc_now(),
            "port": port, "baud": BAUD, "label": label, "side": side, "placement": placement,
            "label_source": "operator_annotation_not_automatic_detection",
            "odr_hz": 100, "accel_range_g": 16, "gyro_range_dps": 2000,
            "acceleration_includes_gravity": True, "calibrated": False,
            "device_time_basis": "ESP32 esp_timer microseconds at read start, NOT hardware sample time",
            "host_time_basis": "PC receive time, affected by USB buffering",
            "acquisition": "data_ready_polling_latest_sample_no_fifo_no_interpolation",
            "clip_mask_bits": ["ax", "ay", "az", "gx", "gy", "gz"],
            "clip_mask_meaning": "at least 98 percent of configured full-scale range",
            "csv": self.csv_path.name,
        }
        self._write_meta()

    def _write_meta(self):
        self.meta_file.seek(0)
        json.dump(self.meta, self.meta_file, ensure_ascii=False, indent=2)
        self.meta_file.write("\n")
        self.meta_file.truncate()
        self.meta_file.flush()

    def consume(self, line: str) -> bool:
        try:
            sample = parse_sample(line)
        except (ValueError, OverflowError):
            self.bad_lines += 1
            return False
        if sample is None:
            self.ignored_lines += 1
            if line.startswith("#"):
                self.diagnostics.append(line[:1024])
            return False
        old = self.last_sample
        if old:
            if sample["device_id"] != old["device_id"]:
                raise CaptureStopped("device_changed")
            if sample["boot_id"] != old["boot_id"]:
                raise CaptureStopped("board_reset")
            if sample["device_time_us"] <= old["device_time_us"] or sample["sequence"] <= old["sequence"]:
                raise CaptureStopped("sample_clock_or_sequence_regressed")
            if any(sample[key] < old[key] for key in COUNTERS):
                raise CaptureStopped("quality_counter_regressed")
            self.missing_sequences += sample["sequence"] - old["sequence"] - 1
        now = self.clock()
        if self.first_at is None:
            self.first_at, self.first_sample = now, sample
        row = {key: sample[key] for key in WIRE_FIELDS[2:]}
        row.update(host_utc=utc_now(), host_elapsed_s=f"{now - self.first_at:.6f}",
                   label=self.label, side=self.side, placement=self.placement)
        self.writer.writerow(row)
        self.rows += 1
        self.near_limit_rows += int(sample["clip_mask"] != 0)
        self.last_at, self.last_sample = now, sample
        return True

    def finish(self, reason: str, *, oversized_lines=0, trailing_bytes=0):
        if self.closed:
            return
        self.closed = True
        try:
            self.csv_file.flush()
            interval = (self.last_sample["device_time_us"] - self.first_sample["device_time_us"]) / 1e6 if self.rows > 1 else 0
            self.meta.update(
                status="completed" if reason in ("duration_reached", "user_stopped") and self.rows else "stopped_with_warning",
                ended_utc=utc_now(), stop_reason=reason, rows=self.rows,
                invalid_data_lines=self.bad_lines, ignored_non_data_lines=self.ignored_lines,
                oversized_lines=oversized_lines, trailing_incomplete_bytes=trailing_bytes,
                missing_uart_sequences=self.missing_sequences, near_limit_rows=self.near_limit_rows,
                recorded_device_span_s=interval,
                effective_recorded_hz=(self.rows - 1) / interval if interval > 0 else None,
                first_sample=self.first_sample, last_sample=self.last_sample,
                counter_deltas={key: self.last_sample[key] - self.first_sample[key] for key in COUNTERS} if self.rows else {},
                recent_firmware_diagnostics=list(self.diagnostics),
            )
            self._write_meta()
        finally:
            self.csv_file.close()
            self.meta_file.close()


def capture_stream(stream, recording: CsvRecording, *, seconds=0, startup_timeout=20, idle_timeout=5, clock=time.monotonic, report=print):
    framer = LineFramer()
    last_flush = last_report = clock()
    reason = "error"
    try:
        while True:
            now = clock()
            if recording.first_at is None and now - recording.started_at >= startup_timeout:
                raise CaptureStopped("no_valid_samples_check_board_wiring_baud")
            if recording.last_at is not None and now - recording.last_at >= idle_timeout:
                raise CaptureStopped("valid_sample_timeout_check_USB_and_IMU")
            if seconds and recording.first_at is not None and now - recording.first_at >= seconds:
                reason = "duration_reached"
                break
            chunk = stream.read(min(max(stream.in_waiting, 1), 4096))
            for line in framer.feed(chunk):
                if line.startswith("# ERROR"):
                    report(line)
                recording.consume(line)
            now = clock()
            if now - last_flush >= 1:
                recording.csv_file.flush()
                last_flush = now
            if now - last_report >= 2:
                report(f"rows={recording.rows} invalid={recording.bad_lines} missing_uart_sequences={recording.missing_sequences}")
                last_report = now
    except KeyboardInterrupt:
        reason = "user_stopped"
    except CaptureStopped as exc:
        reason = str(exc)
        report(f"STOP: {reason}")
    except Exception as exc:
        reason = f"io_error:{type(exc).__name__}"
        report(f"STOP: {exc}")
    finally:
        recording.finish(reason, oversized_lines=framer.oversized_lines, trailing_bytes=len(framer.buffer))
    return 0 if reason in ("duration_reached", "user_stopped") and recording.rows else 1


def label_code(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,48}", value):
        raise argparse.ArgumentTypeError("Use 1-48 letters/digits/_/- for an anonymous label, e.g. walking or standing")
    return value


def positive_number(value: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("Must be a finite positive number")
    return number


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="The WROOM board's port, e.g. COM7; close Arduino Serial Monitor first")
    parser.add_argument("--list-ports", action="store_true")
    parser.add_argument("--seconds", type=positive_number, default=0, help="Duration after first valid sample; omit for Ctrl+C stop")
    parser.add_argument("--startup-timeout", type=positive_number, default=20)
    parser.add_argument("--idle-timeout", type=positive_number, default=5)
    parser.add_argument("--label", type=label_code, default="unlabeled", help="Operator label only, NOT AI classification")
    parser.add_argument("--side", choices=("left", "right", "unknown"), default="unknown")
    parser.add_argument("--placement", choices=("shoe", "ankle", "shank", "waist", "hand", "unknown"), default="unknown")
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent / "recordings")
    args = parser.parse_args(argv)
    local_deps = Path(__file__).resolve().parent / ".deps"
    if local_deps.is_dir():
        sys.path.insert(0, str(local_deps))
    try:
        import serial
        from serial.tools import list_ports
    except ImportError:
        print("pyserial is missing. Run record.bat --install, or install requirements.txt with Python 3.10+.", file=sys.stderr)
        return 2
    if args.list_ports or not args.port:
        ports = list(list_ports.comports())
        for port in ports:
            print(f"{port.device}: {port.description}")
        if not ports:
            print("No serial ports found. Connect the WROOM board using a data-capable USB cable.")
        if args.list_ports:
            return 0
        if not sys.stdin.isatty():
            parser.error("Pass --port COMx")
        args.port = input("WROOM COM port (example COM7): ").strip()
        if not args.port:
            parser.error("A serial port is required")
    stream = serial.Serial(port=None, baudrate=BAUD, timeout=0.2, write_timeout=1, rtscts=False, dsrdtr=False)
    # Do not intentionally reset the board. Some USB drivers can still pulse these on open.
    stream.dtr = False
    stream.rts = False
    stream.port = args.port
    recording = None
    try:
        stream.open()
        stream.reset_input_buffer()  # Discard pre-recording backlog; partial lines are filtered.
        recording = CsvRecording(args.out_dir, label=args.label, side=args.side, placement=args.placement, port=args.port)
        print(f"CSV: {recording.csv_path.resolve()}")
        print("Recording real IMU data. Ctrl+C stops and closes files. Keep the USB cable safe while walking.")
        result = capture_stream(stream, recording, seconds=args.seconds, startup_timeout=args.startup_timeout, idle_timeout=args.idle_timeout)
        print(f"Saved {recording.rows} rows. Summary: {recording.json_path.resolve()}")
        return result
    except (serial.SerialException, OSError) as exc:
        print(f"Cannot record: {exc}\nClose Arduino Serial Monitor and check the WROOM COM port.", file=sys.stderr)
        return 1
    finally:
        stream.close()
        if recording is not None and not recording.closed:
            recording.finish("unexpected_stop")


if __name__ == "__main__":
    raise SystemExit(main())
