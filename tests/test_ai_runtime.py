"""Synthetic packaging tests, NOT clinical validation or wearer calibration.

Run from repository root: .venv/Scripts/python.exe -m unittest discover -s tests -v
No connection to the ESP32 and no actuator requests are made.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai_engine" / "src"))
from fog_validation.ml.live_detector import LiveFogDetector, load_axis_calibration
from fog_validation.ml.model_io import load_rf, load_cnn
from fog_validation.ml.models_baseline import predict_proba_baseline
from fog_validation.ml.models_cnn import predict_proba_cnn
from fog_validation.ml.state_machine import FogStateMachine

spec = importlib.util.spec_from_file_location("stepon_test_bridge", ROOT / "web/ai_bridge/server.py")
bridge_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge_module)
ARTIFACTS = ROOT / "ai_engine/data/processed/ml/model_artifact"


class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        cls.temp = tempfile.TemporaryDirectory(prefix="stepon-test-only-")
        cls.cal_path = Path(cls.temp.name) / "synthetic.calibration.json"
        cls.cal_path.write_text(json.dumps({
            "vertical_channel": "raw_acc_x", "vertical_sign": 1,
            "forward_channel": "raw_acc_y", "lateral_channel": "raw_acc_z",
            "vertical_confidence": 1, "forward_confidence": 1,
            "zscore_mean_vfl": [0, 0, 0], "zscore_std_vfl": [1, 1, 1],
            "gyro_yaw_channel": None,
        }), encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_pretrained_rf_and_cnn(self):
        x = np.random.default_rng(42).normal(size=(1, 256, 3)).astype(np.float32)
        rf = load_rf(ARTIFACTS / "rf_model.joblib")
        rf.n_jobs = 1
        cnn = load_cnn(ARTIFACTS / "cnn_model.pt")
        for proba in [predict_proba_baseline(rf, x), predict_proba_cnn(cnn, x)]:
            self.assertEqual(proba.shape, (1, 3))
            self.assertTrue(np.isfinite(proba).all())
            np.testing.assert_allclose(proba.sum(axis=1), [1.0], atol=1e-5)

    def test_ensemble_window_and_hop(self):
        detector = LiveFogDetector(load_axis_calibration(self.cal_path), "ensemble", ARTIFACTS, "R")
        decisions = []
        for i in range(288):
            decision = detector.push_sample({
                "R_raw_acc": np.array([np.sin(i * 0.2), np.cos(i * 0.1), 0.1]),
                "R_raw_gyro": np.zeros(3),
            })
            if decision is not None:
                decisions.append((i, decision))
        self.assertEqual([i for i, _ in decisions], [255, 287])
        self.assertTrue(all(s in {"normal", "warning", "confirmed"} for _, s in decisions))
        self.assertGreaterEqual(detector.last_fog_score, 0)
        self.assertLessEqual(detector.last_fog_score, 1)

    def test_time_resampler(self):
        out = []
        resampler = bridge_module.TimeResampler(64)
        for i in range(41):
            t = i / 20
            resampler.push(t, np.full(3, t), np.zeros(3), lambda a, g, ts: out.append((ts, a.copy())))
        self.assertEqual(len(out), 129)
        np.testing.assert_allclose(np.diff([t for t, _ in out]), 1 / 64)
        for t, a in out:
            np.testing.assert_allclose(a, [t] * 3, atol=1e-9)

    def test_state_machine_hysteresis(self):
        sm = FogStateMachine(enter_threshold=0.39, exit_threshold=0.24, n_consecutive=2)
        self.assertFalse(sm.update(0.5))
        self.assertTrue(sm.update(0.5))
        self.assertTrue(sm.update(0.3))
        self.assertFalse(sm.update(0.1))

    def test_bridge_with_synthetic_payload(self):
        state = bridge_module.BridgeState("http://127.0.0.1:1", self.cal_path, "ensemble", ARTIFACTS)
        self.assertTrue(state.snapshot()["detector_loaded"])
        self.assertFalse(state.snapshot()["device_connected"])
        for i in range(300):
            state._process_device_payload({
                "frame": i, "millis": i * 1000 / 64,
                "accel": {"x": np.sin(i * 0.2), "y": 0.2, "z": 1.0},
                "gyro": {"x": 0, "y": 0, "z": 0},
            })
        snapshot = state.snapshot()
        self.assertTrue(snapshot["window_ready"])
        self.assertTrue(snapshot["device_connected"])
        self.assertGreaterEqual(snapshot["window_count"], 2)
        self.assertIsNotNone(snapshot["fog_score"])
        json.dumps(snapshot)

    def test_missing_calibration_not_claimed_ready(self):
        state = bridge_module.BridgeState("http://127.0.0.1:1", None, "ensemble", ARTIFACTS)
        snapshot = state.snapshot()
        self.assertFalse(snapshot["ok"])
        self.assertFalse(snapshot["detector_loaded"])
        self.assertEqual(snapshot["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
