from __future__ import annotations

import tarfile

import pytest

from persona.core.config import get_settings
from persona.services.backup import create_backup, restore_backup
from tests.conftest import make_character


async def test_backup_roundtrip(client, alice, tmp_path):
    c = await make_character(client, alice, name="Keep Me")
    media = get_settings().media_dir / "images" / "probe.txt"
    media.parent.mkdir(parents=True, exist_ok=True)
    media.write_text("hello")
    env = tmp_path / "persona.env"
    env.write_text("SECRET_KEY=abc\n")

    out = create_backup(tmp_path / "b.tar.gz", env)
    assert oct(out.stat().st_mode)[-3:] == "600"
    with tarfile.open(out) as t:
        names = t.getnames()
    assert "db/persona.db" in names and "config/persona.env" in names

    # mutate state, then restore
    await client.delete(f"/api/v1/characters/{c['id']}", headers=alice)
    media.unlink()
    target = tmp_path / "restored.env"
    manifest = restore_backup(out, target)
    assert manifest["app"] == "persona"
    assert media.read_text() == "hello"
    assert target.read_text() == "SECRET_KEY=abc\n"
    r = await client.get(f"/api/v1/characters/{c['id']}", headers=alice)
    assert r.status_code == 200 and r.json()["name"] == "Keep Me"


def test_restore_rejects_path_traversal(tmp_path):
    import io

    bad = tmp_path / "bad.tar.gz"
    with tarfile.open(bad, "w:gz") as t:
        for name, data in (("persona-backup.json", b"{}"), ("../evil", b"x")):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))
    with pytest.raises(RuntimeError, match="unsafe"):
        restore_backup(bad)
