"""Run the Local AI Studio backend."""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import uvicorn  # noqa: E402


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.getenv("LOCAL_AI_STUDIO_HOST", "127.0.0.1"),
        port=int(os.getenv("LOCAL_AI_STUDIO_PORT", "8000")),
        reload=os.getenv("LOCAL_AI_STUDIO_RELOAD", "0") == "1",
        reload_dirs=[str(BACKEND_DIR / "app")] if os.getenv("LOCAL_AI_STUDIO_RELOAD") == "1" else None,
        access_log=False,
    )
