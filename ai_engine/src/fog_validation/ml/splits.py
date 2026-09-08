"""Subject-level train/val/test split, done SEPARATELY per dataset then unioned.

Why per-dataset rather than one pooled split across all subjects: stage 4
needs a Daphnet-vs-FoG-STAR performance breakdown, which requires both
datasets to have their own adequately-populated test slice; and the "test
must contain real FoG subjects" guarantee is dataset-specific in this task
(Daphnet's S04/S10 have none - a pooled split could satisfy the combined
count using only FoG-STAR subjects and still leave Daphnet's test slice with
zero FoG, which would break Daphnet-specific test-set evaluation silently).

Method: random search (not a single GroupShuffleSplit call), because "hit an
approximate 70/15/15 subject count AND guarantee >=2 FoG-positive subjects
in test" isn't a single scikit-learn primitive - especially for Daphnet's 10
subjects, where "exact" ratios don't exist as integers anyway. Each seed
produces one candidate split; the first one meeting the FoG-positive-in-test
constraint is kept. This is deterministic given RANDOM_SEED and reported
seed count, not tuned by hand to produce a "nice-looking" split.
"""
from __future__ import annotations

import numpy as np

from fog_validation.ml.config import (
    MIN_FOG_POSITIVE_SUBJECTS_IN_TEST,
    RANDOM_SEED,
    SPLIT_SEARCH_SEEDS,
    TEST_FRAC,
    TRAIN_FRAC,
    VAL_FRAC,
)


def _largest_remainder_counts(n: int, fracs: tuple[float, float, float]) -> tuple[int, int, int]:
    raw = [f * n for f in fracs]
    counts = [int(r) for r in raw]
    remainder = n - sum(counts)
    order = np.argsort([-(r - int(r)) for r in raw])
    for i in order[:remainder]:
        counts[i] += 1
    return tuple(counts)  # type: ignore[return-value]


def _ensure_test_capacity(n_train: int, n_val: int, n_test: int) -> tuple[int, int, int, bool]:
    """If the 70/15/15 rounding leaves n_test below MIN_FOG_POSITIVE_SUBJECTS_IN_TEST,
    the constraint is not just unlikely to hit by chance - it is MATHEMATICALLY
    IMPOSSIBLE (you cannot fit 2 distinct subjects in a test set of size 1).
    Growing n_test is the only fix; take subjects from val first, then train,
    never dropping n_train below 1. Returns (n_train, n_val, n_test, adjusted).
    """
    need = MIN_FOG_POSITIVE_SUBJECTS_IN_TEST - n_test
    if need <= 0:
        return n_train, n_val, n_test, False
    from_val = min(need, n_val)
    n_val -= from_val
    n_test += from_val
    need -= from_val
    if need > 0:
        from_train = min(need, max(0, n_train - 1))
        n_train -= from_train
        n_test += from_train
    return n_train, n_val, n_test, True


def split_subjects(subjects: list[str], has_fog: dict[str, bool]) -> dict[str, list[str]]:
    """Returns {"train": [...], "val": [...], "test": [...]} of subject ids."""
    n = len(subjects)
    n_fog_total = sum(has_fog.values())
    # The hard floor for this dataset: can't ask for more FoG-positive test
    # subjects than exist in the whole dataset. If n_fog_total is itself below
    # the configured minimum, that's a genuine impossibility (not a rounding
    # artifact) and is recorded as such rather than silently downgraded.
    required_min = min(MIN_FOG_POSITIVE_SUBJECTS_IN_TEST, n_fog_total)
    impossible = n_fog_total < MIN_FOG_POSITIVE_SUBJECTS_IN_TEST

    n_train, n_val, n_test = _largest_remainder_counts(n, (TRAIN_FRAC, VAL_FRAC, TEST_FRAC))
    n_train, n_val, n_test, ratio_adjusted = _ensure_test_capacity(n_train, n_val, n_test)
    subjects = sorted(subjects)  # fix input order before shuffling, for reproducibility

    for seed in range(SPLIT_SEARCH_SEEDS):
        rng = np.random.default_rng(RANDOM_SEED + seed)
        perm = rng.permutation(subjects).tolist()
        test = perm[:n_test]
        val = perm[n_test:n_test + n_val]
        train = perm[n_test + n_val:]
        if sum(has_fog[s] for s in test) >= required_min:
            return {"train": sorted(train), "val": sorted(val), "test": sorted(test),
                    "seed_used": RANDOM_SEED + seed, "constraint_satisfied": not impossible,
                    "ratio_adjusted_for_test_capacity": ratio_adjusted,
                    "n_fog_positive_subjects_total": n_fog_total,
                    "n_fog_positive_required_in_test": required_min}

    # Fallback (not expected to trigger for Daphnet n=10 / FoG-STAR n=22, kept
    # defensively): force the required FoG-positive subjects into test first.
    fog_pos = [s for s in subjects if has_fog[s]]
    fog_neg = [s for s in subjects if not has_fog[s]]
    rng = np.random.default_rng(RANDOM_SEED)
    rng.shuffle(fog_pos)
    rng.shuffle(fog_neg)
    forced_test = fog_pos[:required_min]
    remaining = [s for s in subjects if s not in forced_test]
    rng.shuffle(remaining)
    test = forced_test + remaining[:max(0, n_test - len(forced_test))]
    rest = [s for s in remaining if s not in test]
    val = rest[:n_val]
    train = rest[n_val:]
    return {"train": sorted(train), "val": sorted(val), "test": sorted(test),
            "seed_used": None, "constraint_satisfied": not impossible and len(forced_test) >= required_min,
            "ratio_adjusted_for_test_capacity": ratio_adjusted,
            "n_fog_positive_subjects_total": n_fog_total,
            "n_fog_positive_required_in_test": required_min}


def split_by_dataset(subject_fog_map: dict[str, dict[str, bool]]) -> dict[str, dict[str, list[str]]]:
    """subject_fog_map: {"daphnet": {"S01": True, ...}, "fogstar": {"1": True, ...}}"""
    return {ds: split_subjects(list(m.keys()), m) for ds, m in subject_fog_map.items()}
