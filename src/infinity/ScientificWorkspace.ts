export type ScientificWorkspaceState = { open: boolean; lastBatch: any; lastReport: any }
const state: ScientificWorkspaceState = { open: false, lastBatch: null, lastReport: null }
const win = () => window as any
const esc = (v: unknown) => String(v ?? '').replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' } as Record<string,string>)[c] || c)

function render() {
  const host = document.getElementById('infinityScientificWorkspace')
  if (!host) return
  host.style.display = state.open ? 'block' : 'none'
  if (!state.open) return
  const batch = state.lastBatch
  const report = state.lastReport
  const snapshots = batch?.snapshots ?? []
  const completed = snapshots.filter((s: any) => s.status === 'completed').length
  const failed = snapshots.filter((s: any) => s.status !== 'completed').length
  host.innerHTML = '<div style="background:rgba(10,11,20,.97);border:1px solid rgba(124,111,205,.5);border-radius:12px;box-shadow:0 18px 70px rgba(0,0,0,.65);color:#d0cef5;font:12px system-ui,sans-serif;overflow:hidden;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #29283a;"><div><b style="color:#a09af0">🔬 Infinity Scientific Workspace</b><span style="margin-left:8px;color:#666;font-size:10px">Experiment → Replication → Generalization → Claims → Report</span></div><button id="scienceClose" style="background:#171725;border:1px solid #34334a;color:#aaa;border-radius:6px;padding:4px 9px;cursor:pointer">Close</button></div>' +
    '<div style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
      '<section style="border:1px solid #29283a;border-radius:8px;padding:10px;"><b>Experiment Matrix</b><div style="color:#777;font-size:10px;margin:5px 0 8px">Run a reproducible civilization intervention matrix against the current main branch.</div><div style="display:grid;grid-template-columns:1fr 90px;gap:6px;"><input id="scienceExpId" value="infinity-ui-experiment" placeholder="Experiment ID" style="background:#0e0e18;border:1px solid #302f45;color:#ddd;padding:6px;border-radius:5px"><input id="scienceTicks" type="number" min="1" value="10" style="background:#0e0e18;border:1px solid #302f45;color:#ddd;padding:6px;border-radius:5px"></div><button id="scienceRun" style="margin-top:8px;background:#1a1830;border:1px solid #7c6fcd;color:#b8b2ff;border-radius:6px;padding:6px 12px;cursor:pointer">▶ Run 3-scenario experiment</button><div id="scienceRunStatus" style="margin-top:7px;color:#777;font-size:10px">Ready.</div></section>' +
      '<section style="border:1px solid #29283a;border-radius:8px;padding:10px;"><b>Run Status</b><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;"><div style="background:#0e0e18;padding:8px;border-radius:6px"><small>Total</small><div>' + snapshots.length + '</div></div><div style="background:#0e0e18;padding:8px;border-radius:6px"><small>Completed</small><div>' + completed + '</div></div><div style="background:#0e0e18;padding:8px;border-radius:6px"><small>Failed</small><div>' + failed + '</div></div></div><button id="scienceGeneralize" style="margin-top:8px;background:#0e0e18;border:1px solid #34334a;color:#aaa;border-radius:6px;padding:6px 10px;cursor:pointer">Analyze generalization</button></section>' +
    '</div><div style="padding:0 12px 12px;"><div style="border:1px solid #29283a;border-radius:8px;padding:10px;"><b>Evidence / Claims / Report</b><div style="color:#777;font-size:10px;margin:5px 0 8px">Computational evidence remains explicit and traceable.</div><div style="display:flex;gap:6px;flex-wrap:wrap;"><button id="scienceClaimGraph" style="background:#0e0e18;border:1px solid #34334a;color:#aaa;border-radius:6px;padding:5px 9px;cursor:pointer">Build Claim Graph</button><button id="scienceReport" style="background:#0e0e18;border:1px solid #34334a;color:#aaa;border-radius:6px;padding:5px 9px;cursor:pointer">Create Scientific Report</button></div><pre id="scienceOutput" style="margin:8px 0 0;background:#08080f;border:1px solid #20202e;border-radius:6px;padding:8px;max-height:260px;overflow:auto;color:#9f9bb5;font:10px monospace;white-space:pre-wrap;">' + esc(report ? JSON.stringify(report, null, 2) : 'No report generated yet.') + '</pre></div></div></div>'
  document.getElementById('scienceClose')?.addEventListener('click', () => toggleScientificWorkspace(false))
  document.getElementById('scienceRun')?.addEventListener('click', async () => {
    const ticks = Number((document.getElementById('scienceTicks') as HTMLInputElement)?.value || 10)
    const status = document.getElementById('scienceRunStatus')
    if (status) status.textContent = 'Running deterministic experiment batch…'
    try {
      const result = await win().worldRunCivilizationExperimentBatch({ sourceBranches:['main'], interventions:[{id:'stability',label:'Stability intervention',override:{stabilityDelta:0.05,reason:'UI stability intervention'}},{id:'resilience',label:'Resilience intervention',override:{resilienceDelta:0.05,reason:'UI resilience intervention'}}], includeBaseline:true, ticks, delta:1, combinationMode:'single' })
      state.lastBatch = result
      if (status) status.textContent = 'Completed: ' + (result.completed ?? 0) + '; failed: ' + (result.failed ?? 0)
      render()
    } catch (error) { if (status) status.textContent = 'Error: ' + (error instanceof Error ? error.message : String(error)) }
  })
  document.getElementById('scienceGeneralize')?.addEventListener('click', () => { const result = win().worldAnalyzeExperimentGeneralization(state.lastBatch?.snapshots ?? []); const out=document.getElementById('scienceOutput'); if(out) out.textContent=JSON.stringify(result,null,2) })
  document.getElementById('scienceClaimGraph')?.addEventListener('click', () => { const snapshots=state.lastBatch?.snapshots ?? []; if(!snapshots.length)return; const first=snapshots[0]; const result=win().worldExperimentClaimGraph(first.protocol.experimentId,[],10,1); const out=document.getElementById('scienceOutput'); if(out) out.textContent=JSON.stringify(result,null,2) })
  document.getElementById('scienceReport')?.addEventListener('click', () => { const snapshots=state.lastBatch?.snapshots ?? []; if(!snapshots.length)return; const first=snapshots.find((s:any)=>s.status==='completed') || snapshots[0]; const report=win().worldCreateInfinityScientificReport(first); state.lastReport=report; const out=document.getElementById('scienceOutput'); if(out) out.textContent=JSON.stringify(report,null,2) })
}
export function toggleScientificWorkspace(force?: boolean) { state.open = typeof force === 'boolean' ? force : !state.open; render() }
export function installScientificWorkspace() { if(document.getElementById('infinityScientificWorkspace')) return; const host=document.createElement('div'); host.id='infinityScientificWorkspace'; host.style.cssText='position:absolute;top:8px;left:8px;right:8px;z-index:45;display:none;pointer-events:auto;'; const wrap=document.getElementById('c3d')?.parentElement; if(wrap) wrap.appendChild(host); (window as any).toggleScientificWorkspace=toggleScientificWorkspace; render() }