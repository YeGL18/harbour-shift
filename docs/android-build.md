# Android build

1. Install a compatible JDK, Android SDK Platform 37, Build Tools 37.0.0 and NDK 27.1.12297006. Set `ANDROID_HOME` to the SDK directory.
2. Run `npm ci` from the repository and start an emulator or connect an Android device.
3. Run `npm run android` to install a development build.

Run `sh scripts/android-build.sh` to create a standalone test APK in the parent directory. The project uses the current developer's debug signing identity by default. Supply your own release signing settings for distribution.
