// A standard-library-only local helper, included in comparison ZIPs. It never
// connects to a printer. Zero exit status without sliced output is a failure.
export const RUNNER_SOURCE = String.raw`#!/usr/bin/env python3
"""Run: python slice-comparison.py comparison.zip --bambu "path/to/bambu-studio.exe"
Optional: --snapmaker "path/to/snapmaker-orca.exe". Never sends a print.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

MAX_FILE = 256 * 1024 * 1024

def seconds(value):
    value = value.strip()
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return float(value)
    matches = re.findall(r"(\d+(?:\.\d+)?)\s*([dhms])", value, re.I)
    return sum(float(n) * {"d":86400,"h":3600,"m":60,"s":1}[u.lower()] for n,u in matches) if matches else None

def timing(text):
    values = re.findall(r"(?:^\s*;\s*|;\s*)(?:total estimated time|estimated printing time(?:\s*\(normal mode\))?)\s*[:=]\s*([^;\r\n]+)", text, re.I | re.M)
    total = seconds(values[-1]) if values else None
    if not total or total <= 0:
        raise ValueError("No recognised total printing time. Open the project in the slicer and enter its total time in the comparison panel.")
    change = re.search(r"^\s*;\s*(?:total filament change|filament change times|total toolchanges)\s*[:=]\s*(\d+)", text, re.I | re.M)
    sequence = re.search(r"^\s*;\s*print_sequence\s*=\s*by object\s*$", text, re.I | re.M)
    return {"seconds":total,"toolChanges":int(change[1]) if change else None,"clearanceChecked":bool(sequence)}

def output_timing(folder):
    files = list(folder.glob("*.gcode"))
    if len(files) == 1 and files[0].stat().st_size <= MAX_FILE:
        return timing(files[0].read_text(encoding="utf-8", errors="replace"))
    sliced = folder / "sliced.3mf"
    if sliced.is_file():
        with zipfile.ZipFile(sliced) as archive:
            members = [i for i in archive.infolist() if i.filename.lower().endswith(".gcode")]
            if len(members) == 1 and members[0].file_size <= MAX_FILE:
                return timing(archive.read(members[0]).decode("utf-8", errors="replace"))
    raise ValueError("The slicer produced no single-plate G-code result. CLI slicing may be unsupported by this build; use the app's manual timing inputs.")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", type=Path)
    parser.add_argument("--bambu", default="C:/Program Files/Bambu Studio/bambu-studio.exe")
    parser.add_argument("--snapmaker", default="C:/Program Files/Snapmaker_Orca/snapmaker-orca.exe")
    parser.add_argument("--timeout", type=int, default=1200)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 7200:
        parser.error("timeout must be 1–7200 seconds")
    root = Path(tempfile.mkdtemp(prefix="yab3d-comparison-", dir=Path.cwd()))
    with zipfile.ZipFile(args.pack) as archive:
        info = archive.getinfo("comparison.json")
        if info.file_size > 2 * 1024 * 1024:
            raise ValueError("Manifest is too large")
        manifest = json.loads(archive.read(info))
        if manifest.get("schema") != "yab3d-comparison-v1" or not 1 <= len(manifest.get("jobs", [])) <= 64:
            raise ValueError("Invalid comparison manifest")
        report = {"schema":"yab3d-timings-v1","packId":manifest["packId"],"jobs":[]}
        for index, job in enumerate(manifest["jobs"]):
            result = {"id":job["id"],"sha256":job["sha256"]}
            report["jobs"].append(result)
            print(str(index+1)+"/"+str(len(manifest["jobs"]))+": "+str(job["id"]), flush=True)
            try:
                name = job["file"]
                if not re.fullmatch(r"job-\d+\.3mf", name) or job["target"] not in ("bambu","snapmaker"):
                    raise ValueError("Invalid job name or printer")
                member = archive.getinfo(name)
                if member.file_size > MAX_FILE:
                    raise ValueError("Model is too large")
                data = archive.read(member)
                if hashlib.sha256(data).hexdigest() != job["sha256"]:
                    raise ValueError("Model checksum mismatch")
                folder = root / ("job-"+str(index+1))
                folder.mkdir()
                model = folder / "input.3mf"
                model.write_bytes(data)
                executable = Path(args.bambu if job["target"] == "bambu" else args.snapmaker).resolve()
                if not executable.is_file():
                    raise ValueError("Slicer executable not found: "+str(executable))
                command = [str(executable),"--slice","0","--outputdir",str(folder),"--export-3mf","sliced.3mf"]
                if job["sequence"] == "by object":
                    command += ["--arrange","1"]
                elif job["sequence"] != "by layer":
                    raise ValueError("Unknown print sequence")
                command.append(str(model))
                with (folder/"slicer.log").open("wb") as log:
                    run = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=args.timeout,
                        creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
                if run.returncode:
                    raise ValueError("Slicer rejected the job (exit "+str(run.returncode)+"). See "+str(folder/"slicer.log"))
                result.update(output_timing(folder))
                # Only accept automatic sequential evidence when the sliced
                # output also confirms that by-object mode was retained.
                if job["sequence"] == "by layer":
                    result["clearanceChecked"] = False
                result["slicer"] = str(executable)
            except Exception as error:
                result["error"] = str(error)
                print("  "+str(error), flush=True)
            (root/"timings.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print("Import into YAB3D: "+str(root/"timings.json"), flush=True)

if __name__ == "__main__":
    main()
`;
