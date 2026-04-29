#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ICON="$ROOT_DIR/assets/shishou-app-icon.png"
APPICONSET_DIR="$ROOT_DIR/macos/OffhandReactnative-macOS/Assets.xcassets/AppIcon.appiconset"
ICNS_OUTPUT="$ROOT_DIR/assets/shishou-app-icon.icns"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Missing source icon: $SOURCE_ICON" >&2
  exit 1
fi

mkdir -p "$APPICONSET_DIR"

resize_icon() {
  local size="$1"
  local scale="$2"
  local filename="$3"
  local pixels=$((size * scale))

  /usr/bin/sips -z "$pixels" "$pixels" "$SOURCE_ICON" --out "$APPICONSET_DIR/$filename" >/dev/null
}

resize_icon 16 1 app-icon-16.png
resize_icon 16 2 app-icon-16@2x.png
resize_icon 32 1 app-icon-32.png
resize_icon 32 2 app-icon-32@2x.png
resize_icon 128 1 app-icon-128.png
resize_icon 128 2 app-icon-128@2x.png
resize_icon 256 1 app-icon-256.png
resize_icon 256 2 app-icon-256@2x.png
resize_icon 512 1 app-icon-512.png
resize_icon 512 2 app-icon-512@2x.png

python3 - "$APPICONSET_DIR/Contents.json" <<'PY'
import json
import sys

output_path = sys.argv[1]
entries = [
    ("16x16", "1x", "app-icon-16.png"),
    ("16x16", "2x", "app-icon-16@2x.png"),
    ("32x32", "1x", "app-icon-32.png"),
    ("32x32", "2x", "app-icon-32@2x.png"),
    ("128x128", "1x", "app-icon-128.png"),
    ("128x128", "2x", "app-icon-128@2x.png"),
    ("256x256", "1x", "app-icon-256.png"),
    ("256x256", "2x", "app-icon-256@2x.png"),
    ("512x512", "1x", "app-icon-512.png"),
    ("512x512", "2x", "app-icon-512@2x.png"),
]
contents = {
    "images": [
        {"size": size, "idiom": "mac", "filename": filename, "scale": scale}
        for size, scale, filename in entries
    ],
    "info": {"version": 1, "author": "xcode"},
}

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(contents, f, indent=2)
    f.write("\n")
PY

python3 - "$SOURCE_ICON" "$ICNS_OUTPUT" <<'PY'
import sys

try:
    from PIL import Image
except ImportError:
    print("Pillow is not available; skipped standalone .icns generation.")
    raise SystemExit(0)

source_icon, icns_output = sys.argv[1:]
image = Image.open(source_icon).convert("RGBA")
image.save(
    icns_output,
    format="ICNS",
    sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)],
)
PY

echo "Generated macOS app icons from $SOURCE_ICON"
