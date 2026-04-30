#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
PRODUCT_NAME="${OFFHAND_PRODUCT_NAME:-释手}"
SCHEME="${OFFHAND_MACOS_SCHEME:-OffhandReactnative-macOS}"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version || '0.0.0'")"
BUILD_DIR="$MACOS_DIR/build"
APP_PATH="$BUILD_DIR/Build/Products/Release/$PRODUCT_NAME.app"
DIST_DIR="$ROOT_DIR/dist"
ZIP_PATH="$DIST_DIR/$PRODUCT_NAME-macOS-$VERSION.zip"
LEGACY_ZIP_PATH="$DIST_DIR/OffhandReactnative-macOS-$VERSION.zip"

log_step() {
  printf '\n> %s\n' "$1"
}

ensure_codegen_compatibility() {
  local source="$ROOT_DIR/node_modules/@react-native/codegen"
  local target="$ROOT_DIR/node_modules/react-native-macos/node_modules/@react-native/codegen"

  if [[ ! -d "$source" ]]; then
    echo "Missing codegen package: $source" >&2
    exit 1
  fi

  if [[ -f "$target/package.json" ]] && cmp -s "$source/package.json" "$target/package.json"; then
    echo "React Native macOS codegen package is already aligned."
    return
  fi

  mkdir -p "$(dirname "$target")"
  rm -rf "$target"
  cp -R "$source" "$target"
  echo "Aligned React Native macOS codegen package: $target"
}

ensure_pods_installed_if_needed() {
  if [[ "${SKIP_POD_INSTALL:-0}" == "1" ]]; then
    echo "SKIP_POD_INSTALL=1; skipping pod install check."
    return
  fi

  local podfile_lock="$MACOS_DIR/Podfile.lock"
  local manifest_lock="$MACOS_DIR/Pods/Manifest.lock"

  if [[ -f "$podfile_lock" ]] && [[ -f "$manifest_lock" ]] && cmp -s "$podfile_lock" "$manifest_lock"; then
    echo "CocoaPods manifest is up to date."
    return
  fi

  log_step "pod install"
  (cd "$MACOS_DIR" && pod install)
}

patch_fmt_for_macos_sdk() {
  local fmt_base="$MACOS_DIR/Pods/fmt/include/fmt/base.h"
  local marker="consteval broken with macOS 26.x SDK"

  if [[ ! -f "$fmt_base" ]]; then
    echo "fmt base.h not found; skipping fmt SDK patch."
    return
  fi

  if grep -q "$marker" "$fmt_base"; then
    echo "fmt consteval compatibility patch is already applied."
    return
  fi

  python3 - "$fmt_base" <<'PY'
import os
import sys

path = sys.argv[1]
needle = "#elif defined(__cpp_consteval)\n#  define FMT_USE_CONSTEVAL 1"
replacement = (
    "#elif defined(__APPLE__)\n"
    "#  define FMT_USE_CONSTEVAL 0  // consteval broken with macOS 26.x SDK\n"
    + needle
)

with open(path, "r", encoding="utf-8") as f:
    text = f.read()

if needle not in text:
    raise SystemExit(f"Could not find fmt consteval block in {path}")

os.chmod(path, 0o644)
with open(path, "w", encoding="utf-8") as f:
    f.write(text.replace(needle, replacement, 1))
PY

  echo "Applied fmt consteval compatibility patch."
}

build_release_app() {
  log_step "xcodebuild Release"
  (
    cd "$MACOS_DIR"
    xcodebuild \
      -workspace OffhandReactnative.xcworkspace \
      -scheme "$SCHEME" \
      -configuration Release \
      -destination "platform=macOS" \
      -derivedDataPath build \
      build
  )

  if [[ ! -d "$APP_PATH" ]]; then
    echo "Release app was not produced at $APP_PATH" >&2
    exit 1
  fi
}

zip_release_app() {
  log_step "zip Release app"
  mkdir -p "$DIST_DIR"
  rm -f "$ZIP_PATH"
  if [[ "$LEGACY_ZIP_PATH" != "$ZIP_PATH" ]]; then
    rm -f "$LEGACY_ZIP_PATH"
  fi
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"
}

log_step "generate macOS icons"
bash "$ROOT_DIR/scripts/generate-macos-icons.sh"

log_step "align react-native-macos codegen"
ensure_codegen_compatibility

log_step "check CocoaPods"
ensure_pods_installed_if_needed

log_step "patch fmt"
patch_fmt_for_macos_sdk

build_release_app
zip_release_app

printf '\nRelease build complete.\n'
printf 'App: %s\n' "$APP_PATH"
printf 'Zip: %s\n' "$ZIP_PATH"
