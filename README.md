# Pixel Squisher

A tiny mobile app that compresses video to the Small File standard — 1.44 MB per minute or less — entirely on your phone. No servers, no data centers, no internet required. Compress locally, then submit your favourite clips to Small File TV.

A [Small File Media Society](https://smallfile.ca) project.

---

## What it does

Online video is responsible for a large and growing share of global carbon emissions. Small-File Ecomedia is a response: movies of no more than 1.44 megabytes per minute, a tiny fraction of standard video (typically 60–350 MB/min). Pixel Squisher makes it easy for anyone to bring their own footage down to that standard, on-device, and share the result.

- **Compress to the Small File standard** — every mode lands at or below 1.44 MB/min.
- **Fully on-device** — no uploads, no cloud processing, works offline.
- **Preset modes** — from *Standard* (480p with sound) down to *Pixel Soup* (240p, silent, maximum crush).
- **Custom mode** — dial in your own resolution, bitrate, and audio, with a name generated for every combination.
- **Submit to Small File TV** — send clips straight to the festival's showcase.
- **Save & share** — export to your gallery or share to any app.

## Compression modes

| Mode | Target | Notes |
|------|--------|-------|
| Standard | ~1.44 MB/min | 480p, with sound |
| Tiny | ~1.0 MB/min | 360p, with sound |
| Micro | ~0.5 MB/min | 360p, silent |
| Blocky | ~0.4 MB/min | 360p, silent, pixelated |
| Pixel Soup | ~0.3 MB/min | 240p, silent, maximum compression |

Plus a **Custom** mode for tuning resolution, bitrate, and audio by hand.

## How it works

Pixel Squisher uses the device's native hardware video encoder (H.264 via Android MediaCodec) rather than bundling a heavy software codec. This keeps the app extremely small, avoids codec patent exposure, and runs fast on modest hardware — choices that reflect the small-file ethos in the app itself.

## Platforms

- **Android** — available now.
- **iOS** — in development.

## Tech

React Native. Video compression via [`react-native-compressor`](https://github.com/numandev1/react-native-compressor).

## About Small File Media Society

Small File Media Society was founded in 2020 to raise awareness of the carbon footprint of streaming media and to champion low-bandwidth moving-image art. The Small File Media Festival runs annually in partnership with The Cinematheque in Vancouver.

Learn more at [smallfile.ca](https://smallfile.ca).

## License

See [LICENSE](LICENSE).
