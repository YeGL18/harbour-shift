# 港更 · Harbour Shift

Drive a six-, twelve- or twenty-four-hour shift across Hong Kong. Choose from 12 vehicles, take trips, manage fuel or charging and return to a handover point. The offline map includes 37,925 named locations. The dispatch, fares, traffic and queues are game simulations.

Version **0.8.2** includes **1×, 10×, 30× and 60×** speeds, day and night map themes and optional ELITE reservations for qualified drivers. Solo play works offline after the native build is installed. Multiplayer rooms share an authoritative clock and dispatch, with individual and team rankings.

## Build and run

Use a recent Node.js release compatible with the locked Expo and React Native packages. Install dependencies before building.

```sh
npm ci
npm run typecheck
npm test
```

- **iOS** requires macOS, Xcode and CocoaPods. [Build iOS](docs/ios-build.md).
- **Android** requires a JDK and the Android SDK, platform and NDK configured in the native project. [Build Android](docs/android-build.md).

Use a native Expo development build for either platform. The checked-in native projects contain the MapLibre and game audio integration.

## Local multiplayer

Set `EXPO_PUBLIC_MULTIPLAYER_URL` to your own authority before starting Metro or bundling the app. Standard simulator endpoints are `http://127.0.0.1:8787` on iOS and `http://10.0.2.2:8787` on Android. Physical devices can reach an independently operated HTTPS endpoint. [Start a local authority](server/README.md).

## Data and attribution

- © Government of the Hong Kong Special Administrative Region and respective data providers. [Map sources and reuse terms](assets/map/SOURCES.md), [named places](assets/places/NOTICE.md), [locality anchors](assets/localities/NOTICE.md) and [service locations](assets/services/NOTICE.md).
- The bundled Harbour Sans HK subset derives from Noto Sans CJK HK. [SIL Open Font License](assets/map/OFL-NotoSansHK.txt).
- [Original game audio](assets/sounds/NOTICE.md) and [simulated trip mechanics](docs/order-preferences.md).

The repository is public for viewing. No general open-source license has been granted for the original game code and artwork. The listed datasets, font and external dependencies retain their respective terms.
