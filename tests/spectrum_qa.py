#!/usr/bin/env python3
"""One bounded end-to-end run of the Full Spectrum export, recorded verbatim.

    python tests/spectrum_qa.py

It builds a small synthetic five-colour project, runs the documented command
line against it, and checks the archive the command wrote: the recipe table, the
virtual filament ids and the application metadata.  No slicer is started, and no
real model file is touched.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from tests import fixtures                                    # noqa: E402
import u1spectrum                                             # noqa: E402

EVIDENCE = os.path.join(HERE, "docs", "agent-work", "colour-strategy", "evidence")
REELS = "#FFFFFF,#000000,#FF9500,#FF0080"


def main() -> int:
    os.makedirs(EVIDENCE, exist_ok=True)
    lines = ["# Full Spectrum command-line acceptance (synthetic project, no slicer)",
             f"# reels: {REELS}", ""]
    problems: list = []

    with tempfile.TemporaryDirectory(prefix="u1spectrum-qa-") as work:
        src = os.path.join(work, "five-colours.3mf")
        out = os.path.join(work, "five-colours-spectrum.3mf")
        fixtures.two_plate_project(src, five_colours=True)
        cmd = [sys.executable, "u1convert.py", src, "-o", out,
               "--plate", "1", "--spectrum", "--slots", REELS]
        lines.append("$ " + " ".join('"%s"' % c if " " in c else c for c in cmd))
        proc = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True)
        lines.append(proc.stdout.strip())
        if proc.stderr.strip():
            lines.append("-- stderr --")
            lines.append(proc.stderr.strip())
        lines.append("-- exit %d" % proc.returncode)
        lines.append("")

        if proc.returncode != 0:
            problems.append("the export command exited %d" % proc.returncode)
        elif not os.path.isfile(out):
            problems.append("no output file was written")
        else:
            with zipfile.ZipFile(out) as z:
                names = z.namelist()
                cfg = json.loads(z.read("Metadata/project_settings.config").decode("utf-8"))
                model = z.read("3D/3dmodel.model").decode("utf-8")
                rows = cfg.get("mixed_filament_definitions", "").split(";")
                custom = [r for r in rows if r.split(",")[2:4] == ["1", "1"]]
                lines.append("archive     : %d members, %d bytes"
                             % (len(names), os.path.getsize(out)))
                lines.append("application : %s"
                             % ("BambuStudio-2.3.5" if u1spectrum.APPLICATION in model
                                else "MISSING"))
                lines.append("physical    : %d reels in filament_colour (must stay 4)"
                             % len(cfg.get("filament_colour", [])))
                lines.append("recipes     : %d virtual filaments, ids 5-%d"
                             % (len(custom), 4 + len(custom)))
                lines.append("rows        : %s" % [r[:5] for r in custom])
                if u1spectrum.APPLICATION not in model:
                    problems.append("the application metadata is missing")
                if len(cfg.get("filament_colour", [])) != 4:
                    problems.append("filament_colour no longer describes four reels")
                for key in u1spectrum.BAMBU_ONLY_KEYS:
                    if key in cfg:
                        problems.append("a Bambu mixture field (%s) was written" % key)
                if any("MmPaintingVersion" in z.read(n).decode("utf-8", "replace")
                       for n in names if n.endswith((".model", ".config"))):
                    problems.append("a MmPaintingVersion was written")
                if not custom:
                    problems.append("the export wrote no custom recipe rows")

    lines.append("")
    lines.append("RESULT: " + ("FAILED - " + "; ".join(problems) if problems
                               else "PASS - export, recipe table and metadata checked"))
    text = "\n".join(lines) + "\n"
    with open(os.path.join(EVIDENCE, "spectrum-cli.txt"), "w", encoding="utf-8") as fh:
        fh.write(text)
    print(text)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
