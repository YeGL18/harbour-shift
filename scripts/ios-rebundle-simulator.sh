#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build_root="${HARBOUR_BUILD_ROOT:-$project_root/.build/ios}"
simulator_id="${HARBOUR_SIMULATOR_ID:?Set HARBOUR_SIMULATOR_ID to the UUID of a dedicated test simulator}"
derived_data_root="${HARBOUR_DERIVED_DATA_ROOT:-$build_root/DerivedData}"
simulator_app="$derived_data_root/Build/Products/Release-iphonesimulator/app.app"
bundle_file="$build_root/js/main.jsbundle"

if [[ ! -d "$simulator_app" ]]; then
  printf '%s\n' 'Build the simulator Release app first with scripts/ios-build.sh simulator.' >&2
  exit 1
fi
mkdir -p "$build_root/js"
cd "$project_root"
node node_modules/expo/bin/cli export:embed --entry-file index.ts --platform ios \
  --dev false --minify false --bundle-output "$bundle_file" --assets-dest "$simulator_app"
ios/Pods/hermes-engine/destroot/bin/hermesc -emit-binary -O \
  -out "$simulator_app/main.jsbundle" "$bundle_file"
xcrun simctl bootstatus "$simulator_id" -b >/dev/null
xcrun simctl terminate "$simulator_id" com.ygl100.harbourshift >/dev/null 2>&1 || true
xcrun simctl install "$simulator_id" "$simulator_app"
xcrun simctl launch "$simulator_id" com.ygl100.harbourshift
