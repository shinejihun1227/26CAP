"""Small 1D-CNN, 3-class (walk/stop/fog). Kept deliberately small: the
combined dataset is ~16k training windows from 23 subjects, not enough to
justify a deep network without overfitting.

Input to forward() is [N, T, C] (matches the npz layout); permuted to
[N, C, T] internally since torch Conv1d expects channels-first.
"""
from __future__ import annotations

import numpy as np
import torch
from torch import nn

from fog_validation.ml.augment import augment_windows
from fog_validation.ml.config import RANDOM_SEED


class FogCNN(nn.Module):
    def __init__(self, n_channels: int = 3, n_classes: int = 3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(n_channels, 16, kernel_size=7, padding=3), nn.BatchNorm1d(16), nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(16, 32, kernel_size=5, padding=2), nn.BatchNorm1d(32), nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=3, padding=1), nn.BatchNorm1d(64), nn.ReLU(),
            nn.MaxPool1d(2),
            nn.AdaptiveAvgPool1d(1),
        )
        self.head = nn.Linear(64, n_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x.permute(0, 2, 1)          # [N, T, C] -> [N, C, T]
        z = self.net(x).squeeze(-1)     # [N, 64]
        return self.head(z)


def class_weights_from_labels(y: np.ndarray, n_classes: int = 3) -> torch.Tensor:
    """Inverse-frequency weights for CrossEntropyLoss, the class-imbalance
    handling this project uses for both the CNN and the RandomForest
    baseline (same principle, different sklearn/torch API)."""
    counts = np.bincount(y, minlength=n_classes).astype(np.float64)
    counts = np.where(counts == 0, 1.0, counts)
    w = counts.sum() / (n_classes * counts)
    return torch.tensor(w, dtype=torch.float32)


def train_cnn(
    X_train: np.ndarray, y_train: np.ndarray,
    X_val: np.ndarray, y_val: np.ndarray,
    n_epochs: int = 20, batch_size: int = 64, lr: float = 1e-3,
    device: str = "cpu", verbose: bool = True, seed: int = RANDOM_SEED,
    augment_rng: np.random.Generator | None = None, augment_kwargs: dict | None = None,
    sample_weight: np.ndarray | None = None, n_classes: int | None = None,
) -> tuple[FogCNN, list[dict]]:
    """n_classes: opt-in only (default None infers int(y_train.max())+1, which
    equals 3 for every existing caller's 3-class y - so this is a strictly
    additive, backward-compatible change, not a behavior change for any
    caller that doesn't pass it). Added so a 4-class target (see
    windowing.assign_4class_labels / scripts/sitstand_classification_
    investigation.py) can train the SAME architecture with a 4-unit output
    head and 4-class weights, without a second copy of this function.

    augment_rng: opt-in only (default None = unchanged behavior, see
    augment.py). When given, each minibatch gets a FRESH random augmentation
    every epoch (unlike train_baseline's static expanded set) - X_val is
    NEVER augmented, same rule as everywhere else in this project.

    sample_weight: optional [len(X_train)] per-window weight (e.g. episode-
    based, see windowing.compute_episode_sample_weights), ORTHOGONAL to the
    per-CLASS weights already applied via `weights`/class_weights_from_labels
    below - both apply together when sample_weight is given, one does not
    replace the other. None (default) takes the EXACT original code path
    (same single mean-reduction CrossEntropyLoss call, byte-for-byte
    unchanged) - this is a strictly additive, opt-in change. When given,
    CrossEntropyLoss is switched to reduction="none" so each sample's
    class-weighted loss can be scaled by its own sample_weight, then combined
    with the same weighted-average convention PyTorch's own mean reduction
    uses (sum of weighted losses / sum of weights) - just extended to
    include the extra per-sample factor. X_val/y_val loss is always the
    plain per-CLASS-weighted mean (sample_weight is a training-time
    re-balancing trick, same "never touches what the model is honestly
    measured against" rule augment.py already follows for augmentation)."""
    # Fixes BOTH weight init and the per-epoch shuffle order, which otherwise
    # both draw from torch's global RNG - without this, two runs on identical
    # data produced meaningfully different AUCs (0.818 vs 0.872 in one A/B
    # check this session), which is not acceptable for a demo or a poster
    # number that needs to be reproducible.
    torch.manual_seed(seed)
    n_classes = n_classes if n_classes is not None else int(y_train.max()) + 1
    model = FogCNN(n_channels=X_train.shape[2], n_classes=n_classes).to(device)
    weights = class_weights_from_labels(y_train, n_classes=n_classes).to(device)
    criterion_mean = nn.CrossEntropyLoss(weight=weights)
    use_sample_weight = sample_weight is not None
    if use_sample_weight:
        criterion_train = nn.CrossEntropyLoss(weight=weights, reduction="none")
        sw_t = torch.tensor(sample_weight, dtype=torch.float32)
    else:
        criterion_train = criterion_mean  # identical object/behavior to before this change
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    yt = torch.tensor(y_train, dtype=torch.int64)
    Xv = torch.tensor(X_val, dtype=torch.float32).to(device)
    yv = torch.tensor(y_val, dtype=torch.int64).to(device)

    n = len(X_train)
    augment_kwargs = augment_kwargs or {}
    history = []
    best_val_loss = float("inf")
    best_state = None
    for epoch in range(n_epochs):
        model.train()
        perm = torch.randperm(n)
        total_loss = 0.0
        for i in range(0, n, batch_size):
            idx = perm[i:i + batch_size]
            xb_np = X_train[idx.numpy()]
            if augment_rng is not None:
                xb_np = augment_windows(xb_np, augment_rng, **augment_kwargs)
            xb = torch.tensor(xb_np, dtype=torch.float32).to(device)
            yb = yt[idx].to(device)
            optimizer.zero_grad()
            if use_sample_weight:
                swb = sw_t[idx].to(device)
                per_sample_loss = criterion_train(model(xb), yb)  # [batch], already class-weighted
                class_w_b = weights[yb]
                loss = (per_sample_loss * swb).sum() / (class_w_b * swb).sum()
            else:
                loss = criterion_train(model(xb), yb)  # EXACT original code path
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(idx)

        model.eval()
        with torch.no_grad():
            val_logits = model(Xv)
            val_loss = criterion_mean(val_logits, yv).item()
            val_acc = (val_logits.argmax(1) == yv).float().mean().item()
        history.append({"epoch": epoch, "train_loss": total_loss / n,
                        "val_loss": val_loss, "val_acc": val_acc})
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        if verbose:
            print(f"    epoch {epoch+1}/{n_epochs}  train_loss={total_loss/n:.4f}  "
                  f"val_loss={val_loss:.4f}  val_acc={val_acc:.4f}")

    # Restore the best-val-loss checkpoint rather than whatever the last
    # epoch happens to be - the loss curves in practice bounce around after
    # ~epoch 10 (small val set, ~17k train windows), so "last epoch" and
    # "best epoch" are usually NOT the same one.
    if best_state is not None:
        model.load_state_dict(best_state)
        best_epoch = min(range(len(history)), key=lambda i: history[i]["val_loss"])
        if verbose:
            print(f"    restored best checkpoint: epoch {best_epoch+1} "
                  f"(val_loss={best_val_loss:.4f})")
    return model, history


def predict_proba_cnn(model: FogCNN, X: np.ndarray, device: str = "cpu") -> np.ndarray:
    model.eval()
    with torch.no_grad():
        logits = model(torch.tensor(X, dtype=torch.float32).to(device))
        return torch.softmax(logits, dim=1).cpu().numpy()
