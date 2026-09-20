"""Central path configuration. All paths are resolved relative to the project root
(two levels above this file: src/fog_validation/common/config.py -> project root)."""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]

DATA_RAW = PROJECT_ROOT / "data" / "raw"
DATA_PROCESSED = PROJECT_ROOT / "data" / "processed"

DAPHNET_RAW_DIR = DATA_RAW / "daphnet" / "dataset_fog_release" / "dataset"
# NOTE: the official PhysioNet zip extracts into a versioned subdirectory
# (confirmed in STEP 0), not directly into data/raw/gaitpdb/.
GAITPDB_RAW_DIR = DATA_RAW / "gaitpdb" / "gait-in-parkinsons-disease-1.0.0"

RESULTS_DIR = PROJECT_ROOT / "results"
FIGURES_DIR = RESULTS_DIR / "figures"
TABLES_DIR = RESULTS_DIR / "tables"

for _d in (DATA_PROCESSED, FIGURES_DIR, TABLES_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Daphnet acquisition parameters, confirmed against actual data files in STEP 0
# (see documentation.html and direct inspection of S01R01.txt etc.)
DAPHNET_FS_HZ = 64  # sampling rate documented AND confirmed via median time-delta of raw files
DAPHNET_COLUMNS = [
    "time_ms",
    "ankle_horiz_fwd_mg",
    "ankle_vertical_mg",
    "ankle_horiz_lat_mg",
    "thigh_horiz_fwd_mg",
    "thigh_vertical_mg",
    "thigh_horiz_lat_mg",
    "trunk_horiz_fwd_mg",
    "trunk_vertical_mg",
    "trunk_horiz_lat_mg",
    "annotation",
]
# annotation codes, from documentation.html, confirmed present in raw files as {0,1,2}
DAPHNET_ANNOTATION_NOT_EXPERIMENT = 0
DAPHNET_ANNOTATION_WALK_NO_FREEZE = 1
DAPHNET_ANNOTATION_FREEZE = 2

# Subjects documented (and confirmed in STEP 0) to contain zero freeze annotations
# across all of their recording runs. Kept only for reference/sanity checks -
# they are not treated specially in the LOSO evaluation.
DAPHNET_SUBJECTS_NO_FREEZE = ("S04", "S10")

# ---------------------------------------------------------------------------
# gaitpdb (PhysioNet) parameters, confirmed in STEP 0 against the official
# data/raw/gaitpdb/format.txt shipped with the dataset, and against sample
# files (e.g. GaCo01_01.txt) downloaded directly.
# ---------------------------------------------------------------------------
GAITPDB_FS_HZ = 100  # documented in format.txt AND confirmed via 0.01s time steps
GAITPDB_COLUMNS = (
    ["time_s"]
    + [f"vgrf_left_{i}" for i in range(1, 9)]
    + [f"vgrf_right_{i}" for i in range(1, 9)]
    + ["total_force_left", "total_force_right"]
)

# Sensor (X, Y) coordinates as documented in format.txt, attributed there to
# the Infotronic insole manufacturer. These are in an ARBITRARY, unitless
# coordinate system (not millimeters) - format.txt explicitly states they
# only reflect "relative (arbitrarily scaled) positions" of the 8 sensors
# within one insole, valid while standing with both legs parallel. Any CoP
# computed from these coordinates is therefore a proxy for relative
# within-insole pressure distribution, NOT a calibrated real-world CoP
# trajectory, and is documented as such wherever it is used.
GAITPDB_SENSOR_XY = {
    "left": {
        1: (-500, -800), 2: (-700, -400), 3: (-300, -400), 4: (-700, 0),
        5: (-300, 0), 6: (-700, 400), 7: (-300, 400), 8: (-500, 800),
    },
    "right": {
        1: (500, -800), 2: (700, -400), 3: (300, -400), 4: (700, 0),
        5: (300, 0), 6: (700, 400), 7: (300, 400), 8: (500, 800),
    },
}

# Filename convention (format.txt): {Study}{Group}{Subjnum}_{Walk}.txt
#   Study: Ga (Yogev dual-task PD, Eur J Neuro 2005), Ju (Hausdorff RAS PD,
#          Eur J Neuro 2007), Si (Frenkel-Toledo treadmill PD, Mov Disord 2005)
#   Group: Co (control) or Pt (PD patient)
#   Walk : 01 = usual walk, 10 = dual-task (serial-7 subtraction) walk, Ga study only
#
# The package also ships demographics.html/.xls (same data, different
# formats) - demographics.txt is preferred here since it parses with plain
# pandas.read_csv (no lxml/xlrd dependency). Confirmed in STEP 0: Group column
# encodes 1=PD patient (Pt), 2=control (Co); Gender: 1=male, 2=female.
GAITPDB_DEMOGRAPHICS_TXT = GAITPDB_RAW_DIR / "demographics.txt"
