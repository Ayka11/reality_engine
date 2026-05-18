# Reality Engine — Scientific Solver Microservice
# Based on dolfinx/dolfinx for FEniCSx support.
# Fallback: if dolfinx is unavailable, all solvers use NumPy.

FROM dolfinx/dolfinx:stable

# Extra Python dependencies
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn[standard] \
    numpy \
    pydantic

# Optional: Elmer (if available in apt)
RUN apt-get update && \
    apt-get install -y --no-install-recommends elmer gromacs 2>/dev/null || true && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY .. .

EXPOSE 8765

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/status')"

CMD ["uvicorn", "reality_solver_api:app", \
     "--host", "0.0.0.0", "--port", "8765", \
     "--log-level", "info"]
