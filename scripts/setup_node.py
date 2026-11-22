"""Download a portable Node.js LTS toolchain into .tools/node (Windows).

No system-wide installation and no admin rights required.
Run: python scripts/setup_node.py
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / ".tools"
NODE_DIR = TOOLS / "node"
TMP_ROOT = Path(os.environ.get("TEMP", tempfile.gettempdir())) / "opencode"


def log(message: str) -> None:
    print(message, flush=True)


def main() -> int:
    if (NODE_DIR / "node.exe").exists():
        log(f"Node already present: {NODE_DIR / 'node.exe'}")
        return 0

    TOOLS.mkdir(parents=True, exist_ok=True)
    TMP_ROOT.mkdir(parents=True, exist_ok=True)

    log("Fetching Node.js release index...")
    with urllib.request.urlopen("https://nodejs.org/dist/index.json", timeout=60) as response:
        releases = json.load(response)

    release = next(
        item
        for item in releases
        if item.get("lts")
        and item.get("version", "").startswith("v")
        and "win-x64-zip" in item.get("files", [])
    )
    version = release["version"]
    archive_name = f"node-{version}-win-x64.zip"
    url = f"https://nodejs.org/dist/{version}/{archive_name}"
    archive_path = TMP_ROOT / archive_name

    log(f"Downloading Node.js {version} LTS...")
    urllib.request.urlretrieve(url, archive_path)
    log(f"Downloaded {archive_path.stat().st_size / 1_000_000:.1f} MB")

    extract_dir = TMP_ROOT / f"node-extract-{os.getpid()}"
    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    extract_dir.mkdir(parents=True)

    log("Extracting...")
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(extract_dir)

    node_exe = next(extract_dir.rglob("node.exe"), None)
    if node_exe is None:
        raise RuntimeError("node.exe not found in downloaded archive")
    source_dir = node_exe.parent

    if NODE_DIR.exists():
        shutil.rmtree(NODE_DIR)
    shutil.copytree(source_dir, NODE_DIR)

    shutil.rmtree(extract_dir, ignore_errors=True)
    try:
        archive_path.unlink()
    except OSError:
        pass

    log(f"Portable Node.js installed: {NODE_DIR / 'node.exe'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
