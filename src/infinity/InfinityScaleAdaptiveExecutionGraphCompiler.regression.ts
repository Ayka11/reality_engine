import { InfinityScaleAdaptiveTransferCompiler } from "./InfinityScaleAdaptiveTransferCompiler";
import { InfinityScaleAdaptiveExecutionGraphCompiler } from "./InfinityScaleAdaptiveExecutionGraphCompiler";

export function runInfinityScaleAdaptiveExecutionGraphCompilerRegression(): void {
  const transferCompiler = new InfinityScaleAdaptiveTransferCompiler();
  const graphCompiler = new InfinityScaleAdaptiveExecutionGraphCompiler();

  const plan = transferCompiler.compile([
    { regionId: "B", fromLOD: 2, toLOD: 1 },
    { regionId: "A", fromLOD: 1, toLOD: 2 },
  ]);

  const graph = graphCompiler.compile(plan);

  if (!graph.valid) throw new Error("Compiled execution graph is invalid");
  if (graph.nodes.length !== 5) throw new Error("Unexpected execution graph size");
  if (graph.roots.length !== 1) throw new Error("Expected a single execution root");
  if (graph.nodes[0].type !== "TOPOLOGY_TRANSFER") {
    throw new Error("Execution graph did not start with topology transfer");
  }
  if (graph.nodes[2].type !== "CONSERVATION_VALIDATION") {
    throw new Error("Missing conservation validation barrier");
  }
  if (graph.nodes[3].type !== "GPU_EXECUTION") {
    throw new Error("Missing GPU execution node");
  }
  if (graph.nodes[4].type !== "COMMIT_BARRIER") {
    throw new Error("Missing commit barrier");
  }
  if (graph.terminalNodeId !== "commit:barrier") {
    throw new Error("Incorrect terminal commit node");
  }
  if (!graph.graphHash) throw new Error("Missing deterministic graph hash");

  const replayPlan = transferCompiler.compile([
    { regionId: "A", fromLOD: 1, toLOD: 2 },
    { regionId: "B", fromLOD: 2, toLOD: 1 },
  ]);
  const replayGraph = graphCompiler.compile(replayPlan);
  if (replayGraph.graphHash !== graph.graphHash) {
    throw new Error("Execution graph hash is not deterministic");
  }

  const noopPlan = transferCompiler.compile([
    { regionId: "A", fromLOD: 1, toLOD: 1 },
  ]);
  const noopGraph = graphCompiler.compile(noopPlan);
  if (!noopGraph.valid) throw new Error("No-op execution graph is invalid");
  if (noopGraph.nodes[0].type !== "CONSERVATION_VALIDATION") {
    throw new Error("No-op plan should not create transfer nodes");
  }
}
