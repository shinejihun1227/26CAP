"""Shared evaluation for both models (baseline and CNN): same metrics, same
dataset-split reporting, so the two models are compared on identical ground.

FPR_stop is this project's key question metric - "does the model mistake an
intentional stop for a freeze" - reported separately and prominently rather
than folded into an aggregate score, per the task's explicit instruction.

Evaluation contexts: "overall" pools every window from every dataset in the
split, including HuGaDB (healthy, non-PD subjects - see windowing.py). That
pooled number is NOT the number to put on a poster about a PD product: a
healthy person sitting is trivially easy to tell apart from a PD patient
freezing, so pooling inflates specificity/FPR_stop relative to what a PD
patient's device will actually face. "PD_only" restricts to Daphnet +
FoG-STAR (the two datasets with real PD subjects) and is the clinically
relevant number - evaluate_by_dataset() always computes both, plus each
individual dataset, so nothing is hidden either way.

AUC is threshold-independent (it scores ranking quality across every
possible cutoff), so it does not need a tuned decision threshold - it is the
right metric for a poster ROC plot on its own. sensitivity/specificity/
FPR_stop DO depend on a threshold - evaluate() defaults to the raw 3-class
argmax, but accepts a `fog_threshold` (typically Youden's J tuned on a
VALIDATION split, never on test) to report those at a deliberately chosen
operating point instead of whatever argmax happens to imply.
"""
from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, confusion_matrix, roc_auc_score, roc_curve

from fog_validation.ml.windowing import LABEL_FOG, LABEL_STOP, LABEL_WALK

CLASS_ORDER = [LABEL_WALK, LABEL_STOP, LABEL_FOG]
CLASS_NAMES = ["walk", "stop", "fog"]
PD_DATASETS = {"daphnet", "fogstar"}


def youden_threshold(proba: np.ndarray, y_true: np.ndarray, fallback: float = 0.5) -> float:
    """Fog-vs-rest threshold maximizing (sensitivity + specificity - 1) on
    the given (proba, y_true) - call this on a VAL split, apply the result
    to test. Never call this on the test split itself.

    Falls back to `fallback` if y_true has only one class (e.g. an unlucky
    tiny smoke-test subsample with zero fog windows) - a threshold "tuned"
    against a single class is meaningless, not just noisy, so this is a
    correctness guard, not a quality one.
    """
    y_bin = (y_true == LABEL_FOG).astype(int)
    if len(set(y_bin.tolist())) < 2:
        return fallback
    fog_score = proba[:, CLASS_ORDER.index(LABEL_FOG)]
    fpr, tpr, thr = roc_curve(y_bin, fog_score)
    return float(thr[np.argmax(tpr - fpr)])


def evaluate(proba: np.ndarray, y_true: np.ndarray, fog_threshold: float | None = None) -> dict:
    """proba: [N, 3] softmax/predict_proba output, class order = CLASS_ORDER.
    fog_threshold=None -> raw argmax (default). Otherwise: fog iff
    fog_score >= fog_threshold, else walk/stop by argmax between those two.
    """
    i_walk, i_stop, i_fog = (CLASS_ORDER.index(c) for c in CLASS_ORDER)
    fog_score = proba[:, i_fog]

    if fog_threshold is None:
        pred = np.array(CLASS_ORDER)[proba.argmax(axis=1)]
    else:
        is_fog = fog_score >= fog_threshold
        walk_or_stop = np.where(proba[:, i_walk] >= proba[:, i_stop], LABEL_WALK, LABEL_STOP)
        pred = np.where(is_fog, LABEL_FOG, walk_or_stop)

    cm = confusion_matrix(y_true, pred, labels=CLASS_ORDER)

    y_bin = (y_true == LABEL_FOG).astype(int)
    result = {"n": int(len(y_true)), "fog_threshold_used": fog_threshold,
              "confusion_matrix": cm.tolist(), "confusion_matrix_labels": CLASS_NAMES}

    if len(set(y_bin)) == 2:
        result["AUC_fog_vs_rest"] = round(float(roc_auc_score(y_bin, fog_score)), 4)
        result["PR_AUC_fog_vs_rest"] = round(float(average_precision_score(y_bin, fog_score)), 4)
    else:
        result["AUC_fog_vs_rest"] = None
        result["PR_AUC_fog_vs_rest"] = None

    i_fog_cm = CLASS_ORDER.index(LABEL_FOG)
    tp = cm[i_fog_cm, i_fog_cm]
    fn = cm[i_fog_cm, :].sum() - tp
    fp = cm[:, i_fog_cm].sum() - tp
    tn = cm.sum() - tp - fn - fp
    result["sensitivity_fog"] = round(float(tp / (tp + fn)), 4) if (tp + fn) else None
    result["specificity_fog"] = round(float(tn / (tn + fp)), 4) if (tn + fp) else None

    i_stop_cm = CLASS_ORDER.index(LABEL_STOP)
    stop_total = cm[i_stop_cm, :].sum()
    result["FPR_stop"] = round(float(cm[i_stop_cm, i_fog_cm] / stop_total), 4) if stop_total else None
    result["n_stop_windows"] = int(stop_total)

    return result


def evaluate_by_dataset(proba: np.ndarray, y_true: np.ndarray, dataset_id: np.ndarray,
                        fog_threshold: float | None = None) -> dict:
    out = {"overall": evaluate(proba, y_true, fog_threshold)}
    pd_mask = np.isin(dataset_id, list(PD_DATASETS))
    if pd_mask.any():
        out["PD_only"] = evaluate(proba[pd_mask], y_true[pd_mask], fog_threshold)
    for ds in sorted(set(dataset_id.tolist())):
        m = dataset_id == ds
        out[ds] = evaluate(proba[m], y_true[m], fog_threshold)
    return out


def roc_points(proba: np.ndarray, y_true: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """(fpr, tpr, auc) for the fog-vs-rest ROC curve - for plotting."""
    y_bin = (y_true == LABEL_FOG).astype(int)
    fog_score = proba[:, CLASS_ORDER.index(LABEL_FOG)]
    fpr, tpr, _ = roc_curve(y_bin, fog_score)
    return fpr, tpr, float(roc_auc_score(y_bin, fog_score))


def confusion_by_activity(proba: np.ndarray, y_true: np.ndarray, dataset_id: np.ndarray,
                          activity_code: np.ndarray, fog_threshold: float | None = None):
    """Per-activity-type false-alarm rate: of windows whose TRUE label is
    NOT fog, restricted by their SOURCE dataset's own activity code (Walk,
    TurnRight, Stand-to-Sit, ...), what fraction get predicted as fog?

    This is the direct answer to "does turning in place, or sitting down
    while walking, get confused with a freeze" - a question FPR_stop alone
    cannot answer, since FPR_stop only separates fog from the WALK/STOP
    3-class label, not from the finer activity that produced it.

    Only meaningful on datasets with real activity ground truth (FoG-STAR;
    HuGaDB has no fog at all so it never appears here) - Daphnet has none
    (see config.ACTIVITY_NAMES_BY_DATASET) and PD-only turning data does not
    exist anywhere else, so this is FoG-STAR-only by construction, not a
    choice. Activity codes are namespaced by dataset since they collide
    (FoG-STAR code 5 = Stand-to-Sit, HuGaDB code 5 = sitting) - NEVER compare
    raw activity_code across different dataset_id values.
    """
    from fog_validation.ml.config import ACTIVITY_NAMES_BY_DATASET

    i_walk, i_stop, i_fog = (CLASS_ORDER.index(c) for c in CLASS_ORDER)
    fog_score = proba[:, i_fog]
    if fog_threshold is None:
        pred_is_fog = proba.argmax(axis=1) == i_fog
    else:
        pred_is_fog = fog_score >= fog_threshold

    non_fog = y_true != LABEL_FOG
    rows = []
    for ds in sorted(set(dataset_id.tolist())):
        names = ACTIVITY_NAMES_BY_DATASET.get(ds, {})
        if not names:
            continue  # no activity ground truth for this dataset (e.g. Daphnet)
        ds_mask = (dataset_id == ds) & non_fog
        for code, name in sorted(names.items()):
            m = ds_mask & (activity_code == code)
            n = int(m.sum())
            if n == 0:
                continue
            n_pred_fog = int(pred_is_fog[m].sum())
            rows.append({
                "dataset": ds, "activity_code": code, "activity_name": name,
                "n_windows": n, "n_predicted_fog": n_pred_fog,
                "false_alarm_rate": round(n_pred_fog / n, 4),
            })
    return rows
