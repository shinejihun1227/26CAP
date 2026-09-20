"""Training-only data augmentation for windowed accel signals - simulates
real-world variation this project's static datasets don't capture. Each
augmentation maps to a SPECIFIC deployment risk already identified elsewhere
in this project, not generic "more data" for its own sake:

  rotation jitter: small random 3D rotation of the [vertical, forward,
      lateral] triplet - simulates the auto-calibration axis identification
      never being perfectly exact (calibration.py's own confidence scores
      are typically 0.85-0.99 on real data, not 1.0 - some residual
      mounting-angle error is the expected case, not the exception).
  amplitude scaling: per-window random gain - simulates unit-to-unit sensor
      calibration variance across multiple physical IMUs (2 feet now,
      eventually more shoes).
  noise injection: adds Gaussian noise - simulates sensor noise floor
      variance across physical units and calibration sessions.

APPROXIMATION, stated plainly: build_dataset.py's train.npz stores windows
AFTER per-subject z-scoring, not the raw pre-normalized signal - true
physical rotation (mixing channels in their original g-unit scale) isn't
recoverable from what's saved. This module rotates the ALREADY-z-scored
triplet instead, which is only exact if the 3 channels happened to share one
scale, and in general does not. It is still a reasonable regularizer (each
channel is roughly unit-variance post-z-score, so small-angle mixing is a
sane proxy for "the model shouldn't overfit to one exact channel
assignment"), just not a physically faithful rotation - do not oversell it
as one.

NEVER apply to val/test - augmentation must only touch what the model learns
FROM, never what it is honestly measured against.
"""
from __future__ import annotations

import numpy as np


def _random_rotation_matrices(n: int, max_angle_deg: float, rng: np.random.Generator) -> np.ndarray:
    """n independent small-angle 3D rotations, axis-angle sampled uniformly
    on the sphere, angle sampled uniformly in [-max_angle_deg, max_angle_deg]."""
    axes = rng.normal(size=(n, 3))
    axes /= np.linalg.norm(axes, axis=1, keepdims=True) + 1e-12
    angles = np.deg2rad(rng.uniform(-max_angle_deg, max_angle_deg, size=n))

    # Rodrigues' rotation formula, vectorized over n.
    K = np.zeros((n, 3, 3))
    K[:, 0, 1], K[:, 0, 2] = -axes[:, 2], axes[:, 1]
    K[:, 1, 0], K[:, 1, 2] = axes[:, 2], -axes[:, 0]
    K[:, 2, 0], K[:, 2, 1] = -axes[:, 1], axes[:, 0]
    I = np.eye(3)[None, :, :]
    sin_a = np.sin(angles)[:, None, None]
    cos_a = (1 - np.cos(angles))[:, None, None]
    return I + sin_a * K + cos_a * (K @ K)


def augment_windows(
    X: np.ndarray, rng: np.random.Generator,
    max_rotation_deg: float = 10.0,
    scale_range: tuple[float, float] = (0.9, 1.1),
    noise_std: float = 0.05,
) -> np.ndarray:
    """X: [N, T, 3] already-z-scored windows -> [N, T, 3] augmented copy.
    One independent rotation/scale draw per window, applied across its
    whole T (a mounting or calibration error is constant within one
    recording session, not resampled every timestep)."""
    N = X.shape[0]
    R = _random_rotation_matrices(N, max_rotation_deg, rng)  # [N, 3, 3]
    rotated = np.einsum("ntc,nkc->ntk", X, R)  # apply R to each timestep's 3-vector

    scale = rng.uniform(scale_range[0], scale_range[1], size=(N, 1, 1))
    scaled = rotated * scale

    noise = rng.normal(0, noise_std, size=scaled.shape)
    return (scaled + noise).astype(X.dtype)


def expand_with_augmented_copies(
    X: np.ndarray, y: np.ndarray, rng: np.random.Generator,
    n_augmented_copies: int = 1, **augment_kwargs,
) -> tuple[np.ndarray, np.ndarray]:
    """For non-epoch-based training (RandomForest): original + N augmented
    copies, concatenated once. y is tiled unchanged (labels don't move)."""
    parts_X, parts_y = [X], [y]
    for _ in range(n_augmented_copies):
        parts_X.append(augment_windows(X, rng, **augment_kwargs))
        parts_y.append(y)
    return np.concatenate(parts_X, axis=0), np.concatenate(parts_y, axis=0)
