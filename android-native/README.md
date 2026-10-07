# Bloomora for Android

A small native Android app that runs the Bloomora web app in a WebView and adds
phone features through a JavaScript bridge (`window.BloomoraNative`, see
`src/lib/native.ts`):

- Timer alerts when a focus round, break or countdown ends, even with the app closed
- Deadline reminders the evening before and on the day something is due
- Keeps the screen awake while a timer runs
- Android back button and gesture support
- "Save as" for backups, CSV and Markdown exports, and a file picker for imports and photos
- Status and navigation bars that follow the light/dark theme
- AI tutor requests sent natively to `https://bloomora.pages.dev` (override with `VITE_API_BASE_URL`)

The web files are bundled inside the APK and served from
`https://appassets.androidplatform.net`, so everything works offline and data
stays on the phone unless you sign in to sync.

## Building

```bash
./android-native/build.sh             # builds the web app, then the APK
./android-native/build.sh --skip-web  # reuse dist/
```

The APK is written to `android-native/build/Bloomora-<version>.apk`. The script
needs Node, a JDK (17+), `curl`, `unzip` and `zip`; it downloads a pinned,
checksum-verified toolchain into `android-native/.tools/` (aapt2, dx, apksig and
the Android platform jars), so the full Android SDK and Gradle are not required.

Sync and the AI tutor are configured at build time like the website: put
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_AUTH_TOKEN` in `.env`
or the environment. The **Android APK** GitHub Actions workflow does this from
repository secrets of the same names and uploads the APK as a build artifact.

## Signing

`keystore/bloomora-dev.p12` (password `bloomora-dev`, alias `bloomora`) is a
development key committed on purpose so every build can be installed over the
previous one without losing data. Do not use it for the Play Store: create a
private upload key and pass it with `BLOOMORA_KEYSTORE`,
`BLOOMORA_KEYSTORE_PASSWORD`, `BLOOMORA_KEY_ALIAS` and `BLOOMORA_KEY_PASSWORD`.

## Updating the icon

The logo lives in `resources/*.svg`. After editing, run
`node resources/render-icons.mjs` to regenerate the Android and web PNGs.
