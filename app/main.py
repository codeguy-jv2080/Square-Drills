from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import __version__
from app.database import Database


STATIC_DIR = Path(__file__).resolve().parent / "static"
ALLOWED_MODULES = {"square-drills"}
database = Database()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    database.initialize()
    yield


app = FastAPI(title="Square Drills", version=__version__, lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class StatePayload(BaseModel):
    payload: dict[str, Any]


class ThemeRequest(BaseModel):
    theme: Literal["light", "dark"]


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


def _validate_module(module_id: str) -> None:
    if module_id not in ALLOWED_MODULES:
        raise HTTPException(status_code=404, detail="Unknown module")


@app.get("/api/state/{module_id}")
def get_state(module_id: str) -> dict[str, Any]:
    _validate_module(module_id)
    return {"payload": database.get_module_state(module_id)}


@app.put("/api/state/{module_id}")
def put_state(module_id: str, state: StatePayload) -> dict[str, str]:
    _validate_module(module_id)
    return {"updated_at": database.set_module_state(module_id, state.payload)}


@app.delete("/api/state/{module_id}")
def delete_state(module_id: str) -> dict[str, bool]:
    _validate_module(module_id)
    return {"deleted": database.delete_module_state(module_id)}


@app.get("/api/settings/theme")
def get_theme() -> dict[str, str]:
    theme = database.get_setting("theme")
    return {"theme": "dark" if theme == "dark" else "light"}


@app.put("/api/settings/theme")
def put_theme(request: ThemeRequest) -> dict[str, str]:
    database.set_setting("theme", request.theme)
    return {"theme": request.theme}
