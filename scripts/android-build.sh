#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TASK_DIR=$(CDPATH= cd -- "$PROJECT_DIR/../.." && pwd)
if [ -d "$TASK_DIR/work/android-sdk" ]; then
  DEFAULT_WORK_DIR="$TASK_DIR/work"
else
  DEFAULT_WORK_DIR="$PROJECT_DIR/.build-work"
fi
WORK_DIR="${HARBOUR_BUILD_WORK_DIR:-$DEFAULT_WORK_DIR}"

# Prefer a caller's Android SDK. The task-local toolchain is used on this machine.
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$WORK_DIR/android-sdk" ]; then
  ANDROID_HOME="$WORK_DIR/android-sdk"
  export ANDROID_HOME
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  printf '%s\n' 'Set ANDROID_HOME to an Android SDK with platform 37, build tools 37.0.0 and NDK 27.1.12297006.' >&2
  exit 1
fi

GRADLE_USER_HOME="${GRADLE_USER_HOME:-$WORK_DIR/android-gradle}"
NODE_ENV=production
export GRADLE_USER_HOME NODE_ENV

# Release bundles JavaScript/assets for offline use. It uses the generated debug
# certificate, so this is an internal-test APK, not a Play Store production build.
cd "$PROJECT_DIR/android"
./gradlew :app:assembleRelease \
  --console plain \
  -Pandroid.builder.sdkDownload=false \
  -Pandroid.enableMinifyInReleaseBuilds=false \
  -PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64 \
  "$@"

APK_SOURCE="$PROJECT_DIR/android/app/build/outputs/apk/release/app-release.apk"
APP_VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
APK_DESTINATION="$PROJECT_DIR/../harbour-shift-$APP_VERSION.apk"
cp "$APK_SOURCE" "$APK_DESTINATION"
printf 'APK: %s\n' "$APK_DESTINATION"

SIGNER="$ANDROID_HOME/build-tools/37.0.0/apksigner"
if [ -x "$SIGNER" ]; then
  "$SIGNER" verify --verbose "$APK_DESTINATION"
fi
