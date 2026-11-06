# Troubleshooting

Start with `./install.sh doctor` (or **Admin → Overview → Health**). It checks the secret key,
database, disk space, Redis, and each AI provider.

## The site doesn't load

- `./install.sh status`. Docker: `cd /opt/persona && docker compose logs --tail 100 persona`.
  Native: `journalctl -u persona -n 100`.
- From another machine: Persona.AI listens on 127.0.0.1 unless you set `--domain` or `--lan`.
  Use `ssh -L 8000:127.0.0.1:8000 you@server`.

## HTTPS / Caddy

- DNS for the domain must point at the server; ports 80 and 443 must be open
  (`sudo ufw allow 80,443/tcp`).
- Docker: `docker compose logs caddy`. Native: `journalctl -u caddy`.

## "Could not reach LLM"

- Is the server running? `ollama list` / `curl http://127.0.0.1:11434/v1/models`.
- Docker mode uses service names: `http://ollama:11434/v1`. For a server on the host use
  `http://host.docker.internal:11434/v1`.
- `404 model not found`: the model name in Admin → Providers must match exactly (`ollama list`).

## Replies are slow

- CPU-only: use a smaller model (`llama3.2:3b`) or a cloud provider.
- Lower **Context size** in Admin → Providers; long prompts take longer to process.
- `OLLAMA_KEEP_ALIVE=30m` (set by default in Docker) keeps the model loaded between messages.

## GPU isn't used

- NVIDIA + Docker: `docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi`
  must work. If not, install the NVIDIA Container Toolkit and restart Docker.
- `.env` should contain `COMPOSE_FILE=docker-compose.yml:docker-compose.nvidia.yml`.
- Podman needs CDI: `sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml`.

## Voices / calls

- Browsers only allow the microphone on HTTPS or `localhost`.
- "Voices are off on this server": pick a TTS provider in Admin → Providers.
- First use of Kokoro downloads ~330 MB; the first reply after a restart is slower.
- Calls interrupt themselves: use headphones, or keep the volume lower. Echo cancellation helps
  but loud speakers can still trigger barge-in.
- Dictation fails on uploaded formats: install ffmpeg (`persona doctor` reports it).

## Avatars

- "Image generation isn't configured": set a provider in Admin → Providers.
- ComfyUI "has no checkpoints installed": put a `.safetensors` file in `ComfyUI/models/checkpoints`
  (Docker: `/opt/persona/comfyui/ComfyUI/models/checkpoints`), or re-run the installer with
  `--checkpoint`.

## Reset the admin password

```bash
# native
sudo -u persona bash -c 'set -a; source /etc/persona/persona.env; /opt/persona/app/apps/server/.venv/bin/persona create-admin yourname'
# docker
cd /opt/persona && docker compose exec persona persona create-admin yourname
```
