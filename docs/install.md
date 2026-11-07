# Installation

`install.sh` (Linux and macOS) and `install.ps1` (Windows) set up Persona.AI either in Docker
containers or as native services. Both are safe to re-run: existing secrets and your edits to the
env file are kept.

## Choosing a mode

| | Docker (recommended) | Native |
|---|---|---|
| Isolation | Containers | System user `persona` + hardened systemd units (launchd on macOS) |
| Updates | `./install.sh update` pulls new images | `./install.sh update` pulls git, rebuilds |
| Local voices / STT | Kokoro-FastAPI and Speaches containers | Kokoro and faster-whisper in-process |
| GPU | NVIDIA via Container Toolkit, AMD via ROCm image | Uses host drivers directly |
| Alpine | Yes | No (no systemd) |

On macOS, Docker can't use the GPU, so the installer runs Ollama natively (Metal) even in Docker
mode and points the containers at it.

## Options

```
./install.sh [install] [options]
  --docker | --native        install mode
  -y, --yes                  accept defaults, no questions
  --dir PATH                 install directory (default /opt/persona, ~/persona on macOS)
  --domain NAME              public domain: Caddy with automatic HTTPS
  --email ADDR               Let's Encrypt contact email
  --port N                   local port (default 8000)
  --lan                      listen on all interfaces without a proxy (trusted LANs only)
  --llm ollama|external|none
  --llm-url URL              OpenAI-compatible base URL for --llm external
  --model NAME               Ollama model to pull (default: picked from VRAM/RAM)
  --gpu auto|nvidia|amd|none
  --image-gen comfyui|none   ComfyUI for avatars
  --checkpoint / --no-checkpoint   download a starter image model for ComfyUI (checksum-verified)
  --checkpoint-model sd15|sdxl     DreamShaper 8 (~2 GB) or DreamShaper XL Lightning SFW (~7 GB);
                                   default: sdxl with 10 GB+ VRAM
  --tts / --no-tts           local voices (Kokoro)
  --stt / --no-stt           local speech recognition (faster-whisper)
  --redis                    Redis for shared rate limits and instant job pickup
  --build                    Docker: build the image from source instead of pulling
  --seed / --no-seed         sample characters
```

API keys are never passed as flags (they'd end up in shell history). For `--llm external`, set
`PERSONA_LLM_API_KEY` in the environment or enter it at the prompt, or add it later in
**Admin → Providers**.

## What gets installed where

**Docker mode** (`--dir`, default `/opt/persona`):

```
docker-compose.yml, docker-compose.{nvidia,amd}.yml
.env              settings + secrets (mode 600)
Caddyfile         only with --domain
data/             database, media, models, cache
ollama/ comfyui/ stt-cache/ caddy/   per-service volumes
backups/
```

Compose profiles are selected through `COMPOSE_PROFILES` in `.env`: `core`, `llm`, `image-gen`,
`tts`, `stt`, `proxy`, `redis`. Add or remove one and run `docker compose up -d` in the install
directory.

**Native mode (Linux)**: code in `/opt/persona/app`, data in `/var/lib/persona`, settings in
`/etc/persona/persona.env` (root:persona 640), services `persona`, `persona-worker` and
optionally `persona-comfyui`. **macOS**: everything under `~/persona`, launchd agents
`ai.persona.server` and `ai.persona.worker`.

## Network exposure

Without `--domain`, Persona.AI binds to `127.0.0.1` only. Ways to reach it from elsewhere:

- `--domain chat.example.com`: Caddy terminates HTTPS (ports 80 and 443 must be reachable and DNS
  must point at the server). The installer prints `ufw`/`firewalld` commands.
- An SSH tunnel: `ssh -L 8000:127.0.0.1:8000 you@server`.
- `--lan`: listens on all interfaces over plain HTTP. Browsers block the microphone on non-HTTPS
  origins, so calls and dictation won't work this way except on `localhost`.

## Subcommands

| Command | What it does |
|---|---|
| `update` | Pull the new version, run migrations, restart |
| `backup [--out FILE]` | One `.tar.gz` with the database, media and config (contains secrets) |
| `restore FILE` | Replace data with a backup (asks first; `--yes` to skip) |
| `doctor` | Service status plus `persona doctor` checks for DB, disk and every provider |
| `status` | Container / service status |
| `export-training [--out DIR]` | Export opted-in users' rated chats for fine-tuning ([training guide](../training/README.md)) |
| `uninstall [--purge]` | Remove services; `--purge` also deletes data |
