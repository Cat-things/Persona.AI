# Mobile app

The Persona.AI app for Android and iOS lives in `apps/mobile`. It's built with Expo (SDK 58) and
uses the same API client as the web app (`packages/shared`). It has the same core features as
the web app:

- discover and search
- streaming chat with swipes, star ratings, edit, rewind and memory
- rooms and personas
- voice playback and dictation
- real-time calls with barge-in
- the character editor, with card import, avatar generation and voice cloning

Admin settings stay in the web app. The app links to them.

## Before you install: can your phone reach the server?

The app talks to your server directly. A default install listens on `127.0.0.1` only, so a phone
can't reach it. Use one of these:

| Setup | How | Address to enter in the app |
|---|---|---|
| Public domain (recommended) | `./install.sh --domain chat.example.com` (Caddy gets HTTPS for you) | `chat.example.com` |
| Home network only | `./install.sh --lan`, then allow port 8000 in the firewall | `192.168.1.20:8000` (your server's LAN IP) |
| Private VPN | Tailscale or WireGuard on both devices, plus `--lan` | `100.x.y.z:8000` |

On first launch the app asks for this address and checks that a Persona.AI server answers there
before you can sign in. Without `http://` or `https://`, it tries HTTPS first. The app warns
you before connecting over plain HTTP to anything that isn't a local or VPN address, because
passwords and chats would travel unencrypted. You can switch servers later under
**You → Server**.

## Install a ready-made APK

When releases are published, the APK is attached to each
[GitHub release](https://github.com/Cat-things/Persona.AI/releases). Open it on your phone and
allow "install unknown apps" for your browser when Android asks.

## Build the Android APK yourself (no Expo account)

### 1. Tools

- **JDK 17.** Android's Gradle tooling doesn't support much newer JDKs yet. On Arch or
  EndeavourOS, install `jdk17-openjdk` and run `archlinux-java set java-17-openjdk`. On
  Debian or Ubuntu, install `openjdk-17-jdk`. On macOS, run `brew install openjdk@17`.
- **Android SDK.** Install Android Studio, or only the
  [command-line tools](https://developer.android.com/studio#command-line-tools-only). Then run:

  ```bash
  export ANDROID_HOME=$HOME/Android/Sdk
  sdkmanager "platform-tools"
  sdkmanager --licenses        # accept them; Gradle then downloads the platforms it needs
  ```
- Node.js 22+ and pnpm, as for the rest of the repo.

### 2. Optional: a signing key

Without a key of your own, the build is signed with the Android debug key. That's fine for
trying the app. But Android only installs an update over an existing app when both were
signed with the same key, so create one if you'll keep using the app:

```bash
keytool -genkeypair -v -storetype PKCS12 -keystore ~/persona-release.keystore \
  -alias persona -keyalg RSA -keysize 2048 -validity 10000
```

Then put the details in `~/.gradle/gradle.properties`, which is outside the repo; never commit
them:

```properties
PERSONA_UPLOAD_STORE_FILE=/home/you/persona-release.keystore
PERSONA_UPLOAD_STORE_PASSWORD=your-store-password
PERSONA_UPLOAD_KEY_ALIAS=persona
PERSONA_UPLOAD_KEY_PASSWORD=your-key-password
```

A config plugin in the app (`apps/mobile/plugins/withReleaseSigning.js`) picks these up
automatically. Back up the keystore: if you lose it, you can't update the app, only uninstall
it and install it again.

### 3. Build

```bash
pnpm install
cd apps/mobile
npx expo prebuild --platform android          # generates android/ (git-ignored)
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The APK is at `android/app/build/outputs/apk/release/app-release.apk`. Install it with
`adb install` or by copying it to the phone. `arm64-v8a` covers practically every phone from
the last eight years. Leave the flag out to build for all architectures; the APK is then about
three times larger.

The first build downloads Gradle and the Android dependencies, which takes a while. It needs
about 6 GB of free RAM. If it runs out of memory, close other apps or add
`org.gradle.jvmargs=-Xmx4g` to `~/.gradle/gradle.properties`.

## Build with EAS (Expo account)

EAS builds in Expo's cloud, so you need no Android SDK or Mac. It's also the simplest way to
get remote push notifications and iOS builds.

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init                                 # adds your projectId to app.json
npx eas-cli@latest build -p android --profile preview   # APK for sideloading
npx eas-cli@latest build -p android --profile production   # AAB for Google Play
npx eas-cli@latest build -p ios --profile production       # needs an Apple developer account
```

The profiles are defined in `apps/mobile/eas.json`.

## Notifications

When an avatar generation finishes, the app notifies you:

- **EAS builds with a projectId** get real push notifications through Expo's push service,
  even while the app is closed. For Android, upload an FCM v1 service account key with
  `npx eas-cli@latest credentials`. The server only sends a short title and body, such as
  "Avatars ready", never chat content.
- **Self-built APKs** have no Expo projectId, so remote push isn't possible. Instead, the app
  checks the server for new notifications every 30 seconds while it's open and shows them
  as local notifications.

## Development

Expo Go can't run this app. Calls use `react-native-audio-api`, which is native code that Expo
Go doesn't include. Use a development build instead:

```bash
cd apps/mobile
npx expo run:android      # builds and installs a debug build on a connected phone or emulator
pnpm start                # Metro dev server for later sessions
```

To point the app at a dev server on your computer, start the backend with
`HOST=0.0.0.0 uv run persona serve` and enter `http://<your-computer-ip>:8000` in the app.

Checks:

```bash
cd apps/mobile
pnpm typecheck
pnpm lint
npx expo-doctor
npx expo export --platform android   # bundles all screens; catches broken imports
```

## Troubleshooting

- **"Couldn't reach that address."** Is the server listening on more than `127.0.0.1` (see the
  table at the top)? Is the port open in the firewall? Is the phone on the same network or
  VPN? Try opening the address in the phone's browser first.
- **"Something answered, but it isn't a Persona.AI server."** The address points at a different
  service or at a reverse proxy that isn't forwarding `/api`. Use the same URL that opens
  Persona.AI in a browser.
- **The microphone does nothing in calls.** Allow the microphone under Android Settings →
  Apps → Persona.AI → Permissions. Calls also need the server to have speech recognition and
  a voice set up (**Admin → Providers**).
- **No notifications.** Allow notifications for the app. Self-built APKs only notify while the
  app is open (see [Notifications](#notifications)).
