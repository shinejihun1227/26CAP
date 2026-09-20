"""STEP 4 entry point: train + evaluate the baseline (RF) and 1D-CNN models.

Run from the project root (after `pip install -e .`):
    python scripts/train_fog.py                 # full run
    python scripts/train_fog.py --smoke          # tiny-subset, 1-epoch smoke test

This is the same logic notebooks/train_fog_colab.ipynb runs on Colab - the
notebook imports these same fog_validation.ml modules rather than
reimplementing the models, so "script" and "notebook" never drift apart.

Reports both the raw-argmax operating point AND a Youden's-J-tuned
fog-vs-rest threshold (fit on VAL, applied to test - never fit on test
itself). AUC is threshold-independent and unaffected by this either way.
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np

from fog_validation.ml.config import ML_DIR, RANDOM_SEED
from fog_validation.ml.evaluate import PD_DATASETS, evaluate_by_dataset, youden_threshold
from fog_validation.ml.models_baseline import predict_proba_baseline, train_baseline
from fog_validation.ml.models_cnn import predict_proba_cnn, train_cnn


def load_split(name: str, smoke: bool, smoke_n: int = 300):
    d = np.load(ML_DIR / f"{name}.npz", allow_pickle=True)
    X, y3, did = d["X"], d["y_3class"], d["dataset_id"]
    if smoke and len(X) > smoke_n:
        rng = np.random.default_rng(RANDOM_SEED)
        idx = rng.choice(len(X), size=smoke_n, replace=False)
        X, y3, did = X[idx], y3[idx], did[idx]
    return X, y3, did


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="tiny subset, 1 CNN epoch, fast sanity check")
    ap.add_argument("--epochs", type=int, default=None)
    args = ap.parse_args()

    epochs = args.epochs if args.epochs is not None else (1 if args.smoke else 20)
    print(f"[mode] smoke={args.smoke}  cnn_epochs={epochs}")

    Xtr, ytr, _ = load_split("train", args.smoke)
    Xva, yva, dva = load_split("val", args.smoke, smoke_n=100)
    Xte, yte, dte = load_split("test", args.smoke, smoke_n=100)
    print(f"[data] train={len(Xtr)}  val={len(Xva)}  test={len(Xte)}")

    # Threshold is tuned on the PD-ONLY slice of val, not the pooled val set.
    # HuGaDB (healthy subjects) dominates val by volume and is trivially easy
    # to call "not fog" - pooling would drag the Youden threshold toward
    # whatever separates HuGaDB's negatives, not toward what actually
    # separates a PD patient's freeze from a PD patient's voluntary stop,
    # which is the only discrimination the shipped product ever has to make.
    pd_val_mask = np.isin(dva, list(PD_DATASETS))
    print(f"[threshold] tuning on PD_only val subset: {pd_val_mask.sum()} / {len(dva)} val windows")

    print("[baseline] training RandomForest on hand-crafted features...")
    t0 = time.time()
    rf = train_baseline(Xtr, ytr)
    print(f"          done in {time.time()-t0:.1f}s")
    proba_rf_val = predict_proba_baseline(rf, Xva)
    proba_rf = predict_proba_baseline(rf, Xte)
    thr_rf = youden_threshold(proba_rf_val[pd_val_mask], yva[pd_val_mask])
    report_rf_argmax = evaluate_by_dataset(proba_rf, yte, dte)
    report_rf_tuned = evaluate_by_dataset(proba_rf, yte, dte, fog_threshold=thr_rf)

    print("[cnn] training 1D-CNN...")
    t0 = time.time()
    model, history = train_cnn(Xtr, ytr, Xva, yva, n_epochs=epochs, device="cpu")
    print(f"          done in {time.time()-t0:.1f}s")
    proba_cnn_val = predict_proba_cnn(model, Xva)
    proba_cnn = predict_proba_cnn(model, Xte)
    thr_cnn = youden_threshold(proba_cnn_val[pd_val_mask], yva[pd_val_mask])
    report_cnn_argmax = evaluate_by_dataset(proba_cnn, yte, dte)
    report_cnn_tuned = evaluate_by_dataset(proba_cnn, yte, dte, fog_threshold=thr_cnn)

    print(f"\n[thresholds] RF Youden J (PD_only val) = {thr_rf:.4f}   "
          f"CNN Youden J (PD_only val) = {thr_cnn:.4f}")

    print("\n=== baseline (RandomForest) - test set, PD_only, tuned threshold ===")
    print(json.dumps(report_rf_tuned["PD_only"], indent=2))
    print("\n=== 1D-CNN - test set, PD_only, tuned threshold ===")
    print(json.dumps(report_cnn_tuned["PD_only"], indent=2))

    print("\n=== FPR_stop: argmax vs tuned threshold, by context ===")
    for name, argmax_r, tuned_r in [("baseline", report_rf_argmax, report_rf_tuned),
                                    ("cnn", report_cnn_argmax, report_cnn_tuned)]:
        for ctx in argmax_r:
            a, t = argmax_r[ctx]["FPR_stop"], tuned_r[ctx]["FPR_stop"]
            print(f"  {name:8s} {ctx:10s} argmax={a}   tuned={t}")

    if args.smoke:
        assert history[-1]["train_loss"] == history[-1]["train_loss"], "NaN loss in smoke test"
        print("\n[smoke test] PASSED - pipeline runs end-to-end on CPU with a tiny subset.")

    return report_rf_tuned, report_cnn_tuned


if __name__ == "__main__":
    main()
