from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

from src.config import doc_addr

KIND = "ametrine_personal_snapshot"


def _dir() -> Path:
    path = Path(doc_addr) / "snapshots"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _canon(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _name(tenant_id: int, tail: str) -> str:
    return f"personal-{tenant_id}-{tail[:12]}.zip"


def create(tenant_id: int, rows: list[dict], house: dict | None) -> dict:
    ledger = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True,
                   separators=(",", ":")) + "\n" for row in rows
    ).encode()
    tail = str(rows[-1].get("hash") or "") if rows else ""
    files: list[tuple[str, bytes]] = [("ledger.jsonl", ledger)]
    if house:
        files.append(("house.json", _canon(house)))
    manifest = {
        "v": 1, "kind": KIND, "tenant_id": tenant_id,
        "rows": len(rows), "tail": tail,
        "includes": [name for name, _ in files],
        "files": [{"path": name, "sha256": _sha(data), "bytes": len(data)}
                  for name, data in files],
        "note": "No wall clock; ledger remains append-only. Restore is a CLI "
                "operation, not an HTTP write.",
    }
    path = _dir() / _name(tenant_id, tail or "empty")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files:
            archive.writestr(name, data)
        archive.writestr("MANIFEST.json",
                         json.dumps(manifest, ensure_ascii=False, sort_keys=True,
                                    indent=2) + "\n")
    return {"name": path.name, "bytes": path.stat().st_size,
            "manifest": manifest}


def listing(tenant_id: int) -> list[dict]:
    pattern = f"personal-{tenant_id}-*.zip"
    return sorted(
        ({"name": path.name, "bytes": path.stat().st_size}
         for path in _dir().glob(pattern)),
        key=lambda item: item["name"], reverse=True,
    )


def path_for(tenant_id: int, name: str) -> Path | None:
    prefix = f"personal-{tenant_id}-"
    if not name.startswith(prefix) or not name.endswith(".zip") or "/" in name:
        return None
    path = _dir() / name
    return path if path.is_file() else None
