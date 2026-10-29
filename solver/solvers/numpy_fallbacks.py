"""
numpy_fallbacks.py — Fast built-in solvers requiring only NumPy.

These run without any external installation. Every FEniCS/MOOSE/Elmer/GROMACS
solver also calls the matching fallback when the heavy library is unavailable.
"""

import numpy as np
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from reality_solver_api import register


def _laplacian(arr: np.ndarray) -> np.ndarray:
    return (np.roll(arr, 1, 0) + np.roll(arr, -1, 0) +
            np.roll(arr, 1, 1) + np.roll(arr, -1, 1) - 4 * arr)


def _parse_field(req: dict, key: str, W: int, H: int) -> np.ndarray:
    raw = req.get(key, [])
    if len(raw) >= W * H:
        return np.array(raw[:W * H], dtype=float).reshape(H, W)
    return np.zeros((H, W))


def _norm_out(arr: np.ndarray, scale: float) -> list[float]:
    mn, mx = arr.min(), arr.max()
    if mx > mn:
        return ((arr - mn) / (mx - mn) * scale).flatten().tolist()
    return (arr * 0).flatten().tolist()


# ── 1. Heat diffusion (steady-state Jacobi) ────────────────────────────────────
@register(
    "numpy_heat_diffusion",
    label="Heat Diffusion",
    desc="Steady-state heat equation solved with Jacobi iteration",
    requires="Built-in NumPy",
    equation="-∇·(k∇T) = f(energy)",
)
def numpy_heat_diffusion(req: dict) -> dict:
    W, H = req["W"], req["H"]
    E = _parse_field(req, "energy_field", W, H) / 1000.0
    k = float(req.get("conductivity", 1.0))
    T = np.zeros((H, W))
    for _ in range(500):
        T = (np.roll(T, 1, 0) + np.roll(T, -1, 0) +
             np.roll(T, 1, 1) + np.roll(T, -1, 1) + E * k) / 4.0
        T[[0, -1], :] = 0; T[:, [0, -1]] = 0   # Dirichlet BC
    return {
        "field_id": 4,  # FT = temperature
        "values": _norm_out(T, 800),
        "min": float(T.min()), "max": float(T.max()),
        "solver": "NumPy Jacobi Heat",
        "active_cells": int((T > 0.01).sum()),
    }


# ── 2. Gray-Scott reaction-diffusion (Turing patterns) ─────────────────────────
@register(
    "numpy_turing_patterns",
    label="Turing Patterns (Gray-Scott)",
    desc="Reaction-diffusion → spots, stripes, labyrinths",
    requires="Built-in NumPy",
    equation="∂u/∂t = Dᵤ∇²u - uv² + f(1-u)",
)
def numpy_turing_patterns(req: dict) -> dict:
    W, H = req["W"], req["H"]
    D_u   = float(req.get("D_u",   0.16))
    D_v   = float(req.get("D_v",   0.08))
    f     = float(req.get("f",     0.035))
    k     = float(req.get("k",     0.065))
    steps = int(req.get("steps",   800))
    dt    = 1.0

    u = 0.5 + 0.05 * np.random.rand(H, W)
    v = 0.25 + 0.05 * np.random.rand(H, W)
    # Seed from existing bio / info fields if provided
    bio  = _parse_field(req, "bio_field", W, H)
    info = _parse_field(req, "info_field", W, H) / 500.0
    u += bio * 0.3; v += info * 0.2
    u = np.clip(u, 0, 1); v = np.clip(v, 0, 1)

    for _ in range(steps):
        uvv = u * v * v
        u += dt * (D_u * _laplacian(u) - uvv + f * (1 - u))
        v += dt * (D_v * _laplacian(v) + uvv - (f + k) * v)
        u = np.clip(u, 0, 1); v = np.clip(v, 0, 1)

    return {
        "field_id_u": 2,   # FI  = information field
        "field_id_v": 10,  # FBio = bio potential
        "u_values":   (u * 500).flatten().tolist(),
        "v_values":   v.flatten().tolist(),
        "W": W, "H": H,
        "solver": "NumPy Gray-Scott",
        "params": {"D_u": D_u, "D_v": D_v, "f": f, "k": k, "steps": steps},
    }


# ── 3. Wave equation ───────────────────────────────────────────────────────────
@register(
    "numpy_wave_equation",
    label="Wave Propagation",
    desc="2D acoustic/EM wave equation from energy sources",
    requires="Built-in NumPy",
    equation="∂²u/∂t² = c²∇²u",
)
def numpy_wave_equation(req: dict) -> dict:
    W, H = req["W"], req["H"]
    c     = float(req.get("wave_speed", 1.0))
    steps = int(req.get("steps", 300))
    dt    = 0.08

    E = _parse_field(req, "energy_field", W, H) / 1000.0
    u = E.copy(); u_prev = E.copy()
    c2dt2 = (c * dt) ** 2

    for _ in range(steps):
        u_next = 2 * u - u_prev + c2dt2 * _laplacian(u)
        u_next = np.clip(u_next, -1, 1)
        u_prev, u = u, u_next

    result = (u + 1) / 2 * 600
    return {
        "field_id": 0,  # FE = energy field
        "values":   result.flatten().tolist(),
        "solver": "NumPy Wave Equation",
        "params": {"c": c, "steps": steps},
    }


# ── 4. Electric potential (Jacobi Laplace) ─────────────────────────────────────
@register(
    "numpy_electric_potential",
    label="Electric Potential",
    desc="Electrostatic potential from charged (info-field) regions",
    requires="Built-in NumPy",
    equation="∇²φ = -ρ/ε",
)
def numpy_electric_potential(req: dict) -> dict:
    W, H = req["W"], req["H"]
    rho = _parse_field(req, "info_field", W, H) / 500.0
    phi = np.zeros((H, W))
    for _ in range(600):
        phi = (np.roll(phi, 1, 0) + np.roll(phi, -1, 0) +
               np.roll(phi, 1, 1) + np.roll(phi, -1, 1) + rho) / 4.0
        phi[[0, -1], :] = 0; phi[:, [0, -1]] = 0
    return {
        "field_id": 2,  # FI = information field used as potential
        "values":   _norm_out(phi, 500),
        "solver": "NumPy Jacobi Laplace",
    }


# ── 5. 2D fluid flow (pressure-gradient Stokes) ────────────────────────────────
@register(
    "numpy_fluid_flow",
    label="Fluid Flow (Stokes)",
    desc="Incompressible 2D flow driven by energy-pressure gradient",
    requires="Built-in NumPy",
    equation="μ∇²u = ∇p,  ∇·u = 0",
)
def numpy_fluid_flow(req: dict) -> dict:
    W, H = req["W"], req["H"]
    E = _parse_field(req, "energy_field", W, H) / 1000.0
    viscosity = max(float(req.get("viscosity", 0.01)), 1e-4)

    # Pressure = energy; velocity from Darcy relation
    px = np.gradient(E, axis=1)
    py = np.gradient(E, axis=0)
    vx = -px / viscosity
    vy = -py / viscosity

    # Smooth with a few diffusion steps (viscous damping)
    for _ in range(30):
        vx += 0.1 * _laplacian(vx); vy += 0.1 * _laplacian(vy)

    speed = np.sqrt(vx ** 2 + vy ** 2)
    s_max = speed.max() + 1e-10

    return {
        "field_id": 5,    # FFX = flow X
        "field_vy_id": 6, # FFY = flow Y
        "vx":    (vx / s_max * 500).flatten().tolist(),
        "vy":    (vy / s_max * 500).flatten().tolist(),
        "speed": (speed / s_max).flatten().tolist(),
        "solver": "NumPy Stokes Flow",
    }


# ── 6. Cahn-Hilliard phase separation ─────────────────────────────────────────
@register(
    "numpy_phase_separation",
    label="Phase Separation (Cahn-Hilliard)",
    desc="Spinodal decomposition → two-phase patterns",
    requires="Built-in NumPy",
    equation="∂c/∂t = ∇·(M∇μ),  μ = f'(c) - κ∇²c",
)
def numpy_phase_separation(req: dict) -> dict:
    W, H = req["W"], req["H"]
    kappa = float(req.get("kappa", 0.001))
    M     = float(req.get("M", 1.0))
    steps = int(req.get("steps", 200))
    dt    = 0.01

    D = _parse_field(req, "density_field", W, H)
    c = np.clip(D + 0.05 * (np.random.rand(H, W) - 0.5), 0, 1)

    for _ in range(steps):
        mu = 2 * c * (1 - c) * (1 - 2 * c) - kappa * _laplacian(c)
        c += dt * M * _laplacian(mu)
        c = np.clip(c, 0, 1)

    return {
        "field_id": 1,  # FD = density
        "values":   c.flatten().tolist(),
        "solver": "NumPy Cahn-Hilliard",
        "params": {"kappa": kappa, "M": M, "steps": steps},
    }


# ── 7. Coupled heat + buoyancy flow ───────────────────────────────────────────
@register(
    "numpy_thermal_convection",
    label="Thermal Convection",
    desc="Buoyancy-driven convective heat transport",
    requires="Built-in NumPy",
    equation="∂T/∂t + u·∇T = κ∇²T,  u driven by ∇T",
)
def numpy_thermal_convection(req: dict) -> dict:
    W, H = req["W"], req["H"]
    E = _parse_field(req, "energy_field", W, H)
    k = float(req.get("conductivity", 0.5))

    T  = E / 1000.0 * 800
    vx = np.zeros((H, W)); vy = np.zeros((H, W))

    for _ in range(80):
        # Buoyancy: hot fluid rises (negative y)
        vy = -np.gradient(T, axis=0) * 0.008
        vx =  np.gradient(T, axis=1) * 0.008
        # Advect temperature
        T += 0.01 * (-vx * np.gradient(T, axis=1) - vy * np.gradient(T, axis=0))
        # Diffuse
        T += 0.005 * k * _laplacian(T)
        T = np.clip(T, 0, 2000)

    return {
        "field_id":    4,  # FT = temperature
        "field_vx_id": 5,  # FFX
        "field_vy_id": 6,  # FFY
        "values":    T.flatten().tolist(),
        "vx":        (vx * 500).flatten().tolist(),
        "vy":        (vy * 500).flatten().tolist(),
        "solver": "NumPy Thermal Convection",
    }


# ── 8. Langevin molecular dynamics ────────────────────────────────────────────
@register(
    "numpy_molecular_dynamics",
    label="Molecular Dynamics (Langevin)",
    desc="Particle simulation aggregated to density/energy fields",
    requires="Built-in NumPy",
    equation="mẍ = F_LJ - γẋ + √(2γkT)η",
)
def numpy_molecular_dynamics(req: dict) -> dict:
    W, H = req["W"], req["H"]
    n       = int(req.get("n_molecules", 300))
    T_K     = float(req.get("temperature_K", 300))
    steps   = int(req.get("steps", 2000))
    dt      = 0.004
    gamma   = 2.0
    kT      = T_K / 120.0  # reduced units

    rng = np.random.default_rng(42)
    pos = rng.uniform(0.05, 0.95, (n, 2))
    vel = rng.standard_normal((n, 2)) * np.sqrt(kT)

    # Simple LJ force (cutoff at 0.1)
    def lj_forces(p):
        F = np.zeros_like(p)
        for i in range(min(n, 80)):   # limit O(n²) for browser-usable speed
            dr = p[i] - p
            d  = np.linalg.norm(dr, axis=1, keepdims=True) + 1e-6
            mask = (d.flatten() < 0.12) & (d.flatten() > 1e-5)
            dr_m = dr[mask]; d_m = d[mask]
            f  = dr_m / d_m ** 2 * (1 / d_m ** 6 - 1 / d_m ** 12) * 24
            F[i] += f.sum(0)
        return F

    for step in range(steps):
        F   = lj_forces(pos) if step % 10 == 0 else np.zeros((n, 2))
        noise = rng.standard_normal((n, 2)) * np.sqrt(2 * gamma * kT / dt)
        vel  += dt * (F - gamma * vel + noise)
        pos   = (pos + dt * vel) % 1.0

    # Bin particles onto voxel grid
    density = np.zeros((H, W))
    kinetic = np.zeros((H, W))
    for i in range(n):
        gx = int(pos[i, 0] * W) % W
        gy = int(pos[i, 1] * H) % H
        density[gy, gx] += 1
        kinetic[gy, gx] += 0.5 * (vel[i, 0] ** 2 + vel[i, 1] ** 2)

    d_max = density.max() + 1e-10
    k_max = kinetic.max() + 1e-10

    return {
        "field_id":        0,   # FE = energy (kinetic)
        "field_density_id": 1,  # FD = density
        "values":          (kinetic / k_max * 600).flatten().tolist(),
        "density":         (density / d_max).flatten().tolist(),
        "solver": "NumPy Langevin MD",
        "params": {"n": n, "T_K": T_K, "steps": steps},
        "n_atoms": n,
    }


# ── 9. Entropy diffusion (entropy production field) ────────────────────────────
@register(
    "numpy_entropy_dynamics",
    label="Entropy Production",
    desc="Entropy generation and diffusion from energy gradients",
    requires="Built-in NumPy",
    equation="∂S/∂t = σ_irr + D_S∇²S,  σ = |∇E|²/kT",
)
def numpy_entropy_dynamics(req: dict) -> dict:
    W, H = req["W"], req["H"]
    E = _parse_field(req, "energy_field", W, H) / 1000.0
    T = _parse_field(req, "temp_field",   W, H) / 800.0
    T = np.clip(T, 0.01, 10)
    S = _parse_field(req, "entropy_field", W, H)

    dEx = np.gradient(E, axis=1); dEy = np.gradient(E, axis=0)
    sigma = (dEx ** 2 + dEy ** 2) / T   # irreversible entropy production

    for _ in range(100):
        S += 0.002 * (sigma + 0.3 * _laplacian(S))
        S  = np.clip(S, 0, 1)

    return {
        "field_id": 3,  # FS = entropy
        "values":   S.flatten().tolist(),
        "solver": "NumPy Entropy Dynamics",
    }
