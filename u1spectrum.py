#!/usr/bin/env python3
"""The native Full Spectrum project format, written the way its own parser reads it.

Full Spectrum (the ``ratdoux/OrcaSlicer-FullSpectrum`` lineage, and the Snapmaker
Orca builds that carry it) keeps mixtures as *virtual filaments*: the four
physical reels keep ids 1-4, every recipe the user accepts gets the next id, and
painted triangles point at whichever id is right for them.  The recipe table
itself lives in one project setting, ``mixed_filament_definitions``, as
semicolon-separated compact rows.

The row grammar and the id rule used here were taken from two independent
sources, both checked read-only:

* the upstream C++ that parses the rows -- ``LegacyRow.cpp`` (token 5 is a
  retired same-layer flag; ``m``/``z``/``d``/``o``/``u`` are metadata) and
  ``Manager.cpp`` (custom rows keep their stable id, missing auto rows are
  appended as tombstones, and ids are "physical + 1 + visible index"); revision
  ``ba00f1d661b1b8d6a4e9c8b9c4bd9a8e5150089f`` is recorded in
  ``docs/agent-work/colour-strategy/references/upstream-revision.txt``;
* Strata's working writer for this target (``src/js/89-texture-spectrum.js`` and
  the matching branch of ``60-export.js``), reviewed read-only, which is where
  the config key names come from.

Target: Snapmaker Orca with Full Spectrum support.  The installed build is
2.4.0, and its ``Snapmaker_Orca.dll`` carries ``mixed_filament_definitions`` and
``mixed_color_layer_height_a``, so the recipes are read by the same application
that opens ordinary U1 projects -- nothing here depends on a separate
application.  Whether the rebuilt project loads identically at runtime has not
been checked in this phase, because starting the slicer is out of scope.

What this module will *not* do: write ids past 16.  Newer Prusa-format files
extend paint states above 16 with a different escape, and a file that mixes the
two encodings would be read as different colours by different slicers.  Twelve
recipes is the ceiling here, and a value outside that range is refused rather
than guessed at.
"""

from __future__ import annotations

import re

import u1colour
import u1mix

# Four physical reels plus twelve recipes = 16 ids, the largest range whose
# escaping is unambiguous across Prusa, Bambu and Orca.
MAX_VISIBLE = 16
MAX_RECIPES = MAX_VISIBLE - 4

# The pitch the reference writer used for its recipes.  This app does not force
# it: the project keeps whatever process the user selected, because a stock
# process name is a preset the slicer has to be able to resolve, and the
# Snapmaker 2.4.0 release renamed the old "0.08 Extra Fine" process.  Set these
# only when the user explicitly asks for the recipe pitch.
REFERENCE_LAYER_HEIGHT = "0.08"
REFERENCE_INITIAL_LAYER = "0.2"

# Application metadata that keeps the slicer from prompting about an unknown
# paint version on load. A "BambuStudio:MmPaintingVersion" must NOT be written:
# it turns the file into a multi-material-painting document and opens a dialog.
APPLICATION = "BambuStudio-2.3.5"

RECIPE_RE = re.compile(r"^\s*(\d+)\s*[,:]\s*(\d+)\s*[,:]\s*(\d+)\s*$")


class SpectrumError(ValueError):
    """The recipe set cannot be written as a Full Spectrum project."""


def parse_recipes(text: str) -> list:
    """``"1,3,50;2,4,25"`` -> ``[{"a":1,"b":3,"percent":50}, ...]``."""
    out = []
    for chunk in re.split(r"[;|]", text or ""):
        if not chunk.strip():
            continue
        m = RECIPE_RE.match(chunk)
        if m is None:
            raise SpectrumError(
                f"recipe {chunk.strip()!r} is not 'first,second,percent'")
        a, b, percent = (int(m.group(i)) for i in (1, 2, 3))
        out.append({"a": a, "b": b, "percent": percent})
    return out


def check(physical: int, recipes: list) -> None:
    if physical < 1:
        raise SpectrumError("a Full Spectrum project needs at least one physical reel")
    if len(recipes) > MAX_RECIPES:
        raise SpectrumError(
            f"{len(recipes)} recipes would need {physical + len(recipes)} filament ids "
            f"and this writer stops at {MAX_VISIBLE}; keep at most {MAX_RECIPES}")
    if physical + len(recipes) > MAX_VISIBLE:
        raise SpectrumError(
            f"{physical} reels plus {len(recipes)} recipes exceed the {MAX_VISIBLE} "
            "ids this writer can serialise without ambiguity")
    for index, recipe in enumerate(recipes):
        a, b, percent = recipe.get("a"), recipe.get("b"), recipe.get("percent")
        if not isinstance(a, int) or not isinstance(b, int):
            raise SpectrumError(f"recipe {index + 1} needs integer reels")
        if a == b or not (1 <= a <= physical) or not (1 <= b <= physical):
            raise SpectrumError(
                f"recipe {index + 1} must name two different reels out of 1-{physical}")
        if not isinstance(percent, int) or not 0 < percent < 100:
            raise SpectrumError(
                f"recipe {index + 1} needs a share between 1 and 99 per cent")


def virtual_id(physical: int, index: int) -> int:
    """The filament id of recipe ``index`` (0-based). Physical ids come first."""
    return physical + index + 1


def check_types(physical_types: list, recipes: list) -> None:
    """Refuse a recipe that would blend two different materials.

    The mixture model says nothing about combining, say, PLA with PETG, so a
    recipe that names two materials is refused before anything is written --
    whatever route it arrived by (page, API or command line).
    """
    for index, recipe in enumerate(recipes):
        try:
            first = physical_types[recipe["a"] - 1]
            second = physical_types[recipe["b"] - 1]
        except (IndexError, KeyError, TypeError):
            raise SpectrumError(
                f"recipe {index + 1} names a reel that has no material type")
        if str(first or "").strip().upper() != str(second or "").strip().upper():
            raise SpectrumError(
                f"recipe {index + 1} would blend reel {recipe['a']} ({first}) with "
                f"reel {recipe['b']} ({second}); only two reels of the same material "
                "can be mixed")


def row(a: int, b: int, *, enabled: bool, custom: bool, percent: int,
        deleted: bool, stable_id: int) -> str:
    """One ``mixed_filament_definitions`` row.

    Token 5 is the retired same-layer flag and is always written as 0.  The
    metadata tail sets the distribution to ``Simple`` (``m2`` in the enum
    ``LayerCycle = 0, SameLayerPointillisme = 1, Simple = 2``), which resolves a
    layer to one of the two components from the recipe's own cadence, and clears
    the optional local-Z cap and surface offsets.
    """
    return ("%d,%d,%d,%d,%d,0,g,w,m2,z0,xa0,xb0,d%d,o%d,u%d"
            % (a, b, 1 if enabled else 0, 1 if custom else 0, percent,
               1 if deleted else 0, 0 if custom else 1, stable_id))


def definitions(physical: int, recipes: list) -> list:
    """The full row list: custom recipes first, then every pair as a tombstone.

    The tombstones matter.  The slicer appends its own automatic pair rows when
    they are missing, and that insertion would shift the visible index -- and so
    the id every painted triangle points at.  Writing them as deleted rows keeps
    the ids stable while leaving the pairs available to the user later.
    """
    check(physical, recipes)
    rows = []
    stable = 1
    for recipe in recipes:
        rows.append(row(recipe["a"], recipe["b"], enabled=True, custom=True,
                        percent=recipe["percent"], deleted=False, stable_id=stable))
        stable += 1
    for a in range(1, physical + 1):
        for b in range(a + 1, physical + 1):
            rows.append(row(a, b, enabled=False, custom=False, percent=50,
                            deleted=True, stable_id=stable))
            stable += 1
    return rows


def palette(physical_colors: list, recipes: list) -> list:
    """Predicted hex for each recipe, in id order, after the physical colours."""
    out = []
    for recipe in recipes:
        first = physical_colors[recipe["a"] - 1]
        second = physical_colors[recipe["b"] - 1]
        out.append(u1mix.mix_hex(first, second, recipe["percent"]))
    return out


def config_values(physical: int, recipes: list, print_settings_id: str | None = None,
                  layer_height: str | None = None,
                  initial_layer: str | None = None) -> dict:
    """The project settings that describe the mixtures.

    These keys, and only these, are what a Full Spectrum target reads.  The
    virtual filaments do *not* get entries in ``filament_colour`` or in any other
    per-filament array: the length of ``filament_colour`` is how the slicer works
    out how many *physical* reels the recipes are built from, so appending
    mixtures to it would shift every id -- the first recipe would be read as a
    fifth physical reel and the paint ids would point at nothing.
    """
    check(physical, recipes)
    values = {
        "mixed_filament_definitions": ";".join(definitions(physical, recipes)),
        "mixed_color_layer_height_a": "0",
        "mixed_color_layer_height_b": "0",
        "mixed_filament_gradient_mode": "0",
        "mixed_filament_advanced_dithering": "0",
        "mixed_filament_height_lower_bound": "0.04",
        "mixed_filament_height_upper_bound": "0.16",
        "dithering_z_step_size": "0",
        "dithering_local_z_mode": "0",
        "dithering_step_painted_zones_only": "1",
        "adaptive_layer_height": "0",
    }
    if layer_height:
        values["layer_height"] = layer_height
        values["initial_layer_print_height"] = initial_layer or layer_height
    if print_settings_id:
        values["print_settings_id"] = print_settings_id
    return values


# Bambu stores mixtures as extra filaments with these arrays.  Snapmaker's
# Full Spectrum does not, and writing them here would describe the palette to
# the wrong schema, so they are removed if a template ever carries them.
BAMBU_ONLY_KEYS = (
    "filament_is_mixed", "filament_mixed_components",
    "filament_mixed_sublayer_ratios", "filament_multi_colour",
    "filament_mixed_gradient", "filament_mixed_gradient_per_part",
    "filament_mixed_gradient_range", "filament_mixed_gradient_curve",
    "enable_mixed_color_sublayer",
)


def apply(cfg: dict, physical_colors: list, physical_types: list, recipes: list,
          filament_profile: str | None = None,
          print_settings_id: str | None = None,
          layer_height: str | None = None,
          initial_layer: str | None = None) -> dict:
    """Describe the recipes in a four-slot config, in place.

    The physical palette is left exactly as it was -- same colours, same types,
    same array lengths.  What changes is that the project now declares the
    mixture rows, which is what makes filament id ``4 + 1 + k`` mean the k-th
    recipe.
    """
    physical = len(physical_colors)
    check(physical, recipes)
    check_types(physical_types, recipes)
    values = config_values(physical, recipes, print_settings_id=print_settings_id,
                           layer_height=layer_height, initial_layer=initial_layer)
    colours = [u1colour.norm(c) or "#FFFFFF" for c in physical_colors]
    types = [t or "PLA" for t in physical_types]
    cfg["filament_colour"] = [c + "FF" for c in colours]
    cfg["extruder_colour"] = list(colours)
    cfg["filament_type"] = list(types)
    if filament_profile:
        cfg["filament_settings_id"] = [filament_profile] * physical
    cfg["nozzle_diameter"] = ["0.4"] * physical
    for key in BAMBU_ONLY_KEYS:
        cfg.pop(key, None)
    cfg.update(values)
    return cfg


def validate(cfg: dict, physical: int, recipes: list) -> list:
    """Re-read what was written and report anything that would confuse a slicer."""
    problems: list = []
    try:
        check(physical, recipes)
    except SpectrumError as exc:
        return [str(exc)]
    text = cfg.get("mixed_filament_definitions")
    if not isinstance(text, str) or not text:
        return ["the project has no mixed_filament_definitions"]
    rows = text.split(";")
    custom = []
    deleted = []
    stable_ids = []
    for index, line in enumerate(rows):
        tokens = [t.strip() for t in line.split(",")]
        if len(tokens) < 4:
            problems.append(f"row {index + 1} has {len(tokens)} tokens")
            continue
        try:
            a, b, enabled, is_custom = (int(tokens[i]) for i in range(4))
            percent = int(tokens[4]) if len(tokens) > 4 else 50
        except ValueError:
            problems.append(f"row {index + 1} has a non-numeric field")
            continue
        if not (1 <= a <= physical) or not (1 <= b <= physical) or a == b:
            problems.append(f"row {index + 1} names reels {a},{b} out of 1-{physical}")
        meta = {}
        for token in tokens[5:]:
            if token[:1] in ("m", "z", "d", "o", "u") and len(token) > 1:
                meta[token[0]] = token[1:]
        if meta.get("u"):
            try:
                stable_ids.append(int(meta["u"]))
            except ValueError:
                problems.append(f"row {index + 1} has a non-numeric stable id")
        if is_custom and enabled:
            custom.append((a, b, percent))
        if meta.get("d") == "1":
            deleted.append((a, b))
    if len(custom) != len(recipes):
        problems.append(f"{len(custom)} custom rows for {len(recipes)} recipes")
    for index, recipe in enumerate(recipes):
        want = (recipe["a"], recipe["b"], recipe["percent"])
        if index >= len(custom) or custom[index] != want:
            problems.append(f"recipe {index + 1} is written as "
                            f"{custom[index] if index < len(custom) else 'nothing'}, "
                            f"expected {want}")
    expected_pairs = {(a, b) for a in range(1, physical + 1)
                      for b in range(a + 1, physical + 1)}
    if set(deleted) != expected_pairs:
        missing = sorted(expected_pairs - set(deleted))
        problems.append(f"the auto pair rows are not all tombstoned (missing {missing})")
    if len(set(stable_ids)) != len(stable_ids):
        problems.append("two rows share a stable id")
    total = physical + len(recipes)
    for key in ("filament_colour", "extruder_colour", "filament_type",
                "nozzle_diameter"):
        value = cfg.get(key)
        if not isinstance(value, list) or len(value) != physical:
            problems.append(f"{key} has {len(value) if isinstance(value, list) else 0} "
                            f"entries; the physical palette must stay at {physical}")
    for key in BAMBU_ONLY_KEYS:
        if key in cfg:
            problems.append(f"{key} is a Bambu mixture field and must not be written")
    # Independent oracle: work the visible id order out from the rows themselves
    # rather than from the helper that wrote them, the way the C++ does -- custom
    # rows in serialisation order, then unconsumed automatic rows, skipping any
    # row that is disabled or tombstoned.
    visible = []
    for line in rows:
        tokens = [t.strip() for t in line.split(",")]
        if len(tokens) < 4:
            continue
        try:
            enabled, is_custom = int(tokens[2]), int(tokens[3])
        except ValueError:
            continue
        deleted = "d1" in tokens
        if not enabled or deleted:
            continue
        visible.append(is_custom)
    for index in range(len(recipes)):
        position = index
        if position >= len(visible) or visible[position] != 1:
            problems.append(
                f"filament id {physical + 1 + index} does not resolve to recipe "
                f"{index + 1} in the row order the slicer walks")
    return problems


def mapping_with_recipes(plan_mapping: dict, physical: int) -> dict:
    """Reject a mapping that points at an id this writer will not produce."""
    out = {}
    for source, target in (plan_mapping or {}).items():
        try:
            value = int(target)
        except (TypeError, ValueError):
            raise SpectrumError(f"slot {target!r} for colour {source} is not a number")
        if not 1 <= value <= MAX_VISIBLE:
            raise SpectrumError(
                f"colour {source} is mapped to filament id {value}; this writer only "
                f"produces ids 1-{MAX_VISIBLE}")
        out[int(source)] = value
    return out
