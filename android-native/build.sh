#!/usr/bin/env bash
# Builds the Bloomora Android app (APK) without Gradle or the full Android SDK.
#
#   ./android-native/build.sh            # build the web app, then the APK
#   ./android-native/build.sh --skip-web # reuse the existing dist/ folder
#
# Needs: bash, curl, unzip, zip, Node/npm and a JDK (17+).
# Output: android-native/build/Bloomora-<version>.apk
#
# The web build reads .env as usual, so put VITE_SUPABASE_URL,
# VITE_SUPABASE_ANON_KEY and VITE_API_AUTH_TOKEN there (or in the environment)
# to enable sync and the AI tutor inside the app.
#
# Signing: by default the committed development keystore is used so every build
# can update the previous one. For a Play Store release set BLOOMORA_KEYSTORE,
# BLOOMORA_KEYSTORE_PASSWORD, BLOOMORA_KEY_ALIAS and BLOOMORA_KEY_PASSWORD.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$HERE/.tools"
OUT="$HERE/build"
MIN_SDK=24
TARGET_SDK=36

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# Toolchain. Google's SDK download host is not always reachable, so every
# piece comes from a public mirror and is pinned by checksum.
# ---------------------------------------------------------------------------
fetch() {
  local url="$1" dest="$2" sha="$3"
  if [[ -f "$dest" ]] && echo "$sha  $dest" | sha256sum -c --status; then return; fi
  log "Downloading $(basename "$dest")"
  curl -fsSL --retry 3 -o "$dest.part" "$url"
  echo "$sha  $dest.part" | sha256sum -c --status || { echo "Checksum mismatch for $url" >&2; exit 1; }
  mv "$dest.part" "$dest"
}

mkdir -p "$TOOLS"
# aapt2 2.19 (Android build-tools 31), packaged on PyPI.
fetch https://files.pythonhosted.org/packages/py3/a/aapt2/aapt2-0.2.1-py3-none-any.whl "$TOOLS/aapt2.whl" \
  a49805fdf6b92ce3fbf237b5f3fb988b2d6eb43131cd2cdd5e3cfe55d6b93ab8
if [[ ! -x "$TOOLS/aapt2" ]]; then
  unzip -o -q -j "$TOOLS/aapt2.whl" 'aapt2/bin/Linux/aapt2' -d "$TOOLS"
  chmod +x "$TOOLS/aapt2"
fi
# dx dexer (AOSP, repackaged on Maven Central).
fetch https://repo1.maven.org/maven2/com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar "$TOOLS/dx.jar" \
  1e4b645628e3bdb097b5331d669e177ef235a551582a8c646dbe36865e541907
# apksig (APK signing library, Maven Central).
fetch https://repo1.maven.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar "$TOOLS/apksig.jar" \
  9637078c0016244e4be0941836295365a7e2e5b164c59cb7885783c40460bfee
# Android platform jars: API 36 to compile Java, API 33 to link resources
# (this aapt2 cannot read the newer API 36 resource table format).
fetch https://raw.githubusercontent.com/Sable/android-platforms/master/android-36/android.jar "$TOOLS/android-36.jar" \
  d9eb9da824d9e247a352f570f01e1169e725b2954bca9e283a71786c59b59f9a
fetch https://raw.githubusercontent.com/Sable/android-platforms/master/android-33/android.jar "$TOOLS/android-33.jar" \
  4fade8d5e04130bd8ccd74d5fec6c86b01ad75c3ee877ccc5d660255c4c78646

# ---------------------------------------------------------------------------
# Version
# ---------------------------------------------------------------------------
VERSION_NAME="$(node -p "require('$ROOT/package.json').version")"
VERSION_CODE="${BLOOMORA_VERSION_CODE:-$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)}"
log "Bloomora $VERSION_NAME (code $VERSION_CODE)"

# ---------------------------------------------------------------------------
# Web app
# ---------------------------------------------------------------------------
if [[ "${1:-}" != "--skip-web" ]]; then
  log "Building web app"
  (cd "$ROOT" && npm run build --silent)
fi
[[ -f "$ROOT/dist/index.html" ]] || { echo "dist/ is missing; run without --skip-web" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/assets/www" "$OUT/gen" "$OUT/classes" "$OUT/signer"
cp -R "$ROOT/dist/." "$OUT/assets/www/"

# ---------------------------------------------------------------------------
# Resources + manifest
# ---------------------------------------------------------------------------
log "Linking resources"
"$TOOLS/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip"
"$TOOLS/aapt2" link \
  -I "$TOOLS/android-33.jar" \
  --manifest "$HERE/AndroidManifest.xml" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  -o "$OUT/unsigned.apk" \
  "$OUT/res.zip"

# ---------------------------------------------------------------------------
# Java -> dex
# ---------------------------------------------------------------------------
log "Compiling Java"
find "$HERE/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -Xlint:-options -encoding UTF-8 -source 8 -target 8 \
  -bootclasspath "$TOOLS/android-36.jar" \
  -d "$OUT/classes" @"$OUT/sources.txt"
java -cp "$TOOLS/dx.jar" com.android.dx.command.Main --dex --min-sdk-version="$MIN_SDK" \
  --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && zip -q -j unsigned.apk classes.dex)

# ---------------------------------------------------------------------------
# Sign (APK signature scheme v2; Android 7.0+ needs nothing older)
# ---------------------------------------------------------------------------
KEYSTORE="${BLOOMORA_KEYSTORE:-$HERE/keystore/bloomora-dev.p12}"
STORE_PASS="${BLOOMORA_KEYSTORE_PASSWORD:-bloomora-dev}"
KEY_ALIAS="${BLOOMORA_KEY_ALIAS:-bloomora}"
KEY_PASS="${BLOOMORA_KEY_PASSWORD:-$STORE_PASS}"
if [[ ! -f "$KEYSTORE" ]]; then
  log "Creating keystore $KEYSTORE"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=Bloomora, O=Bloomora" >/dev/null
fi

log "Signing"
javac -nowarn -cp "$TOOLS/apksig.jar" -d "$OUT/signer" "$HERE/tools/SignApk.java"
APK="$OUT/Bloomora-$VERSION_NAME.apk"
# apksig 2.3.0 reaches into JDK internals that newer JDKs no longer export by default.
java --add-exports java.base/sun.security.x509=ALL-UNNAMED \
     --add-exports java.base/sun.security.pkcs=ALL-UNNAMED \
     --add-exports java.base/sun.security.util=ALL-UNNAMED \
  -cp "$TOOLS/apksig.jar:$OUT/signer" SignApk \
  "$OUT/unsigned.apk" "$APK" "$KEYSTORE" "$STORE_PASS" "$KEY_ALIAS" "$KEY_PASS" "$MIN_SDK"

"$TOOLS/aapt2" dump badging "$APK" | head -n 3 || true
log "Done: $APK ($(du -h "$APK" | cut -f1))"
