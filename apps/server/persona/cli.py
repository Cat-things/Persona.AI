"""`persona` command line: serve, worker, migrate, create-admin, doctor."""

from __future__ import annotations

import asyncio
import getpass
import json
import shutil
import sys
from pathlib import Path

import typer

app = typer.Typer(add_completion=False, help="Persona.AI server tools")
SERVER_DIR = Path(__file__).resolve().parent


def _alembic_config():
    from alembic.config import Config

    from persona.core.config import get_settings

    cfg = Config()
    cfg.set_main_option("script_location", str(SERVER_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", get_settings().db_url)
    return cfg


def run_migrations() -> None:
    from alembic import command

    from persona.core.config import get_settings

    get_settings().data_dir.mkdir(parents=True, exist_ok=True)
    command.upgrade(_alembic_config(), "head")


@app.command()
def migrate() -> None:
    """Apply database migrations."""
    run_migrations()
    typer.echo("Database is up to date.")


@app.command()
def makemigration(message: str) -> None:
    """(dev) Autogenerate a migration from model changes."""
    from alembic import command

    command.revision(_alembic_config(), message=message, autogenerate=True)


@app.command()
def serve(
    host: str = typer.Option(None, help="Bind address (default from HOST)"),
    port: int = typer.Option(None, help="Port (default from PORT)"),
    reload: bool = False,
    workers: int = 1,
) -> None:
    """Run the API + web server."""
    import uvicorn

    from persona.core.config import get_settings

    s = get_settings()
    run_migrations()
    uvicorn.run(
        "persona.main:app",
        host=host or s.host,
        port=port or s.port,
        reload=reload,
        workers=workers,
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1,::1,172.16.0.0/12,10.0.0.0/8",
        ws_max_size=4 * 1024 * 1024,
    )


@app.command()
def worker(concurrency: int = 2) -> None:
    """Run the background job worker (image generation, TTS pre-render, summaries)."""
    from persona.worker import run_worker

    run_migrations()
    asyncio.run(run_worker(concurrency=concurrency))


@app.command("create-admin")
def create_admin(
    username: str,
    password_stdin: bool = typer.Option(False, help="Read the password from stdin"),
) -> None:
    """Create (or promote) an admin account."""
    from sqlalchemy import func, select

    from persona.core.security import hash_password
    from persona.db import sessionmaker
    from persona.models import User

    pw = sys.stdin.readline().rstrip("\n") if password_stdin else getpass.getpass("Password: ")
    if len(pw) < 8:
        typer.echo("Password must be at least 8 characters.", err=True)
        raise typer.Exit(1)

    async def _go() -> str:
        run_migrations()
        async with sessionmaker()() as db:
            u = await db.scalar(select(User).where(func.lower(User.username) == username.lower()))
            if u:
                u.is_admin = True
                u.password_hash = hash_password(pw)
                verb = "Promoted"
            else:
                db.add(
                    User(
                        username=username,
                        password_hash=hash_password(pw),
                        display_name=username,
                        is_admin=True,
                    )
                )
                verb = "Created"
            await db.commit()
            return verb

    typer.echo(f"{asyncio.run(_go())} admin '{username}'.")


@app.command("export-training")
def export_training(
    out: Path = typer.Option(Path("training-data"), help="Output directory"),
    min_rating: int = typer.Option(3, min=1, max=4, help="Stars a reply needs to be learned from"),
    include_unrated: bool = typer.Option(False, help="Also learn from unrated replies"),
) -> None:
    """Export opted-in users' rated chats as fine-tuning data (sft.jsonl, dpo.jsonl)."""
    from persona.db import sessionmaker
    from persona.services.training import export

    async def _go():
        run_migrations()
        async with sessionmaker()() as db:
            return await export(db, out, min_rating=min_rating, include_unrated=include_unrated)

    st = asyncio.run(_go())
    typer.echo(
        f"{st.users} opted-in users, {st.chats_seen} chats seen -> "
        f"{st.sft_rows} SFT conversations ({st.trained_turns} learned replies), "
        f"{st.dpo_rows} preference pairs. Dropped: {st.dropped_filter} by the content filter, "
        f"{st.dropped_unrated} with no well-rated replies."
    )
    for n in st.notes:
        typer.echo(f"Note: {n}")
    typer.echo(f"Wrote {out}/sft.jsonl and {out}/dpo.jsonl")


@app.command("filter-jsonl")
def filter_jsonl(src: Path, dest: Path) -> None:
    """Run a public dataset (.jsonl, `messages` or ShareGPT) through the strict content filter."""
    import json

    from persona.services.training import filter_row

    kept = dropped = 0
    with src.open(encoding="utf-8") as fin, dest.open("w", encoding="utf-8") as fout:
        for line in fin:
            if not line.strip():
                continue
            try:
                row = filter_row(json.loads(line))
            except ValueError:
                row = None
            if row is None:
                dropped += 1
                continue
            fout.write(json.dumps(row, ensure_ascii=False) + "\n")
            kept += 1
    typer.echo(f"Kept {kept} conversations, dropped {dropped}. Wrote {dest}")


@app.command()
def backup(
    out: Path = typer.Option(None, help="Output .tar.gz (default: DATA_DIR/backups/<timestamp>)"),
    env_file: Path = typer.Option(None, help="Include this env file (contains secrets)"),
) -> None:
    """Back up the database and media (safe while running)."""
    from datetime import datetime

    from persona.core.config import get_settings
    from persona.services.backup import create_backup

    if str(out) == "-":  # stream to stdout (used by the installer through `docker compose exec`)
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = create_backup(Path(tmp) / "backup.tar.gz", env_file)
            with path.open("rb") as f:
                shutil.copyfileobj(f, sys.stdout.buffer)
            sys.stdout.buffer.flush()
        return
    if out is None:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        out = get_settings().data_dir / "backups" / f"persona-{stamp}.tar.gz"
    path = create_backup(out, env_file)
    typer.echo(str(path))


@app.command()
def restore(
    archive: Path,
    env_target: Path = typer.Option(None, help="Write the backed-up env file here"),
    yes: bool = typer.Option(False, "--yes", help="Don't ask for confirmation"),
) -> None:
    """Restore a backup. Stop the server first; current data is replaced."""
    from persona.services.backup import restore_backup

    if not yes and not typer.confirm("This replaces the current database and media. Continue?"):
        raise typer.Exit(1)
    if str(archive) == "-":  # read the archive from stdin
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            staged = Path(tmp) / "restore.tar.gz"
            with staged.open("wb") as f:
                shutil.copyfileobj(sys.stdin.buffer, f)
            manifest = restore_backup(staged, env_target)
    else:
        manifest = restore_backup(archive, env_target)
    run_migrations()
    typer.echo(f"Restored backup from {manifest.get('created_at')} (v{manifest.get('version')}).")


@app.command("seed-demo")
def seed_demo() -> None:
    """Add a few original sample characters (for trying the app out)."""
    from persona.services.seed import seed

    run_migrations()
    n = asyncio.run(seed())
    typer.echo(f"Added {n} sample characters." if n else "Sample characters already exist.")


@app.command()
def doctor(as_json: bool = typer.Option(False, "--json")) -> None:
    """Check database, providers and disk. Exit code 1 if something critical fails."""
    from persona.services.doctor import run_checks

    results = asyncio.run(run_checks())
    if as_json:
        typer.echo(json.dumps(results, indent=2))
    else:
        icons = {"ok": "✔", "warn": "!", "fail": "✘", "skip": "-"}
        for r in results:
            typer.echo(f" {icons[r['status']]} {r['name']:<16} {r['detail']}")
    if any(r["status"] == "fail" and r.get("critical") for r in results):
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
