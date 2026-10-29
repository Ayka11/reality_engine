"""
Reality Engine — Scientific Solver Microservice
================================================
Run:  uvicorn reality_solver_api:app --port 8765 --reload
Or:   docker-compose up  (see docker/docker-compose.yml)

Connects to the Reality Engine browser app at localhost:5173 via HTTP + WebSocket.
Every solver has a NumPy fallback — no heavy install required for basic use.
"""

from __future__ import annotations
import asyncio, json, importlib, logging, os
from typing import Any, Callable, Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger("solver")

app = FastAPI(title="Reality Engine Solver API", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# ── Solver registry ────────────────────────────────────────────────────────────
SOLVERS: Dict[str, Callable] = {}
SOLVER_META: Dict[str, Dict] = {}

def register(name: str, label: str = "", desc: str = "", requires: str = "built-in", equation: str = ""):
    """Decorator: register a solver function."""
    def decorator(fn: Callable):
        SOLVERS[name] = fn
        SOLVER_META[name] = {"label": label, "desc": desc, "requires": requires, "equation": equation}
        return fn
    return decorator


# ── Load solver modules ────────────────────────────────────────────────────────
def _load_modules():
    for mod_name in ["numpy_fallbacks", "fenics_solvers", "moose_solvers", "elmer_solvers", "gromacs_solvers"]:
        try:
            importlib.import_module(f"solvers.{mod_name}")
            log.info(f"  ✓ loaded {mod_name}")
        except ImportError as e:
            log.warning(f"  ✗ {mod_name} skipped ({e})")
        except Exception as e:
            log.error(f"  ✗ {mod_name} error: {e}")

_load_modules()


# ── Capability checks ──────────────────────────────────────────────────────────
def _has_fenics() -> bool:
    try: import dolfinx; return True        # noqa: F401
    except ImportError: return False

def _has_mfem() -> bool:
    try: import mfem.ser; return True       # noqa: F401
    except ImportError: return False

def _has_elmer() -> bool:
    import subprocess
    try:
        r = subprocess.run(["ElmerSolver", "--version"], capture_output=True, timeout=3)
        return r.returncode == 0
    except Exception:
        return False

def _has_moose() -> bool:
    return bool(os.environ.get("MOOSE_DIR")) and os.path.isdir(os.environ.get("MOOSE_DIR", ""))

def _has_gromacs() -> bool:
    import subprocess
    try:
        r = subprocess.run(["gmx", "--version"], capture_output=True, timeout=3)
        return r.returncode == 0
    except Exception:
        return False


# ── REST endpoints ─────────────────────────────────────────────────────────────
@app.get("/status")
async def status():
    return {
        "status": "ok",
        "solvers": {name: SOLVER_META[name] for name in SOLVERS},
        "capabilities": {
            "fenics":  _has_fenics(),
            "mfem":    _has_mfem(),
            "elmer":   _has_elmer(),
            "moose":   _has_moose(),
            "gromacs": _has_gromacs(),
            "numpy":   True,
        },
    }


class SolveRequest(BaseModel):
    solver: str
    W: int = 36
    H: int = 28
    D: int = 1
    NF: int = 12
    # Optional field arrays (len = W*H)
    energy_field:  list[float] = []
    density_field: list[float] = []
    info_field:    list[float] = []
    entropy_field: list[float] = []
    temp_field:    list[float] = []
    bio_field:     list[float] = []
    # Extra params passed through
    model_config = {"extra": "allow"}

    def extra(self) -> dict:
        d = self.model_dump(exclude={"solver","W","H","D","NF",
            "energy_field","density_field","info_field","entropy_field","temp_field","bio_field"})
        return d


@app.post("/solve")
async def solve(req: SolveRequest):
    if req.solver not in SOLVERS:
        return {"error": f"Unknown solver '{req.solver}'", "available": list(SOLVERS.keys())}
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, SOLVERS[req.solver], req.model_dump(mode="python"))
        return {"ok": True, "solver": req.solver, **result,
                "equation": SOLVER_META[req.solver].get("equation", "")}
    except Exception as e:
        log.exception(f"Solver '{req.solver}' failed")
        return {"ok": False, "error": str(e), "solver": req.solver}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    """WebSocket for streaming progress updates during long solves."""
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            solver_name = data.get("solver", "")
            if solver_name not in SOLVERS:
                await ws.send_json({"error": f"Unknown: {solver_name}"})
                continue
            await ws.send_json({"status": "computing", "solver": solver_name})
            try:
                loop = asyncio.get_event_loop()
                result = await loop.run_in_executor(None, SOLVERS[solver_name], data)
                await ws.send_json({"status": "done", "solver": solver_name, **result,
                                    "equation": SOLVER_META.get(solver_name, {}).get("equation", "")})
            except Exception as e:
                await ws.send_json({"status": "error", "error": str(e)})
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("reality_solver_api:app", host="0.0.0.0", port=8765, reload=True)
