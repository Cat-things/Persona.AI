# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Backend: FastAPI server with accounts, characters, discover feed, admin panel API, job queue.
- Chat: streaming replies, swipes, regenerate, edit, rewind, 1-4 star ratings, pinned memories,
  rolling summaries with per-model token budgeting.
- Web app: discover, chat, character editor, profile, settings, admin, PWA.
- Installer: Docker and native modes, update / backup / restore / uninstall / doctor.
- Avatar generation: ComfyUI, AUTOMATIC1111/Forge, OpenAI-compatible, fal.ai.
- Voices: Kokoro, Piper, XTTS-v2, ElevenLabs, OpenAI-compatible; playback and cloning.
- Voice calls with streaming STT, LLM and TTS, and barge-in.
