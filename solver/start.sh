#!/usr/bin/env bash
# Reality Engine — Solver microservice launcher
# Run from the repo root: bash solver/start.sh

cd "$(dirname "$0")"

echo "🔬 Reality Engine Scientific Solver"
echo "====================================="
echo "Checking Python..."
python3 --version || { echo "Python 3 required"; exit 1; }

echo "Installing/checking dependencies..."
pip install fastapi "uvicorn[standard]" numpy pydantic -q

echo ""
echo "Checking optional solvers:"
python3 -c "import dolfinx; print('  ✓ FEniCSx')"       2>/dev/null || echo "  ✗ FEniCSx   (install: conda install -c conda-forge fenics-dolfinx)"
python3 -c "import mfem.ser; print('  ✓ MFEM')"          2>/dev/null || echo "  ✗ MFEM      (install: pip install mfem)"
ElmerSolver --version >/dev/null 2>&1  && echo "  ✓ Elmer"    || echo "  ✗ Elmer     (install: apt install elmer)"
gmx --version >/dev/null 2>&1          && echo "  ✓ GROMACS"  || echo "  ✗ GROMACS   (install: apt install gromacs)"
[ -n "$MOOSE_DIR" ]                    && echo "  ✓ MOOSE"    || echo "  ✗ MOOSE     (set MOOSE_DIR env var)"

echo ""
echo "All built-in (NumPy) solvers available regardless of above."
echo ""
echo "Starting microservice on http://localhost:8765 ..."
echo "API docs:  http://localhost:8765/docs"
echo ""
uvicorn reality_solver_api:app --host 0.0.0.0 --port 8765 --reload
