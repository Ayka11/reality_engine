import { AIDirector, DirectorGoal } from './AIDirector';

function log(msg: string) {
  let el = document.getElementById('directorDemoLog');
  if (!el) {
    el = document.createElement('div');
    el.id = 'directorDemoLog';
    el.style.position = 'fixed';
    el.style.right = '12px';
    el.style.bottom = '12px';
    el.style.padding = '10px';
    el.style.maxWidth = '360px';
    el.style.maxHeight = '40vh';
    el.style.overflow = 'auto';
    el.style.background = 'rgba(10,10,14,0.9)';
    el.style.color = '#cfd8ff';
    el.style.fontSize = '12px';
    el.style.border = '1px solid #2a2a3a';
    el.style.zIndex = '9999';
    document.body.appendChild(el);
  }
  const p = document.createElement('div'); p.textContent = msg; el.appendChild(p); el.scrollTop = el.scrollHeight;
}

export async function runDirectorDemo() {
  try {
    const sim = (window as any).realityEngine;
    const creator = (window as any).realityCreator;
    const saveSystem = (window as any).realitySave;
    if (!sim || !creator) {
      log('Demo: simulation or creator not ready.');
      return;
    }

    const director = new AIDirector(sim.grid, creator.graph, sim.laws, saveSystem);

    const goal: DirectorGoal = {
      description: 'Create a low-gravity crystal ocean world with cooperative swarm intelligence that develops simple language',
      timeHorizon: 50000,
      constraints: [],
      style: 'cinematic',
    };

    log('Demo: executing sample goal...');
    await director.executeGoal(goal);
    log('Demo: campaign finished.');
  } catch (e) {
    console.error(e);
    log('Demo error: ' + String(e));
  }
}

// Auto-run when URL contains ?directorDemo=1
if (typeof window !== 'undefined' && window.location.search.includes('directorDemo=1')) {
  // defer until main app has initialized
  window.addEventListener('load', () => { setTimeout(() => void runDirectorDemo(), 2000); });
}
