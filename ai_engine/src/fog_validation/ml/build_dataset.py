"""Orchestrator: raw files -> windows -> stop-label -> subject split -> npz + manifest.

Usage: python -m fog_validation.ml.build_dataset

Normalization note: z-score stats are computed PER SUBJECT from that
subject's own windows (whichever split they land in - a subject belongs to
exactly one split by construction, so this is leak-free without needing to
restrict to "training subjects only": the stats never look at ANY other
subject's data, train or test).

Datasets: Daphnet + FoG-STAR (the only two with real FoG episodes) + HuGaDB
(healthy subjects, zero FoG - contributes ground-truth walk/stop volume
only; see windowing.py for why it replaced the energy-threshold stop label).
gaitpdb was evaluated and excluded: it has NO IMU at all (pressure/VGRF
insole only), so it cannot supply this pipeline's 3 accelerometer channels
without fabricating a physically invalid accel-from-force conversion.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np

from fog_validation.ml.config import (
    COMMON_CHANNELS,
    HOP_SAMPLES,
    ML_DIR,
    N_CHANNELS,
    TARGET_FS_HZ,
    WINDOW_SAMPLES,
    WINDOW_SEC,
)
from fog_validation.ml.loaders import load_all_segments
from fog_validation.ml.splits import split_by_dataset
from fog_validation.ml.windowing import (
    LABEL_FOG,
    LABEL_STOP,
    LABEL_WALK,
    assign_3class_labels,
    build_windows,
    compute_episode_sample_weights,
)


def _class_dist(y, labels):
    vals, counts = np.unique(y, return_counts=True)
    return {str(labels.get(v, v)): int(c) for v, c in zip(vals, counts)}


def main(include_hugadb: bool = True):
    print("[1/5] loading + segmenting raw files (Daphnet + FoG-STAR"
          + (" + HuGaDB" if include_hugadb else "") + ")...")
    segments = load_all_segments(include_hugadb=include_hugadb)
    counts = {}
    for s in segments:
        counts[s.dataset] = counts.get(s.dataset, 0) + 1
    print(f"      segments: {counts}")

    print(f"[2/5] windowing ({WINDOW_SEC}s = {WINDOW_SAMPLES} samples @ {TARGET_FS_HZ}Hz, "
          f"hop={HOP_SAMPLES} samples)...")
    df = build_windows(segments)
    df = assign_3class_labels(df)
    print(f"      windows total={len(df)}  by dataset:\n{df.groupby('dataset').size().to_string()}")
    print(f"      label_3class by dataset (0=walk,1=stop,2=fog):\n"
          f"{df.groupby(['dataset', 'label_3class']).size().to_string()}")

    print("[3/5] subject-level split (per dataset, FoG-positive guaranteed in test where possible)...")
    subject_fog_map = {}
    for ds in df["dataset"].unique():
        sub = df[df.dataset == ds]
        has_fog = sub.groupby("subject")["label_3class"].apply(lambda s: bool((s == LABEL_FOG).any()))
        subject_fog_map[ds] = has_fog.to_dict()
    splits = split_by_dataset(subject_fog_map)
    for ds, sp in splits.items():
        n_test_fog = sum(subject_fog_map[ds][s] for s in sp["test"])
        print(f"      {ds}: train={len(sp['train'])} val={len(sp['val'])} test={len(sp['test'])} "
              f"(test FoG-positive subjects={n_test_fog}, "
              f"ratio_adjusted_for_test_capacity={sp['ratio_adjusted_for_test_capacity']}, "
              f"constraint_satisfied={sp['constraint_satisfied']})")

    subj_to_split = {}
    for ds, sp in splits.items():
        for split_name in ("train", "val", "test"):
            for s in sp[split_name]:
                subj_to_split[(ds, s)] = split_name
    df["split"] = [subj_to_split[(r.dataset, r.subject)] for r in df.itertuples()]

    print("[4/5] per-subject z-score normalization + npz export...")
    label_names_3 = {LABEL_WALK: "walk", LABEL_STOP: "stop", LABEL_FOG: "fog"}
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "target_fs_hz": TARGET_FS_HZ, "window_sec": WINDOW_SEC,
            "window_samples": WINDOW_SAMPLES, "hop_samples": HOP_SAMPLES,
            "channels": COMMON_CHANNELS,
            "stop_label_source": "ground-truth activity codes (FoG-STAR own `activity` column, "
                                 "HuGaDB own ActivityID) - NOT an energy heuristic. Daphnet has no "
                                 "activity sub-label so its non-freeze windows are all 'walk'.",
        },
        "split_metadata_by_dataset": {
            ds: {k: v for k, v in sp.items() if k not in ("train", "val", "test")}
            for ds, sp in splits.items()
        },
        "splits": {},
    }

    for split_name in ("train", "val", "test"):
        sub = df[df.split == split_name].reset_index(drop=True)
        X = np.zeros((len(sub), WINDOW_SAMPLES, N_CHANNELS), dtype=np.float32)

        # per-subject z-score: stats from ALL of that subject's windows in
        # this split (a subject is entirely inside one split, so this never
        # touches another subject's data).
        for (ds, subj), idx in sub.groupby(["dataset", "subject"]).groups.items():
            idx = np.asarray(idx)
            stacked = np.stack(sub.loc[idx, "signal"].to_numpy())  # [n, T, C]
            mu = stacked.mean(axis=(0, 1))
            sd = stacked.std(axis=(0, 1))
            sd = np.where(sd < 1e-8, 1.0, sd)
            X[idx] = (stacked - mu) / sd

        y3 = sub["label_3class"].to_numpy().astype(np.int64)
        yb = sub["label_binary_fog"].to_numpy().astype(np.int64)
        subject_id = sub["dataset"].str.cat(sub["subject"], sep="_").to_numpy()
        dataset_id = sub["dataset"].to_numpy()
        # Raw per-dataset activity code (ACTIVITY_UNKNOWN=-1 for Daphnet/own).
        # NOT directly comparable across datasets - codes collide (FoG-STAR
        # code 5 = Stand-to-Sit, HuGaDB code 5 = sitting). Always resolve via
        # ACTIVITY_NAMES_BY_DATASET[dataset_id[i]][activity_code[i]], never
        # by the raw integer alone. See evaluate.py's confusion_by_activity().
        activity_code = sub["dominant_activity"].to_numpy().astype(np.int64)
        # Episode-aware weight (see windowing.compute_episode_sample_weights):
        # FOG-labeled windows get 1/(windows in their own episode) so every
        # FOG EPISODE counts equally in training regardless of how many
        # overlapping windows its duration produced; walk/stop windows stay
        # at 1.0 (their own class balancing is handled separately via
        # class_weight="balanced" / class_weights_from_labels - this is an
        # additional, orthogonal axis, opt-in at training time). Purely
        # additive here: an extra saved array, no existing key touched.
        sample_weight = compute_episode_sample_weights(sub)

        out_path = ML_DIR / f"{split_name}.npz"
        np.savez_compressed(out_path, X=X, y_3class=y3, y_binary=yb,
                            subject_id=subject_id, dataset_id=dataset_id,
                            activity_code=activity_code, sample_weight=sample_weight)

        fog_mask_split = y3 == LABEL_FOG
        sum_fog_weight = float(sample_weight[fog_mask_split].sum()) if fog_mask_split.any() else 0.0
        manifest["splits"][split_name] = {
            "n_windows": int(len(sub)),
            "subjects": {ds: splits[ds][split_name] for ds in splits},
            "n_windows_by_dataset": {ds: int((sub.dataset == ds).sum()) for ds in splits},
            "class_dist_3class": _class_dist(y3, label_names_3),
            "class_dist_binary": _class_dist(yb, {0: "rest", 1: "fog"}),
            "npz_bytes": out_path.stat().st_size,
            "episode_sample_weight_check": {
                "n_fog_windows": int(fog_mask_split.sum()),
                "sum_of_fog_window_weights": round(sum_fog_weight, 4),
                "implied_n_fog_episodes": round(sum_fog_weight),
                "note": "sum_of_fog_window_weights should equal (up to rounding) "
                        "the number of window-contiguous FOG episodes in this "
                        "split, since each episode's per-window weights "
                        "(1/n_windows_in_episode) sum to 1.0 - see "
                        "windowing.compute_episode_sample_weights.",
            },
        }
        print(f"      {split_name}: {out_path.name} -> {out_path.stat().st_size/1e6:.1f} MB, "
              f"{len(sub)} windows")

    manifest_path = ML_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    total_mb = sum(manifest["splits"][s]["npz_bytes"] for s in manifest["splits"]) / 1e6
    print(f"[5/5] manifest.json written. total npz size = {total_mb:.1f} MB")
    return manifest


if __name__ == "__main__":
    main()
