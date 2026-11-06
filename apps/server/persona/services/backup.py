"""Backups: a single .tar.gz with the database, media and (optionally) the env file.

SQLite uses the online backup API, so it is safe while the server is running.
Postgres uses pg_dump / psql when available.
"""

from __future__ import annotations

import io
import json
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from persona import __version__
from persona.core.config import get_settings

MANIFEST = "persona-backup.json"


def _sqlite_path() -> Path | None:
    url = get_settings().db_url
    if url.startswith("sqlite"):
        return Path(url.split("///", 1)[1])
    return None


def _pg_url() -> str:
    url = get_settings().db_url
    return url.replace("postgresql+asyncpg://", "postgresql://")


def create_backup(out: Path, env_file: Path | None = None) -> Path:
    s = get_settings()
    out.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "app": "persona",
        "version": __version__,
        "created_at": datetime.now(UTC).isoformat(),
        "database": "sqlite" if _sqlite_path() else "postgres",
        "includes_env": bool(env_file and env_file.exists()),
    }
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        with tarfile.open(out, "w:gz") as tar:
            data = json.dumps(manifest, indent=2).encode()
            info = tarfile.TarInfo(MANIFEST)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))

            src = _sqlite_path()
            if src is not None:
                if src.exists():
                    dump = tmpdir / "persona.db"
                    with sqlite3.connect(src) as a, sqlite3.connect(dump) as b:
                        a.backup(b)
                    tar.add(dump, arcname="db/persona.db")
            else:
                if not shutil.which("pg_dump"):
                    raise RuntimeError("pg_dump not found; install the PostgreSQL client tools")
                dump = tmpdir / "persona.sql"
                subprocess.run(  # noqa: S603
                    ["pg_dump", "--no-owner", "--file", str(dump), _pg_url()],  # noqa: S607
                    check=True,
                )
                tar.add(dump, arcname="db/persona.sql")

            media = s.media_dir
            if media.exists():
                tar.add(media, arcname="media")
            if env_file and env_file.exists():
                tar.add(env_file, arcname="config/persona.env")
    out.chmod(0o600)
    return out


def _safe_members(tar: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = []
    for m in tar.getmembers():
        p = Path(m.name)
        if p.is_absolute() or ".." in p.parts or m.issym() or m.islnk():
            raise RuntimeError(f"Refusing unsafe path in backup: {m.name}")
        members.append(m)
    return members


def restore_backup(archive: Path, env_target: Path | None = None) -> dict:
    s = get_settings()
    with tarfile.open(archive, "r:gz") as tar:
        members = _safe_members(tar)
        names = {m.name for m in members}
        if MANIFEST not in names:
            raise RuntimeError("Not a Persona.AI backup (manifest missing)")
        manifest = json.loads(tar.extractfile(MANIFEST).read())  # type: ignore[union-attr]
        with tempfile.TemporaryDirectory() as tmp:
            tar.extractall(tmp, members=members, filter="data")
            root = Path(tmp)
            if (root / "db/persona.db").exists():
                dest = _sqlite_path()
                if dest is None:
                    raise RuntimeError("Backup is SQLite but DATABASE_URL points to Postgres")
                dest.parent.mkdir(parents=True, exist_ok=True)
                with sqlite3.connect(root / "db/persona.db") as a, sqlite3.connect(dest) as b:
                    a.backup(b)
            elif (root / "db/persona.sql").exists():
                if not shutil.which("psql"):
                    raise RuntimeError("psql not found; install the PostgreSQL client tools")
                subprocess.run(  # noqa: S603
                    ["psql", "--quiet", "--file", str(root / "db/persona.sql"), _pg_url()],  # noqa: S607
                    check=True,
                )
            if (root / "media").exists():
                if s.media_dir.exists():
                    shutil.rmtree(s.media_dir)
                shutil.copytree(root / "media", s.media_dir)
            if env_target and (root / "config/persona.env").exists():
                shutil.copy2(root / "config/persona.env", env_target)
                env_target.chmod(0o600)
    return manifest
