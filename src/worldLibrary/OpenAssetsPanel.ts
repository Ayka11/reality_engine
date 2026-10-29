/**
 * Reality Engine — Open Assets panel
 *
 * Lightweight top-workspace browser for external open-data providers.
 * It deliberately performs discovery only; binary import remains an explicit
 * future action governed by the provenance manifest.
 */

import { worldAssetProviders, type WorldAssetProvider } from './AssetProviders'
import { discoverPolyHavenAssets, resolvePolyHavenRuntimeUrl, type DiscoveredAsset } from './AssetDiscovery'

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
        <div style="max-height:270px;overflow:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:5px">
          ${results.filter(a => !query || (a.name+' '+a.id+' '+a.tags.join(' ')).toLowerCase().includes(query.toLowerCase())).slice(0,30).map(a=>`
            <div style="padding:6px;border:1px solid rgba(255,255,255,.07);border-radius:6px;background:rgba(8,9,17,.6)">
              <div style="font-size:8.5px;font-weight:600">${esc(a.name)}</div>
              <div style="font-size:7px;color:#8f88d8;margin-top:2px">${esc(a.id)}</div>
              <div style="font-size:7px;color:var(--sub);margin-top:3px">${esc(a.category || 'asset')} · ${esc(a.license)}</div>
              <div style="display:flex;gap:4px;align-items:center;margin-top:5px">
                <a href="${esc(a.sourceUrl)}" target="_blank" rel="noreferrer" style="font-size:7.5px;color:#a09af0">Source ↗</a>
                ${a.providerId==='polyhaven' ? `<button data-import-asset="${esc(a.id)}" class="pill" style="font-size:7px;padding:2px 5px">${importing===a.id?'Loading…':'Import'}</button>${importedSemantic.has(a.id) ? `<button data-scatter-asset="${esc(a.id)}" class="pill" style="font-size:7px;padding:2px 5px">Scatter</button>` : ''}` : ''}
              </div>
            </div>`).join('') || '<div style="grid-column:1/-1;padding:18px;text-align:center;font-size:9px;color:var(--sub)">Choose Browse to discover provider assets.</div>'}
        </div>
      </div>` : ''
    if (!open) return
    document.getElementById('openAssetsClose')?.addEventListener('click',()=>{open=false;render()})
    document.getElementById('openAssetsProvider')?.addEventListener('change',(e)=>{providerId=(e.target as HTMLSelectElement).value;results=[];error='';render()})
    document.getElementById('openAssetsQuery')?.addEventListener('input',(e)=>{query=(e.target as HTMLInputElement).value;render()})
    document.getElementById('openAssetsBrowse')?.addEventListener('click',browse)
    host.querySelectorAll('[data-import-asset]').forEach(b=>b.addEventListener('click',()=>importAsset(b.getAttribute('data-import-asset')||'')))
    host.querySelectorAll('[data-scatter-asset]').forEach(b=>b.addEventListener('click',()=>scatterAsset(b.getAttribute('data-scatter-asset')||'')))
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
      const manifestResult = (window as any).worldAssetImport?.(asset)
      if (!manifestResult?.accepted) {
        throw new Error(manifestResult?.errors?.join('; ') || 'Asset provenance validation failed')
      }
      const load = (window as any).worldExternalAssetLoad
      if (typeof load !== 'function') throw new Error('Infinite World asset runtime is not ready')
      await load(asset.id, runtime.url, manifestResult.manifestEntry?.semanticEntryId, 1)
      asset.runtimeUrl = runtime.url
      asset.format = runtime.format
      if (manifestResult.manifestEntry?.semanticEntryId) importedSemantic.set(asset.id, manifestResult.manifestEntry.semanticEntryId)
      importMessage = 'Imported ' + asset.name + ' as ' + (manifestResult.manifestEntry?.semanticEntryId || 'unmapped asset')
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
  button.style.cssText = 'position:absolute;top:48px;right:18px;z-index:41;font-size:10px;padding:5px 9px;pointer-events:auto;'
  button.addEventListener('click',()=>{open=!open;render()})
  document.body.appendChild(button)
  render()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountOpenAssetsPanel)
else mountOpenAssetsPanel()
