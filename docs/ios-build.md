# iOS build

1. On macOS, install Xcode, an iOS Simulator runtime and CocoaPods.
2. From the repository root, run `npm ci`.
3. Run `cd ios && pod install`, then return to the repository root.
4. Start an iOS Simulator, then run `npm run ios`.

Run `bash scripts/ios-build.sh simulator` to compile an offline Release simulator build. Set `HARBOUR_SIMULATOR_ID` to target a specific simulator. For device distribution, set your own bundle identifier and development team in Xcode, then provide your own App Store export settings.
