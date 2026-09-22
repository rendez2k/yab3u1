import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(ROOT, "u1_base_project_settings.json")
dst = os.path.join(ROOT, "web", "base_settings.js")

with open(src, "r", encoding="utf-8-sig") as fh:
    data = json.load(fh)

body = json.dumps(data, indent=2, ensure_ascii=False)
# JSON is valid JS object-literal syntax once these are escaped
body = body.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

header = (
    "// base_settings.js -- the U1 project settings the web converter starts from.\n"
    "//\n"
    "// Generated from ../u1_base_project_settings.json (which came from the\n"
    "// u1_template.3mf shipped by github.com/josuanbn/bl2u1, GPL-3.0). A web page\n"
    "// cannot read the profiles installed on your machine, so the desktop tool's\n"
    "// resolved-profile overlay is replaced by this fixed baseline. Regenerate with:\n"
    "//   python make_base_settings.py\n"
    "\n"
    "export const BASE_SETTINGS = "
)

with open(dst, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(header + body + ";\n")

print(f"wrote {dst} ({os.path.getsize(dst):,} bytes, {len(data)} keys)")
for key in ("layer_height", "enable_support", "support_type", "printer_model",
            "print_settings_id", "filament_colour", "printable_area",
            "enable_prime_tower", "wipe_tower_x", "wipe_tower_y",
            "prime_tower_width", "brim_type", "brim_width"):
    print(f"   {key:20} = {data.get(key)}")
