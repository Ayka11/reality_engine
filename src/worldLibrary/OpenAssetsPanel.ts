/**
 * Reality Engine — Open Assets panel
 *
 * Lightweight top-workspace browser for external open-data providers.
 * It deliberately performs discovery only; binary import remains an explicit
 * future action governed by the provenance manifest.
 */

import { worldAssetProviders, type WorldAssetProvider } from './AssetProviders'
import { discoverPolyHavenAssets, resolvePolyHavenRuntimeUrl, type DiscoveredAsset } from './AssetDiscovery'
import { AGENT_VISUAL_STATES, type AgentState } from '../modes/agents/AgentVisualProfile'

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c] || c))

function providerCard(provider: WorldAssetProvider) {
  return `
    <button data-provider="${esc(provider.id)}" style="text-align:left;padding:7px;border:1px solid rgba(255,255,255,.08);border-radius:6px;background:#0b0c16;color:var(--tx);cursor:pointer;">
      <div style="font-size:9.5px;font-weight:600">${esc(provider.name)}</div>
      <div style="font-size:7.5px;color:#8f88d8;margin-top:2px">${esc(provider.license)} · ${provider.capabilities.slice(0,4).join(' · ')}</div>
    </button>`
}

export function mountOpenAssetsPanel() {
  if (document.getElementById('openAssetsPanel')) return
  const host = document.createElement('div')
  host.id = 'openAssetsPanel'
  host.style.cssText = 'position:absolute;top:72px;left:50%;transform:translateX(-50%);z-index:40;width:min(760px,calc(100vw - 40px));pointer-events:none;'
  document.body.appendChild(host)

  let open = false
  let providerId = 'polyhaven'
  let query = ''
  let results: DiscoveredAsset[] = []
  let loading = false
  let error = ''
  let importing = ''
  let importMessage = ''
  const importedSemantic = new Map<string, string>()
  const importedAnimations = new Map<string, string[]>()
  let selectedAgentAssetId = ''
  const agentClipSelections = new Map<AgentState, string>()
  let agentFallbackClip = ''
  const agentTransformInputs = { originX: '0', originY: '0', originZ: '0', cellSize: '1', scale: '1' }
  let agentVisualMessage = ''
  let agentVisualError = ''

  const render = () => {
    host.innerHTML = open ? `
      <div style="pointer-events:auto;background:rgba(13,15,26,.97);backdrop-filter:blur(16px);border:1px solid rgba(124,111,205,.4);border-radius:10px;box-shadow:0 12px 45px rgba(0,0,0,.65);padding:10px;color:var(--tx);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
          <div><b style="font-size:11px;color:#c8c3ff">📚 Open World Assets</b><span style="font-size:8px;color:var(--sub);margin-left:8px">discovery + provenance</span></div>
          <button id="openAssetsClose" class="pill" style="font-size:9px;padding:2px 7px">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:170px 1fr 80px;gap:5px;margin-bottom:7px">
          <select id="openAssetsProvider" style="padding:5px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.08);border-radius:5px;font-size:9px">
            ${worldAssetProviders.all().map(p=>`<option value="${esc(p.id)}" ${p.id===providerId?'selected':''}>${esc(p.name)}</option>`).join('')}
          </select>
          <input id="openAssetsQuery" value="${esc(query)}" placeholder="Search external assets..." style="padding:5px 7px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.08);border-radius:5px;font-size:9px;outline:none">
          <button id="openAssetsBrowse" class="pill on" style="font-size:9px">Browse</button>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px">
          ${worldAssetProviders.all().map(providerCard).join('')}
        </div>
        <div style="font-size:8px;color:var(--sub);margin-bottom:5px">
          ${loading ? 'Loading provider catalogue…' : importing ? 'Resolving runtime asset…' : error ? esc(error) : importMessage || (providerId==='polyhaven' ? 'Poly Haven live catalogue' : 'Provider registry metadata')}
        </div>
        <details style="margin:8px 0;padding:7px;border:1px solid rgba(124,111,205,.25);border-radius:6px;background:rgba(8,9,17,.55)">
          <summary style="cursor:pointer;font-size:9px;font-weight:600;color:#c8c3ff">Agent Visual Binding · optional</summary>
          <div style="font-size:7.5px;color:var(--sub);margin:5px 0">Create temporary GLTF representations for the active 2D agents. You choose the world origin, grid spacing and exact imported animation clips. The visual instances are regenerated from simulation state and are not included in world saves.</div>
          <div style="display:grid;grid-template-columns:1.5fr repeat(3,minmax(55px,.6fr));gap:5px;margin:6px 0">
            <label style="font-size:7px;color:var(--sub)">Imported model
              <select id="agentVisualAsset" style="display:block;width:100%;margin-top:3px;padding:4px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.1);border-radius:4px;font-size:8px">
                <option value="">Select imported model…</option>
                ${[...importedSemantic.entries()].map(([id, semantic]) => `<option value="${esc(id)}" ${selectedAgentAssetId===id?'selected':''}>${esc(id)} · ${esc(semantic)}</option>`).join('')}
              </select>
            </label>
            ${[['agentVisualOriginX','Origin X','originX'],['agentVisualOriginY','Origin Y','originY'],['agentVisualOriginZ','Origin Z','originZ']].map(([id,label,key])=>`<label style="font-size:7px;color:var(--sub)">${label}<input id="${id}" type="number" step="any" value="${esc(agentTransformInputs[key as keyof typeof agentTransformInputs])}" style="display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:4px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.1);border-radius:4px;font-size:8px"></label>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(90px,1fr));gap:5px;margin-bottom:6px">
            <label style="font-size:7px;color:var(--sub)">Grid cell size<input id="agentVisualCellSize" type="number" min="0.000001" step="any" value="${esc(agentTransformInputs.cellSize)}" style="display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:4px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.1);border-radius:4px;font-size:8px"></label>
            <label style="font-size:7px;color:var(--sub)">Model scale<input id="agentVisualScale" type="number" min="0.000001" step="any" value="${esc(agentTransformInputs.scale)}" style="display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:4px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.1);border-radius:4px;font-size:8px"></label>
          </div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-bottom:6px">
            ${AGENT_VISUAL_STATES.map(state=>`
              <label style="font-size:7px;color:var(--sub)">${esc(state)} animation
                <select data-agent-state-clip="${state}" style="display:block;width:100%;margin-top:3px;padding:4px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.1);border-radius:4px;font-size:8px">
                  <option value="">No mapping</option>
                  ${(importedAnimations.get(selectedAgentAssetId) ?? []).map(name=>`<option value="${esc(name)}" ${agentClipSelections.get(state)===name?'selected':''}>${esc(name)}</option>`).join('')}
                </select>
              </label>`).join('')}
            <label style="font-size:7px;color:var(--sub)">Fallback animation
              <select id="agentVisualFallback" style="display:block;width:100%;margin-top:3px;padding:4px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.1);border-radius:4px;font-size:8px">
                <option value="">No fallback</option>
                ${(importedAnimations.get(selectedAgentAssetId) ?? []).map(name=>`<option value="${esc(name)}" ${agentFallbackClip===name?'selected':''}>${esc(name)}</option>`).join('')}
              </select>
            </label>
          </div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
            <button id="agentVisualConfigure" class="pill on" style="font-size:8px" ${selectedAgentAssetId?'':'disabled'}>Bind visuals</button>
            <button id="agentVisualClear" class="pill" style="font-size:8px">Clear binding</button>
            <span style="font-size:7px;color:var(--sub)">${esc(agentVisualError || agentVisualMessage || 'Set the world-space center of grid cell (0,0), then map the available clips.')}</span>
          </div>
        </details>
        <div style="max-height:270px;overflow:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:5px">
          ${results.filter(a => !query || (a.name+' '+a.id+' '+a.tags.join(' ')).toLowerCase().includes(query.toLowerCase())).slice(0,30).map(a=>`
            <div style="padding:6px;border:1px solid rgba(255,255,255,.07);border-radius:6px;background:rgba(8,9,17,.6)">
              <div style="font-size:8.5px;font-weight:600">${esc(a.name)}</div>
              <div style="font-size:7px;color:#8f88d8;margin-top:2px">${esc(a.id)}</div>
              <div style="font-size:7px;color:var(--sub);margin-top:3px">${esc(a.category || 'asset')} · ${esc(a.license)}</div>
              <div style="display:flex;gap:4px;align-items:center;margin-top:5px">
                <a href="${esc(a.sourceUrl)}" target="_blank" rel="noreferrer" style="font-size:7.5px;color:#a09af0">Source ↗</a>
                ${a.providerId==='polyhaven' ? `<button data-import-asset="${esc(a.id)}" class="pill" style="font-size:7px;padding:2px 5px">${importing===a.id?'Loading…':'Import'}</button>${importedSemantic.has(a.id) ? `
                  <button data-scatter-asset="${esc(a.id)}" class="pill" style="font-size:7px;padding:2px 5px">Scatter</button>
                  ${(importedAnimations.get(a.id) ?? []).length
                    ? `<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;width:100%;margin-top:5px">
                        <select data-animation-clip="${esc(a.id)}" aria-label="Animation clip for ${esc(a.name)}" style="min-width:85px;max-width:135px;padding:3px;background:#0b0c16;color:var(--tx);border:1px solid rgba(255,255,255,.1);border-radius:4px;font-size:7px">
                          ${(importedAnimations.get(a.id) ?? []).map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
                        </select>
                        <button data-play-animation="${esc(a.id)}" class="pill" style="font-size:7px;padding:2px 5px">Play group</button>
                        <button data-stop-animation="${esc(a.id)}" class="pill" style="font-size:7px;padding:2px 5px">Stop group</button>
                      </div>`
                    : `<span style="font-size:7px;color:var(--sub)">No animation clips in this model</span>`}
                ` : ''}` : ''}
              </div>
            </div>`).join('') || '<div style="grid-column:1/-1;padding:18px;text-align:center;font-size:9px;color:var(--sub)">Choose Browse to discover provider assets.</div>'}
        </div>
      </div>` : ''
    if (!open) return
    document.getElementById('openAssetsClose')?.addEventListener('click',()=>{open=false;render()})
    document.getElementById('openAssetsProvider')?.addEventListener('change',(e)=>{providerId=(e.target as HTMLSelectElement).value;results=[];error='';render()})
    document.getElementById('openAssetsQuery')?.addEventListener('input',(e)=>{query=(e.target as HTMLInputElement).value;render()})
    document.getElementById('openAssetsBrowse')?.addEventListener('click',browse)
    document.getElementById('agentVisualAsset')?.addEventListener('change',(e)=>{
      selectedAgentAssetId=(e.target as HTMLSelectElement).value
      agentClipSelections.clear()
      agentFallbackClip=''
      agentVisualError=''
      render()
    })
    host.querySelectorAll<HTMLSelectElement>('[data-agent-state-clip]').forEach(select=>select.addEventListener('change',()=>{
      const state=select.getAttribute('data-agent-state-clip') as AgentState | null
      if(!state)return
      if(select.value)agentClipSelections.set(state,select.value)
      else agentClipSelections.delete(state)
    }))
    document.getElementById('agentVisualFallback')?.addEventListener('change',(e)=>{agentFallbackClip=(e.target as HTMLSelectElement).value})
    ;(['originX','originY','originZ','cellSize','scale'] as const).forEach(key=>{
      const id=key==='originX'?'agentVisualOriginX':key==='originY'?'agentVisualOriginY':key==='originZ'?'agentVisualOriginZ':key==='cellSize'?'agentVisualCellSize':'agentVisualScale'
      document.getElementById(id)?.addEventListener('input',(e)=>{agentTransformInputs[key]=(e.target as HTMLInputElement).value})
    })
    document.getElementById('agentVisualConfigure')?.addEventListener('click',()=>{
      const semanticEntryId=importedSemantic.get(selectedAgentAssetId)
      const transformFactory=(window as any).createPlanarAgentGridWorldTransform
      const configure=(window as any).configureAgentVisuals
      const readNumber=(id:string,label:string)=>{
        const value=Number((document.getElementById(id) as HTMLInputElement | null)?.value)
        if(!Number.isFinite(value))throw new TypeError(label+' must be a finite number')
        return value
      }
      agentTransformInputs.originX=(document.getElementById('agentVisualOriginX') as HTMLInputElement | null)?.value ?? agentTransformInputs.originX
      agentTransformInputs.originY=(document.getElementById('agentVisualOriginY') as HTMLInputElement | null)?.value ?? agentTransformInputs.originY
      agentTransformInputs.originZ=(document.getElementById('agentVisualOriginZ') as HTMLInputElement | null)?.value ?? agentTransformInputs.originZ
      agentTransformInputs.cellSize=(document.getElementById('agentVisualCellSize') as HTMLInputElement | null)?.value ?? agentTransformInputs.cellSize
      agentTransformInputs.scale=(document.getElementById('agentVisualScale') as HTMLInputElement | null)?.value ?? agentTransformInputs.scale
      try{
        if(!semanticEntryId)throw new Error('Choose a successfully imported model first')
        if(typeof transformFactory!=='function'||typeof configure!=='function')throw new Error('Agent visual runtime is not initialized')
        const cellSize=readNumber('agentVisualCellSize','Grid cell size')
        const scale=readNumber('agentVisualScale','Model scale')
        if(cellSize<=0)throw new RangeError('Grid cell size must be positive')
        if(scale<=0)throw new RangeError('Model scale must be positive')
        const origin={
          x:readNumber('agentVisualOriginX','Origin X'),
          y:readNumber('agentVisualOriginY','Origin Y'),
          z:readNumber('agentVisualOriginZ','Origin Z'),
        }
        const clips:Partial<Record<AgentState,string>>={}
        host.querySelectorAll<HTMLSelectElement>('[data-agent-state-clip]').forEach(select=>{
          const state=select.getAttribute('data-agent-state-clip') as AgentState | null
          if(state&&select.value)clips[state]=select.value
        })
        const fallback=(document.getElementById('agentVisualFallback') as HTMLSelectElement | null)?.value
        const result=configure({
          transform:transformFactory(origin,cellSize),
          profile:{schemaVersion:'agent-visual-profile-v1',semanticEntryId,scale,fadeDuration:0.2,clips,...(fallback?{fallbackClip:fallback}:{})},
        })
        const d=result?.diagnostics ?? {}
        agentVisualMessage='Bound '+(d.created??0)+' agent(s); '+(d.animated??0)+' animation(s) started; '+(d.awaitingAsset??0)+' waiting for asset; '+(d.missingClip??0)+' missing clip(s).'
        agentVisualError=''
      }catch(error){agentVisualError=error instanceof Error?error.message:'Could not configure agent visuals';agentVisualMessage=''}
      render()
    })
    document.getElementById('agentVisualClear')?.addEventListener('click',()=>{
      try{
        const clear=(window as any).clearAgentVisuals
        if(typeof clear!=='function')throw new Error('Agent visual runtime is not initialized')
        clear()
        agentVisualMessage='Agent visual binding cleared.'
        agentVisualError=''
      }catch(error){agentVisualError=error instanceof Error?error.message:'Could not clear agent visuals';agentVisualMessage=''}
      render()
    })
    host.querySelectorAll('[data-import-asset]').forEach(b=>b.addEventListener('click',()=>importAsset(b.getAttribute('data-import-asset')||'')))
    host.querySelectorAll('[data-scatter-asset]').forEach(b=>b.addEventListener('click',()=>scatterAsset(b.getAttribute('data-scatter-asset')||'')))
    host.querySelectorAll('[data-play-animation]').forEach(button => button.addEventListener('click', () => {
      const assetId = button.getAttribute('data-play-animation') || ''
      const semanticEntryId = importedSemantic.get(assetId)
      const select = [...host.querySelectorAll<HTMLSelectElement>('[data-animation-clip]')]
        .find(element => element.getAttribute('data-animation-clip') === assetId)
      const state = (window as any).worldExternalAssetAnimationState
      if (!semanticEntryId || !select?.value || typeof state !== 'function') {
        error = 'Animation controls are not available for this asset'
        render()
        return
      }
      try {
        const result = state(semanticEntryId, select.value, { fadeDuration: 0.25 })
        importMessage = result?.started
          ? `Playing ${select.value} for ${result.started} of ${result.matched} placed instance(s)`
          : `No placed instances found for ${semanticEntryId}. Use Scatter first.`
        error = ''
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unable to start group animation'
      }
      render()
    }))
    host.querySelectorAll('[data-stop-animation]').forEach(button => button.addEventListener('click', () => {
      const assetId = button.getAttribute('data-stop-animation') || ''
      const semanticEntryId = importedSemantic.get(assetId)
      const stop = (window as any).worldExternalAssetAnimationStopSemantic
      if (!semanticEntryId || typeof stop !== 'function') {
        error = 'Animation stop control is not available for this asset'
        render()
        return
      }
      try {
        const stopped = stop(semanticEntryId)
        importMessage = stopped
          ? `Stopped animation on ${stopped} instance(s) of ${semanticEntryId}`
          : `No active group animation for ${semanticEntryId}`
        error = ''
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unable to stop group animation'
      }
      render()
    }))
    host.querySelectorAll('[data-provider]').forEach(b=>b.addEventListener('click',()=>{providerId=b.getAttribute('data-provider')||providerId;results=[];error='';browse()}))
  }

  const scatterAsset = (assetId: string) => {
    const semanticEntryId = importedSemantic.get(assetId)
    const scatter = (window as any).worldExternalAssetScatter
    if (!semanticEntryId || typeof scatter !== 'function') return
    const count = scatter(semanticEntryId, 12, 70, Date.now() >>> 0, 1)
    importMessage = 'Scattered ' + count + ' instances of ' + semanticEntryId
    render()
  }

  const importAsset = async (assetId: string) => {
    const asset = results.find(item => item.id === assetId)
    if (!asset) return
    importing = assetId
    importMessage = ''
    error = ''
    render()
    try {
      const runtime = await resolvePolyHavenRuntimeUrl(asset)
      if (!runtime) throw new Error('No GLB/GLTF runtime file is available for this asset')
      // Preserve the semantic mapping used by saved placement descriptors.
      // Re-discovery may return a different automatic match after a library update.
      const savedManifestEntry = (window as any).worldAssetManifest?.entries?.find((entry: any) =>
        entry.providerId === asset.providerId && entry.sourceAssetId === asset.id
      )
      const savedSemanticEntryId = typeof savedManifestEntry?.semanticEntryId === 'string'
        ? savedManifestEntry.semanticEntryId
        : undefined
      const manifestResult = (window as any).worldAssetImport?.(asset, savedSemanticEntryId)
      if (!manifestResult?.accepted) {
        throw new Error(manifestResult?.errors?.join('; ') || 'Asset provenance validation failed')
      }
      const load = (window as any).worldExternalAssetLoad
      if (typeof load !== 'function') throw new Error('Infinite World asset runtime is not ready')
      await load(asset.id, runtime.url, manifestResult.manifestEntry?.semanticEntryId, 1)
      asset.runtimeUrl = runtime.url
      asset.format = runtime.format
      const animationNames = (window as any).worldExternalAssetAnimationNames?.(asset.id)
      importedAnimations.set(asset.id, Array.isArray(animationNames) ? animationNames.filter((name: unknown): name is string => typeof name === 'string') : [])
      if (manifestResult.manifestEntry?.semanticEntryId) importedSemantic.set(asset.id, manifestResult.manifestEntry.semanticEntryId)
      if (!selectedAgentAssetId) selectedAgentAssetId = asset.id
      importMessage = 'Imported ' + asset.name + ' as ' + (manifestResult.manifestEntry?.semanticEntryId || 'unmapped asset')
        + (importedAnimations.get(asset.id)?.length ? ' · ' + importedAnimations.get(asset.id)!.length + ' animation clip(s)' : ' · no animation clips')
    } catch (e) {
      error = e instanceof Error ? e.message : 'Asset import failed'
    } finally {
      importing = ''
      render()
    }
  }

  const browse = async () => {
    loading=true;error='';render()
    try {
      if (providerId === 'polyhaven') results = await discoverPolyHavenAssets()
      else results = []
      loading=false
    } catch (e) {
      loading=false
      error=e instanceof Error ? e.message : 'Provider discovery failed'
    }
    render()
  }

  const button = document.createElement('button')
  button.id = 'openAssetsButton'
  button.textContent = '📚 Open Assets'
  button.className = 'brush-btn'
  button.style.cssText = 'position:fixed;bottom:44px;right:18px;z-index:41;font-size:10px;padding:5px 9px;pointer-events:auto;'
  button.addEventListener('click',()=>{open=!open;render()})
  document.body.appendChild(button)
  render()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountOpenAssetsPanel)
else mountOpenAssetsPanel()
