"""FastAPI application entry point."""

from __future__ import annotations

import logging
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .attachments import AttachmentError
from .config import CHAT_DIR, FRONTEND_DIST, THUMB_DIR, UPLOAD_DIR, ensure_dirs
from .gas_store import ChatNotFoundError, ChatValidationError
from .routers import assets, chats, llm, system, youtube
from .utils import InvalidNameError

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("local-ai-studio")


def _cleanup_old_files(folder: Path, max_age_seconds: int) -> None:
    if not folder.is_dir():
        return
    cutoff = time.time() - max_age_seconds
    for path in folder.iterdir():
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_dirs()
    _cleanup_old_files(UPLOAD_DIR, 7 * 24 * 3600)
    _cleanup_old_files(THUMB_DIR, 30 * 24 * 3600)
    logger.info("GAS chat folder: %s", CHAT_DIR)
    if not CHAT_DIR.is_dir():
        logger.warning("GAS chat folder does not exist: %s", CHAT_DIR)
    if FRONTEND_DIST.is_dir():
        logger.info("Serving frontend from %s", FRONTEND_DIST)
    yield


app = FastAPI(
    title="Local AI Studio",
    version="0.1.0",
    description="Local Google AI Studio-compatible chat workspace.",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ChatNotFoundError)
async def chat_not_found(_: Request, exc: ChatNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ChatValidationError)
async def chat_invalid(_: Request, exc: ChatValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(AttachmentError)
async def attachment_error(_: Request, exc: AttachmentError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(InvalidNameError)
async def name_error(_: Request, exc: InvalidNameError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


app.include_router(system.router)
app.include_router(chats.router)
app.include_router(assets.router)
app.include_router(llm.router)
app.include_router(youtube.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:

    @app.get("/", response_class=HTMLResponse)
    def dev_root() -> str:
        return """
        <!doctype html>
        <html lang="ru">
          <head><meta charset="utf-8"><title>Local AI Studio</title></head>
          <body style="font-family:system-ui;background:#0b1020;color:#e5e7eb;padding:40px">
            <h1>Local AI Studio API</h1>
            <p>Frontend ещё не собран. Для разработки запустите <code>npm run dev</code> в папке <code>frontend</code>.</p>
            <p><a style="color:#818cf8" href="/api/docs">OpenAPI docs</a> ·
               <a style="color:#818cf8" href="/api/chats">Chats API</a></p>
          </body>
        </html>
        """
