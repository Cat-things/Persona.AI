"""Instance configuration loaded from environment / .env.

Runtime-editable provider settings live in the DB (see services/settings_store.py) and fall
back to these values.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env",), env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    # Core
    app_name: str = "Persona.AI"
    environment: str = "production"  # production | development | test
    secret_key: str = Field(default="change-me-dev-only", min_length=16)
    public_url: str = "http://localhost:8000"
    host: str = "127.0.0.1"
    port: int = 8000
    data_dir: Path = Path("./data")
    web_dist: Path | None = None  # directory with built web app to serve at /

    database_url: str = ""  # default: sqlite in data_dir
    redis_url: str = ""

    cors_origins: list[str] = Field(default_factory=list)
    invite_only: bool = False
    allow_registration: bool = True

    access_token_minutes: int = 15
    refresh_token_days: int = 30

    # Rate limits (requests per minute)
    rl_auth_per_min: int = 10
    rl_chat_per_min: int = 30
    rl_gen_per_min: int = 10

    # Uploads
    max_image_mb: int = 8
    max_audio_mb: int = 25

    # Default LLM (OpenAI-compatible)
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: str = ""
    llm_model: str = "llama3.1:8b"
    llm_context_tokens: int = 8192
    llm_max_response_tokens: int = 512
    llm_provider: str = "openai"  # openai | anthropic

    # Image generation
    image_provider: str = ""  # comfyui | a1111 | openai | fal | ""
    image_base_url: str = ""
    image_api_key: str = ""
    image_model: str = ""

    # TTS
    tts_provider: str = "kokoro"  # kokoro | piper | xtts | elevenlabs | none
    tts_base_url: str = ""
    tts_api_key: str = ""
    tts_model: str = ""
    kokoro_model_path: str = ""
    kokoro_voices_path: str = ""
    piper_binary: str = "piper"
    piper_voices_dir: str = ""

    # STT
    stt_provider: str = "faster-whisper"  # faster-whisper | openai | none
    stt_model: str = "small"
    stt_device: str = "auto"
    stt_base_url: str = ""
    stt_api_key: str = ""

    content_filter: bool = True
    # Process background jobs inside the API process too (claims are atomic, so running a
    # separate `persona worker` as well is safe). The installer turns this off.
    embedded_worker: bool = True

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json

                return json.loads(v)
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_test(self) -> bool:
        return self.environment == "test"

    @property
    def db_url(self) -> str:
        if self.database_url:
            url = self.database_url
            if url.startswith("postgres://"):
                url = "postgresql+asyncpg://" + url[len("postgres://") :]
            elif url.startswith("postgresql://"):
                url = "postgresql+asyncpg://" + url[len("postgresql://") :]
            return url
        return f"sqlite+aiosqlite:///{(self.data_dir / 'persona.db').resolve()}"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"


@lru_cache
def get_settings() -> Settings:
    return Settings()
