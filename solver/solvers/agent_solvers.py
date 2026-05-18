"""
agent_solvers.py — Multi-agent coordination and flow-field solvers.

Inspired by:
  LangChain    → chained reasoning steps (heuristic chain here)
  CrewAI       → role-based multi-agent delegation
  AutoGen      → agent debate/consensus (rule-based fallback)
  Haystack     → knowledge pipeline for agent memory

These run with NumPy only. If LangChain / CrewAI are installed the
  heavy-solver variants will use them instead.
"""

import numpy as np
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from reality_solver_api import register

try:
    from langchain.chains import LLMChain          # type: ignore
    from langchain.llms import OpenAI              # type: ignore
    HAS_LANGCHAIN = True
except ImportError:
    HAS_LANGCHAIN = False

try:
    from crewai import Agent as CrewAgent, Task, Crew  # type: ignore
    HAS_CREWAI = True
except ImportError:
    HAS_CREWAI = False


# ── helpers ────────────────────────────────────────────────────────────────

def _parse(req, key, W, H):
    raw = req.get(key, [])
    if len(raw) >= W * H:
        return np.array(raw[:W*H], dtype=float).reshape(H, W)
    return np.zeros((H, W))


# ── 1. Flow field (gradient-based optimal agent movement) ─────────────────
@register(
    "agent_flow_field",
    label="Agent Flow Field",
    desc="Computes per-cell optimal movement direction using potential field + entropy gradient",
    requires="Built-in NumPy",
    equation="F = ∇E + ∇I - ∇S — grad of (energy+info-entropy)",
)
def agent_flow_field(req: dict) -> dict:
    W, H = req["W"], req["H"]
    E = _parse(req, "energy_field",  W, H) / 1000.0
    I = _parse(req, "info_field",    W, H) / 500.0
    S = _parse(req, "entropy_field", W, H)

    # Potential = energy + info - entropy (higher = more attractive)
    P = E + I - S

    # Smooth potential to avoid jitter
    from scipy.ndimage import gaussian_filter
    try:
        P = gaussian_filter(P, sigma=1.5)
    except ImportError:
        # Manual 3×3 average blur as fallback
        kernel = np.ones((3,3))/9
        from numpy import pad
        Pp = pad(P, 1, mode='wrap')
        P_blur = np.zeros_like(P)
        for dy in range(3):
            for dx in range(3):
                P_blur += Pp[dy:H+dy, dx:W+dx] * kernel[dy, dx]
        P = P_blur

    gy, gx = np.gradient(P)

    # Normalise to unit vectors
    mag = np.sqrt(gx**2 + gy**2) + 1e-8
    vx  = gx / mag * 500
    vy  = gy / mag * 500

    # Attractiveness heatmap (for visualisation on FBio field)
    attr = np.clip((P - P.min()) / (P.max() - P.min() + 1e-8), 0, 1)

    return {
        "field_id":    5,    # FFX
        "field_vy_id": 6,    # FFY
        "vx":    vx.flatten().tolist(),
        "vy":    vy.flatten().tolist(),
        "field_bio_id": 10,
        "bio":   attr.flatten().tolist(),
        "solver": "NumPy Flow Field",
    }


# ── 2. Population density forecast (diffusion + birth/death) ──────────────
@register(
    "agent_population_forecast",
    label="Population Forecast",
    desc="Projects agent population dynamics from bio+entropy fields over N ticks",
    requires="Built-in NumPy",
    equation="∂ρ/∂t = D∇²ρ + r(E,S)ρ(1-ρ/K) — logistic reaction-diffusion",
)
def agent_population_forecast(req: dict) -> dict:
    W, H = req["W"], req["H"]
    E    = _parse(req, "energy_field",  W, H) / 1000.0
    S    = _parse(req, "entropy_field", W, H)
    Bio  = _parse(req, "bio_field",     W, H)
    steps = int(req.get("steps", 150))
    D     = float(req.get("D", 0.08))
    dt    = 0.5

    rho = Bio.copy()

    for _ in range(steps):
        lap = (np.roll(rho,1,0)+np.roll(rho,-1,0)+
               np.roll(rho,1,1)+np.roll(rho,-1,1) - 4*rho)
        r = E * (1 - S) * 1.2      # growth rate: high energy, low entropy
        rho += dt * (D * lap + r * rho * (1 - rho))
        rho  = np.clip(rho, 0, 1)

    return {
        "field_id": 10,  # FBio
        "values":   rho.flatten().tolist(),
        "solver": "NumPy Population Forecast",
        "params": {"steps": steps, "D": D},
    }


# ── 3. Multi-agent coordination (CrewAI-inspired role assignment) ──────────
@register(
    "multi_agent_coordination",
    label="Multi-Agent Coordination",
    desc="Assigns spatial roles (Scout/Harvester/Guardian) via utility maximisation — CrewAI pattern",
    requires="Built-in NumPy",
    equation="role(x,y) = argmax_r U_r(E,I,S,Bio)",
)
def multi_agent_coordination(req: dict) -> dict:
    W, H = req["W"], req["H"]
    E    = _parse(req, "energy_field",  W, H) / 1000.0
    I    = _parse(req, "info_field",    W, H) / 500.0
    S    = _parse(req, "entropy_field", W, H)
    Bio  = _parse(req, "bio_field",     W, H)

    # Utility maps per role
    # Scout     → prefers unexplored (low bio, low info) high-energy zones
    U_scout    = E * (1 - Bio) * (1 - I) * 0.7 + E * 0.3
    # Harvester → prefers high energy + low entropy
    U_harvest  = E * (1 - S)
    # Guardian  → prefers high entropy (needs defending)
    U_guardian = S * 0.8 + (1 - E) * 0.2
    # Architect → prefers high info potential (high energy + low entropy, low current info)
    U_arch     = E * (1 - S) * (1 - I) + Bio * 0.3
    # Breeder   → prefers high bio + moderate energy
    U_breeder  = Bio * (E + 0.1) * (1 - S)

    roles = np.stack([U_scout, U_harvest, U_guardian, U_arch, U_breeder], axis=0)
    role_map = roles.argmax(axis=0).astype(float) / 4.0  # normalise 0-1

    # Coordination heatmap written to FI field (info = "shared knowledge")
    # Each role's dominant zone adds info
    coord_info = (U_scout + U_arch + U_harvest) / 3
    coord_info = np.clip(coord_info * 400, 0, 499)

    return {
        "field_id":    9,    # FCid — civil id repurposed as role map
        "values":      (role_map * 9).flatten().tolist(),
        "field_info_id": 2,  # FI
        "info":        coord_info.flatten().tolist(),
        "roles": {"0": "Scout", "1": "Harvester", "2": "Guardian", "3": "Architect", "4": "Breeder"},
        "solver": "NumPy Multi-Agent Coordination",
        "requires_crewai": HAS_CREWAI,
    }


# ── 4. Evolutionary fitness landscape (Haystack-inspired knowledge map) ───
@register(
    "evolutionary_fitness_landscape",
    label="Evolutionary Fitness Landscape",
    desc="Fitness surface for agent evolution based on field gradients — Haystack knowledge pipeline",
    requires="Built-in NumPy",
    equation="F = w_E·E + w_I·I + w_B·Bio - w_S·S + κ|∇E|",
)
def evolutionary_fitness_landscape(req: dict) -> dict:
    W, H = req["W"], req["H"]
    E    = _parse(req, "energy_field",  W, H) / 1000.0
    I    = _parse(req, "info_field",    W, H) / 500.0
    S    = _parse(req, "entropy_field", W, H)
    Bio  = _parse(req, "bio_field",     W, H)

    w_E = float(req.get("w_energy",  1.0))
    w_I = float(req.get("w_info",    0.8))
    w_B = float(req.get("w_bio",     0.6))
    w_S = float(req.get("w_entropy", 0.9))

    # Gradient richness bonus: cells with steep energy gradients are information-rich
    dEx = np.gradient(E, axis=1)
    dEy = np.gradient(E, axis=0)
    grad_bonus = np.sqrt(dEx**2 + dEy**2) * 0.3

    fitness = w_E * E + w_I * I + w_B * Bio - w_S * S + grad_bonus
    fitness = np.clip(fitness, 0, None)
    mn, mx = fitness.min(), fitness.max()
    if mx > mn:
        fitness_norm = (fitness - mn) / (mx - mn)
    else:
        fitness_norm = fitness * 0

    return {
        "field_id": 10,  # FBio = fitness output
        "values":   fitness_norm.flatten().tolist(),
        "field_info_update": 2,
        "info":     (fitness * 300).flatten().tolist(),
        "solver": "NumPy Fitness Landscape",
        "params": {"w_E": w_E, "w_I": w_I, "w_B": w_B, "w_S": w_S},
    }
