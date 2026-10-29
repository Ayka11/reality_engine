import { SimulationEngine } from '../simulation/SimulationEngine';
import { CELL_FIELDS } from '../core/CellState';

export class ScientificAPI {
  private sim: SimulationEngine;

  constructor(sim: SimulationEngine) {
    this.sim = sim;
  }

  exportNumPy(): string {
    const { grid, tick } = this.sim;
    const { W, H, D, buffer } = grid;
    const NF = CELL_FIELDS;
    return JSON.stringify({
      format: 'numpy_compatible',
      shape: [D, H, W, NF],
      dtype: 'float32',
      fields: {
        0: 'energy', 1: 'density', 2: 'information', 3: 'entropy',
        4: 'temperature', 11: 'bioPotential', 17: 'signal',
      },
      data: Array.from(buffer),
      tick,
      timestamp: new Date().toISOString(),
    });
  }

  exportJupyter(): string {
    const nb = {
      nbformat: 4, nbformat_minor: 5,
      metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
      cells: [
        {
          cell_type: 'markdown', metadata: {}, source: [
            `# Reality Engine v4 Analysis\n`,
            `Tick: ${this.sim.tick}  |  Grid: ${this.sim.grid.W}×${this.sim.grid.H}×${this.sim.grid.D}\n`,
          ],
        },
        {
          cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: [
            'import json, numpy as np, matplotlib.pyplot as plt\n',
            '# Load exported field data\n',
            "with open('reality_engine_data.json') as f:\n",
            "    d = json.load(f)\n",
            'field = np.array(d["data"], dtype=np.float32).reshape(d["shape"])\n',
            'energy = field[:,:,:,0]   # D×H×W energy grid\n',
            'entropy = field[:,:,:,3]\n',
            'info = field[:,:,:,2]\n',
            'bio = field[:,:,:,11]\n',
            'print(f\'Grid: {field.shape}, Total energy: {energy.sum():.0f}\')\n',
          ],
        },
        {
          cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: [
            '# Plot field slices at mid-altitude\n',
            'mid = energy.shape[0] // 2\n',
            'fig, axes = plt.subplots(1, 4, figsize=(18, 4))\n',
            'axes[0].imshow(energy[mid], cmap="plasma");  axes[0].set_title("Energy")\n',
            'axes[1].imshow(entropy[mid], cmap="hot");    axes[1].set_title("Entropy")\n',
            'axes[2].imshow(info[mid], cmap="viridis");   axes[2].set_title("Information")\n',
            'axes[3].imshow(bio[mid], cmap="YlGn");       axes[3].set_title("Bio Potential")\n',
            'plt.tight_layout(); plt.savefig("reality_fields.png", dpi=150); plt.show()\n',
          ],
        },
        {
          cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: [
            '# Correlation analysis\n',
            'e_f, s_f, i_f, b_f = energy.flatten(), entropy.flatten(), info.flatten(), bio.flatten()\n',
            'print(f"Energy–Entropy correlation: {np.corrcoef(e_f, s_f)[0,1]:.3f}")\n',
            'print(f"Energy–Info correlation:    {np.corrcoef(e_f, i_f)[0,1]:.3f}")\n',
            'print(f"Entropy–Info correlation:   {np.corrcoef(s_f, i_f)[0,1]:.3f}")\n',
            'print(f"Energy–Bio correlation:     {np.corrcoef(e_f, b_f)[0,1]:.3f}")\n',
          ],
        },
      ],
    };
    return JSON.stringify(nb, null, 2);
  }

  exportGraphML(): string {
    const events = this.sim.causal.recent(100);
    const lines = [
      '<?xml version="1.0"?>',
      '<graphml xmlns="http://graphml.graphdrawing.org/graphml">',
      '<graph id="causality" edgedefault="directed">',
      '<key id="delta" for="edge" attr.name="delta" attr.type="double"/>',
      '<key id="type"  for="node" attr.name="type"  attr.type="string"/>',
      '<key id="tick"  for="node" attr.name="tick"  attr.type="int"/>',
    ];
    for (const e of events) {
      lines.push(`  <node id="e${e.id}"><data key="tick">${e.tick}</data><data key="type">${e.type}</data></node>`);
    }
    for (const e of events) {
      if (e.parentId != null) {
        lines.push(`  <edge source="e${e.parentId}" target="e${e.id}"><data key="delta">${e.delta}</data></edge>`);
      }
    }
    lines.push('</graph></graphml>');
    return lines.join('\n');
  }

  private _download(data: string, name: string, type: string): void {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    a.click();
  }

  downloadAll(): string {
    const t = this.sim.tick;
    this._download(this.exportNumPy(),   `re_field_t${t}.json`,       'application/json');
    this._download(this.exportJupyter(), `re_analysis_t${t}.ipynb`,   'application/json');
    this._download(this.exportGraphML(), `re_causality_t${t}.graphml`, 'text/xml');
    return 'Exported 3 scientific files (JSON field data, Jupyter notebook, GraphML causality graph)';
  }

  downloadField(): string {
    const t = this.sim.tick;
    this._download(this.exportNumPy(), `re_field_t${t}.json`, 'application/json');
    return `Field snapshot exported (tick ${t})`;
  }

  downloadNotebook(): string {
    const t = this.sim.tick;
    this._download(this.exportJupyter(), `re_analysis_t${t}.ipynb`, 'application/json');
    return `Jupyter notebook exported (tick ${t})`;
  }

  downloadCausalGraph(): string {
    const t = this.sim.tick;
    this._download(this.exportGraphML(), `re_causality_t${t}.graphml`, 'text/xml');
    return `Causality graph exported (${this.sim.causal.recent(100).length} events)`;
  }
}
