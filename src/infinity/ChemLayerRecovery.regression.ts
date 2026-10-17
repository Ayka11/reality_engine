import { ChemLayer, type ChemLayerSnapshot } from "../chemistry/ChemLayer";

export function runChemLayerRecoveryRegression(): void {
  const layer = new ChemLayer();
  const initial: ChemLayerSnapshot = {
    pendingDensityTransfers: [[7, -0.125], [19, 0.25]],
  };
  layer.restore(initial);

  const captured = layer.snapshot();
  if (captured.pendingDensityTransfers.length !== 2 ||
      captured.pendingDensityTransfers[0][0] !== 7 ||
      captured.pendingDensityTransfers[0][1] !== -0.125 ||
      captured.pendingDensityTransfers[1][0] !== 19 ||
      captured.pendingDensityTransfers[1][1] !== 0.25) {
    throw new Error("ChemLayer snapshot did not preserve pending density transfers");
  }

  captured.pendingDensityTransfers[0][1] = 99;
  if (layer.snapshot().pendingDensityTransfers[0][1] !== -0.125) {
    throw new Error("ChemLayer snapshot aliases the live pending transfer queue");
  }

  let rejected = false;
  try {
    layer.restore({ pendingDensityTransfers: [[3, Number.NaN]] });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("ChemLayer accepted a non-finite pending transfer");
  let boundsRejected = false;
  try {
    layer.restore({ pendingDensityTransfers: [[10, 0.5]] }, 10);
  } catch {
    boundsRejected = true;
  }
  if (!boundsRejected) throw new Error("ChemLayer accepted a transfer outside the grid bounds");

  const afterRejectedRestore = layer.snapshot();
  if (afterRejectedRestore.pendingDensityTransfers.length !== 2 ||
      afterRejectedRestore.pendingDensityTransfers[0][0] !== 7 ||
      afterRejectedRestore.pendingDensityTransfers[0][1] !== -0.125) {
    throw new Error("ChemLayer invalid restore changed the existing pending transfer queue");
  }
}
