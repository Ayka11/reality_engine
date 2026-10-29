/**
 * Reality Engine
 * Scientific Field Diagnostics
 *
 * Purpose:
 *   Calculate spatial gradients from the REAL simulation field.
 *
 * Important:
 *   These diagnostics are refinement indicators.
 *   They are NOT solver residuals.
 *
 * Supported:
 *   - 2D scalar fields
 *   - 3D SparseVoxelGrid fields
 *   - Float32Array simulation buffers
 */

export interface FieldDiagnostics {
  gradientRMS: number;
  gradientMax: number;
  fieldMin: number;
  fieldMax: number;
  validSamples: number;
}

/**
 * Compute diagnostics for a 2D scalar field.
 *
 * Layout:
 *
 *   index = y * width + x
 *
 * Central differences are used for interior cells.
 * Boundary cells are excluded from gradient statistics.
 */
export function computeFieldDiagnostics(
  field: number[] | Float32Array,
  width: number,
  height: number,
): FieldDiagnostics {
  if (
    width < 3 ||
    height < 3 ||
    field.length < width * height
  ) {
    return {
      gradientRMS: 0,
      gradientMax: 0,
      fieldMin: 0,
      fieldMax: 0,
      validSamples: 0,
    };
  }

  let sumSquaredGradient = 0;
  let gradientMax = 0;

  let fieldMin = Infinity;
  let fieldMax = -Infinity;

  let validSamples = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      const value = Number(field[index]);

      if (!Number.isFinite(value)) {
        continue;
      }

      fieldMin = Math.min(
        fieldMin,
        value,
      );

      fieldMax = Math.max(
        fieldMax,
        value,
      );

      // Boundary cells cannot use a
      // centered finite difference.
      if (
        x === 0 ||
        x === width - 1 ||
        y === 0 ||
        y === height - 1
      ) {
        continue;
      }

      const left = Number(
        field[y * width + (x - 1)],
      );

      const right = Number(
        field[y * width + (x + 1)],
      );

      const down = Number(
        field[(y - 1) * width + x],
      );

      const up = Number(
        field[(y + 1) * width + x],
      );

      if (
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        !Number.isFinite(down) ||
        !Number.isFinite(up)
      ) {
        continue;
      }

      const dx =
        0.5 * (right - left);

      const dy =
        0.5 * (up - down);

      const gradient =
        Math.hypot(dx, dy);

      sumSquaredGradient +=
        gradient * gradient;

      gradientMax = Math.max(
        gradientMax,
        gradient,
      );

      validSamples++;
    }
  }

  if (validSamples === 0) {
    return {
      gradientRMS: 0,
      gradientMax: 0,
      fieldMin: 0,
      fieldMax: 0,
      validSamples: 0,
    };
  }

  return {
    gradientRMS: Math.sqrt(
      sumSquaredGradient /
        validSamples,
    ),
    gradientMax,
    fieldMin,
    fieldMax,
    validSamples,
  };
}


/**
 * Compute diagnostics directly from the REAL
 * 3D Reality Engine simulation buffer.
 *
 * Buffer layout:
 *
 *   cellIndex =
 *     z * width * height +
 *     y * width +
 *     x
 *
 *   offset =
 *     cellIndex * cellFields +
 *     fieldIndex
 *
 * This matches the SparseVoxelGrid layout:
 *
 *   ((z * H * W) + (y * W) + x) * CELL_FIELDS
 *
 * Central differences are used for:
 *
 *   dF/dx
 *   dF/dy
 *   dF/dz
 *
 * The resulting spatial gradient is:
 *
 *   |grad F| =
 *     sqrt(
 *       dx² +
 *       dy² +
 *       dz²
 *     )
 *
 * Boundary cells are excluded.
 *
 * This function does NOT modify the simulation buffer.
 */
export function computeGridFieldDiagnostics(
  buffer: Float32Array,
  width: number,
  height: number,
  depth: number,
  cellFields: number,
  fieldIndex: number,
): FieldDiagnostics {
  /*
   * Validate dimensions.
   */
  if (
    width < 3 ||
    height < 3 ||
    depth < 3 ||
    cellFields <= 0 ||
    fieldIndex < 0 ||
    fieldIndex >= cellFields
  ) {
    return {
      gradientRMS: 0,
      gradientMax: 0,
      fieldMin: 0,
      fieldMax: 0,
      validSamples: 0,
    };
  }

  const expectedCells =
    width *
    height *
    depth;

  const expectedValues =
    expectedCells *
    cellFields;

  if (
    buffer.length < expectedValues
  ) {
    return {
      gradientRMS: 0,
      gradientMax: 0,
      fieldMin: 0,
      fieldMax: 0,
      validSamples: 0,
    };
  }

  let sumSquaredGradient = 0;
  let gradientMax = 0;

  let fieldMin = Infinity;
  let fieldMax = -Infinity;

  let validSamples = 0;

  /*
   * Helper for accessing one scalar field
   * value from the packed simulation buffer.
   */
  const getValue = (
    x: number,
    y: number,
    z: number,
  ): number => {
    const cellIndex =
      z * height * width +
      y * width +
      x;

    const offset =
      cellIndex *
        cellFields +
      fieldIndex;

    return Number(
      buffer[offset],
    );
  };

  /*
   * First determine field min/max over
   * the complete 3D field.
   */
  for (
    let z = 0;
    z < depth;
    z++
  ) {
    for (
      let y = 0;
      y < height;
      y++
    ) {
      for (
        let x = 0;
        x < width;
        x++
      ) {
        const value =
          getValue(x, y, z);

        if (
          !Number.isFinite(value)
        ) {
          continue;
        }

        fieldMin =
          Math.min(
            fieldMin,
            value,
          );

        fieldMax =
          Math.max(
            fieldMax,
            value,
          );
      }
    }
  }

  /*
   * Calculate 3D centered gradients.
   */
  for (
    let z = 1;
    z < depth - 1;
    z++
  ) {
    for (
      let y = 1;
      y < height - 1;
      y++
    ) {
      for (
        let x = 1;
        x < width - 1;
        x++
      ) {
        const left =
          getValue(
            x - 1,
            y,
            z,
          );

        const right =
          getValue(
            x + 1,
            y,
            z,
          );

        const down =
          getValue(
            x,
            y - 1,
            z,
          );

        const up =
          getValue(
            x,
            y + 1,
            z,
          );

        const back =
          getValue(
            x,
            y,
            z - 1,
          );

        const front =
          getValue(
            x,
            y,
            z + 1,
          );

        if (
          !Number.isFinite(left) ||
          !Number.isFinite(right) ||
          !Number.isFinite(down) ||
          !Number.isFinite(up) ||
          !Number.isFinite(back) ||
          !Number.isFinite(front)
        ) {
          continue;
        }

        /*
         * Central finite differences.
         *
         * Current Reality Engine grid spacing
         * is treated as one normalized cell.
         */
        const dx =
          0.5 *
          (right - left);

        const dy =
          0.5 *
          (up - down);

        const dz =
          0.5 *
          (front - back);

        /*
         * Full 3D spatial gradient magnitude.
         */
        const gradient =
          Math.hypot(
            dx,
            dy,
            dz,
          );

        sumSquaredGradient +=
          gradient *
          gradient;

        gradientMax =
          Math.max(
            gradientMax,
            gradient,
          );

        validSamples++;
      }
    }
  }

  if (
    validSamples === 0
  ) {
    return {
      gradientRMS: 0,
      gradientMax: 0,
      fieldMin:
        Number.isFinite(fieldMin)
          ? fieldMin
          : 0,
      fieldMax:
        Number.isFinite(fieldMax)
          ? fieldMax
          : 0,
      validSamples: 0,
    };
  }

  return {
    gradientRMS:
      Math.sqrt(
        sumSquaredGradient /
          validSamples,
      ),

    gradientMax,

    fieldMin:
      Number.isFinite(fieldMin)
        ? fieldMin
        : 0,

    fieldMax:
      Number.isFinite(fieldMax)
        ? fieldMax
        : 0,

    validSamples,
  };
}


/**
 * Convenience wrapper specifically for
 * a SparseVoxelGrid-like object.
 *
 * The object only needs:
 *
 *   buffer
 *   W
 *   H
 *   D
 *
 * This avoids coupling FieldDiagnostics
 * directly to SparseVoxelGrid.ts.
 */
export function computeSparseGridFieldDiagnostics(
  grid: {
    buffer: Float32Array;
    W: number;
    H: number;
    D: number;
  },
  cellFields: number,
  fieldIndex: number,
): FieldDiagnostics {
  return computeGridFieldDiagnostics(
    grid.buffer,
    grid.W,
    grid.H,
    grid.D,
    cellFields,
    fieldIndex,
  );
}