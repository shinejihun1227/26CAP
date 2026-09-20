"""Per-dataset -> common-channel mapping, and the evidence behind it.

Common channel order: [vertical, horizontal_forward, horizontal_lateral],
all in g. This is the only channel triplet BOTH datasets can supply, since
Daphnet has no gyroscope.

Daphnet (documented in documentation.html, columns 1-indexed from the
DAPHNET_COLUMNS list in common/config.py):
    col "ankle_vertical_mg"      -> vertical
    col "ankle_horiz_fwd_mg"     -> horizontal_forward
    col "ankle_horiz_lat_mg"     -> horizontal_lateral
    unit conversion: mg -> g is /1000.

FoG-STAR ankleR (NOT documented anywhere in the dataset - README lists
axes as x/y/z with no orientation meaning). Identified empirically this
session, right ankle only (side choice justified below):

    acc_x -> vertical.
        Evidence: mean(acc_x) = -1.003 g across the whole dataset (gravity),
        std 0.22g. The other two axes have mean ~0 (0.10, -0.09).

    acc_y -> horizontal_forward.
        Evidence, both computed on Walking-activity rows only:
          (a) largest non-gravity amplitude: std(acc_y)=0.462g vs
              std(acc_z)=0.213g. An ankle-worn sensor's forward/backward
              swing acceleration is typically larger than its
              side-to-side (mediolateral) acceleration.
          (b) coherence with gyro_z (already established in an earlier
              session as the pitch/sagittal-plane axis, from its 91% share
              of walking-band gyro power): mean coherence(acc_y, gyro_z)
              in 0.5-3 Hz = 0.775, vs coherence(acc_z, gyro_z) = 0.119.
              Sagittal-plane pitch rotation and anteroposterior (forward)
              acceleration both arise from the same swing/stance motion, so
              high coherence with the confirmed pitch axis is expected only
              for the forward axis, not the lateral one.
        Both independent checks agree, so acc_y = forward.

    acc_z -> horizontal_lateral (by elimination + the low-amplitude,
        low-coherence result above).

Side choice, ORIGINAL (single-side) pipeline: RIGHT ankle (ankleR), not left.
    Both sides have NaN gaps (raw sensor dropout, not FoG-STAR's fault).
    ankleL's dropout wipes out 87.8% of subject 17, who DOES have FoG
    (333 labeled samples) - losing that subject's data almost entirely.
    ankleR's worst dropout (subject 8, 16.6% missing) falls on a subject
    with ZERO FoG samples, so ankleR loses far less usable positive signal.
    (Re-confirmed this session; matches the choice made in an earlier
    session's FoG-STAR-only analysis.)

BILATERAL upgrade (this session): the real hardware instruments BOTH feet,
and this same FoG-STAR CSV already has both ankleL_* and ankleR_* columns in
full (a Jan 2026 Scientific Data paper, Borzi/Demrozi/Bacchin et al., DOI
10.1038/s41597-026-06645-1, confirms this is the formally published version
of this exact dataset - 22 participants, ankles+wrist+back IMUs, 101 FoG
episodes - cross-checked against our own sensor_data.csv's column list and
subject count, not assumed from the paper alone). ankleL was never loaded
before; the ONLY reason was subject 17's dropout above, which only matters
FOR subject 17 (their ankleL segments simply end up short after NaN-gap
segmentation, same as any other dropout - no special-casing needed).

ankleL axis mapping - checked empirically before reuse, NOT assumed to
mirror ankleR just because the mount is nominally symmetric:
    ankleL_acc_x -> vertical:  mean -1.026g (walking rows), matches ankleR_acc_x's -1.034g.
    ankleL_acc_y -> forward:   walk-band power 0.178 (median per block) vs
                                ankleL_acc_z's 0.033 - same axis index as ankleR's forward (acc_y).
    ankleL_acc_z -> lateral:   by elimination, SIGN FLIPPED vs ankleR_acc_z
                                (mean +0.138g vs ankleR's -0.109g) - expected
                                for a mirror-mounted pair (each foot's
                                lateral axis points the same rotational
                                direction relative to its OWN foot, which is
                                opposite in a shared body-frame sense). Sign
                                flipped here (scale=-1.0) purely so both
                                feet's "lateral" channel share one sign
                                convention - lateral motion is roughly
                                symmetric during normal gait so this is a
                                bookkeeping choice, not a physically forced one.

Splitting: adding ankleL segments does NOT add new subjects (still the same
22) - it adds a second block_id-tagged segment set per existing subject.
splits.py keys by (dataset, subject), so a subject's L and R segments always
land in the same split together - required, since L and R share the same
underlying FoG episodes (whole-body events, not foot-specific): letting one
side train and the other test on the SAME subject would leak that subject's
gait signature across the split, inflating test performance in a way that
would not generalize to a genuinely unseen patient.
"""
from __future__ import annotations

from fog_validation.ml.config import HUGADB_ACC_SCALE

MG_TO_G = 1.0 / 1000.0

DAPHNET_CHANNEL_COLUMNS = {
    "acc_vertical_g": ("ankle_vertical_mg", MG_TO_G),
    "acc_horiz_fwd_g": ("ankle_horiz_fwd_mg", MG_TO_G),
    "acc_horiz_lat_g": ("ankle_horiz_lat_mg", MG_TO_G),
}

FOGSTAR_CHANNEL_COLUMNS = {
    "acc_vertical_g": ("ankleR_acc_x", 1.0),
    "acc_horiz_fwd_g": ("ankleR_acc_y", 1.0),
    "acc_horiz_lat_g": ("ankleR_acc_z", 1.0),
}

FOGSTAR_CHANNEL_COLUMNS_L = {
    "acc_vertical_g": ("ankleL_acc_x", 1.0),
    "acc_horiz_fwd_g": ("ankleL_acc_y", 1.0),
    "acc_horiz_lat_g": ("ankleL_acc_z", -1.0),  # sign flipped - see module docstring
}

FOGSTAR_CHANNEL_COLUMNS_BY_SIDE = {"R": FOGSTAR_CHANNEL_COLUMNS, "L": FOGSTAR_CHANNEL_COLUMNS_L}

# Own-collected data (docs/own_data_schema.md): the schema already stores
# these 3 channels under their physical names, pre-mapped at capture time -
# no empirical axis identification needed here, unlike FoG-STAR.
#
# STALE vs. the schema doc's v2 (bilateral FSR+IMU) rewrite: v2's stage-2
# columns are L_/R_ prefixed (L_acc_vertical_g, R_acc_vertical_g, ...), not
# the bare names below. This map (and load_own_segments() in loaders.py)
# was never updated when the schema went bilateral - harmless for now since
# nothing has fed real own-collected data through this path yet, but fix
# this (pick a side via config, like FOGSTAR_SIDE, or add both) before the
# first real own-data CSV goes through build_dataset.py.
OWN_CHANNEL_COLUMNS = {
    "acc_vertical_g": ("acc_vertical_g", 1.0),
    "acc_horiz_fwd_g": ("acc_horiz_fwd_g", 1.0),
    "acc_horiz_lat_g": ("acc_horiz_lat_g", 1.0),
}

# HuGaDB, RIGHT FOOT (RF) sensor - axes identified empirically this session,
# same methodology as FoG-STAR but with a real caveat this time:
#
#   During standing (n=8000 samples, 40 files), gravity is NOT cleanly
#   aligned to one axis: RF_acc_x=-0.54g, RF_acc_y=-0.20g, RF_acc_z=+0.78g
#   (combined magnitude ~0.97g ~= 1g, confirming it IS gravity, just spread
#   across all 3 axes). This means the RF unit sits at a real fixed tilt on
#   the foot dorsum, unlike Daphnet/FoG-STAR's more axis-aligned ankle mounts.
#   Z carries the largest single-axis share and the lowest standing-state
#   std (0.081g, vs 0.097/0.114g) -> chosen as the vertical proxy, but it is
#   an approximation, not a clean single-axis read.
#
#   Forward vs lateral (the remaining X/Y) is correspondingly less clean too:
#   during walking, X edges out Y on BOTH amplitude (std 0.705g vs 0.614g)
#   and coherence with the confirmed-pitch gyro axis (0.817 vs 0.786 in
#   0.5-3 Hz) - X chosen as forward - but the gap is much smaller than
#   FoG-STAR's (0.775 vs 0.119), so this assignment is a lean, not a clear
#   signal. Consequence for this project: acceptable, because HuGaDB
#   contributes to this pipeline ONLY as ground-truth walk/stop volume (see
#   config.py) - FI is computed on the vertical channel only, and no
#   HuGaDB-specific feature (like FoG-STAR's PitchROM) depends on getting
#   forward/lateral exactly right.
#
#   Pitch gyro axis: RF_gyro_y (std 828.9 deg/s, 74.4% of walking power in
#   the 0.5-3 Hz step band - largest of the 3, used only to pick the
#   forward/lateral accel axes above, not exposed as a feature).
HUGADB_CHANNEL_COLUMNS = {
    "acc_vertical_g": ("RF_acc_z", HUGADB_ACC_SCALE),
    "acc_horiz_fwd_g": ("RF_acc_x", HUGADB_ACC_SCALE),
    "acc_horiz_lat_g": ("RF_acc_y", HUGADB_ACC_SCALE),
}
HUGADB_COLUMN_INDEX = {  # HuGaDB files have no header names in the data rows themselves
    "RF_acc_x": 0, "RF_acc_y": 1, "RF_acc_z": 2,
    "RF_gyro_x": 3, "RF_gyro_y": 4, "RF_gyro_z": 5,
    "activity_id": -1,
}
