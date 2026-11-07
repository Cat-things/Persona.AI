# Persona.AI mobile app

Expo (SDK 58) app for Android and iOS. Setup, sideloadable APK builds without an Expo account,
EAS builds and troubleshooting: [docs/mobile.md](../../docs/mobile.md).

```bash
npx expo run:android   # development build on a phone or emulator (Expo Go isn't supported)
pnpm typecheck && pnpm lint
```

Layout: `src/app` holds the Expo Router routes (`setup`, `login`, `register`, and `(app)` with
the tabs, chat, call, character, editor and room screens). Shared UI is in `src/components`,
and API, auth, theme, voice, calls and push are in `src/lib`.
