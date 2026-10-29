/**
 * GameDevModePanel — HTML builder for the Game Dev Mode left sidebar.
 *
 * Sections:
 *   1. AI Game Designer    (Claude API chat + apply ruleset button)
 *   2. Playtest Controls   (start/reset/pause, score, lives)
 *   3. Objectives          (preset picker, progress bars)
 *   4. Entity Behaviors    (FSM canvas + spawn)
 *   5. Prefab Library      (grid of prefabs, capture, stamp)
 *   6. Level Export        (export + share)
 */

export function buildGameDevModePanel(): string {
  return `
<!-- SECTION 1: AI Game Designer -->
<div class="sec">
  <div class="sechdr" onclick="toggleSec(this)">
    <span>🤖 AI Game Designer</span><span class="sarr">▾</span>
  </div>
  <div class="secbody">
    <div id="gameDesignerLog" style="height:90px;overflow-y:auto;font-size:9px;
      color:var(--sub);background:#09090f;border:1px solid var(--bd);border-radius:5px;
      padding:5px;font-family:monospace;line-height:1.6;margin-bottom:5px">
      Describe your game concept or ask for level ideas.
    </div>
    <div style="display:flex;gap:4px;margin-bottom:4px">
      <input id="gameDesignerInput" type="text"
        placeholder="Design a survival level..."
        style="flex:1;font-size:10px;padding:4px 8px;background:#0c0c18;color:var(--tx);
        border:1px solid var(--bd);border-radius:5px;outline:none"
        onkeydown="if(event.key==='Enter')window.gamedevMode&&window.gamedevMode.askDesigner()">
      <button onclick="window.gamedevMode&&window.gamedevMode.askDesigner()" class="bb"
        style="border-color:var(--err);color:var(--err)">Ask</button>
    </div>
    <div style="display:flex;gap:4px">
      <button onclick="window.gamedevMode&&window.gamedevMode.suggestObjective()" class="bb" style="flex:1">💡 Suggest</button>
      <button id="btnApplyRuleset" onclick="window.gamedevMode&&window.gamedevMode.applyDesignerRuleset()"
        class="bb" style="flex:1;display:none;border-color:var(--ok);color:var(--ok)">✓ Apply ruleset</button>
    </div>
  </div>
</div>

<!-- SECTION 2: Playtest Controls -->
<div class="sec">
  <div class="sechdr" onclick="toggleSec(this)">
    <span>🎮 Playtest</span>
    <div style="display:flex;align-items:center;gap:6px">
      <span id="scoreDisplay" style="font-size:10px;color:var(--ok);font-weight:500">Score: 0</span>
      <span class="sarr">▾</span>
    </div>
  </div>
  <div class="secbody">
    <div style="display:flex;gap:4px;margin-bottom:6px">
      <button onclick="window.gamedevMode&&window.gamedevMode.startPlaytest()"
        class="bb" style="flex:1;border-color:var(--ok);color:var(--ok)">▶ Start</button>
      <button onclick="window.gamedevMode&&window.gamedevMode.resetPlaytest()"
        class="bb" style="flex:1">↺ Reset</button>
      <button onclick="window.gamedevMode&&window.gamedevMode.pausePlaytest()"
        class="bb" style="flex:1">⏸ Pause</button>
    </div>
    <div id="livesDisplay" style="font-size:11px;color:var(--tx);margin-bottom:5px">Lives: ❤️❤️❤️</div>
    <div id="objectivesDisplay" style="display:flex;flex-direction:column;gap:3px"></div>
    <div id="gameMessage" style="font-size:9px;color:var(--warn);margin-top:5px;font-style:italic"></div>
    <select style="width:100%;margin-top:6px" onchange="window.gamedevMode&&window.gamedevMode.loadPreset(this.value);this.value=''">
      <option value="">Load preset...</option>
      <option value="town">🏙️ Town</option>
      <option value="survival">⚔️ Survival</option>
      <option value="ecosystem">🌿 Ecosystem</option>
      <option value="civilization">🏛️ Civilization</option>
      <option value="custom">✏️ Custom</option>
    </select>
  </div>
</div>

<!-- SECTION 3: Objectives -->
<div class="sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>🎯 Objectives</span><span class="sarr">▾</span></div>
  <div class="secbody">
    <select id="objectivePreset" style="width:100%;margin-bottom:5px"
      onchange="window.gamedevMode&&window.gamedevMode.addObjective(this.value);this.value=''">
      <option value="">+ Add objective...</option>
      <option value="survive_500">⏱ Survive 500 ticks</option>
      <option value="survive_1000">🏅 City milestone 1000</option>
      <option value="grow_life">🧬 Reach bio > 0.5</option>
      <option value="grow_parks">🌳 Bio flourish > 0.7</option>
      <option value="spawn_10">🤖 Spawn 10 agents</option>
      <option value="spawn_25">👥 Spawn 25 citizens</option>
      <option value="reduce_ent">🌀 Entropy < 0.2</option>
      <option value="low_entropy">🏗️ City entropy < 0.12</option>
      <option value="max_info">🧠 Info avg > 100</option>
      <option value="high_info">📡 Info grid > 300</option>
    </select>
    <div id="activeObjectives"></div>
    <div class="crow" style="margin-top:4px">
      <span class="clbl" style="font-size:9px">Time limit (ticks)</span>
      <input type="number" id="timeLimitInput" placeholder="none" min="100" max="10000" step="100"
        style="width:70px;font-size:10px;background:#0c0c18;color:var(--sub);
        border:1px solid var(--bd);border-radius:4px;padding:2px 5px"
        oninput="window.gamedevMode&&window.gamedevMode.setTimeLimit(+this.value||null)">
    </div>
  </div>
</div>

<!-- SECTION 4: Entity Behaviors -->
<div class="sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>🧬 Entity Behaviors</span><span class="sarr">▾</span></div>
  <div class="secbody">
    <select id="behaviorPreset" style="width:100%;margin-bottom:5px"
      onchange="window.gamedevMode&&window.gamedevMode.loadBehaviorPreset(this.value)">
      <option value="">Select behavior preset...</option>
      <option value="predator">🦅 Predator</option>
      <option value="explorer">🔭 Explorer</option>
      <option value="survivor">🛡️ Survivor</option>
    </select>
    <canvas id="behaviorCanvas" style="width:100%;cursor:pointer;border:1px solid var(--bd);border-radius:4px"></canvas>
    <div id="behaviorStateInfo" style="font-size:9px;color:var(--sub);margin-top:4px;min-height:24px"></div>
    <div style="display:flex;gap:4px;margin-top:4px">
      <button onclick="window.gamedevMode&&window.gamedevMode.spawnWithBehavior(5)"  class="bb" style="flex:1">🧬 Spawn 5</button>
      <button onclick="window.gamedevMode&&window.gamedevMode.spawnWithBehavior(20)" class="bb" style="flex:1">🧬 Spawn 20</button>
    </div>
  </div>
</div>

<!-- SECTION 5: Prefab Library -->
<div class="sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>📦 Prefabs</span><span class="sarr">▾</span></div>
  <div class="secbody">
    <div id="prefabLibrary"
      style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:6px">
    </div>
    <button onclick="window.gamedevMode&&window.gamedevMode.capturePrefab()" class="bb" style="width:100%;margin-bottom:4px">📷 Capture prefab</button>
    <div style="font-size:9px;color:var(--sub)">
      Active: <span id="activePrefabName" style="color:#a09af0">none</span><br>
      Select prefab → click grid to stamp
    </div>
  </div>
</div>

<!-- SECTION 6: Level Export -->
<div class="sec">
  <div class="sechdr" onclick="toggleSec(this)"><span>📤 Level Export</span><span class="sarr">▾</span></div>
  <div class="secbody">
    <button onclick="window.gamedevMode&&window.gamedevMode.exportLevel()"   class="bb" style="width:100%;margin-bottom:3px">💾 Export level (.level.json)</button>
    <button onclick="window.saveWorld&&window.saveWorld()"                    class="bb" style="width:100%;margin-bottom:3px">🌍 Export world (.reality)</button>
    <button onclick="window.gamedevMode&&window.gamedevMode.shareLevel()"     class="bb" style="width:100%">🔗 Copy shareable link</button>
    <div style="font-size:8px;color:var(--sub);margin-top:5px;line-height:1.5">
      Level JSON includes objectives, rules, lives, time limit.<br>
      Share link encodes objectives as URL hash.
    </div>
  </div>
</div>
`
}
