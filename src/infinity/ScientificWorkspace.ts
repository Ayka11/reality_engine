export type ScientificWorkspaceState = {
  open: boolean
  workflow: any
}

const state: ScientificWorkspaceState = { open: false, workflow: null }
const win = () => window as any
const esc = (v: unknown) => String(v ?? '').replace(/[&<>\\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\\"':'&quot;', "'":'&#39;' } as Record<string,string>)[c] || c)

function stage(ok: boolean, label: string) {
  return '<div style="padding:7px 9px;border:1px solid ' + (ok ? '#245b4b' : '#29283a') + ';border-radius:6px;background:' + (ok ? '#0d201b' : '#0e0e18') + '"><span style="color:' + (ok ? '#6ee7b7' : '#777') + '">' + (ok ? '✓' : '○') + '</span> ' + esc(label) + '</div>'
}

function render() {
  const host = document.getElementById('infinityScientificWorkspace')
  if (!host) return
  host.style.display = state.open ? 'block' : 'none'
  if (!state.open) return
  const w = state.workflow
  const batch = w?.batch
  const snapshots = w?.snapshots ?? []
  const completed = batch?.completed ?? 0
  const replications = w?.replications ? Object.values(w.replications) as any[] : []
  const replicationCompleted = replications.reduce((n, r) => n + (r?.repetitionsCompleted ?? 0), 0)
  const validationValues = w?.claimValidation ? Object.values(w.claimValidation) as any[] : []
  const claimsValid = validationValues.filter((v: any) => v?.valid).length
  const reportValues = w?.reports ? Object.values(w.reports) as any[] : []
  const provenanceValues = w?.provenance ? Object.values(w.provenance) as any[] : []
  const provenanceValid = provenanceValues.filter((v: any) => v?.valid).length

  host.innerHTML =
    '<div style="background:rgba(10,11,20,.98);border:1px solid rgba(124,111,205,.55);border-radius:12px;box-shadow:0 18px 70px rgba(0,0,0,.65);color:#d0cef5;font:12px system-ui,sans-serif;overflow:hidden;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #29283a;">' +
        '<div><b style="color:#a09af0">🔬 Infinity Scientific Workspace</b><span style="margin-left:8px;color:#666;font-size:10px">Matrix → Run → Replication → Generalization → Claims → Report → Provenance</span></div>' +
        '<button id="scienceClose" style="background:#171725;border:1px solid #34334a;color:#aaa;border-radius:6px;padding:4px 9px;cursor:pointer">Close</button>' +
      '</div>' +
      '<div style="padding:12px;display:grid;grid-template-columns:1fr 1.15fr;gap:10px;">' +
        '<section style="border:1px solid #29283a;border-radius:8px;padding:10px;">' +
          '<b>1. Experiment Matrix</b>' +
          '<div style="color:#777;font-size:10px;margin:5px 0 8px">Baseline + stability + resilience scenarios on the current civilization runtime.</div>' +
          '<div style="display:grid;grid-template-columns:1fr 80px;gap:6px;">' +
            '<input id="scienceRunId" value="infinity-ui-experiment" placeholder="Run label" style="background:#0e0e18;border:1px solid #302f45;color:#ddd;padding:6px;border-radius:5px">' +
            '<input id="scienceTicks" type="number" min="1" value="10" style="background:#0e0e18;border:1px solid #302f45;color:#ddd;padding:6px;border-radius:5px">' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:7px;"><label style="color:#888">Replications</label><input id="scienceReps" type="number" min="1" max="20" value="3" style="width:70px;background:#0e0e18;border:1px solid #302f45;color:#ddd;padding:5px;border-radius:5px"></div>' +
          '<button id="scienceRun" style="margin-top:9px;background:#1a1830;border:1px solid #7c6fcd;color:#b8b2ff;border-radius:6px;padding:7px 12px;cursor:pointer">▶ Run complete scientific workflow</button>' +
          '<div id="scienceRunStatus" style="margin-top:7px;color:#777;font-size:10px">Ready.</div>' +
        '</section>' +
        '<section style="border:1px solid #29283a;border-radius:8px;padding:10px;">' +
          '<b>Pipeline</b>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;">' +
            stage(Boolean(batch), 'Experiment Matrix → Run') +
            stage(completed > 0, 'Scenario results') +
            stage(replicationCompleted > 0, 'Replication statistics') +
            stage(Boolean(w?.reports && Object.keys(w.reports).length), 'Generalization') +
            stage(claimsValid > 0, 'Claim validation') +
            stage(reportValues.length > 0, 'Scientific report') +
            stage(provenanceValid > 0, 'Provenance validation') +
            stage(Boolean(w), 'Reproducible workflow result') +
          '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px;">' +
            '<div style="background:#0e0e18;padding:7px;border-radius:6px"><small>Runs</small><div>' + snapshots.length + '</div></div>' +
            '<div style="background:#0e0e18;padding:7px;border-radius:6px"><small>Completed</small><div>' + completed + '</div></div>' +
            '<div style="background:#0e0e18;padding:7px;border-radius:6px"><small>Replications</small><div>' + replicationCompleted + '</div></div>' +
            '<div style="background:#0e0e18;padding:7px;border-radius:6px"><small>Reports</small><div>' + reportValues.length + '</div></div>' +
          '</div>' +
        '</section>' +
      '</div>' +
      '<div style="padding:0 12px 12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
        '<section style="border:1px solid #29283a;border-radius:8px;padding:10px;">' +
          '<b>Scenario Results</b>' +
          '<div id="scienceScenarioResults" style="margin-top:7px;max-height:180px;overflow:auto;">' +
            (snapshots.length ? snapshots.map((s:any) => '<div style="padding:6px;border-bottom:1px solid #1f1f2c"><b>' + esc(s.protocol?.experimentId) + '</b> <span style="color:' + (s.status === 'completed' ? '#6ee7b7' : '#f59e0b') + '">' + esc(s.status) + '</span><div style="color:#777;font-size:10px">' + esc(JSON.stringify(s.results?.civilization?.outcomes?.map((o:any) => ({ scenarioId:o.scenarioId, populationChange:o.populationChange, stabilityChange:o.stabilityChange, resilienceChange:o.resilienceChange, scoreChange:o.scoreChange })))) + '</div></div>').join('') : '<div style="color:#666">No execution yet.</div>') +
          '</div>' +
        '</section>' +
        '<section style="border:1px solid #29283a;border-radius:8px;padding:10px;">' +
          '<b>Replication Statistics</b>' + '<div style="margin-top:7px;max-height:140px;overflow:auto;">' + (replications.length && replications[0]?.metricSummary ? Object.entries(replications[0].metricSummary).map(([metric, s]: any) => '<div style="padding:5px;border-bottom:1px solid #1f1f2c"><b>' + esc(metric) + '</b>: n=' + esc(s.n) + ', mean=' + esc(Number(s.mean).toFixed(4)) + ', SD=' + esc(Number(s.standardDeviation).toFixed(4)) + ', tolerance=' + esc(s.withinToleranceRate == null ? 'n/a' : Number(s.withinToleranceRate).toFixed(3)) + '</div>').join('') : '<div style="color:#666">No replication statistics yet.</div>') + '</div>' + '<div style="margin-top:9px"><b>Scientific Output</b>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;">'
            '<button id="scienceShowReport" style="background:#0e0e18;border:1px solid #34334a;color:#aaa;border-radius:6px;padding:5px 9px;cursor:pointer">Report JSON</button>' +
            '<button id="scienceShowProv" style="background:#0e0e18;border:1px solid #34334a;color:#aaa;border-radius:6px;padding:5px 9px;cursor:pointer">Provenance</button>' +
            '<button id="scienceShowClaims" style="background:#0e0e18;border:1px solid #34334a;color:#aaa;border-radius:6px;padding:5px 9px;cursor:pointer">Claim validation</button>' +
          '</div>' +
          '<pre id="scienceOutput" style="margin:8px 0 0;background:#08080f;border:1px solid #20202e;border-radius:6px;padding:8px;max-height:300px;overflow:auto;color:#9f9bb5;font:10px monospace;white-space:pre-wrap;">' + esc(w ? JSON.stringify(w, null, 2) : 'No workflow generated yet.') + '</pre>' +
        '</section>' +
      '</div>' +
    '</div>'

  document.getElementById('scienceClose')?.addEventListener('click', () => toggleScientificWorkspace(false))
  document.getElementById('scienceRun')?.addEventListener('click', async () => {
    const ticks = Math.max(1, Number((document.getElementById('scienceTicks') as HTMLInputElement)?.value || 10))
    const repetitions = Math.max(1, Math.min(20, Number((document.getElementById('scienceReps') as HTMLInputElement)?.value || 3)))
    const runLabel = (document.getElementById('scienceRunId') as HTMLInputElement)?.value || 'infinity-ui-experiment'
    const status = document.getElementById('scienceRunStatus')
    if (status) status.textContent = 'Running Matrix → Replication → Generalization → Claims → Report → Provenance…'
    try {
      state.workflow = await win().worldRunScientificWorkflow({
        sourceBranches: ['main'],
        interventions: [
          { id: 'stability', label: 'Stability intervention', override: { stabilityDelta: 0.05, reason: 'UI stability intervention' } },
          { id: 'resilience', label: 'Resilience intervention', override: { resilienceDelta: 0.05, reason: 'UI resilience intervention' } },
        ],
        includeBaseline: true,
        ticks,
        delta: 1,
        combinationMode: 'single',
        metadata: { uiRunLabel: runLabel, workflow: 'infinity-scientific-workflow-v1' },
      }, repetitions)
      if (status) status.textContent = 'Workflow completed: ' + (state.workflow?.batch?.completed ?? 0) + ' experiment plan(s), ' + repetitions + ' replication(s) per plan.'
      render()
    } catch (error) {
      if (status) status.textContent = 'Workflow error: ' + (error instanceof Error ? error.message : String(error))
    }
  })
  document.getElementById('scienceShowReport')?.addEventListener('click', () => {
    const out=document.getElementById('scienceOutput')
    if(out) out.textContent=JSON.stringify(state.workflow?.reports ?? {}, null, 2)
  })
  document.getElementById('scienceShowProv')?.addEventListener('click', () => {
    const out=document.getElementById('scienceOutput')
    if(out) out.textContent=JSON.stringify(state.workflow?.provenance ?? {}, null, 2)
  })
  document.getElementById('scienceShowClaims')?.addEventListener('click', () => {
    const out=document.getElementById('scienceOutput')
    if(out) out.textContent=JSON.stringify(state.workflow?.claimValidation ?? {}, null, 2)
  })
}

export function toggleScientificWorkspace(force?: boolean) {
  state.open = typeof force === 'boolean' ? force : !state.open
  render()
}

export function installScientificWorkspace() {
  if (document.getElementById('infinityScientificWorkspace')) return
  const host = document.createElement('div')
  host.id = 'infinityScientificWorkspace'
  host.style.cssText = 'position:absolute;top:8px;left:8px;right:8px;z-index:45;display:none;pointer-events:auto;'
  const wrap = document.getElementById('c3d')?.parentElement
  if (wrap) wrap.appendChild(host)
  ;(window as any).toggleScientificWorkspace = toggleScientificWorkspace
  render()
}
