#!/usr/bin/env python3
"""Run the documented command lines against the real examples and record what
they print, so the report can point at a transcript instead of a summary.

    python tests/cli_qa.py

Slicer checks are **off** unless ``--slicer`` is passed: Snapmaker Orca's command
line crashed on one of the earlier exports, so nothing here launches it by
default.  Outputs go to ``analysis-previews/colour-assessment/`` (scratch,
untracked); the transcript goes to the evidence folder next to the browser
screenshots.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = os.path.join(HERE, "docs", "agent-work", "colour-assessment", "evidence")
OUT = os.path.join(HERE, "analysis-previews", "colour-assessment")
PY = sys.executable

DESKTOP = r"C:\Users\rende\Desktop"
D_DRIVE = r"D:\3D"
BLOB = os.path.join(DESKTOP, "5 colour test-Blob Lab_Monsters V1.3mf")
FULL_BLOB = os.path.join(D_DRIVE, "Blob Lab_Monsters V1.3mf")
WOOKIE = os.path.join(D_DRIVE, "Hex3D_WookieMonster_Color",
                      "Hex3D_WookieMonster_Full_Bambu_5Color.3mf")
WOOKIE_GENERIC = os.path.join(D_DRIVE, "Hex3D_WookieMonster_Color",
                              "Hex3D_WookieMonster_Full_Generic_5Color.3mf")
ALIEN = os.path.join(DESKTOP, "They live alien_5 colors.3mf")
REELS = "#FFFFFF,#000000,#3D9140,#FF9500"


def _parse_flags():
    import argparse
    ap = argparse.ArgumentParser(description="CLI transcript for the real examples.")
    ap.add_argument("--slicer", action="store_true",
                    help="also ask Snapmaker Orca to slice (off by default)")
    return ap.parse_args()


def main() -> int:
    args = _parse_flags()
    os.makedirs(EVIDENCE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    lines: list[str] = []
    slicer = ["--verify"] if args.slicer else []
    slicer_note = (" (with a slicer check)" if args.slicer
                   else " (no slicer check: it is opt-in)")
    lines.append("# Slice checks start Snapmaker Orca.  Its command line crashed on an "
                 "earlier export, so nothing here launches it unless --slicer is passed.")
    lines.append("")

    def run(*args, note=""):
        cmd = [PY, os.path.join(HERE, "u1convert.py"), *args]
        shown = "python u1convert.py " + " ".join(
            f'"{a}"' if " " in a else a for a in args)
        lines.append(f"$ {shown}" + (f"   # {note}" if note else ""))
        started = time.time()
        proc = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True,
                              timeout=1800)
        output = (proc.stdout or "") + (proc.stderr or "")
        lines.append(output.rstrip())
        lines.append(f"-- exit {proc.returncode} in {time.time() - started:.1f}s")
        lines.append("")
        return proc.returncode, output

    def digest(path):
        if not os.path.isfile(path):
            return "missing"
        with open(path, "rb") as fh:
            data = fh.read()
        return f"{len(data):,} bytes  sha256={hashlib.sha256(data).hexdigest()[:16]}"

    if os.path.isfile(BLOB):
        run("--list-plates", BLOB, note="two objects, five colours, one plate")
        run("--list-plates", BLOB, "--objects", "11", note="one object only")
        run(BLOB, "-o", os.path.join(OUT, "blob-iggy-direct.3mf"),
            "--plate", "1", "--objects", "11", *slicer,
            note="direct four-colour export" + slicer_note)
        run(BLOB, "-o", os.path.join(OUT, "blob-sitting-direct.3mf"),
            "--plate", "1", "--objects", "24",
            note="direct three-colour export (Sitting Body)")
        for name in ("blob-iggy-direct.3mf", "blob-sitting-direct.3mf"):
            lines.append(f"   {name}: {digest(os.path.join(OUT, name))}")
        lines.append("")

    if os.path.isfile(FULL_BLOB):
        run("--list-plates", FULL_BLOB, note="four plates; plate 1 needs nine colours")

    if os.path.isfile(WOOKIE):
        run("--list-plates", WOOKIE, note="five colours in one painted mesh")
        run(WOOKIE, "-o", os.path.join(OUT, "wookie-refused.3mf"),
            note="no reels named: the tool should refuse rather than substitute")
        run(WOOKIE, "-o", os.path.join(OUT, "wookie-approximation.3mf"),
            "--slots", REELS, "--approximate", *slicer,
            note="explicit approximation onto the loaded reels" + slicer_note)
        lines.append(f"   wookie-approximation.3mf: "
                     f"{digest(os.path.join(OUT, 'wookie-approximation.3mf'))}")
        lines.append("")

    if os.path.isfile(WOOKIE_GENERIC):
        run(WOOKIE_GENERIC, "-o", os.path.join(OUT, "wookie-generic.3mf"),
            "--slots", REELS, "--approximate",
            note="the same model with its mesh inline in the main file")

    if os.path.isfile(ALIEN):
        run("--list-plates", ALIEN, note="PrusaSlicer, eight slots, five used")
        code, output = run(ALIEN, "-o", os.path.join(OUT, "alien-approximation.3mf"),
                           "--slots", REELS, "--approximate", *slicer,
                           note="sub-divided paint is remapped, not skipped" + slicer_note)
        if "UNVERIFIED" in output or code not in (0,):
            lines.append("   the slicer check did not pass, so this export stays marked "
                         "UNVERIFIED and slicer validation remains unavailable")
        lines.append(f"   alien-approximation.3mf: "
                     f"{digest(os.path.join(OUT, 'alien-approximation.3mf'))}")
        lines.append("")

    transcript = os.path.join(EVIDENCE, "cli-session.txt")
    with open(transcript, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines).rstrip() + "\n")
    print("\n".join(lines[-40:]))
    print(f"\ntranscript: {transcript}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
