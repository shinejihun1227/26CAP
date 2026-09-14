"""Feature + RandomForest baseline.

RandomForest chosen over XGBoost (the task allowed either): scikit-learn is
already a project dependency and RandomForest's class_weight='balanced'
handles the FoG minority class without adding a new dependency. Swapping in
XGBoost later is a drop-in change (same feature matrix, same evaluate.py).
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import RandomForestClassifier

from fog_validation.ml.augment import expand_with_augmented_copies
from fog_validation.ml.config import RANDOM_SEED
from fog_validation.ml.features import compute_features


def train_baseline(
    X_train: np.ndarray, y_train: np.ndarray,
    augment_rng: np.random.Generator | None = None, n_augmented_copies: int = 0,
    sample_weight: np.ndarray | None = None,
    extra_features: np.ndarray | None = None,
) -> RandomForestClassifier:
    """augment_rng/n_augmented_copies: opt-in only (default off, unchanged
    behavior) - see augment.py. RF has no epoch loop, so augmentation here
    means a STATIC expanded training set (original + N augmented copies),
    fit once - unlike train_cnn's fresh-per-epoch augmentation.

    sample_weight: optional [len(X_train)] per-window weight (e.g. episode-
    based, see windowing.compute_episode_sample_weights), ORTHOGONAL to
    class_weight="balanced" below - sklearn multiplies the two together
    internally, it does not replace one with the other. None (default,
    unchanged behavior) is passed straight through to
    RandomForestClassifier.fit(), which treats sample_weight=None as uniform
    weighting - identical to never having this parameter at all. If
    augmentation is also requested, sample_weight is tiled the same way X/y
    are (original + n_augmented_copies repeats of the SAME weights, since
    augmented copies keep their source window's label and importance).

    extra_features: optional [len(X_train)] (or [len(X_train), k]) opt-in
    array of extra precomputed feature column(s) - e.g. gyro_pitch_rom_min,
    see features.py's module docstring - appended to the 6 features computed
    from X_train. None (default) reproduces the exact original 6-feature
    behavior. Tiled the same way sample_weight is when augmentation is
    requested (an augmented copy is a jittered version of the SAME source
    window, so it keeps that window's own precomputed extra feature value(s)
    unchanged - only X_train's accel channels are perturbed by augmentation,
    never extra_features)."""
    if augment_rng is not None and n_augmented_copies > 0:
        if sample_weight is not None:
            sample_weight = np.tile(sample_weight, n_augmented_copies + 1)
        if extra_features is not None:
            extra_features = np.tile(np.asarray(extra_features), (n_augmented_copies + 1,) +
                                     (1,) * (np.asarray(extra_features).ndim - 1))
        X_train, y_train = expand_with_augmented_copies(
            X_train, y_train, augment_rng, n_augmented_copies=n_augmented_copies)
    feats = compute_features(X_train, extra_features=extra_features)
    clf = RandomForestClassifier(
        n_estimators=300, max_depth=12, class_weight="balanced",
        random_state=RANDOM_SEED, n_jobs=-1,
    )
    clf.fit(feats, y_train, sample_weight=sample_weight)
    return clf


def predict_proba_baseline(clf: RandomForestClassifier, X: np.ndarray,
                           extra_features: np.ndarray | None = None) -> np.ndarray:
    return clf.predict_proba(compute_features(X, extra_features=extra_features))
