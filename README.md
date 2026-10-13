# Pixel Squisher

A tiny mobile app that compresses video to the Small File standard, 1.44 MB per minute or less, entirely on your phone. No data centers, no edge servers, no internet required. Compress locally, then submit your favourite clips to Small File TV.

A [Small File Media Society](https://smallfile.ca) project.

---

## What it does

Online video is responsible for a large and growing share of global carbon emissions. Small-File Ecomedia is a response: movies of no more than 1.44 megabytes per minute, a tiny fraction of standard video (typically 60 to 350 MB/min). Pixel Squisher makes it easy for anyone to bring their own footage down to that standard, on-device, and share the result.

- **Compress to the Small File standard.** Every mode lands at or below 1.44 MB/min.
- **Fully on-device.** No uploads to compress, no cloud processing, works offline.
- **Preset modes.** From Standard (480p with sound) down to Pixel Soup (240p, silent, maximum crush).
- **Custom mode.** Dial in your own resolution, bitrate, and audio, with a name generated for every combination.
- **Submit to Small File TV.** Send clips straight to the showcase at [smallfile.tv](https://smallfile.tv).
- **Save and share.** Export to your gallery or share to any app.

## Compression modes

| Mode | Target | Notes |
|------|--------|-------|
| Standard | ~1.44 MB/min | 480p, with sound |
| Tiny | ~1.0 MB/min | 360p, with sound |
| Micro | ~0.5 MB/min | 360p, silent |
| Blocky | ~0.4 MB/min | 360p, silent, pixelated |
| Pixel Soup | ~0.3 MB/min | 240p, silent, maximum compression |

Plus a **Custom** mode for tuning resolution (480p to 144p), bitrate, and audio by hand. Each combination gets its own generated name.

## How it works

Pixel Squisher uses the device's native hardware video encoder (H.264 via Android MediaCodec) rather than bundling a heavy software codec. This keeps the app small (around 13 MB installed), avoids codec patent exposure, and runs fast on modest hardware. These choices reflect the small-file ethos in the app itself.

When a device's encoder cannot handle a very low resolution and bitrate combination, the app automatically retries at a higher bitrate, and only steps the resolution up as a last resort, so the lowest settings degrade gracefully instead of failing.

## Platforms

- **Android.** In testing, heading to the Play Store.
- **iOS.** Deferred until Mac access is available.

## Building from source

This is a React Native project. You will need Node 20, the Android SDK, and a JDK (the one bundled with Android Studio works).

```
git clone https://github.com/jschinkel/pixelsquisher.git
cd pixelsquisher
yarn install
```

Create `android/local.properties` pointing at your Android SDK:

```
sdk.dir=/path/to/Android/Sdk
```

Then run on a connected device or emulator:

```
yarn android
```

The app uses Firebase for Small File TV submissions. To build with submission working, you will need your own `google-services.json` in `android/app/`. The app compiles and compresses video without it; only the submission feature needs Firebase configured.

## Tech

React Native, with video compression via [`react-native-compressor`](https://github.com/numandev1/react-native-compressor). Animations use Reanimated. Sharing, gallery export, thumbnails, and file handling use the corresponding React Native community libraries.

## About Small File Media Society

Small File Media Society was founded in 2020 to raise awareness of the carbon footprint of streaming media and to champion low-bandwidth moving-image art. The Small File Media Festival runs annually in partnership with The Cinematheque in Vancouver.

Learn more at [smallfile.ca](https://smallfile.ca).

## License

See [LICENSE](LICENSE).
