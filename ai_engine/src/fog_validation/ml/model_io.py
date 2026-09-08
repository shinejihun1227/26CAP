"""Persist trained models to disk. Neither model type had a save/load path
before this file - every training script in this project (evaluate.py's
callers, multiseed_robustness.py, ...) trained and evaluated in the same
process, then discarded the model. The live/BLE pipeline needs a model that
was trained once, offline, and can be loaded again later in a separate
process (scripts/ble_receiver.py) - that's what this module is for.
"""
from __future__ import annotations

from pathlib import Path

import joblib
import torch
from sklearn.ensemble import RandomForestClassifier

from fog_validation.ml.models_cnn import FogCNN


def save_rf(clf: RandomForestClassifier, path: Path) -> None:
    joblib.dump(clf, path)


def load_rf(path: Path) -> RandomForestClassifier:
    return joblib.load(path)


def save_cnn(model: FogCNN, path: Path, n_channels: int = 3, n_classes: int = 3) -> None:
    torch.save({"state_dict": model.state_dict(),
               "n_channels": n_channels, "n_classes": n_classes}, path)


def load_cnn(path: Path) -> FogCNN:
    ckpt = torch.load(path, map_location="cpu", weights_only=True)
    model = FogCNN(n_channels=ckpt["n_channels"], n_classes=ckpt["n_classes"])
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model
