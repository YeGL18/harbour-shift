#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_root="${HARBOUR_BUILD_ROOT:-$project_root/.build/ios}"
simulator_id="${HARBOUR_SIMULATOR_ID:-}"
build_number="${HARBOUR_BUILD_NUMBER:-15}"
derived_data_root="${HARBOUR_DERIVED_DATA_ROOT:-$build_root/DerivedData}"
archive_path="$build_root/HarbourShift.xcarchive"
mkdir -p "$build_root"
cd "$project_root"

case "${1:-help}" in
  simulator)
    destination='generic/platform=iOS Simulator'
    if [[ -n "$simulator_id" ]]; then
      destination="id=$simulator_id"
    fi
    xcodebuild -workspace ios/app.xcworkspace -scheme app -configuration Release \
      -sdk iphonesimulator -destination "$destination" \
      -derivedDataPath "$derived_data_root" \
      CURRENT_PROJECT_VERSION="$build_number" CODE_SIGNING_ALLOWED=NO ONLY_ACTIVE_ARCH=YES ARCHS=arm64
    ;;
  archive)
    : "${HARBOUR_APPLE_TEAM_ID:?Set your Apple development team ID}"
    xcodebuild -workspace ios/app.xcworkspace -scheme app -configuration Release \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "$derived_data_root" \
      -archivePath "$archive_path" -allowProvisioningUpdates \
      CURRENT_PROJECT_VERSION="$build_number" DEVELOPMENT_TEAM="$HARBOUR_APPLE_TEAM_ID" archive
    ;;
  export)
    xcodebuild -exportArchive -archivePath "$archive_path" \
      -exportPath "$build_root/export" \
      -exportOptionsPlist ios/ExportOptions.plist -allowProvisioningUpdates
    ;;
  upload)
    xcodebuild -exportArchive -archivePath "$archive_path" \
      -exportPath "$build_root/upload" \
      -exportOptionsPlist ios/UploadOptions.plist -allowProvisioningUpdates
    ;;
  *)
    printf '%s\n' 'Usage: bash scripts/ios-build.sh {simulator|archive|export|upload}'
    printf '%s\n' 'HARBOUR_BUILD_NUMBER, HARBOUR_BUILD_ROOT and HARBOUR_SIMULATOR_ID can override defaults.'
    ;;
esac
