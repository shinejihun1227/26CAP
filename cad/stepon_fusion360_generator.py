"""StepOn Fusion 360 generator

Creates:
    1. A lace-mounted electronics housing with a sliding top lid.
    2. A 270 mm insole-shaped base.
    3. Eight editable pressure-sensor placeholder pads on the insole.

Run this file from Fusion 360:
    Utilities -> Add-Ins -> Scripts and Add-Ins -> Scripts -> Open folder

Important:
    Fusion 360's Point3D coordinates use centimetres internally.  This
    script keeps all design values in millimetres and converts points in
    ``p_mm`` so the dimensions remain readable.
"""

import traceback

import adsk.core
import adsk.fusion


# ---------------------------------------------------------------------------
# Editable design parameters (millimetres)
# ---------------------------------------------------------------------------

# User requested internal housing dimensions: 11.5 x 6.5 x 0.85 cm.
HOUSING_INNER_LENGTH = 115.0       # Y direction
HOUSING_INNER_WIDTH = 65.0         # X direction
HOUSING_INNER_HEIGHT = 8.5         # Z direction

HOUSING_WALL = 2.0
HOUSING_BOTTOM = 2.0
HOUSING_END_CLEARANCE = 0.25

RAIL_WIDTH = 3.0
RAIL_HEIGHT = 1.6
LID_THICKNESS = 1.8
LID_CLEARANCE = 0.30
LID_SKIRT_WIDTH = 1.5
LID_SKIRT_DEPTH = 1.0
PULL_TAB_WIDTH = 18.0
PULL_TAB_LENGTH = 5.0
PULL_TAB_HEIGHT = 3.0

# Two elongated holes in the housing bottom for a lace/strap to pass through.
LACE_SLOT_X = (-20.0, 20.0)
LACE_SLOT_WIDTH = 4.0
LACE_SLOT_LENGTH = 28.0

# Insole
INSOLE_LENGTH = 270.0
INSOLE_THICKNESS = 3.2
PRESSURE_PAD_LENGTH = 18.0
PRESSURE_PAD_WIDTH = 12.0
PRESSURE_PAD_THICKNESS = 0.45
SENSOR_ZONE_OFFSET = 0.35


# ---------------------------------------------------------------------------
# Fusion helpers
# ---------------------------------------------------------------------------

def v_mm(value):
    """Create a Fusion distance ValueInput expressed in millimetres."""
    return adsk.core.ValueInput.createByString(f"{value} mm")


def p_mm(x, y, z=0.0):
    """Create a Fusion Point3D from millimetre coordinates."""
    return adsk.core.Point3D.create(x / 10.0, y / 10.0, z / 10.0)


def new_component(root, name):
    """Create and return a new component occurrence."""
    transform = adsk.core.Matrix3D.create()
    occurrence = root.occurrences.addNewComponent(transform)
    component = occurrence.component
    component.name = name
    return component


def offset_plane(component, base_plane, offset_mm, name):
    """Create a construction plane parallel to base_plane."""
    plane_input = component.constructionPlanes.createInput()
    plane_input.setByOffset(base_plane, v_mm(offset_mm))
    plane = component.constructionPlanes.add(plane_input)
    plane.name = name
    return plane


def rectangle(sketch, cx, cy, width, height):
    """Add a centred rectangle to a sketch and return its profile later."""
    lines = sketch.sketchCurves.sketchLines
    lines.addTwoPointRectangle(
        p_mm(cx - width / 2.0, cy - height / 2.0),
        p_mm(cx + width / 2.0, cy + height / 2.0),
    )


def rectangle_sketch(component, plane, cx, cy, width, height, name):
    sketch = component.sketches.add(plane)
    sketch.name = name
    rectangle(sketch, cx, cy, width, height)
    return sketch


def extrude_profiles(component, sketch, distance_mm, operation, body_name):
    """Extrude every closed profile in a sketch.

    A sketch containing multiple independent rectangles produces one profile
    per rectangle.  Each profile is extruded separately so this works with
    both join and cut operations.
    """
    features = component.features.extrudeFeatures
    created = []
    for index in range(sketch.profiles.count):
        profile = sketch.profiles.item(index)
        input_ = features.createInput(profile, operation)
        input_.setDistanceExtent(False, v_mm(distance_mm))
        feature = features.add(input_)
        if index == 0 and feature.bodies.count:
            feature.bodies.item(0).name = body_name
        created.append(feature)
    return created


def make_box(component, plane, cx, cy, width, length, height, name):
    sketch = rectangle_sketch(component, plane, cx, cy, width, length, name + "_Sketch")
    features = extrude_profiles(
        component,
        sketch,
        height,
        adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
        name,
    )
    return features[0] if features else None


def add_label(component, name):
    """Name the first body in a component when one is present."""
    if component.bRepBodies.count:
        component.bRepBodies.item(0).name = name


# ---------------------------------------------------------------------------
# Housing
# ---------------------------------------------------------------------------

def build_housing(root):
    outer_length = HOUSING_INNER_LENGTH + 2.0 * HOUSING_WALL
    outer_width = HOUSING_INNER_WIDTH + 2.0 * HOUSING_WALL
    base_height = HOUSING_BOTTOM + HOUSING_INNER_HEIGHT

    base = new_component(root, "Lace_Housing_Base")

    # Solid outer base.
    outer_sketch = rectangle_sketch(
        base,
        base.xYConstructionPlane,
        0.0,
        0.0,
        outer_width,
        outer_length,
        "Housing_Outer_Profile",
    )
    extrude_profiles(
        base,
        outer_sketch,
        base_height,
        adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
        "Housing_Base",
    )

    # Main cavity.  The cavity starts above the bottom plate and cuts through
    # the top, leaving the requested 115 x 65 x 8.5 mm internal volume.
    cavity_plane = offset_plane(
        base,
        base.xYConstructionPlane,
        HOUSING_BOTTOM,
        "Cavity_Start_Plane",
    )
    cavity_sketch = rectangle_sketch(
        base,
        cavity_plane,
        0.0,
        0.0,
        HOUSING_INNER_WIDTH,
        HOUSING_INNER_LENGTH,
        "Housing_Internal_Cavity",
    )
    extrude_profiles(
        base,
        cavity_sketch,
        HOUSING_INNER_HEIGHT + 3.0,
        adsk.fusion.FeatureOperations.CutFeatureOperation,
        "Housing_Cavity",
    )

    # Lace/strap pass-through openings in the bottom plate.
    lace_sketch = base.sketches.add(base.xYConstructionPlane)
    lace_sketch.name = "Lace_Pass_Through_Slots"
    for x_position in LACE_SLOT_X:
        rectangle(
            lace_sketch,
            x_position,
            0.0,
            LACE_SLOT_WIDTH,
            LACE_SLOT_LENGTH,
        )
    extrude_profiles(
        base,
        lace_sketch,
        HOUSING_BOTTOM + 0.6,
        adsk.fusion.FeatureOperations.CutFeatureOperation,
        "Lace_Slots",
    )

    # Raised rails on the two long sides.  The lid bridges these rails and
    # uses its underside skirts as guides.
    rail_plane = offset_plane(
        base,
        base.xYConstructionPlane,
        base_height - 0.05,
        "Rail_Start_Plane",
    )
    rail_sketch = base.sketches.add(rail_plane)
    rail_sketch.name = "Sliding_Lid_Rails"
    rail_x = outer_width / 2.0 - RAIL_WIDTH / 2.0
    rail_length = HOUSING_INNER_LENGTH + 2.0 * HOUSING_END_CLEARANCE
    rectangle(rail_sketch, -rail_x, 0.0, RAIL_WIDTH, rail_length)
    rectangle(rail_sketch, rail_x, 0.0, RAIL_WIDTH, rail_length)
    extrude_profiles(
        base,
        rail_sketch,
        RAIL_HEIGHT,
        adsk.fusion.FeatureOperations.JoinFeatureOperation,
        "Sliding_Rails",
    )

    # Lid component.  It is generated in its closed position.  Move the
    # component along Y in Fusion to demonstrate the sliding action.
    lid = new_component(root, "Lace_Housing_Sliding_Lid")
    lid_z = base_height + RAIL_HEIGHT - 0.05
    lid_width = outer_width + 2.0 * LID_CLEARANCE
    lid_length = HOUSING_INNER_LENGTH + 2.0 * HOUSING_END_CLEARANCE
    lid_plane = offset_plane(lid, lid.xYConstructionPlane, lid_z, "Lid_Top_Plane")
    lid_sketch = rectangle_sketch(
        lid,
        lid_plane,
        0.0,
        0.0,
        lid_width,
        lid_length,
        "Sliding_Lid_Plate",
    )
    extrude_profiles(
        lid,
        lid_sketch,
        LID_THICKNESS,
        adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
        "Sliding_Lid_Plate",
    )

    # Underside guide skirts.
    skirt_plane = offset_plane(
        lid,
        lid.xYConstructionPlane,
        lid_z - LID_SKIRT_DEPTH,
        "Lid_Guide_Skirt_Plane",
    )
    skirt_sketch = lid.sketches.add(skirt_plane)
    skirt_sketch.name = "Lid_Guide_Skirts"
    skirt_x = outer_width / 2.0 + LID_CLEARANCE / 2.0
    rectangle(skirt_sketch, -skirt_x, 0.0, LID_SKIRT_WIDTH, lid_length - 5.0)
    rectangle(skirt_sketch, skirt_x, 0.0, LID_SKIRT_WIDTH, lid_length - 5.0)
    extrude_profiles(
        lid,
        skirt_sketch,
        LID_SKIRT_DEPTH + 0.05,
        adsk.fusion.FeatureOperations.JoinFeatureOperation,
        "Lid_Guide_Skirts",
    )

    # Pull tab at the front edge of the lid.
    tab_plane = offset_plane(
        lid,
        lid.xYConstructionPlane,
        lid_z + LID_THICKNESS - 0.05,
        "Lid_Pull_Tab_Plane",
    )
    tab_sketch = rectangle_sketch(
        lid,
        tab_plane,
        0.0,
        -lid_length / 2.0 + PULL_TAB_LENGTH / 2.0 + 1.0,
        PULL_TAB_WIDTH,
        PULL_TAB_LENGTH,
        "Lid_Pull_Tab",
    )
    extrude_profiles(
        lid,
        tab_sketch,
        PULL_TAB_HEIGHT,
        adsk.fusion.FeatureOperations.JoinFeatureOperation,
        "Lid_Pull_Tab",
    )

    return base, lid


# ---------------------------------------------------------------------------
# Insole
# ---------------------------------------------------------------------------

def insole_outline_points():
    """Return a symmetric, editable approximate outline for a 270 mm insole."""
    # Half-width values are intentionally conservative.  Replace these with
    # a traced footbed outline when the actual shoe last is available.
    half_widths = [
        (0.0, 31.0),
        (15.0, 34.0),
        (40.0, 37.0),
        (75.0, 40.0),
        (115.0, 43.0),
        (155.0, 46.0),
        (190.0, 48.0),
        (220.0, 46.0),
        (245.0, 41.0),
        (262.0, 33.0),
        (270.0, 10.0),
    ]
    right = [(half_width, y) for y, half_width in half_widths]
    left = [(-half_width, y) for y, half_width in reversed(half_widths[:-1])]
    return right + left


def build_insole(root):
    insole = new_component(root, "Insole_270mm")

    outline_sketch = insole.sketches.add(insole.xYConstructionPlane)
    outline_sketch.name = "Insole_270mm_Outline"
    points = insole_outline_points()
    lines = outline_sketch.sketchCurves.sketchLines
    for index, start in enumerate(points):
        end = points[(index + 1) % len(points)]
        lines.addByTwoPoints(p_mm(start[0], start[1]), p_mm(end[0], end[1]))

    extrude_profiles(
        insole,
        outline_sketch,
        INSOLE_THICKNESS,
        adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
        "Insole_Base",
    )

    # Sensor locations: heel, midfoot, metatarsal and toe zones, each with a
    # medial and lateral position.  These are visual/fit placeholders.  The
    # actual FSR part dimensions should be entered at the top of this file.
    sensor_locations = [
        (-15.0, 28.0),
        (15.0, 28.0),
        (-18.0, 82.0),
        (18.0, 82.0),
        (-22.0, 155.0),
        (22.0, 155.0),
        (-17.0, 225.0),
        (17.0, 225.0),
    ]

    pads = new_component(root, "FSR_Sensor_Zones")
    pad_plane = offset_plane(
        pads,
        pads.xYConstructionPlane,
        INSOLE_THICKNESS + SENSOR_ZONE_OFFSET,
        "FSR_Pad_Plane",
    )
    pad_sketch = pads.sketches.add(pad_plane)
    pad_sketch.name = "FSR_P01_to_P08"
    for x_position, y_position in sensor_locations:
        rectangle(
            pad_sketch,
            x_position,
            y_position,
            PRESSURE_PAD_WIDTH,
            PRESSURE_PAD_LENGTH,
        )
    extrude_profiles(
        pads,
        pad_sketch,
        PRESSURE_PAD_THICKNESS,
        adsk.fusion.FeatureOperations.NewBodyFeatureOperation,
        "FSR_Pads",
    )

    return insole, pads


def run(context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        if design is None:
            document = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
            design = adsk.fusion.Design.cast(document.products.itemByProductType("DesignProductType"))

        root = design.rootComponent
        root.name = "StepOn_270mm_Insole_and_Lace_Housing"

        build_housing(root)
        build_insole(root)

        ui.messageBox(
            "StepOn CAD 생성 완료\n\n"
            "- 115 x 65 x 8.5 mm 내부 하우징\n"
            "- 바닥 신발끈 통과 슬롯 2개\n"
            "- 상부 슬라이드 덮개와 가이드 레일\n"
            "- 270 mm 깔창 외곽선\n"
            "- FSR 센서 위치 8개"
        )
    except Exception:
        if ui:
            ui.messageBox("StepOn CAD 생성 실패:\n{}".format(traceback.format_exc()))

