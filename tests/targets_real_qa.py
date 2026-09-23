#!/usr/bin/env python3
"""One bounded real-model check: the three targets from the same source file.

    python tests/targets_real_qa.py

It uses whichever real example is on this machine (the PrusaSlicer alien file
first, then the Blob/Wookie examples) and stops after one export per target.  No
slicer is started and the examples are never modified.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

import u1targets                                              # noqa: E402
import u1convert as u1                                        # noqa: E402
import u1project as u1p                                       # noqa: E402
from tests.browser_qa import Recorder                         # noqa: E402

EVIDENCE = os.path.join(HERE, "docs", "agent-work", "preview-targets-swaps", "evidence")
OUT = os.path.join(HERE, "analysis-previews", "preview-targets-swaps")

DESKTOP = r"C:\Users\rende\Desktop"
D_DRIVE = r"D:\3D"
CANDIDATES = [
    (os.path.join(DESKTOP, "They live alien_5 colors.3mf"), "alien (PrusaSlicer)"),
    (os.path.join(D_DRIVE, "Blob Lab_Monsters.3mf"), "blob (Bambu Studio)"),
    (os.path.join(DESKTOP, "5 colour test-Blob Lab_Monsters V1.3mf"), "blob (desktop)"),
]
REELS = "#FFFFFF,#000000,#FF9500,#FF0080"


def main() -> int:
    os.makedirs(EVIDENCE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    record = Recorder(os.path.join(EVIDENCE, "targets-real.txt"))
    failures: list = []

    source, label = next(((path, label) for path, label in CANDIDATES
                          if os.path.isfile(path)), (None, None))
    if source is None:
        record("no real example is on this machine; skipping")
        record.save()
        return 0
    record(f"source: {source} ({label}) {os.path.getsize(source):,} bytes")

    for target in u1targets.TARGETS:
        out = os.path.join(OUT, f"{target}-real.3mf")
        command = [sys.executable, "u1convert.py", source, "-o", out,
                   "--plate", "1", "--target", target, "--spectrum",
                   "--slots", REELS]
        result = subprocess.run(command, cwd=HERE, capture_output=True, text=True)
        record(f"$ {' '.join(command[1:])}")
        for line in (result.stdout or "").strip().splitlines()[-6:]:
            record("  " + line)
        if result.returncode != 0:
            failures.append(f"{target} exited {result.returncode}: "
                            + (result.stderr or "").strip().splitlines()[-1:][0]
                            if result.stderr else f"{target} exited {result.returncode}")
            continue
        # Each target keeps its palette somewhere different.  Reading only the
        # Bambu config is how this check broke: a Prusa portable project has no
        # Metadata/project_settings.config at all, on purpose.
        with zipfile.ZipFile(out) as zf:
            names = zf.namelist()
            cfg = None
            palette = None
            if u1targets.PRUSA_SPECTRUM_JSON in names:
                spectrum = json.loads(zf.read(u1targets.PRUSA_SPECTRUM_JSON)
                                      .decode("utf-8"))
                palette = len(spectrum.get("physical_extruders") or []) + \
                    len(spectrum.get("virtual_extruders") or [])
                recipes = len(spectrum.get("virtual_extruders") or [])
            else:
                cfg = json.loads(zf.read("Metadata/project_settings.config")
                                 .decode("utf-8"))
                palette = len(cfg.get("filament_colour") or [])
                if target == "snapmaker":
                    rows = (cfg.get("mixed_filament_definitions") or "").split(";")
                    recipes = len([row for row in rows
                                   if row.split(",")[2:4] == ["1", "1"]])
                else:
                    recipes = sum(1 for value in (cfg.get("filament_is_mixed") or [])
                                  if value == "1")
            leaked = [key for key in u1targets.MACHINE_KEYS if cfg and key in cfg]
            reread = u1p.read_project(zf)
        record(f"  {target}: {len(names)} members, {os.path.getsize(out):,} bytes, "
               f"recipes={recipes}, palette={palette}, "
               f"machine keys={'yes (U1 project)' if leaked else 'none'}, "
               f"reopened with {len(reread.colors)} colours from "
               f"{reread.palette_source or 'defaults'}")
        if target == "snapmaker" and not cfg.get("printer_settings_id"):
            failures.append("the Snapmaker export lost its U1 profile")
        if target != "snapmaker" and leaked:
            failures.append(f"the {target} export leaked U1 machine settings")
        if not reread.colors:
            failures.append(f"the {target} export reopened with no palette")

    record("RESULT: " + ("FAILED - " + "; ".join(failures) if failures
                         else "PASS - one real export per target"))
    record.save()
    print("RESULT: " + ("FAILED - " + "; ".join(failures) if failures else "PASS"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
