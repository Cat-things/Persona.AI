#!/usr/bin/env bash
# Persona.AI installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/Cat-things/Persona.AI/main/install.sh | bash
#   ./install.sh --docker --yes --domain chat.example.com
#   ./install.sh update | backup | restore <file> | uninstall | doctor | status
#
# Read it before you run it: https://github.com/Cat-things/Persona.AI/blob/main/install.sh
# Safe to re-run: existing secrets and settings in the env file are kept.

set -Eeuo pipefail

PERSONA_REPO="${PERSONA_REPO:-https://github.com/Cat-things/Persona.AI}"
PERSONA_BRANCH="${PERSONA_BRANCH:-main}"
PERSONA_RAW="${PERSONA_RAW:-https://raw.githubusercontent.com/Cat-things/Persona.AI/${PERSONA_BRANCH}}"
PERSONA_IMAGE_DEFAULT="ghcr.io/cat-things/persona-server:latest"
NODE_VERSION="22.12.0"
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

# ----------------------------------------------------------------------------- options
COMMAND="install"
MODE=""            # docker | native
ASSUME_YES=0
DOMAIN=""
ACME_EMAIL=""
INSTALL_DIR=""
PORT="8000"
LAN=0              # bind 0.0.0.0 without a proxy (explicit opt-in)
LLM=""             # ollama | external | none
LLM_URL=""
MODEL=""
GPU="auto"         # auto | nvidia | amd | none
IMAGE_GEN=""       # comfyui | none
TTS=""             # yes | no
STT=""             # yes | no
REDIS=0
BUILD=0            # docker: build the image from source instead of pulling
SEED=""            # yes | no (sample characters)
DOWNLOAD_CHECKPOINT=""  # yes | no
RESTORE_FILE=""
PURGE=0

usage() {
  cat <<'EOF'
Persona.AI installer

Usage: install.sh [command] [options]

Commands:
  install            Install or reconfigure (default)
  update             Pull the latest version and restart
  backup [--out F]   Write a backup archive (database, media, config)
  restore FILE       Restore a backup archive
  uninstall          Stop and remove services (keeps data unless --purge)
  doctor             Health check
  status             Show service status

Options:
  --docker | --native        Install mode (default: ask; Docker recommended)
  -y, --yes                  Accept defaults, no questions
  --dir PATH                 Install directory (default /opt/persona, ~/persona on macOS)
  --domain NAME              Public domain; sets up Caddy with automatic HTTPS
  --email ADDR               Email for Let's Encrypt notices
  --port N                   Local port for the app (default 8000)
  --lan                      Listen on all interfaces without a proxy (not recommended)
  --llm ollama|external|none LLM backend (default: ollama)
  --llm-url URL              OpenAI-compatible base URL for --llm external
                             (API key: set PERSONA_LLM_API_KEY in the environment)
  --model NAME               Ollama model to pull (default picked from your hardware)
  --gpu auto|nvidia|amd|none GPU to use (default: auto-detect)
  --image-gen comfyui|none   Set up ComfyUI for avatar generation
  --checkpoint / --no-checkpoint
                             Download a starter image model for ComfyUI (~2 GB)
  --tts / --no-tts           Local text to speech (Kokoro)
  --stt / --no-stt           Local speech recognition (faster-whisper)
  --redis                    Add Redis (shared rate limits, instant job pickup)
  --build                    Docker: build the image from source
  --seed / --no-seed         Add sample characters
  --purge                    With uninstall: also delete data and backups
  -h, --help                 Show this help
EOF
}

parse_args() {
  local args=("$@")
  local i=0
  if [[ ${#args[@]} -gt 0 && "${args[0]}" != -* ]]; then
    COMMAND="${args[0]}"
    i=1
  fi
  while [[ $i -lt ${#args[@]} ]]; do
    local a="${args[$i]}"
    local next="${args[$((i + 1))]:-}"
    case "$a" in
      --docker) MODE="docker" ;;
      --native) MODE="native" ;;
      -y | --yes) ASSUME_YES=1 ;;
      --dir) INSTALL_DIR="$next"; i=$((i + 1)) ;;
      --domain) DOMAIN="$next"; i=$((i + 1)) ;;
      --email) ACME_EMAIL="$next"; i=$((i + 1)) ;;
      --port) PORT="$next"; i=$((i + 1)) ;;
      --lan) LAN=1 ;;
      --llm) LLM="$next"; i=$((i + 1)) ;;
      --llm-url) LLM_URL="$next"; i=$((i + 1)) ;;
      --model) MODEL="$next"; i=$((i + 1)) ;;
      --gpu) GPU="$next"; i=$((i + 1)) ;;
      --image-gen) IMAGE_GEN="$next"; i=$((i + 1)) ;;
      --checkpoint) DOWNLOAD_CHECKPOINT="yes" ;;
      --no-checkpoint) DOWNLOAD_CHECKPOINT="no" ;;
      --tts) TTS="yes" ;;
      --no-tts) TTS="no" ;;
      --stt) STT="yes" ;;
      --no-stt) STT="no" ;;
      --redis) REDIS=1 ;;
      --build) BUILD=1 ;;
      --seed) SEED="yes" ;;
      --no-seed) SEED="no" ;;
      --purge) PURGE=1 ;;
      --out) RESTORE_FILE="$next"; i=$((i + 1)) ;;
      -h | --help) usage; exit 0 ;;
      *)
        if [[ "$COMMAND" == "restore" && -z "$RESTORE_FILE" ]]; then
          RESTORE_FILE="$a"
        else
          die "Unknown option: $a (see --help)"
        fi
        ;;
    esac
    i=$((i + 1))
  done
  [[ "$PORT" =~ ^[0-9]+$ ]] || die "--port must be a number"
  case "$GPU" in auto | nvidia | amd | none) ;; *) die "--gpu must be auto, nvidia, amd or none" ;; esac
  case "$LLM" in "" | ollama | external | none) ;; *) die "--llm must be ollama, external or none" ;; esac
  if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then die "--domain looks invalid"; fi
}

# ----------------------------------------------------------------------------- output
if [[ -t 1 ]]; then
  C_B=$'\033[1m' C_DIM=$'\033[2m' C_R=$'\033[31m' C_G=$'\033[32m' C_Y=$'\033[33m' C_C=$'\033[38;5;209m' C_0=$'\033[0m'
else
  C_B="" C_DIM="" C_R="" C_G="" C_Y="" C_C="" C_0=""
fi
step() { printf '\n%s==>%s %s%s%s\n' "$C_C" "$C_0" "$C_B" "$*" "$C_0"; }
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s✔%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '    %s!%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
die() {
  printf '\n%sError:%s %s\n' "$C_R" "$C_0" "$*" >&2
  exit 1
}
trap 'die "Command failed (line $LINENO): $BASH_COMMAND"' ERR

HAS_TTY=0
if [[ -r /dev/tty ]] && { : </dev/tty; } 2>/dev/null; then HAS_TTY=1; fi

# ask "Question" default -> REPLY
ask() {
  local q="$1" def="${2:-}"
  if [[ $ASSUME_YES -eq 1 || $HAS_TTY -eq 0 ]]; then
    REPLY="$def"
    return
  fi
  printf '    %s%s%s [%s]: ' "$C_B" "$q" "$C_0" "$def" >/dev/tty
  read -r REPLY </dev/tty || REPLY=""
  REPLY="${REPLY:-$def}"
}

ask_secret() {
  local q="$1"
  REPLY=""
  if [[ $ASSUME_YES -eq 1 || $HAS_TTY -eq 0 ]]; then return; fi
  printf '    %s%s%s (input hidden, Enter to skip): ' "$C_B" "$q" "$C_0" >/dev/tty
  read -rs REPLY </dev/tty || REPLY=""
  printf '\n' >/dev/tty
}

# confirm "Question" y|n -> 0 for yes
confirm() {
  local q="$1" def="${2:-y}" hint="Y/n"
  [[ "$def" == "n" ]] && hint="y/N"
  if [[ $ASSUME_YES -eq 1 || $HAS_TTY -eq 0 ]]; then
    [[ "$def" == "y" ]]
    return
  fi
  printf '    %s%s%s [%s]: ' "$C_B" "$q" "$C_0" "$hint" >/dev/tty
  local a
  read -r a </dev/tty || a=""
  a="${a:-$def}"
  [[ "$a" =~ ^[Yy] ]]
}

# confirm_danger "Question": defaults to No interactively, but an explicit --yes means yes.
confirm_danger() {
  if [[ $ASSUME_YES -eq 1 ]]; then return 0; fi
  if [[ $HAS_TTY -eq 0 ]]; then return 1; fi
  confirm "$1" "n"
}

# choose "Question" default option1 option2 ... -> REPLY
choose() {
  local q="$1" def="$2"
  shift 2
  local opts=("$@") n=1
  if [[ $ASSUME_YES -eq 1 || $HAS_TTY -eq 0 ]]; then
    REPLY="$def"
    return
  fi
  printf '    %s%s%s\n' "$C_B" "$q" "$C_0" >/dev/tty
  local o
  for o in "${opts[@]}"; do
    local mark=" "
    [[ "${o%%|*}" == "$def" ]] && mark="*"
    printf '      %s %d) %s\n' "$mark" "$n" "${o#*|}" >/dev/tty
    n=$((n + 1))
  done
  printf '    Choice [default %s]: ' "$def" >/dev/tty
  local a
  read -r a </dev/tty || a=""
  if [[ -z "$a" ]]; then
    REPLY="$def"
  elif [[ "$a" =~ ^[0-9]+$ && $a -ge 1 && $a -le ${#opts[@]} ]]; then
    REPLY="${opts[$((a - 1))]%%|*}"
  else
    REPLY="$a"
  fi
}

# ----------------------------------------------------------------------------- detection
OS="" DISTRO="" PKG="" ARCH="" GPU_VENDOR="none" VRAM_MB=0 RAM_MB=0
SUDO=""

detect() {
  case "$(uname -s)" in
    Linux) OS="linux" ;;
    Darwin) OS="macos" ;;
    *) die "Unsupported OS $(uname -s). On Windows use install.ps1." ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) ARCH="x86_64" ;;
    aarch64 | arm64) ARCH="arm64" ;;
    *) die "Unsupported CPU architecture $(uname -m) (need x86_64 or arm64)" ;;
  esac

  if [[ "$OS" == "linux" ]]; then
    if [[ -r /etc/os-release ]]; then
      # shellcheck disable=SC1091
      DISTRO="$(. /etc/os-release && echo "${ID:-}")"
    fi
    if command -v apt-get >/dev/null; then PKG="apt"
    elif command -v dnf >/dev/null; then PKG="dnf"
    elif command -v pacman >/dev/null; then PKG="pacman"
    elif command -v apk >/dev/null; then PKG="apk"
    elif command -v zypper >/dev/null; then PKG="zypper"
    fi
    RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  else
    DISTRO="macos"
    PKG="brew"
    RAM_MB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 ))
  fi

  if [[ $EUID -ne 0 ]]; then
    if command -v sudo >/dev/null; then SUDO="sudo"
    elif command -v doas >/dev/null; then SUDO="doas"
    fi
  fi

  detect_gpu
}

detect_gpu() {
  GPU_VENDOR="none"
  VRAM_MB=0
  if [[ "$GPU" == "none" ]]; then return; fi
  if [[ "$OS" == "macos" ]]; then
    [[ "$ARCH" == "arm64" ]] && GPU_VENDOR="apple"
    return
  fi
  if [[ "$GPU" == "nvidia" || "$GPU" == "auto" ]]; then
    if command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then
      GPU_VENDOR="nvidia"
      VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -dc '0-9')
      VRAM_MB=${VRAM_MB:-0}
      return
    elif command -v lspci >/dev/null && lspci 2>/dev/null | grep -qiE 'vga.*nvidia|3d.*nvidia'; then
      GPU_VENDOR="nvidia"
      warn "NVIDIA GPU found but nvidia-smi isn't working: install the NVIDIA driver for GPU acceleration."
      return
    fi
  fi
  if [[ "$GPU" == "amd" || "$GPU" == "auto" ]]; then
    if [[ -e /dev/kfd ]] || { command -v lspci >/dev/null && lspci 2>/dev/null | grep -qiE 'vga.*(amd|ati)|display.*(amd|ati)'; }; then
      GPU_VENDOR="amd"
      if command -v rocm-smi >/dev/null; then
        VRAM_MB=$(rocm-smi --showmeminfo vram --csv 2>/dev/null | awk -F, 'NR==2 {print int($2/1048576)}' || echo 0)
      fi
    fi
  fi
  [[ "$GPU" == "nvidia" && "$GPU_VENDOR" != "nvidia" ]] && warn "--gpu nvidia given but no NVIDIA GPU was found"
  return 0
}

recommend_model() {
  if [[ -n "$MODEL" ]]; then return; fi
  local mem=$VRAM_MB
  if [[ "$GPU_VENDOR" == "apple" ]]; then mem=$((RAM_MB * 2 / 3)); fi
  if [[ $mem -ge 20000 ]]; then MODEL="mistral-small:24b"
  elif [[ $mem -ge 12000 ]]; then MODEL="mistral-nemo:12b"
  elif [[ $mem -ge 7000 ]]; then MODEL="llama3.1:8b"
  elif [[ $RAM_MB -ge 12000 ]]; then MODEL="llama3.1:8b"
  else MODEL="llama3.2:3b"
  fi
}

need_root_for() {
  if [[ $EUID -ne 0 && -z "$SUDO" ]]; then
    die "$1 needs root. Re-run as root or install sudo."
  fi
}

pkg_install() {
  [[ $# -eq 0 ]] && return 0
  info "Installing packages: $*"
  case "$PKG" in
    apt) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq && $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null ;;
    dnf) $SUDO dnf install -y -q "$@" ;;
    pacman) $SUDO pacman -Sy --noconfirm --needed "$@" >/dev/null ;;
    apk) $SUDO apk add --no-cache "$@" >/dev/null ;;
    zypper) $SUDO zypper -q install -y "$@" ;;
    brew) brew install "$@" ;;
    *) die "No supported package manager found; install manually: $*" ;;
  esac
}

ensure_cmd() {
  # ensure_cmd <command> [package-name]
  local cmd="$1" pkg="${2:-$1}"
  command -v "$cmd" >/dev/null || pkg_install "$pkg"
}

ensure_brew() {
  if [[ "$OS" == "macos" ]] && ! command -v brew >/dev/null; then
    die "Homebrew is required on macOS: https://brew.sh (then re-run this installer)"
  fi
}

# ----------------------------------------------------------------------------- state
STATE_FILE=""
ENV_FILE=""
DATA_DIR=""

state_path() {
  # Root installs keep state in /etc; per-user installs in ~/.config.
  if [[ "$OS" == "macos" || $EUID -ne 0 ]] && [[ "$MODE" != "native" || "$OS" == "macos" ]]; then
    echo "${XDG_CONFIG_HOME:-$HOME/.config}/persona/install.conf"
  else
    echo "/etc/persona/install.conf"
  fi
}

load_state() {
  STATE_FILE="$(state_path)"
  if [[ -r "$STATE_FILE" ]]; then
    local k v
    while IFS='=' read -r k v; do
      case "$k" in
        MODE) [[ -z "$MODE" ]] && MODE="$v" ;;
        INSTALL_DIR) [[ -z "$INSTALL_DIR" ]] && INSTALL_DIR="$v" ;;
        ENV_FILE) ENV_FILE="$v" ;;
        DATA_DIR) DATA_DIR="$v" ;;
      esac
    done <"$STATE_FILE"
    return 0
  fi
  return 1
}

save_state() {
  local dir
  dir="$(dirname "$STATE_FILE")"
  if [[ "$STATE_FILE" == /etc/* ]]; then
    $SUDO mkdir -p "$dir"
    printf 'MODE=%s\nINSTALL_DIR=%s\nENV_FILE=%s\nDATA_DIR=%s\n' "$MODE" "$INSTALL_DIR" "$ENV_FILE" "$DATA_DIR" | $SUDO tee "$STATE_FILE" >/dev/null
  else
    mkdir -p "$dir"
    printf 'MODE=%s\nINSTALL_DIR=%s\nENV_FILE=%s\nDATA_DIR=%s\n' "$MODE" "$INSTALL_DIR" "$ENV_FILE" "$DATA_DIR" >"$STATE_FILE"
  fi
}

# ----------------------------------------------------------------------------- env file
gen_secret() {
  if command -v openssl >/dev/null; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Run a command with root if the file isn't ours.
_as_owner() {
  local f="$1"
  shift
  if [[ -e "$f" && ! -w "$f" ]] || [[ ! -e "$f" && ! -w "$(dirname "$f")" ]]; then
    $SUDO "$@"
  else
    "$@"
  fi
}

env_get() {
  local key="$1" file="${2:-$ENV_FILE}"
  [[ -e "$file" ]] || return 0
  _as_owner "$file" cat "$file" | sed -n "s/^${key}=//p" | tail -1
}

# env_set KEY VALUE [file]: update in place or append; never prints the value.
env_set() {
  local key="$1" value="$2" file="${3:-$ENV_FILE}"
  local tmp
  tmp="$(mktemp)"
  chmod 600 "$tmp"
  if [[ -e "$file" ]]; then
    _as_owner "$file" cat "$file" | grep -v "^${key}=" >"$tmp" || true
  fi
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  _as_owner "$file" cp "$tmp" "$file"
  rm -f "$tmp"
}

# env_default KEY VALUE: only set when missing (keeps user edits on re-run)
env_default() {
  local key="$1" value="$2" file="${3:-$ENV_FILE}"
  if [[ -z "$(env_get "$key" "$file")" ]]; then env_set "$key" "$value" "$file"; fi
}

# ----------------------------------------------------------------------------- questions
plan_install() {
  step "Persona.AI installer"
  info "System: ${C_B}${DISTRO:-$OS}${C_0} ${ARCH}, ${RAM_MB} MB RAM, GPU: ${C_B}${GPU_VENDOR}${C_0}$([[ $VRAM_MB -gt 0 ]] && echo " (${VRAM_MB} MB VRAM)")"

  if [[ -z "$MODE" ]]; then
    local def="docker"
    choose "How should Persona.AI run?" "$def" \
      "docker|Docker (recommended: isolated, easy updates)" \
      "native|Native (systemd/launchd services, no containers)"
    MODE="$REPLY"
  fi
  [[ "$MODE" == "docker" || "$MODE" == "native" ]] || die "Mode must be docker or native"

  if [[ -z "$INSTALL_DIR" ]]; then
    local def="/opt/persona"
    if [[ "$OS" == "macos" || ( $EUID -ne 0 && -z "$SUDO" ) ]]; then def="$HOME/persona"; fi
    ask "Install directory" "$def"
    INSTALL_DIR="$REPLY"
  fi

  if [[ -z "$DOMAIN" && $ASSUME_YES -eq 0 && $HAS_TTY -eq 1 ]]; then
    ask "Public domain for HTTPS (leave empty for local-only)" ""
    DOMAIN="$REPLY"
  fi
  if [[ -n "$DOMAIN" && -z "$ACME_EMAIL" ]]; then
    ask "Email for Let's Encrypt (optional)" ""
    ACME_EMAIL="$REPLY"
  fi

  if [[ -z "$LLM" ]]; then
    choose "Language model backend" "ollama" \
      "ollama|Ollama on this machine (installed for you)" \
      "external|An existing OpenAI-compatible server or cloud API" \
      "none|Decide later in the admin panel"
    LLM="$REPLY"
  fi
  if [[ "$LLM" == "ollama" ]]; then
    recommend_model
    ask "Model to download" "$MODEL"
    MODEL="$REPLY"
  elif [[ "$LLM" == "external" && -z "$LLM_URL" ]]; then
    ask "OpenAI-compatible base URL" "https://openrouter.ai/api/v1"
    LLM_URL="$REPLY"
    if [[ -z "${PERSONA_LLM_API_KEY:-}" ]]; then
      ask_secret "API key"
      PERSONA_LLM_API_KEY="$REPLY"
    fi
    ask "Model name" "${MODEL:-meta-llama/llama-3.1-70b-instruct}"
    MODEL="$REPLY"
  fi

  local gpu_ok=0
  [[ "$GPU_VENDOR" == "nvidia" || "$GPU_VENDOR" == "apple" ]] && gpu_ok=1
  if [[ -z "$IMAGE_GEN" ]]; then
    local def="none"
    [[ $gpu_ok -eq 1 && "$MODE" == "docker" && "$GPU_VENDOR" == "nvidia" ]] && def="comfyui"
    if confirm "Set up ComfyUI for avatar generation?$([[ $gpu_ok -eq 0 ]] && echo " (slow without a GPU)")" "$([[ $def == comfyui ]] && echo y || echo n)"; then
      IMAGE_GEN="comfyui"
    else
      IMAGE_GEN="none"
    fi
  fi
  if [[ "$IMAGE_GEN" == "comfyui" && -z "$DOWNLOAD_CHECKPOINT" ]]; then
    if confirm "Download a starter image model (DreamShaper 8, ~2 GB)?" "y"; then DOWNLOAD_CHECKPOINT="yes"; else DOWNLOAD_CHECKPOINT="no"; fi
  fi
  if [[ -z "$TTS" ]]; then
    if confirm "Enable local voices (Kokoro text to speech)?" "y"; then TTS="yes"; else TTS="no"; fi
  fi
  if [[ -z "$STT" ]]; then
    if confirm "Enable local speech recognition for voice input and calls (faster-whisper)?" "y"; then STT="yes"; else STT="no"; fi
  fi
  if [[ -z "$SEED" ]]; then
    if confirm "Add a few sample characters?" "y"; then SEED="yes"; else SEED="no"; fi
  fi

  step "Plan"
  info "Mode:        $MODE"
  info "Directory:   $INSTALL_DIR"
  info "Address:     $([[ -n "$DOMAIN" ]] && echo "https://$DOMAIN (Caddy)" || echo "http://$([[ $LAN -eq 1 ]] && echo 0.0.0.0 || echo 127.0.0.1):$PORT")"
  info "LLM:         $LLM${MODEL:+ ($MODEL)}"
  info "Avatars:     $IMAGE_GEN"
  info "Voices:      TTS=$TTS STT=$STT"
  confirm "Continue?" "y" || die "Cancelled"
}

# ----------------------------------------------------------------------------- docker mode
DOCKER=(docker)
COMPOSE=()

ensure_docker() {
  step "Docker"
  if ! command -v docker >/dev/null; then
    if [[ "$OS" == "macos" ]]; then
      ensure_brew
      confirm "Docker Desktop isn't installed. Install it with Homebrew?" "y" || die "Docker is required for --docker"
      brew install --cask docker
      open -a Docker || true
      info "Waiting for Docker Desktop to start (accept its prompts)…"
    else
      need_root_for "Installing Docker"
      case "$PKG" in
        apt | dnf)
          info "Installing Docker Engine with the official get.docker.com script"
          curl -fsSL https://get.docker.com | $SUDO sh >/dev/null
          ;;
        pacman) pkg_install docker docker-compose docker-buildx ;;
        apk) pkg_install docker docker-cli-compose ;;
        zypper) pkg_install docker docker-compose ;;
        *) die "Install Docker manually: https://docs.docker.com/engine/install/" ;;
      esac
      if command -v systemctl >/dev/null; then $SUDO systemctl enable --now docker >/dev/null 2>&1 || true
      elif command -v rc-update >/dev/null; then $SUDO rc-update add docker default >/dev/null; $SUDO service docker start >/dev/null || true
      fi
    fi
  fi

  local tries=0
  while ! docker info >/dev/null 2>&1; do
    if [[ -n "$SUDO" ]] && "$SUDO" docker info >/dev/null 2>&1; then
      DOCKER=("$SUDO" docker)
      break
    fi
    tries=$((tries + 1))
    [[ $tries -gt 60 ]] && die "Docker isn't running. Start it and re-run the installer."
    sleep 2
  done

  if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
    COMPOSE=("${DOCKER[@]}" compose)
  elif command -v docker-compose >/dev/null; then
    COMPOSE=(docker-compose)
    [[ "${DOCKER[0]}" != "docker" ]] && COMPOSE=("$SUDO" docker-compose)
  else
    case "$PKG" in
      apt) pkg_install docker-compose-plugin ;;
      dnf) pkg_install docker-compose-plugin ;;
      *) die "Docker Compose v2 is required: https://docs.docker.com/compose/install/" ;;
    esac
    COMPOSE=("${DOCKER[@]}" compose)
  fi
  ok "$("${DOCKER[@]}" --version)"

  if [[ "$GPU_VENDOR" == "nvidia" ]] && uses_gpu_services; then ensure_nvidia_toolkit; fi
}

uses_gpu_services() {
  [[ ( "$LLM" == "ollama" && "$OS" == "linux" ) || "$IMAGE_GEN" == "comfyui" || "$TTS" == "yes" || "$STT" == "yes" ]]
}

ensure_nvidia_toolkit() {
  if "${DOCKER[@]}" info 2>/dev/null | grep -qi 'runtimes.*nvidia'; then
    ok "NVIDIA container runtime available"
    return
  fi
  if "${DOCKER[@]}" --version 2>/dev/null | grep -qi podman; then
    if command -v nvidia-ctk >/dev/null && nvidia-ctk cdi list 2>/dev/null | grep -q nvidia.com/gpu; then
      ok "NVIDIA CDI devices available for podman"
    else
      warn "Podman needs CDI for GPUs: sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml"
    fi
    return
  fi
  if ! command -v nvidia-smi >/dev/null; then
    warn "No working NVIDIA driver; containers will run on CPU."
    GPU_VENDOR="none"
    return
  fi
  confirm "Install the NVIDIA Container Toolkit for GPU passthrough?" "y" || { GPU_VENDOR="none"; return; }
  if ! ( _install_nvidia_toolkit ); then
    warn "Couldn't install the NVIDIA Container Toolkit; containers will run on CPU."
    warn "Install it later (https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/) and re-run."
    GPU_VENDOR="none"
    return
  fi
  ok "NVIDIA Container Toolkit configured"
}

_install_nvidia_toolkit() {
  trap - ERR
  set -e
  need_root_for "Installing the NVIDIA Container Toolkit"
  case "$PKG" in
    apt)
      curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | $SUDO gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
      curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
        | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
        | $SUDO tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
      pkg_install nvidia-container-toolkit
      ;;
    dnf)
      curl -fsSL https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | $SUDO tee /etc/yum.repos.d/nvidia-container-toolkit.repo >/dev/null
      pkg_install nvidia-container-toolkit
      ;;
    pacman) pkg_install nvidia-container-toolkit ;;
    *) return 1 ;;
  esac
  $SUDO nvidia-ctk runtime configure --runtime=docker >/dev/null
  $SUDO systemctl restart docker
}

fetch_file() {
  # fetch_file <repo-relative path> <destination>
  local rel="$1" dest="$2"
  if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/$rel" ]]; then
    _as_owner "$dest" cp "$SCRIPT_DIR/$rel" "$dest"
  else
    local tmp
    tmp="$(mktemp)"
    curl -fsSL "$PERSONA_RAW/$rel" -o "$tmp" || die "Download failed: $PERSONA_RAW/$rel"
    _as_owner "$dest" cp "$tmp" "$dest"
    rm -f "$tmp"
  fi
}

ensure_dir() {
  local d="$1"
  if [[ -d "$d" ]]; then return; fi
  if mkdir -p "$d" 2>/dev/null; then return; fi
  need_root_for "Creating $d"
  $SUDO mkdir -p "$d"
  $SUDO chown "$(id -u):$(id -g)" "$d"
}

docker_install() {
  ensure_docker
  step "Writing configuration to $INSTALL_DIR"
  ensure_dir "$INSTALL_DIR"
  ENV_FILE="$INSTALL_DIR/.env"
  DATA_DIR="$INSTALL_DIR/data"
  mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/backups"
  # The container runs as uid 10001, which must own the data dir.
  if [[ "$OS" == "linux" ]]; then
    if "${DOCKER[@]}" --version 2>/dev/null | grep -qi podman && [[ $EUID -ne 0 ]]; then
      podman unshare chown -R 10001:10001 "$INSTALL_DIR/data"   # rootless podman
    else
      $SUDO chown -R 10001:10001 "$INSTALL_DIR/data" 2>/dev/null || chown -R 10001:10001 "$INSTALL_DIR/data" 2>/dev/null || warn "Couldn't chown $INSTALL_DIR/data to uid 10001"
    fi
  fi

  local f
  for f in docker-compose.yml docker-compose.nvidia.yml docker-compose.amd.yml; do
    fetch_file "deploy/$f" "$INSTALL_DIR/$f"
  done
  if [[ -n "$DOMAIN" ]]; then
    {
      [[ -n "$ACME_EMAIL" ]] && printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"
      cat <<'EOF'
{$DOMAIN} {
	encode zstd gzip
	reverse_proxy persona:8000
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
}
EOF
    } >"$INSTALL_DIR/Caddyfile"
    mkdir -p "$INSTALL_DIR/caddy/data" "$INSTALL_DIR/caddy/config"
  fi

  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  write_common_env

  # compose wiring
  local profiles="core"
  local files="docker-compose.yml"
  case "$GPU_VENDOR" in
    nvidia) files="$files:docker-compose.nvidia.yml" ;;
    amd) files="$files:docker-compose.amd.yml"; env_set OLLAMA_IMAGE "ollama/ollama:rocm" ;;
  esac
  [[ "$GPU_VENDOR" == "nvidia" || "$GPU_VENDOR" == "amd" ]] && profiles="$profiles,gpu"

  if [[ "$LLM" == "ollama" ]]; then
    if [[ "$OS" == "macos" ]]; then
      # Containers on macOS can't use the GPU; run Ollama natively (Metal) instead.
      install_ollama_native
      env_set LLM_BASE_URL "http://host.docker.internal:11434/v1"
    else
      profiles="$profiles,llm"
      env_set LLM_BASE_URL "http://ollama:11434/v1"
    fi
  fi
  if [[ "$IMAGE_GEN" == "comfyui" ]]; then
    profiles="$profiles,image-gen"
    env_set IMAGE_PROVIDER comfyui
    env_set IMAGE_BASE_URL "http://comfyui:8188"
    if [[ "$GPU_VENDOR" == "nvidia" ]]; then env_set COMFYUI_IMAGE "yanwk/comfyui-boot:cu126-slim"
    else env_set COMFYUI_IMAGE "yanwk/comfyui-boot:cpu"
    fi
    [[ "$DOWNLOAD_CHECKPOINT" == "yes" ]] && env_default IMAGE_MODEL "DreamShaper_8_pruned.safetensors"
    mkdir -p "$INSTALL_DIR/comfyui"
  fi
  if [[ "$TTS" == "yes" ]]; then
    profiles="$profiles,tts"
    env_set TTS_PROVIDER openai
    env_set TTS_BASE_URL "http://kokoro:8880/v1"
    if [[ "$GPU_VENDOR" == "nvidia" ]]; then env_set KOKORO_IMAGE "ghcr.io/remsky/kokoro-fastapi-gpu:latest"
    else env_set KOKORO_IMAGE "ghcr.io/remsky/kokoro-fastapi-cpu:latest"
    fi
  fi
  if [[ "$STT" == "yes" ]]; then
    profiles="$profiles,stt"
    env_set STT_PROVIDER openai
    env_set STT_BASE_URL "http://stt:8000/v1"
    env_default STT_MODEL "Systran/faster-whisper-small"
    if [[ "$GPU_VENDOR" == "nvidia" ]]; then env_set STT_IMAGE "ghcr.io/speaches-ai/speaches:latest-cuda"
    else env_set STT_IMAGE "ghcr.io/speaches-ai/speaches:latest-cpu"
    fi
    mkdir -p "$INSTALL_DIR/stt-cache"
  fi
  if [[ $REDIS -eq 1 ]]; then
    profiles="$profiles,redis"
    env_set REDIS_URL "redis://redis:6379/0"
  fi
  if [[ -n "$DOMAIN" ]]; then
    profiles="$profiles,proxy"
    env_set DOMAIN "$DOMAIN"
    env_set ACME_EMAIL "$ACME_EMAIL"
  fi
  env_set COMPOSE_PROFILES "$profiles"
  env_set COMPOSE_FILE "$files"
  env_set PORT "$PORT"
  env_set BIND_ADDR "$([[ $LAN -eq 1 && -z "$DOMAIN" ]] && echo 0.0.0.0 || echo 127.0.0.1)"
  env_default PERSONA_IMAGE "$PERSONA_IMAGE_DEFAULT"
  ok "Wrote docker-compose files and .env (secrets are in .env, mode 600)"

  step "Starting containers"
  cd "$INSTALL_DIR"
  if [[ $BUILD -eq 1 ]] || ! "${COMPOSE[@]}" pull --quiet persona 2>/dev/null; then
    [[ $BUILD -eq 0 ]] && warn "Couldn't pull $(env_get PERSONA_IMAGE); building from source instead."
    build_image_from_source
  fi
  "${COMPOSE[@]}" pull --quiet --ignore-buildable 2>/dev/null || "${COMPOSE[@]}" pull --quiet 2>/dev/null || true
  "${COMPOSE[@]}" up -d --remove-orphans
  wait_healthy "http://127.0.0.1:$PORT/api/v1/health"

  if [[ "$LLM" == "ollama" && "$OS" != "macos" && -n "$MODEL" ]]; then
    step "Downloading model $MODEL (this can take a while)"
    "${COMPOSE[@]}" exec -T ollama ollama pull "$MODEL" || warn "Model download failed; retry with: cd $INSTALL_DIR && docker compose exec ollama ollama pull $MODEL"
  fi
  if [[ "$IMAGE_GEN" == "comfyui" && "$DOWNLOAD_CHECKPOINT" == "yes" ]]; then
    download_checkpoint "$INSTALL_DIR/comfyui/ComfyUI/models/checkpoints" docker
  fi
  if [[ "$SEED" == "yes" ]]; then
    "${COMPOSE[@]}" exec -T persona persona seed-demo >/dev/null && ok "Sample characters added"
  fi
}

build_image_from_source() {
  step "Building the Persona.AI image from source"
  ensure_cmd git
  local src="$INSTALL_DIR/src"
  if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/deploy/Dockerfile" ]]; then
    src="$SCRIPT_DIR"
  elif [[ -d "$src/.git" ]]; then
    git -C "$src" fetch -q origin "$PERSONA_BRANCH" && git -C "$src" checkout -q -B "$PERSONA_BRANCH" "origin/$PERSONA_BRANCH"
  else
    git clone -q --depth 1 -b "$PERSONA_BRANCH" "$PERSONA_REPO" "$src"
  fi
  local tag="persona-server:local"
  local extras=""
  "${DOCKER[@]}" build -q -f "$src/deploy/Dockerfile" --build-arg EXTRAS="$extras" -t "$tag" "$src" >/dev/null
  env_set PERSONA_IMAGE "$tag"
  ok "Built $tag"
}

wait_healthy() {
  local url="$1" i
  info "Waiting for the server to come up…"
  for i in $(seq 1 90); do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then
      ok "Server is up"
      return 0
    fi
    sleep 2
  done
  warn "The server didn't answer at $url yet. Check logs: $([[ "$MODE" == docker ]] && echo "cd $INSTALL_DIR && docker compose logs persona" || echo "journalctl -u persona -n 50")"
}

# ----------------------------------------------------------------------------- shared env
write_common_env() {
  env_default SECRET_KEY "$(gen_secret)"
  env_default ENVIRONMENT production
  env_set EMBEDDED_WORKER false   # a dedicated worker service runs jobs
  env_set PUBLIC_URL "$([[ -n "$DOMAIN" ]] && echo "https://$DOMAIN" || echo "http://localhost:$PORT")"
  if [[ -n "$DOMAIN" ]]; then env_set CORS_ORIGINS "https://$DOMAIN"; fi
  case "$LLM" in
    ollama)
      env_set LLM_PROVIDER openai
      env_set LLM_MODEL "$MODEL"
      env_default LLM_CONTEXT_TOKENS 8192
      ;;
    external)
      env_set LLM_PROVIDER "$([[ "$LLM_URL" == *anthropic.com* ]] && echo anthropic || echo openai)"
      env_set LLM_BASE_URL "$LLM_URL"
      [[ -n "$MODEL" ]] && env_set LLM_MODEL "$MODEL"
      [[ -n "${PERSONA_LLM_API_KEY:-}" ]] && env_set LLM_API_KEY "$PERSONA_LLM_API_KEY"
      env_default LLM_CONTEXT_TOKENS 16384
      ;;
  esac
}

# ----------------------------------------------------------------------------- native mode
APP_USER="persona"

ensure_uv() {
  if command -v uv >/dev/null; then return; fi
  if [[ -x /usr/local/bin/uv ]]; then return; fi
  info "Installing uv (Python toolchain manager)"
  if [[ "$OS" == "macos" ]]; then
    brew install uv
  else
    curl -LsSf https://astral.sh/uv/install.sh | $SUDO env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh >/dev/null
  fi
}

uv_bin() { command -v uv 2>/dev/null || echo /usr/local/bin/uv; }

ensure_node() {
  # Node is only needed to build the web app. Use a private copy so system Node is untouched.
  local node_dir="$INSTALL_DIR/.node"
  if [[ -x "$node_dir/bin/node" ]]; then return; fi
  local os_tag arch_tag
  os_tag="$([[ "$OS" == macos ]] && echo darwin || echo linux)"
  arch_tag="$([[ "$ARCH" == arm64 ]] && echo arm64 || echo x64)"
  local url="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${os_tag}-${arch_tag}.tar.gz"
  info "Downloading Node.js ${NODE_VERSION} for the web build"
  _as_owner "$INSTALL_DIR" mkdir -p "$node_dir"
  curl -fsSL "$url" | _as_owner "$INSTALL_DIR" tar -xz -C "$node_dir" --strip-components=1
}

native_deps() {
  step "System packages"
  if [[ "$OS" == "macos" ]]; then
    ensure_brew
    local need=()
    for c in git ffmpeg; do command -v $c >/dev/null || need+=("$c"); done
    [[ ${#need[@]} -gt 0 ]] && pkg_install "${need[@]}"
  else
    need_root_for "A native install"
    case "$PKG" in
      apt) pkg_install git curl ca-certificates ffmpeg tar xz-utils ;;
      dnf) pkg_install git curl ca-certificates tar xz; pkg_install ffmpeg-free 2>/dev/null || warn "ffmpeg not installed (enable RPM Fusion for full ffmpeg)" ;;
      pacman) pkg_install git curl ca-certificates ffmpeg tar xz ;;
      apk) pkg_install git curl ca-certificates ffmpeg tar xz bash libstdc++ ;;
      zypper) pkg_install git curl ca-certificates ffmpeg tar xz ;;
    esac
  fi
  ensure_uv
  ok "Dependencies ready"
}

native_install() {
  native_deps
  local app="$INSTALL_DIR/app"

  if [[ "$OS" == "linux" ]]; then
    if ! id "$APP_USER" >/dev/null 2>&1; then
      info "Creating system user '$APP_USER'"
      if command -v useradd >/dev/null; then
        $SUDO useradd --system --home-dir /var/lib/persona --shell /usr/sbin/nologin "$APP_USER"
      else
        $SUDO adduser -S -D -H -h /var/lib/persona -s /sbin/nologin "$APP_USER"
      fi
    fi
    DATA_DIR="/var/lib/persona"
    ENV_FILE="/etc/persona/persona.env"
    $SUDO mkdir -p "$DATA_DIR" /etc/persona "$INSTALL_DIR"
    $SUDO chown "$APP_USER:" "$DATA_DIR"
    $SUDO chmod 750 "$DATA_DIR"
    $SUDO chown "$(id -u):$(id -g)" "$INSTALL_DIR"
  else
    DATA_DIR="$INSTALL_DIR/data"
    ENV_FILE="$INSTALL_DIR/persona.env"
    mkdir -p "$DATA_DIR" "$INSTALL_DIR"
  fi

  step "Getting the source"
  if [[ -d "$app/.git" ]]; then
    git -C "$app" fetch -q origin "$PERSONA_BRANCH"
    git -C "$app" checkout -q -B "$PERSONA_BRANCH" "origin/$PERSONA_BRANCH"
  elif [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/apps/server/pyproject.toml" && "$SCRIPT_DIR" != "$app" ]]; then
    info "Copying the local checkout"
    rm -rf "$app"
    mkdir -p "$app"
    (cd "$SCRIPT_DIR" && git ls-files -z | xargs -0 tar -cf - ) | tar -xf - -C "$app"
  else
    git clone -q --depth 1 -b "$PERSONA_BRANCH" "$PERSONA_REPO" "$app"
  fi
  ok "Source at $app"

  native_build "$app"

  step "Configuration"
  if [[ "$OS" == "linux" ]]; then
    $SUDO touch "$ENV_FILE"
    $SUDO chown "root:$APP_USER" "$ENV_FILE"
    $SUDO chmod 640 "$ENV_FILE"
  else
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  write_common_env
  env_set DATA_DIR "$DATA_DIR"
  env_set WEB_DIST "$app/apps/web/dist"
  env_set PORT "$PORT"
  env_set HOST "$([[ $LAN -eq 1 && -z "$DOMAIN" ]] && echo 0.0.0.0 || echo 127.0.0.1)"
  if [[ "$LLM" == "ollama" ]]; then
    install_ollama_native
    env_set LLM_BASE_URL "http://127.0.0.1:11434/v1"
  fi
  if [[ "$TTS" == "yes" ]]; then env_set TTS_PROVIDER kokoro; else env_default TTS_PROVIDER none; fi
  if [[ "$STT" == "yes" ]]; then
    env_set STT_PROVIDER faster-whisper
    env_set STT_DEVICE "$([[ "$GPU_VENDOR" == nvidia ]] && echo cuda || echo auto)"
  else
    env_default STT_PROVIDER none
  fi
  if [[ "$IMAGE_GEN" == "comfyui" ]]; then
    native_comfyui
    env_set IMAGE_PROVIDER comfyui
    env_set IMAGE_BASE_URL "http://127.0.0.1:8188"
    [[ "$DOWNLOAD_CHECKPOINT" == "yes" ]] && env_default IMAGE_MODEL "DreamShaper_8_pruned.safetensors"
  fi
  ok "Settings in $ENV_FILE (secrets are never printed)"

  step "Database"
  run_persona migrate >/dev/null
  ok "Migrations applied"
  [[ "$SEED" == "yes" ]] && run_persona seed-demo >/dev/null && ok "Sample characters added"

  step "Services"
  if [[ "$OS" == "linux" ]]; then
    install_systemd "$app"
  else
    install_launchd "$app"
  fi
  wait_healthy "http://127.0.0.1:$PORT/api/v1/health"
  [[ -n "$DOMAIN" ]] && native_caddy
  return 0
}

native_build() {
  local app="$1"
  step "Building"
  local extras=()
  [[ "$TTS" == "yes" ]] && extras+=(--extra tts)
  [[ "$STT" == "yes" ]] && extras+=(--extra stt)
  (cd "$app/apps/server" && UV_PYTHON_INSTALL_DIR="$INSTALL_DIR/.python" "$(uv_bin)" sync -q --frozen --no-dev --python 3.12 "${extras[@]}")
  ok "Python environment ready"
  ensure_node
  (
    cd "$app"
    export PATH="$INSTALL_DIR/.node/bin:$PATH"
    export COREPACK_HOME="$INSTALL_DIR/.node/corepack"
    corepack enable --install-directory "$INSTALL_DIR/.node/bin" pnpm >/dev/null 2>&1 || npm i -g pnpm >/dev/null
    pnpm install --frozen-lockfile --filter "@persona/web..." --silent
    pnpm --filter @persona/web build >/dev/null
  )
  ok "Web app built"
  if [[ "$OS" == "linux" ]]; then $SUDO chmod -R o+rX "$INSTALL_DIR"; fi
}

run_persona() {
  local app="$INSTALL_DIR/app/apps/server"
  # shellcheck disable=SC2016
  local loader='set -a; source "$1"; set +a; shift; exec "$@"'
  if [[ "$OS" == "linux" ]]; then
    if [[ $EUID -eq 0 ]]; then
      runuser -u "$APP_USER" -- bash -c "$loader" _ "$ENV_FILE" "$app/.venv/bin/persona" "$@"
    else
      $SUDO -u "$APP_USER" bash -c "$loader" _ "$ENV_FILE" "$app/.venv/bin/persona" "$@"
    fi
  else
    bash -c "$loader" _ "$ENV_FILE" "$app/.venv/bin/persona" "$@"
  fi
}

install_systemd() {
  local app="$1"
  command -v systemctl >/dev/null || die "systemd not found. On Alpine use --docker (OpenRC services aren't supported natively yet)."
  local venv="$app/apps/server/.venv/bin"
  local common="
User=$APP_USER
Group=$APP_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$DATA_DIR
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true"
  $SUDO tee /etc/systemd/system/persona.service >/dev/null <<EOF
[Unit]
Description=Persona.AI server
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$venv/persona serve
$common

[Install]
WantedBy=multi-user.target
EOF
  $SUDO tee /etc/systemd/system/persona-worker.service >/dev/null <<EOF
[Unit]
Description=Persona.AI background worker
After=persona.service
Wants=persona.service

[Service]
ExecStart=$venv/persona worker
$common

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable -q persona.service persona-worker.service
  $SUDO systemctl restart persona.service persona-worker.service
  ok "systemd services persona and persona-worker enabled"
}

install_launchd() {
  local app="$1"
  local agents="$HOME/Library/LaunchAgents"
  local venv="$app/apps/server/.venv/bin"
  mkdir -p "$agents" "$INSTALL_DIR/logs"
  local name cmd
  for name in server worker; do
    cmd="serve"
    [[ "$name" == "worker" ]] && cmd="worker"
    local plist="$agents/ai.persona.$name.plist"
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.persona.$name</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-c</string>
    <string>set -a; source "$ENV_FILE"; set +a; exec "$venv/persona" $cmd</string>
  </array>
  <key>WorkingDirectory</key><string>$DATA_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$INSTALL_DIR/logs/$name.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/logs/$name.log</string>
</dict>
</plist>
EOF
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load -w "$plist"
  done
  ok "launchd agents ai.persona.server and ai.persona.worker loaded"
}

install_ollama_native() {
  step "Ollama"
  if ! command -v ollama >/dev/null; then
    if [[ "$OS" == "macos" ]]; then
      ensure_brew
      brew install ollama
      brew services start ollama
    else
      info "Installing Ollama with the official script (https://ollama.com/install.sh)"
      curl -fsSL https://ollama.com/install.sh | $SUDO sh >/dev/null
    fi
  fi
  local i
  for i in $(seq 1 30); do
    curl -fsS -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    [[ $i -eq 1 && "$OS" == "macos" ]] && { brew services start ollama >/dev/null 2>&1 || true; }
    sleep 1
  done
  if [[ -n "$MODEL" ]]; then
    info "Downloading $MODEL (this can take a while)"
    ollama pull "$MODEL" || warn "Model download failed; retry with: ollama pull $MODEL"
  fi
  ok "Ollama ready"
}

native_comfyui() {
  step "ComfyUI"
  local dir="$INSTALL_DIR/comfyui"
  if [[ ! -d "$dir/.git" ]]; then
    git clone -q --depth 1 https://github.com/comfyanonymous/ComfyUI "$dir"
  fi
  local index="https://download.pytorch.org/whl/cpu"
  case "$GPU_VENDOR" in
    nvidia) index="https://download.pytorch.org/whl/cu126" ;;
    amd) index="https://download.pytorch.org/whl/rocm6.2" ;;
    apple) index="" ;;
  esac
  (
    cd "$dir"
    UV_PYTHON_INSTALL_DIR="$INSTALL_DIR/.python" "$(uv_bin)" venv -q --python 3.12 .venv
    if [[ -n "$index" ]]; then
      "$(uv_bin)" pip install -q --python .venv/bin/python torch torchvision torchaudio --index-url "$index"
    else
      "$(uv_bin)" pip install -q --python .venv/bin/python torch torchvision torchaudio
    fi
    "$(uv_bin)" pip install -q --python .venv/bin/python -r requirements.txt
  )
  [[ "$DOWNLOAD_CHECKPOINT" == "yes" ]] && download_checkpoint "$dir/models/checkpoints" native
  if [[ "$OS" == "linux" ]]; then
    $SUDO chown -R "$APP_USER:" "$dir/output" "$dir/input" "$dir/temp" 2>/dev/null || true
    $SUDO mkdir -p "$dir/output" "$dir/input" "$dir/temp" "$dir/user"
    $SUDO chown -R "$APP_USER:" "$dir/output" "$dir/input" "$dir/temp" "$dir/user"
    $SUDO tee /etc/systemd/system/persona-comfyui.service >/dev/null <<EOF
[Unit]
Description=ComfyUI for Persona.AI
After=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$dir
ExecStart=$dir/.venv/bin/python main.py --listen 127.0.0.1 --port 8188 $([[ "$GPU_VENDOR" == none ]] && echo --cpu)
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable -q --now persona-comfyui.service
  else
    local plist="$HOME/Library/LaunchAgents/ai.persona.comfyui.plist"
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.persona.comfyui</string>
  <key>ProgramArguments</key><array><string>$dir/.venv/bin/python</string><string>main.py</string><string>--listen</string><string>127.0.0.1</string><string>--port</string><string>8188</string></array>
  <key>WorkingDirectory</key><string>$dir</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$INSTALL_DIR/logs/comfyui.log</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/logs/comfyui.log</string>
</dict></plist>
EOF
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load -w "$plist"
  fi
  ok "ComfyUI running on 127.0.0.1:8188"
}

CHECKPOINT_URL="https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors"

download_checkpoint() {
  local dir="$1" how="$2" file="DreamShaper_8_pruned.safetensors"
  if [[ "$how" == "docker" ]]; then
    # The ComfyUI container installs itself into the volume on first start; wait for it.
    local i
    info "Waiting for ComfyUI's first-time setup"
    for i in $(seq 1 180); do
      [[ -d "$INSTALL_DIR/comfyui/ComfyUI/models" ]] && break
      sleep 5
    done
  fi
  _as_owner "$INSTALL_DIR" mkdir -p "$dir" 2>/dev/null || $SUDO mkdir -p "$dir"
  if [[ -s "$dir/$file" ]]; then ok "Image model already present"; return; fi
  info "Downloading $file (~2 GB, CreativeML Open RAIL-M license)"
  if curl -fL --progress-bar -o "$dir/$file.part" "$CHECKPOINT_URL" 2>/dev/null || $SUDO curl -fL --progress-bar -o "$dir/$file.part" "$CHECKPOINT_URL"; then
    _as_owner "$dir" mv "$dir/$file.part" "$dir/$file" || $SUDO mv "$dir/$file.part" "$dir/$file"
    ok "Image model ready"
  else
    warn "Checkpoint download failed; put any .safetensors checkpoint in $dir and set it in Admin → Providers."
  fi
}

native_caddy() {
  step "Caddy (HTTPS for $DOMAIN)"
  if ! command -v caddy >/dev/null; then
    case "$PKG" in
      apt)
        pkg_install debian-keyring debian-archive-keyring apt-transport-https gnupg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
        pkg_install caddy
        ;;
      *) pkg_install caddy ;;
    esac
  fi
  local conf="/etc/caddy/Caddyfile"
  [[ "$OS" == "macos" ]] && conf="$(brew --prefix)/etc/Caddyfile"
  local block
  block="$(
    [[ -n "$ACME_EMAIL" ]] && printf '{\n\temail %s\n}\n\n' "$ACME_EMAIL"
    printf '# managed by persona install.sh\n%s {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT"
  )"
  if [[ -f "$conf" ]] && ! grep -q "managed by persona" "$conf" && grep -qv '^\s*#' "$conf" 2>/dev/null && [[ -s "$conf" ]]; then
    $SUDO cp "$conf" "$conf.bak.$(date +%s)"
    warn "Existing Caddyfile backed up to $conf.bak.*"
  fi
  printf '%s\n' "$block" | $SUDO tee "$conf" >/dev/null
  if [[ "$OS" == "macos" ]]; then brew services restart caddy >/dev/null
  else $SUDO systemctl enable -q caddy; $SUDO systemctl reload-or-restart caddy
  fi
  ok "Caddy will fetch a certificate for $DOMAIN (DNS must point here, ports 80/443 open)"
}

# ----------------------------------------------------------------------------- summary
firewall_hints() {
  local ports=()
  if [[ -n "$DOMAIN" ]]; then ports=(80 443)
  elif [[ $LAN -eq 1 ]]; then ports=("$PORT")
  fi
  [[ ${#ports[@]} -eq 0 ]] && return
  step "Firewall"
  if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    local p
    for p in "${ports[@]}"; do info "sudo ufw allow $p/tcp"; done
    [[ -n "$DOMAIN" ]] && info "sudo ufw allow 443/udp   # HTTP/3"
  elif command -v firewall-cmd >/dev/null && $SUDO firewall-cmd --state >/dev/null 2>&1; then
    local p
    for p in "${ports[@]}"; do info "sudo firewall-cmd --permanent --add-port=$p/tcp"; done
    info "sudo firewall-cmd --reload"
  else
    info "Open TCP port(s) ${ports[*]} in your firewall / router if needed."
  fi
}

summary() {
  local url
  if [[ -n "$DOMAIN" ]]; then url="https://$DOMAIN"
  else url="http://localhost:$PORT"
  fi
  firewall_hints
  step "Done"
  printf '\n    %sPersona.AI is running at %s%s\n' "$C_B" "$url" "$C_0"
  printf '    Create the admin account: %s%s/register%s (the first account becomes admin)\n' "$C_C" "$url" "$C_0"
  if [[ -z "$DOMAIN" && $LAN -eq 0 ]]; then
    printf '\n    %sIt only listens on this machine (127.0.0.1).%s From another computer use an SSH tunnel:\n' "$C_DIM" "$C_0"
    printf '      ssh -L %s:127.0.0.1:%s %s@<this-server>\n' "$PORT" "$PORT" "${USER:-you}"
    printf '    or re-run with --domain your.domain for HTTPS.\n'
  fi
  printf '\n    Manage: %s update | backup | restore <file> | doctor | uninstall\n' "$0"
  printf '    Config: %s\n\n' "$ENV_FILE"
}

# ----------------------------------------------------------------------------- subcommands
require_install() {
  load_state || die "No Persona.AI installation found (looked for $(state_path))."
}

compose_here() {
  ensure_docker >/dev/null
  cd "$INSTALL_DIR"
}

cmd_update() {
  require_install
  step "Updating Persona.AI ($MODE)"
  if [[ "$MODE" == "docker" ]]; then
    compose_here
    if [[ "$(env_get PERSONA_IMAGE)" == "persona-server:local" ]]; then
      build_image_from_source
    fi
    "${COMPOSE[@]}" pull --quiet --ignore-buildable 2>/dev/null || "${COMPOSE[@]}" pull --quiet 2>/dev/null || true
    # Recreate the app containers so a rebuilt local tag is always picked up.
    "${COMPOSE[@]}" up -d --force-recreate --no-deps persona worker
    "${COMPOSE[@]}" up -d --remove-orphans
    PORT="$(env_get PORT)"
    wait_healthy "http://127.0.0.1:${PORT:-8000}/api/v1/health"
  else
    local app="$INSTALL_DIR/app"
    [[ -d "$app/.git" ]] || die "$app isn't a git checkout; re-run the installer to update."
    git -C "$app" fetch -q origin "$PERSONA_BRANCH"
    git -C "$app" checkout -q -B "$PERSONA_BRANCH" "origin/$PERSONA_BRANCH"
    TTS="$([[ "$(env_get TTS_PROVIDER)" == kokoro ]] && echo yes || echo no)"
    STT="$([[ "$(env_get STT_PROVIDER)" == faster-whisper ]] && echo yes || echo no)"
    native_build "$app"
    run_persona migrate >/dev/null
    if [[ "$OS" == "linux" ]]; then $SUDO systemctl restart persona persona-worker
    else launchctl kickstart -k "gui/$(id -u)/ai.persona.server"; launchctl kickstart -k "gui/$(id -u)/ai.persona.worker"
    fi
    PORT="$(env_get PORT)"
    wait_healthy "http://127.0.0.1:${PORT:-8000}/api/v1/health"
  fi
  ok "Updated"
}

cmd_backup() {
  require_install
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local out="${RESTORE_FILE:-}"
  step "Backup"
  if [[ "$MODE" == "docker" ]]; then
    compose_here
    out="${out:-$INSTALL_DIR/backups/persona-$stamp.tar.gz}"
    mkdir -p "$(dirname "$out")"
    local tmp
    tmp="$(mktemp -d)"
    # Stream the archive out of the container; bundle the compose .env (secrets) alongside.
    "${COMPOSE[@]}" exec -T persona persona backup --out - >"$tmp/app.tar.gz"
    tar -tzf "$tmp/app.tar.gz" persona-backup.json >/dev/null 2>&1 || die "Backup stream was corrupted"
    cp "$ENV_FILE" "$tmp/compose.env"
    (umask 077 && tar -czf "$out" -C "$tmp" app.tar.gz compose.env)
    rm -rf "$tmp"
  else
    out="${out:-$INSTALL_DIR/backups/persona-$stamp.tar.gz}"
    _as_owner "$INSTALL_DIR" mkdir -p "$(dirname "$out")"
    local tmpout="$DATA_DIR/backups/persona-$stamp.tar.gz"
    run_persona backup --out "$tmpout" --env-file "$ENV_FILE" >/dev/null
    $SUDO mv "$tmpout" "$out" 2>/dev/null || mv "$tmpout" "$out"
    $SUDO chown "$(id -u):$(id -g)" "$out" 2>/dev/null || true
  fi
  chmod 600 "$out"
  ok "Backup written to $out (contains secrets; store it safely)"
}

cmd_restore() {
  require_install
  [[ -n "$RESTORE_FILE" && -f "$RESTORE_FILE" ]] || die "Usage: install.sh restore <backup.tar.gz>"
  local file
  file="$(cd "$(dirname "$RESTORE_FILE")" && pwd)/$(basename "$RESTORE_FILE")"
  step "Restore from $file"
  confirm_danger "This replaces the current database and media. Continue?" || die "Cancelled (use --yes to skip this question)"
  if [[ "$MODE" == "docker" ]]; then
    compose_here
    local tmp
    tmp="$(mktemp -d)"
    tar -xzf "$file" -C "$tmp"
    [[ -f "$tmp/app.tar.gz" ]] || die "Not a docker-mode backup (app.tar.gz missing)"
    "${COMPOSE[@]}" stop worker persona >/dev/null
    "${COMPOSE[@]}" run --rm -T --no-deps persona persona restore - --yes <"$tmp/app.tar.gz"
    if [[ -f "$tmp/compose.env" ]] && confirm "Also restore the .env (secrets and settings) from the backup?" "y"; then
      cp "$tmp/compose.env" "$ENV_FILE"
      chmod 600 "$ENV_FILE"
    fi
    rm -rf "$tmp"
    "${COMPOSE[@]}" up -d
  else
    if [[ "$OS" == "linux" ]]; then $SUDO systemctl stop persona persona-worker
    else launchctl unload "$HOME/Library/LaunchAgents/ai.persona.server.plist" "$HOME/Library/LaunchAgents/ai.persona.worker.plist" 2>/dev/null || true
    fi
    local staged="$DATA_DIR/restore.tar.gz"
    $SUDO cp "$file" "$staged" 2>/dev/null || cp "$file" "$staged"
    [[ "$OS" == "linux" ]] && $SUDO chown "$APP_USER:" "$staged"
    run_persona restore "$staged" --yes
    $SUDO rm -f "$staged" 2>/dev/null || rm -f "$staged"
    if [[ "$OS" == "linux" ]]; then $SUDO systemctl start persona persona-worker
    else
      launchctl load -w "$HOME/Library/LaunchAgents/ai.persona.server.plist"
      launchctl load -w "$HOME/Library/LaunchAgents/ai.persona.worker.plist"
    fi
  fi
  ok "Restored"
}

cmd_uninstall() {
  require_install
  step "Uninstall Persona.AI ($MODE) from $INSTALL_DIR"
  confirm_danger "Stop and remove Persona.AI services?" || die "Cancelled (use --yes to skip this question)"
  if [[ "$MODE" == "docker" ]]; then
    compose_here
    "${COMPOSE[@]}" down --remove-orphans
  else
    if [[ "$OS" == "linux" ]]; then
      $SUDO systemctl disable --now persona persona-worker persona-comfyui 2>/dev/null || true
      $SUDO rm -f /etc/systemd/system/persona.service /etc/systemd/system/persona-worker.service /etc/systemd/system/persona-comfyui.service
      $SUDO systemctl daemon-reload
    else
      local p
      for p in server worker comfyui; do
        launchctl unload "$HOME/Library/LaunchAgents/ai.persona.$p.plist" 2>/dev/null || true
        rm -f "$HOME/Library/LaunchAgents/ai.persona.$p.plist"
      done
    fi
  fi
  ok "Services removed"
  if [[ $PURGE -eq 1 ]] && confirm_danger "Permanently delete ALL data, chats, media and backups in $INSTALL_DIR and $DATA_DIR?"; then
    if ! rm -rf "$INSTALL_DIR" 2>/dev/null; then
      if [[ "$MODE" == "docker" ]] && command -v podman >/dev/null && [[ $EUID -ne 0 ]]; then
        podman unshare rm -rf "$INSTALL_DIR"   # files owned by the rootless container user
      else
        $SUDO rm -rf "$INSTALL_DIR"
      fi
    fi
    if [[ "$MODE" == "native" && "$OS" == "linux" ]]; then $SUDO rm -rf "$DATA_DIR" /etc/persona; fi
    $SUDO rm -f "$STATE_FILE" 2>/dev/null || rm -f "$STATE_FILE"
    ok "All data deleted"
  else
    info "Data kept in $([[ "$MODE" == docker ]] && echo "$INSTALL_DIR/data" || echo "$DATA_DIR"). Use --purge to delete it."
  fi
  info "Ollama, Docker and Caddy were left installed."
}

cmd_doctor() {
  require_install
  step "Persona.AI doctor ($MODE, $INSTALL_DIR)"
  local port
  port="$(env_get PORT)"
  port="${port:-8000}"
  if [[ "$MODE" == "docker" ]]; then
    compose_here
    "${COMPOSE[@]}" ps
    echo
    "${COMPOSE[@]}" exec -T persona persona doctor || warn "Some checks failed"
  else
    if [[ "$OS" == "linux" ]]; then
      local s
      for s in persona persona-worker; do
        if systemctl is-active -q "$s"; then ok "$s is running"; else warn "$s is not running (journalctl -u $s -n 50)"; fi
      done
    else
      launchctl list | grep ai.persona || warn "launchd agents not loaded"
    fi
    run_persona doctor || warn "Some checks failed"
  fi
  if curl -fsS -m 3 "http://127.0.0.1:$port/api/v1/health" >/dev/null; then ok "HTTP health endpoint answers on port $port"
  else warn "Nothing answers on http://127.0.0.1:$port"
  fi
  local free
  free="$(df -Pk "$INSTALL_DIR" | awk 'NR==2 {print int($4/1048576)}')"
  if [[ ${free:-0} -lt 5 ]]; then warn "Low disk space: ${free} GB free"; else ok "Disk: ${free} GB free"; fi
}

cmd_status() {
  require_install
  if [[ "$MODE" == "docker" ]]; then
    compose_here
    "${COMPOSE[@]}" ps
  elif [[ "$OS" == "linux" ]]; then
    systemctl --no-pager status persona persona-worker | head -20
  else
    launchctl list | grep ai.persona
  fi
}

cmd_install() {
  load_state || true
  STATE_FILE="$(state_path)"
  plan_install
  if [[ "$MODE" == "docker" ]]; then docker_install; else native_install; fi
  save_state
  summary
}

main() {
  parse_args "$@"
  detect
  case "$COMMAND" in
    install) cmd_install ;;
    update | upgrade) cmd_update ;;
    backup) cmd_backup ;;
    restore) cmd_restore ;;
    uninstall | remove) cmd_uninstall ;;
    doctor | check) cmd_doctor ;;
    status) cmd_status ;;
    help) usage ;;
    *) die "Unknown command: $COMMAND (see --help)" ;;
  esac
}

main "$@"
