#!/usr/bin/env python3
"""Read a sliced G-code's real tool use, then plan reel changes from it.

The height estimate is a guess; only the slicer's own output says what the nozzle
really lays down, because infill, supports and the wipe tower are all in there.
So this module reads a G-code file the user sliced themselves and answers two
questions:

* which filaments actually extrude in each layer (travel, a prime line, a
  retraction or a tool-switch comment is not a colour);
* if no layer needs more than the four the machine has, a deterministic sequence
  of reel changes that satisfies every layer.

It never edits the G-code.  The plan is a separate human-readable file plus a
JSON record of the evidence, so the user's original file stays untouched.

What is modelled explicitly
---------------------------
commands are matched exactly (``G90.1`` is not ``G90`` and ``M820`` is not ``M82``),
with absolute and relative extrusion (``M82``/``M83``), ``G92 E`` resets, retract
debt (an unretraction restores material that was already counted, so it is not a
colour), movement measured by the coordinates actually changing, linear and arced
depositing moves including a full circle, one logical layer per
``;LAYER_CHANGE``/``;CHANGE_LAYER`` with ``;Z:`` and ``;HEIGHT:`` as metadata,
startup and purge extrusion as initial needs, ``T0``-based tool ids, and the slicer
sentinels ``M600``/``M0``/``M1`` reported as operator actions.  Every layer and
every change carries its source line number.

What is refused rather than guessed
-----------------------------------
inches (``G20``), volumetric extrusion (``M200`` with a diameter), firmware retract
(``G10``/``G11``), conditional or activated tools (``ACTIVATE_EXTRUDER``,
``M620``-``M623``), sentinel tool ids (``T255`` and up), ``G90.1``, a move whose
axis word has no number, no layer markers, and no deposition at all.  Refusals
raise :class:`GcodeError` with a sentence the page can show.
"""

from __future__ import annotations

import bisect
import hashlib
import re

MAX_BYTES = 96 * 1024 * 1024
MAX_LAYERS = 40000


class GcodeError(ValueError):
    """The file is not G-code this module can read honestly."""


LAYER_START_RE = re.compile(
    r"^\s*;\s*(?:LAYER_CHANGE|CHANGE_LAYER)\b", re.I)
# `re.M`, because these are used both per line and against a whole file: without
# it `^` matches only the start of the text, so a real header followed by
# hook-only layers looked like a file with no layer markers at all.
LAYER_HOOK_RE = re.compile(
    r"^\s*;\s*(?:BEFORE_LAYER_CHANGE|AFTER_LAYER_CHANGE)\b", re.I | re.M)
LAYER_AFTER_RE = re.compile(r"^\s*;\s*AFTER_LAYER_CHANGE\b", re.I | re.M)
LAYER_START_ALT_RE = re.compile(r"^\s*;\s*LAYER\b\s*$", re.I)
LAYER_Z_RE = re.compile(r"^\s*;\s*Z\s*[:=]\s*(-?[0-9.]+)", re.I)
LAYER_HEIGHT_RE = re.compile(r"^\s*;\s*HEIGHT\s*[:=]\s*(-?[0-9.]+)", re.I)
STATS_LAYER_RE = re.compile(
    r"^\s*;?\s*SET_PRINT_STATS_INFO\s+CURRENT_LAYER\s*[:=]\s*(\d+)", re.I)
TOTAL_LAYER_RE = re.compile(
    r"^\s*;?\s*SET_PRINT_STATS_INFO\s+TOTAL_LAYER\s*[:=]\s*(\d+)", re.I)
TIME_RE = re.compile(
    r"^\s*;\s*(?:estimated printing time[^=:=]*|model printing time[^=:=]*|"
    r"total estimated time[^=:=]*)\s*[:=]\s*(.+?)\s*$", re.I)
FILAMENT_RE = re.compile(
    r"^\s*;\s*(?:filament|filament_settings_id|filament_type)\w*\s*[:=]\s*(.+?)\s*$",
    re.I)
TOOL_RE = re.compile(r"^\s*T(\d+)\s*$")
MOVE_RE = re.compile(r"^\s*(G[0-3])\b(.*)$", re.I)
PARAM_RE = re.compile(r"([XYZEFIJ])(-?(?:[0-9]+\.?[0-9]*|\.[0-9]+))", re.I)
NUMBER_RE = re.compile(r"^[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$")
WORD_RE = re.compile(r"([A-Za-z])([^\s;]*)")

# Exact command matches: a prefix test would read G90.1 as G90 and M820 as M82.
EXACT = {
    "M82": re.compile(r"^M82(?:\s|$)", re.I),
    "M83": re.compile(r"^M83(?:\s|$)", re.I),
    "G90": re.compile(r"^G90(?:\s|$)", re.I),
    "G91": re.compile(r"^G91(?:\s|$)", re.I),
    "G92": re.compile(r"^G92(?:\s|$)", re.I),
    "G20": re.compile(r"^G20(?:\s|$)", re.I),
    "G10": re.compile(r"^G10(?:\s|$)", re.I),
    "G11": re.compile(r"^G11(?:\s|$)", re.I),
    "M600": re.compile(r"^M600(?:\s|$)", re.I),
    "M0": re.compile(r"^M0(?:\s|$)", re.I),
    "M1": re.compile(r"^M1(?:\s|$)", re.I),
    "G90_1": re.compile(r"^G90\.1(?:\s|$)", re.I),
    "M200_D": re.compile(r"^M200\b.*\bD", re.I),
}

UNMODELLED = (
    (re.compile(r"^ACTIVATE_EXTRUDER\b", re.I),
     "the file activates a tool with ACTIVATE_EXTRUDER, which this planner does not "
     "model"),
    (re.compile(r"^M62[0-3](?:\s|$)", re.I),
     "the file uses conditional tool commands (M620-M623), which this planner does "
     "not model"),
    # SET_PRESSURE_ADVANCE / SET_FILAMENT_SENSOR / EXCLUDE_OBJECT are passive:
    # none of them changes which reel extrudes material, so they are ignored
    # deliberately (see PASSIVE_RE) rather than refused.
)

# Commands this planner understands well enough to ignore: none of them can change
# *which* reel extrudes material.  Anything else that looks like a command (a
# macro, a mode lookalike such as M820, a conditional tool change) is refused with
# a sentence rather than skipped, because skipping it would let the plan look
# confident about a file it did not really read.
PASSIVE_RE = re.compile(
    r"^(?:G4|G21|G28|G29|G80|M18|M84|M73|M117|M118|M104|M105|M109|M140|M141|M155|"
    r"M190|M191|M106|M107|M204|M205|M201|M203|M220|M221|M400|M900|M572|M566|M593|"
    r"M594|SET_PRESSURE_ADVANCE|SET_VELOCITY_LIMIT|SET_FAN_SPEED|SET_GCODE_OFFSET|"
    r"SET_FILAMENT_SENSOR|EXCLUDE_OBJECT\w*)"
    r"(?:\s|$)", re.I)
FLAVOUR_RE = re.compile(r"^\s*;\s*gcode_flavor\s*[:=]\s*(\S+)", re.I | re.M)


def decode(data: bytes) -> str:
    """Bytes -> text, refusing the shapes that are not plain ASCII G-code."""
    if not data:
        raise GcodeError("the file is empty")
    if len(data) > MAX_BYTES:
        raise GcodeError(f"the file is {len(data) / 1048576:.1f} MB; this reader stops "
                         f"at {MAX_BYTES // 1048576} MB")
    if b"\x00" in data[:8192]:
        raise GcodeError("this looks like a binary file, not ASCII G-code (a .gcode "
                         "member inside a sliced 3MF has to be chosen explicitly)")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    sample = text[:20000]
    if sample:
        printable = sum(1 for ch in sample if 32 <= ord(ch) < 127 or ch in "\r\n\t")
        if printable < 0.98 * len(sample):
            raise GcodeError("this is not plain-text G-code")
    return text


def flavour(text: str) -> str:
    head = text[:200000].lower()
    for needle, name in (("orcaslicer", "orca"), ("prusaslicer", "prusa"),
                         ("bambustudio", "bambu"), ("bambu studio", "bambu"),
                         ("snapmaker", "snapmaker")):
        if needle in head:
            return name
    return "unknown"


def _params(text: str, line_no: int = 0) -> dict:
    """Axis words of one move; a word with no number is a malformed line."""
    out = {}
    for letter, value in PARAM_RE.findall(text):
        try:
            number = float(value)
        except ValueError as exc:                       # pragma: no cover - regex
            raise GcodeError(f"line {line_no}: {letter} has no number in "
                             f"{text.strip()!r}") from exc
        if number != number or abs(number) == float("inf"):
            raise GcodeError(f"line {line_no}: {letter}{value} is not a finite number")
        out[letter.upper()] = number
    # The whole token has to be a number: `E1oops` must not pass as an extrusion of 1.
    for letter, value in WORD_RE.findall(text):
        if not NUMBER_RE.match(value or ""):
            raise GcodeError(f"line {line_no}: {letter} has no number in "
                             f'"{text.strip()}"')
    return out


def analyse(text: str, *, physical: int = 4) -> dict:
    """Per-layer real tool use, plus a schedule when one exists."""
    try:
        return _analyse(text, physical=physical, hooks_as_markers=False)
    except _NoLayers:
        # Some dialects write only the hooks around a layer. Fall back once, and
        # only then, rather than counting both and doubling every layer.
        if not LAYER_HOOK_RE.search(text):
            raise
        # Count only the *after* hook: counting both would make every layer two.
        return _analyse(text, physical=physical, hooks_as_markers=True)


class _NoLayers(GcodeError):
    pass


def _analyse(text: str, *, physical: int = 4, hooks_as_markers: bool = False) -> dict:
    if physical < 1:
        raise GcodeError("a machine needs at least one slot")
    if not text.strip():
        raise GcodeError("the file has no G-code in it")

    absolute_e = True
    absolute_xyz = True
    # How this firmware's G90/G91 treats the extruder.  Klipper keeps E on its own
    # M82/M83 switch; Marlin resets E with the XYZ mode.  When the file does not say
    # which, an E word after a mode change is refused until M82/M83 settles it.
    mode_match = FLAVOUR_RE.search(text[:100000])
    firmware = (mode_match.group(1).lower() if mode_match else "")
    klipper_like = firmware in ("klipper", "reprapfirmware", "rrf", "smoothieware")
    marlin_like = firmware in ("marlin", "marlin2")
    e_mode_unclear = False
    tool = 0
    position = {"X": 0.0, "Y": 0.0, "Z": 0.0}
    e_position = 0.0
    # Debt is per tool: a retraction on T0 must not hide material from T4.
    debt: dict = {}
    swap_seen = False

    layers: list = []
    current: dict | None = None
    startup: dict = {}
    markers = 0
    retractions = 0
    primes = 0
    moves = 0
    sentinels: list = []
    reported_time = ""
    stats_layers = 0
    total_layers = None
    anomalies = 0
    legend: list = []
    pending: dict = {"z": None, "height": None}

    for line_no, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue

        if line.startswith(";"):
            starts = (LAYER_START_RE.match(line) or LAYER_START_ALT_RE.match(line)
                      or (hooks_as_markers and LAYER_AFTER_RE.match(line)))
            if starts:
                # A repeated start marker before anything is deposited is the same
                # layer written twice; the first boundary stays the layer's line.
                if current is not None and not current["deposited"]:
                    markers += 1
                    continue
                if len(layers) >= MAX_LAYERS:
                    raise GcodeError(f"more than {MAX_LAYERS} layers; this reader "
                                     "stops there")
                current = {"index": len(layers), "z": None, "height": None,
                           "line": line_no, "tools": {}, "deposited": False}
                if pending["z"] is not None or pending["height"] is not None:
                    # A layer whose metadata came before its only marker (the
                    # hook-only dialect writes Z before AFTER_LAYER_CHANGE).
                    current["z"] = pending["z"]
                    current["height"] = pending["height"]
                    pending = {"z": None, "height": None}
                layers.append(current)
                markers += 1
                continue
            meta = LAYER_Z_RE.match(line)
            if meta:
                value = float(meta.group(1))
                if value != value or abs(value) == float("inf"):
                    raise GcodeError(f"line {line_no}: a layer Z is not finite")
                if current is None or current["z"] is not None:
                    # No layer open, or the open layer already has its Z: this one
                    # belongs to the layer that is about to start.
                    pending["z"] = value
                else:
                    current["z"] = value
                continue
            height = LAYER_HEIGHT_RE.match(line)
            if height:
                # HEIGHT is the layer's thickness, not its position.
                value = float(height.group(1))
                if current is None or current["height"] is not None:
                    pending["height"] = value
                else:
                    current["height"] = value
                continue
            if STATS_LAYER_RE.match(line):
                stats_layers += 1
                continue
            total = TOTAL_LAYER_RE.match(line)
            if total:
                total_layers = int(total.group(1))
                continue
            total = TOTAL_LAYER_RE.match(line)
            if total:
                total_layers = int(total.group(1))
                continue
            stamp = TIME_RE.match(line)
            if stamp and not reported_time:
                reported_time = stamp.group(1).strip()
                continue
            spool = FILAMENT_RE.match(line)
            if spool:
                legend.append(spool.group(1).strip())
            continue

        head = line.split(";", 1)[0].strip()
        if not head:
            continue
        upper = head.upper()

        if STATS_LAYER_RE.match(head):
            stats_layers += 1
            continue
        if TOTAL_LAYER_RE.match(head):
            total_layers = int(TOTAL_LAYER_RE.match(head).group(1))
            continue
        if EXACT["G90_1"].match(head):
            raise GcodeError("this file switches to G90.1 extrusion, whose semantics "
                             "this planner does not model")
        for pattern, message in UNMODELLED:
            if pattern.match(head):
                raise GcodeError(message)
        if EXACT["G20"].match(head):
            raise GcodeError("this file switches to inches (G20), which this planner "
                             "does not model")
        if EXACT["M200_D"].match(head):
            raise GcodeError("this file uses volumetric extrusion (M200 with a "
                             "diameter), which this planner does not model")
        if EXACT["G10"].match(head) or EXACT["G11"].match(head):
            raise GcodeError("this file uses firmware retraction (G10/G11), which this "
                             "planner does not model")
        if EXACT["M600"].match(head):
            sentinels.append({"kind": "filament-change", "command": head,
                              "line": line_no, "layer": _layer_of(current)})
            swap_seen = True
            continue
        if EXACT["M0"].match(head) or EXACT["M1"].match(head):
            sentinels.append({"kind": "pause", "command": head, "line": line_no,
                              "layer": _layer_of(current)})
            continue

        if EXACT["M82"].match(head):
            absolute_e = True
            e_mode_unclear = False
            continue
        if EXACT["M83"].match(head):
            absolute_e = False
            e_mode_unclear = False
            continue
        if EXACT["G90"].match(head) or EXACT["G91"].match(head):
            absolute_xyz = bool(EXACT["G90"].match(head))
            if marlin_like:
                absolute_e = absolute_xyz
            elif not klipper_like:
                e_mode_unclear = True
            continue
        if EXACT["G92"].match(head):
            # Any whitespace separates the command from its arguments: a tab is
            # as good as a space in real slicer output.
            pieces = head.split(None, 1)
            params = _params(pieces[1] if len(pieces) > 1 else "", line_no)
            if "E" in params:
                # G92 E moves the *coordinate*, not the physical material: the
                # filament still owes whatever a previous retraction took out.
                e_position = params["E"]
            for axis in ("X", "Y", "Z"):
                if axis in params:
                    position[axis] = params[axis]
            continue

        tool_match = TOOL_RE.match(head)
        if tool_match:
            number = int(tool_match.group(1))
            if number >= 250:
                raise GcodeError(f"line {line_no}: T{number} looks like a slicer "
                                 "sentinel rather than a tool; this planner will not "
                                 "guess which reel it means")
            tool = number
            continue

        move = MOVE_RE.match(head)
        if move is None:
            if PASSIVE_RE.match(head):
                continue
            raise GcodeError(
                f'line {line_no}: this file uses "{head}", which this planner does '
                "not model; it will not guess whether that changes extrusion or which "
                "reel is in the head")
        params = _params(move.group(2), line_no)
        if not params:
            continue
        moves += 1
        if move.group(1).upper() in ("G2", "G3") and "E" in params \
                and "X" not in params and "Y" not in params:
            # A full circle: it deposits even though the end point is the start point.
            params.setdefault("I", 0.0)

        before = dict(position)
        for axis in ("X", "Y", "Z"):
            if axis in params:
                position[axis] = params[axis] if absolute_xyz \
                    else position[axis] + params[axis]
        moved_xy = abs(position["X"] - before["X"]) > 1e-9 \
            or abs(position["Y"] - before["Y"]) > 1e-9
        if current is not None and current["z"] is None:
            current["z"] = position["Z"]

        if "E" not in params:
            continue
        if e_mode_unclear:
            raise GcodeError(
                f"line {line_no}: this file changes the move mode without saying "
                "whether extrusion is absolute or relative (no M82/M83 after "
                "G90/G91), so this planner will not guess how much filament this "
                "move uses")
        if swap_seen:
            raise GcodeError(
                f"line {line_no}: this G-code changes filament itself (M600) and then "
                "prints again, so which reel is in the head is unknown; this planner "
                "will not give a confident schedule for it")
        delta = params["E"] - e_position if absolute_e else params["E"]
        e_position = params["E"] if absolute_e else e_position + params["E"]
        if delta < -1e-9:
            retractions += 1
            debt[tool] = debt.get(tool, 0.0) + -delta
            continue
        if delta <= 1e-9:
            continue
        moving = moved_xy or "I" in params or "J" in params
        owed = debt.get(tool, 0.0)
        if owed > 1e-9:
            consumed = min(owed, delta)
            debt[tool] = owed - consumed
            delta -= consumed
            # Printing through a retracted nozzle is worth reporting; the payback
            # itself is not new material.
            if moving:
                anomalies += 1
            if delta <= 1e-9:
                continue
        if not moving:
            primes += 1
        bucket = current["tools"] if current is not None else startup
        bucket[tool] = bucket.get(tool, 0.0) + delta
        if current is not None:
            current["deposited"] = True

    if markers == 0:
        raise _NoLayers("this G-code has no layer markers, so no per-layer plan can "
                        "be made from it")
    if not layers:
        raise _NoLayers("no layers were found in this G-code")

    used = sorted({t for layer in layers for t in layer["tools"]} | set(startup))
    if not used:
        raise GcodeError("no filament is deposited anywhere in this G-code")

    per_layer = [{"index": layer["index"], "z": layer["z"],
                  "height": layer["height"], "line": layer["line"],
                  "tools": sorted(layer["tools"])} for layer in layers]
    incompatible = [entry for entry in per_layer if len(entry["tools"]) > physical]

    result = {
        "flavour": flavour(text),
        "layers": len(layers),
        "moves": moves,
        "retractions": retractions,
        "primes": primes,
        "anomalies": anomalies,
        "stats_layer_markers": stats_layers,
        "total_layers": total_layers,
        "sentinels": sentinels[:40],
        "startup_tools": sorted(startup),
        "tools": used,
        "legend": legend[:8],
        "max_tools_per_layer": max((len(e["tools"]) for e in per_layer), default=0),
        "incompatible_layers": incompatible[:20],
        "incompatible_count": len(incompatible),
        "reported_time": reported_time,
        "per_layer": per_layer,
        "physical": physical,
    }
    if incompatible:
        worst = max(len(e["tools"]) for e in incompatible)
        first = incompatible[0]
        result.update({
            "feasible": False,
            "schedule": [], "initial": {}, "pause_count": None,
            "reel_changes": None, "diagnosis": "too-many-colours-per-layer",
            "summary": (
                f"{len(incompatible)} of {len(layers)} layers deposit more than "
                f"{physical} colours (worst {worst}, first at layer {first['index']}, "
                f"line {first['line']}"
                + (f", Z {first['z']:.2f} mm" if first["z"] is not None else "")
                + "). Colours inside one layer cannot be separated by changing reels "
                  "between layers, so there is no layer-boundary plan for this file. "
                  "Recolour the model or slice it differently."),
        })
        return result

    plan = schedule(per_layer, sorted(startup), physical)
    result.update(plan)
    result["feasible"] = True
    result["diagnosis"] = "ok"
    return result


def _layer_of(current) -> int | None:
    return current["index"] if current is not None else None


def schedule(per_layer: list, startup: list, physical: int) -> dict:
    """A deterministic, future-aware reel schedule, then simulate it.

    A change is only ever inserted *before* a layer, which is the only point the
    machine can pause at.  When a layer needs a reel that is not loaded, the slot
    holding the reel used furthest in the future is the one reused; a reel that is
    still needed by the current layer is never evicted.  The result is a valid
    schedule, not a claim that it is the shortest one.
    """
    if len(set(per_layer[0]["tools"]) | set(startup)) > physical:
        raise GcodeError("the first layer already needs more colours than the machine "
                         "has")

    # Load the reels that are needed soonest: the first `physical` tools in
    # first-use order.  Filling every slot up front is what the operator expects,
    # and it means a tool that is only needed much later does not occupy a slot
    # that a sooner one needs.
    first_use: dict = {}
    for tool in startup:
        first_use[tool] = -1
    for index, layer in enumerate(per_layer):
        for tool in layer["tools"]:
            first_use.setdefault(tool, index)
    ordered = sorted(first_use, key=lambda tool: (first_use[tool], tool))
    needed = ordered[:physical]

    # Where each tool is used next: one sorted list per tool, searched with bisect,
    # so a file with thousands of layers is not quadratic.
    uses: dict = {}
    for index, layer in enumerate(per_layer):
        for tool in layer["tools"]:
            uses.setdefault(tool, []).append(index)

    def next_use(tool: int, from_layer: int) -> int:
        where = uses.get(tool)
        if not where:
            return len(per_layer) + 1
        position = bisect.bisect_left(where, from_layer)
        return where[position] if position < len(where) else len(per_layer) + 1

    loaded: dict = {}                      # slot -> tool
    initial: dict = {}                     # tool -> slot
    for index, tool in enumerate(needed):
        loaded[index + 1] = tool
        initial[tool] = index + 1
    next_slot = len(loaded) + 1

    changes: list = []
    for position, layer in enumerate(per_layer):
        required = layer["tools"]
        missing = [t for t in required if t not in loaded.values()]
        for tool in missing:
            if next_slot <= physical:
                slot = next_slot
                next_slot += 1
            else:
                keep = {loaded[s] for s in loaded if loaded[s] in required}
                options = [s for s in sorted(loaded) if loaded[s] not in keep]
                if not options:
                    raise GcodeError(
                        f"layer {layer['index']} needs {len(required)} colours and no "
                        "slot can be freed for it")
                slot = max(options,
                           key=lambda s: (next_use(loaded[s], position + 1), -s))
                changes.append({"layer": layer["index"], "z": layer["z"],
                                "line": layer["line"], "slot": slot,
                                "out": loaded[slot], "in": tool})
            loaded[slot] = tool

    sim_loaded = {slot: tool for tool, slot in initial.items()}
    by_layer: dict = {}
    for change in changes:
        by_layer.setdefault(change["layer"], []).append(change)
    problems: list = []
    for layer in per_layer:
        for change in by_layer.get(layer["index"], []):
            slot = next((s for s, t in sim_loaded.items() if t == change["out"]), None)
            if slot != change["slot"]:
                problems.append(f"layer {layer['index']}: reel {change['out']} is not in "
                                f"slot {change['slot']}")
                continue
            sim_loaded[slot] = change["in"]
        for tool in layer["tools"]:
            if tool not in sim_loaded.values():
                problems.append(f"layer {layer['index']} needs tool {tool}, which is "
                                "not loaded")
    if problems:
        raise GcodeError("the schedule does not satisfy the file: "
                         + "; ".join(problems[:3]))

    pauses = len(by_layer)
    return {
        "initial": {str(tool): slot for tool, slot in sorted(initial.items())},
        "schedule": changes,
        "pause_count": pauses,
        "reel_changes": len(changes),
        "heuristic": True,
        "startup": startup,
        "summary": (
            f"{len(per_layer)} layers, never more than "
            f"{max((len(l['tools']) for l in per_layer), default=0)} colours in one "
            f"layer; {len(changes)} reel change"
            f"{'' if len(changes) == 1 else 's'} at {pauses} pause"
            f"{'' if pauses == 1 else 's'}"
            + ("" if changes else " — the four loaded reels cover every layer")
            + ". The pause positions come from the slicer's own layer markers; the "
              "sequence is deterministic, not proven minimal."),
    }


def next_use(tool: int, from_layer: int, per_layer: list) -> int:
    """The index of the next layer that needs ``tool``, or past the end."""
    for index in range(from_layer, len(per_layer)):
        if tool in per_layer[index]["tools"]:
            return index
    return len(per_layer) + 1


def plan_text(evidence: dict, name: str = "model", member: str = "") -> str:
    """The human-readable plan the user downloads (never a patched G-code)."""
    lines = [f"U1 reel-change plan for {name}"]
    if member:
        lines.append(f"  (read from {member} inside that file)")
    lines += [
        "=" * 60,
        "",
        "This is a PLAN, not printable G-code.",
        "The sliced file still selects the slicer's own tools (including any virtual",
        "mixture tools). Before printing on a U1 the tool commands have to be remapped",
        "so each logical colour maps to one of the four loaded reels, and verified",
        "pauses inserted at the boundaries below. Nothing here rewrites the file, and",
        "this schedule alone does not make it four-tool compatible.",
        "",
        "Evidence (read from the sliced file, not from the mesh)",
        "-------------------------------------------------------",
        f"  flavour           : {evidence.get('flavour', 'unknown')}",
        f"  layers            : {evidence.get('layers')}"
        + (f" (the file declares {evidence['total_layers']})"
           if evidence.get("total_layers") else ""),
        f"  machining moves   : {evidence.get('moves')}",
        f"  retractions       : {evidence.get('retractions')} (ignored: no material)",
        f"  prime moves       : {evidence.get('primes')} (purge with no travel: "
        "counted as material for the reel in the head, in the layer it happens in)",
        f"  unanswered extrude: {evidence.get('anomalies')}",
        f"  layer-stat markers: {evidence.get('stats_layer_markers')} "
        "(metadata; one logical layer each)",
        f"  startup tools     : {_labels(evidence.get('startup_tools'))}",
        f"  colours deposited : {_labels(evidence.get('tools'))}",
        f"  slicer time mark  : {evidence.get('reported_time') or 'none in the file'}",
        f"  content           : {evidence.get('fingerprint', 'not recorded')}",
        "",
    ]
    legend = evidence.get("legend") or []
    if legend:
        lines += ["Palette named by the file itself", "--------------------------------"]
        lines += [f"  {entry}" for entry in legend]
        lines.append("")
    sentinels = evidence.get("sentinels") or []
    if sentinels:
        lines += ["Operator actions already in the file",
                  "-----------------------------------"]
        for item in sentinels[:10]:
            where = item.get("layer")
            lines.append(f"  {item.get('kind')}: {item.get('command')} "
                         f"(line {item.get('line')}"
                         + (f", layer {where}" if where is not None else "") + ")")
        lines.append("")

    if not evidence.get("feasible"):
        lines += ["Result: no layer-boundary plan",
                  "---------------------------------",
                  evidence.get("summary") or "", ""]
        return "\n".join(lines) + "\n"

    lines += ["Initial load", "------------"]
    for tool, slot in sorted((evidence.get("initial") or {}).items(),
                             key=lambda kv: kv[1]):
        lines.append(f"  slot {slot} -> tool {tool}")
    changes = evidence.get("schedule") or []
    lines.append("")
    if not changes:
        lines.append("No reel changes: the four loaded reels cover every layer.")
    else:
        lines.append(f"{len(changes)} reel change"
                     f"{'' if len(changes) == 1 else 's'} at "
                     f"{evidence.get('pause_count')} pause"
                     f"{'' if evidence.get('pause_count') == 1 else 's'}:")
        for change in changes:
            z = change.get("z")
            where = f"Z {z:.2f} mm" if isinstance(z, (int, float)) else "the layer"
            lines.append(f"  layer {change['layer']:>5} (line "
                         f"{change.get('line', '?')})  before {where:>12}  "
                         f"slot {change['slot']}: tool {change['out']} -> "
                         f"tool {change['in']}")
        lines.append("")
        lines.append("Pause positions come from the slicer's layer markers; the "
                     "sequence is deterministic, not proven minimal.")
    return "\n".join(lines) + "\n"


def _labels(tools) -> str:
    if not tools:
        return "none"
    return ", ".join(f"T{t}" for t in tools)


def fingerprint(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def provenance(source: str, selection: dict | None,
               mapping: dict | None) -> str:
    """A short token binding a plan to the model and review it came from."""
    payload = repr(sorted((selection or {}).items())) + repr(
        sorted((mapping or {}).items()))
    return hashlib.sha256((source + "|" + payload).encode("utf-8")).hexdigest()[:16]
