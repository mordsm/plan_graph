from __future__ import annotations

import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
ZIP_PATH = ROOT / "plan-graph-dist.zip"

FILES = ["index.html", "app.js", "styles.css", "README.md", "package.json"]
DIRS = ["config", "vendor", "examples", "schemas", "src", "docs"]


def copy_tree(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True)
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def build_docs_index() -> dict:
    docs = []
    for path in sorted(ROOT.rglob("*.md")):
        if DIST in path.parents:
            continue
        rel = path.relative_to(ROOT).as_posix()
        label = path.stem.replace("-", " ").replace("_", " ").strip().title()
        if path.name.lower() == "readme.md":
            label = "README"
        docs.append({"path": rel, "label": label})
    index = {
        "default_doc": "docs/project-overview.md",
        "docs": docs,
    }
    (ROOT / "docs" / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    return index


def build() -> dict:
    build_docs_index()
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True, exist_ok=True)

    for name in FILES:
        src = ROOT / name
        if src.exists():
            copy_tree(src, DIST / name)

    for name in DIRS:
        src = ROOT / name
        if src.exists():
            copy_tree(src, DIST / name)

    info = {
        "name": "plan-graph",
        "built_at_utc": datetime.now(timezone.utc).isoformat(),
        "output_dir": str(DIST),
        "entrypoint": "index.html",
        "files": FILES,
        "dirs": DIRS,
    }
    (DIST / "build-info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")

    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in DIST.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(DIST).as_posix())

    return info


if __name__ == "__main__":
    info = build()
    print(json.dumps(info, indent=2))
