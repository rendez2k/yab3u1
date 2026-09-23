#!/usr/bin/env python3
"""Predicted shades for mixtures of the loaded reels, and the recipes behind them.

The model is the MIT FilamentMixer polynomial (see :mod:`u1mix_model`), the same
one Strata and OrcaSlicer-FullSpectrum use.  It predicts what two filaments look
like when they are blended in a layer, so this module can say *how close* a
mixture would come to a source colour -- and, just as importantly, when mixing is
the wrong answer.

Everything here is a prediction from swatch values, not a calibration: an
uncalibrated estimate must never be confused with an exact colour.  Physical
reels keep their own ids (1..4); each recipe that is worth offering gets a stable
virtual id after them, and the same ids are used for what the page shows and for
what an export writes.
"""

from __future__ import annotations

import u1colour
import u1mix_model as _model

# Ratios worth offering: the share of the *second* filament in the mix.
RATIOS = (25, 50, 75)

# A mixture has to beat the nearest single reel by this much (CIE94) before it is
# worth the operator's effort and the extra uncertainty.
MIN_IMPROVEMENT = 2.0

# Above this, even the best mixture is a poor match: the honest answer is to load
# different filament rather than to mix.
POOR_COVERAGE = 12.0


def _clamp(value: float) -> int:
    return max(0, min(255, int(value)))


def mix_rgb(first: str, second: str, ratio: float):
    """Predicted RGB of ``first`` blended with ``ratio`` of ``second`` (0..1)."""
    a = u1colour.rgb(first)
    b = u1colour.rgb(second)
    if a is None or b is None:
        return None
    x = (a[0], a[1], a[2], b[0], b[1], b[2], float(ratio))
    out = list(_model.INTERCEPT)
    for powers, coeffs in zip(_model.POWERS, _model.COEFFICIENTS):
        feature = 1.0
        for value, power in zip(x, powers):
            if power:
                feature *= value ** power
        out[0] += feature * coeffs[0]
        out[1] += feature * coeffs[1]
        out[2] += feature * coeffs[2]
    return tuple(_clamp(v) for v in out)


def mix_hex(first: str, second: str, percent: int) -> str:
    """Predicted colour of a ``percent`` share of ``second`` in ``first``."""
    rgb = mix_rgb(first, second, percent / 100.0)
    if rgb is None:
        return ""
    return "#%02X%02X%02X" % rgb


def _material(reel) -> str:
    return str((reel or {}).get("type") or "PLA").strip().upper()


def candidate_recipes(reels: list, ratios=RATIOS) -> list:
    """Every pair worth predicting, in a stable order.

    Two reels only mix if they are the same material: the prediction says nothing
    about combining, say, PLA with PETG, so those pairs are not offered at all.
    """
    out: list = []
    colors = [u1colour.norm((r or {}).get("color")) for r in reels]
    for a in range(len(colors)):
        for b in range(a + 1, len(colors)):
            if not colors[a] or not colors[b]:
                continue
            if _material(reels[a]) != _material(reels[b]):
                continue
            for percent in ratios:
                out.append({
                    "a": a + 1,
                    "b": b + 1,
                    "percent": percent,
                    "color": mix_hex(colors[a], colors[b], percent),
                    "materials": _material(reels[a]),
                })
    return out


def plan_mixtures(source_colors: dict, reels: list, ratios=RATIOS,
                  max_recipes: int = 6) -> dict:
    """Compare every source colour with a single reel and with the best mixture.

    ``source_colors`` is {source extruder: hex}.  The answer for each colour says
    which is closer, how much better the mixture is, and whether the palette is
    simply too far away for mixing to be the right advice.
    """
    slot_colors = [u1colour.norm((r or {}).get("color")) for r in reels]
    candidates = candidate_recipes(reels, ratios)
    rows: list = []
    used: dict = {}
    for source in sorted(source_colors):
        original = u1colour.norm(source_colors[source])
        solid_slot, solid_error = u1colour.nearest(original, slot_colors)
        best = None
        for recipe in candidates:
            error = u1colour.distance(original, recipe["color"])
            if best is None or error < best[1]:
                best = (recipe, error)
        solid = {
            "slot": (solid_slot + 1) if solid_slot is not None else None,
            "color": slot_colors[solid_slot] if solid_slot is not None else "",
            "error": None if solid_error == float("inf") else round(solid_error, 1),
        }
        mixture = None
        if best is not None:
            recipe, error = best
            mixture = {
                "a": recipe["a"], "b": recipe["b"], "percent": recipe["percent"],
                "color": recipe["color"], "error": round(error, 1),
            }

        improvement = None
        if mixture and solid["error"] is not None:
            improvement = round(solid["error"] - mixture["error"], 1)
        # A blend can be closer without being close enough to be worth offering;
        # the difference matters when the advice is worded.
        closer = bool(mixture and improvement is not None and improvement > 0)
        exact = bool(solid["color"]) and u1colour.distance(original, solid["color"]) <= 0.5
        if exact:
            choice, reason = "solid", "this colour is already one of the loaded reels"
        elif mixture and improvement is not None and improvement >= MIN_IMPROVEMENT \
                and mixture["error"] <= POOR_COVERAGE:
            choice, reason = "mixture", (
                f"a {'/'.join(str(x) for x in (mixture['a'], mixture['b']))} mix at "
                f"{mixture['percent']}% is {improvement} closer than the nearest reel")
        elif mixture and improvement is not None and improvement >= MIN_IMPROVEMENT:
            choice, reason = "solid", (
                "the best mixture is still a poor match; load a closer filament rather "
                "than mix")
        else:
            choice, reason = "solid", "no mixture is meaningfully closer than one reel"
        # Only a mixture the comparison actually chose earns a virtual filament id.
        # Predicting every pair is not the same as offering it.
        if choice == "mixture":
            used[(mixture["a"], mixture["b"], mixture["percent"])] = recipe
        rows.append({
            "source": source,
            "original": original,
            "solid": solid,
            "mixture": mixture,
            "improvement": improvement,
            "closer": closer,
            "exact": exact,
            "choice": choice,
            "reason": reason,
            "predicted": choice == "mixture",
        })

    ranked = sorted(
        ({"a": r["a"], "b": r["b"], "percent": r["percent"], "color": r["color"],
          "materials": r["materials"], "score": 0.0} for r in used.values()),
        key=lambda r: (-sum(1 for row in rows if row["mixture"] and
                            (row["mixture"]["a"], row["mixture"]["b"],
                             row["mixture"]["percent"]) ==
                            (r["a"], r["b"], r["percent"])),
                       r["a"], r["b"], r["percent"]))
    recipes = []
    for index, recipe in enumerate(ranked[:max_recipes]):
        recipe = dict(recipe)
        recipe["id"] = len(slot_colors) + index + 1      # virtual ids follow the reels
        recipes.append(recipe)

    by_key = {(r["a"], r["b"], r["percent"]): r for r in recipes}
    for row in rows:
        if row["choice"] != "mixture":
            continue
        key = (row["mixture"]["a"], row["mixture"]["b"], row["mixture"]["percent"])
        recipe = by_key.get(key)
        if recipe is None:                       # more recipes wanted than offered
            row["choice"] = "solid"
            row["reason"] = ("too many mixtures would be needed; load a closer filament "
                             "instead of mixing")
            row["predicted"] = False
        else:
            row["recipe_id"] = recipe["id"]

    errors = [row["solid"]["error"] for row in rows if row["solid"]["error"] is not None]
    worst = max(errors) if errors else 0
    changes = sum(1 for row in rows if row["choice"] == "mixture")
    closer_only = [row for row in rows if row["closer"] and row["choice"] != "mixture"]
    if not rows:
        advice = "no source colours to compare"
    elif changes:
        advice = (f"{changes} of {len(rows)} colours would be closer as a predicted "
                  "mixture; the rest stay on the reel they already match")
        if worst > POOR_COVERAGE:
            advice += (f". The palette itself is a long way from these reels (worst "
                       f"match {round(worst, 1)}), so loading closer filament is worth "
                       "doing where you can")
    elif closer_only:
        advice = (f"a blend would come closer for {len(closer_only)} of {len(rows)} "
                  "colours, but not by enough to be worth the extra uncertainty; the "
                  "nearest reels are the better answer")
        if worst > POOR_COVERAGE:
            advice += (f". The palette is a long way from these reels (worst match "
                       f"{round(worst, 1)}), so load closer filament")
    elif worst > POOR_COVERAGE:
        advice = ("no blend comes closer than the nearest reel, and the reels do not "
                  "cover these colours; load closer filament rather than mixing")
    else:
        advice = "the loaded reels already cover these colours as well as mixing would"
    return {
        "reels": [{"slot": i + 1, "color": c, "type": _material(r)}
                  for i, (c, r) in enumerate(zip(slot_colors, reels))],
        "rows": rows,
        "recipes": recipes,
        "advice": advice,
        "coverage": "poor" if worst > POOR_COVERAGE else "good",
        "worst_solid_error": None if not errors else round(worst, 1),
        "uncalibrated": True,
    }


def mapping_from_plan(plan: dict, use_mixtures: bool = True) -> dict:
    """{source extruder: filament id} for an export, using the plan's own ids."""
    mapping = {}
    for row in plan.get("rows", []):
        if use_mixtures and row.get("choice") == "mixture" and row.get("recipe_id"):
            mapping[int(row["source"])] = int(row["recipe_id"])
        elif row.get("solid", {}).get("slot"):
            mapping[int(row["source"])] = int(row["solid"]["slot"])
    return mapping
