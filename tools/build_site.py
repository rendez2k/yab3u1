#!/usr/bin/env python3
"""Build the static site that gets published, from `web/` into `dist/`.

    python tools/build_site.py
    python tools/build_site.py --out dist
    python tools/build_site.py --out scratch --no-clean

Only the browser application is a site: the two pages, the modules and worker
they load beside them, the icon, and the two licence files.  Everything else in
the repository stays out of the output -- the Python applications under the
root, `tests/`, `web/tests/` and its fixtures, `web/selftest.html` and the
self-test fixtures, `make_fixtures.mjs`, the private models and the planning
notes.

That selection is the one the live release was published with; the reference is
browser-performance/stage_site.py in the private agent-work notes.  Files are
copied byte for byte, so rebuilding unchanged sources reproduces the previous
`dist/` exactly.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
DEFAULT_OUT = ROOT / "dist"

# A file under `web/` is a site asset when it has one of these suffixes, or when
# it is one of the two pages.  Nothing else in `web/` is published.
ASSET_SUFFIXES = frozenset({".js", ".css", ".wasm", ".svg", ".ico", ".woff", ".woff2"})
PAGES = frozenset({"index.html", "recolour.html"})
# Directories under `web/` that are development scaffolding, and file name
# prefixes that belong only to the browser self-test.
SKIP_PARTS = frozenset({"tests", "node_modules", ".netlify"})
SKIP_PREFIXES = ("selftest", "make_fixtures")
# Kept next to the site because the GPL text and the notices travel with it.
COPY_WITH_SITE = ("LICENSE", "THIRD_PARTY_NOTICES.txt")
# A cleanup may never reach any of these (or the repository root).
SOURCE_DIRS = (".git", ".netlify", "web", "tests", "tools", "docs", "analysis-previews")


class BuildError(Exception):
    """The build cannot be trusted to produce the published site."""


def asset_paths(web: Path = WEB) -> list[Path]:
    """Every file under `web` that belongs on the published site, sorted."""
    if not (web / "index.html").is_file():
        raise BuildError(f"{web / 'index.html'} is missing - is this a full checkout?")
    chosen: list[Path] = []
    for source in sorted(web.rglob("*")):
        if not source.is_file() or source.is_symlink():
            continue
        rel = source.relative_to(web)
        if any(part in SKIP_PARTS for part in rel.parts):
            continue
        if source.name.startswith(SKIP_PREFIXES):
            continue
        if source.suffix not in ASSET_SUFFIXES and rel.as_posix() not in PAGES:
            continue
        chosen.append(rel)
    if not chosen:
        raise BuildError(f"no site assets found under {web}")
    return chosen


def check_clean_target(target: Path) -> Path:
    """Only the repository's fixed generated dist directory may be deleted."""
    root = ROOT.resolve()
    resolved = target.resolve()
    expected = root / "dist"
    if root not in resolved.parents:
        raise BuildError(f"refusing to clean {resolved}: it is outside {root}")
    if target.is_symlink() or target.absolute() != expected or resolved != expected:
        raise BuildError("refusing to clean anything except this checkout's dist directory")
    return resolved


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(out: Path, clean: bool = True) -> dict:
    """Copy the published files into `out` and describe what was written."""
    rels = asset_paths()
    licences = [Path(name) for name in COPY_WITH_SITE]
    for name in licences:
        if not (ROOT / name).is_file():
            raise BuildError(f"{ROOT / name} is missing - it is published with the site")

    resolved = out.resolve()
    root = ROOT.resolve()
    if resolved == root or out.is_symlink():
        raise BuildError(f"refusing to build into the repository root or a link ({out})")
    for name in SOURCE_DIRS:
        protected = root / name
        if resolved == protected or protected in resolved.parents:
            raise BuildError(f"refusing to write into source or repository state ({out})")
    if not clean and out.exists() and any(out.iterdir()):
        raise BuildError("--no-clean requires an empty output directory")
    if clean and out.exists():
        target = check_clean_target(out)
        shutil.rmtree(target)
    out.mkdir(parents=True, exist_ok=True)

    plan = [(WEB / rel, rel) for rel in rels] + [(ROOT / name, name) for name in licences]
    files = []
    for source, rel in plan:
        target = out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        files.append({"path": rel.as_posix(),
                      "bytes": source.stat().st_size,
                      "sha256": sha256(source)})
    files.sort(key=lambda item: item["path"])
    return {
        "out": str(out.resolve()),
        "assets": len(rels),
        "files": files,
        "bytes": sum(item["bytes"] for item in files),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(DEFAULT_OUT),
                        help="output directory (default: dist/ beside the repository root)")
    parser.add_argument("--no-clean", action="store_true",
                        help="build into a new or empty directory without deleting anything")
    parser.add_argument("--manifest",
                        help="also write the file inventory to this JSON file")
    args = parser.parse_args(argv)

    try:
        report = build(Path(args.out), clean=not args.no_clean)
    except BuildError as exc:
        print(f"build_site: {exc}", file=sys.stderr)
        return 1

    if args.manifest:
        Path(args.manifest).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
