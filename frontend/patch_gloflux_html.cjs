const fs = require('fs');

const path = 'gloflux.html';
let html = fs.readFileSync(path, 'utf8');

const prematchLobbyHtml = 
    <!-- Prematch Lobby Screen -->
    <div id="prematch-lobby" style="position:fixed;inset:0;z-index:9997;display:none;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse 120% 80% at 50% -20%,rgba(255,0,128,.12) 0%,#05050a 60%),radial-gradient(ellipse 80% 60% at 80% 90%,rgba(60,0,200,.08) 0%,#05050a 55%),#05050a;font-family:'Exo 2','Poppins',sans-serif;color:#fff;transition:opacity .6s ease-in-out;opacity:0;overflow:hidden">
      <style>
        #prematch-lobby.visible{display:flex;opacity:1}
        #prematch-lobby.fade-out{opacity:0}
        .pm-title{font-family:'Bungee','Impact',sans-serif;font-weight:400;font-size:clamp(2rem,5vw,3.2rem);text-transform:uppercase;letter-spacing:6px;color:#fff;text-shadow:0 0 50px rgba(255,0,128,.5);margin-bottom:4px}
        .pm-subtitle{font-weight:700;font-size:1rem;text-transform:uppercase;letter-spacing:8px;color:#ff0080;margin-bottom:24px}
        .pm-body{display:flex;gap:28px;width:90%;max-width:1100px;align-items:flex-start;justify-content:center;flex-wrap:wrap}
        .pm-map-panel{flex:0 0 280px;border-radius:18px;overflow:hidden;background:rgba(255,255,255,.055);backdrop-filter:blur(12px) saturate(140%);border:1px solid rgba(255,255,255,.13);box-shadow:0 2px 0 rgba(255,255,255,.08) inset,0 -1px 0 rgba(0,0,0,.35) inset,0 20px 60px rgba(0,0,0,.55)}
        .pm-map-canvas-wrap{width:100%;height:180px;position:relative;background:linear-gradient(135deg,rgba(255,0,128,.12),rgba(60,0,200,.15),rgba(0,30,60,.4));display:flex;align-items:center;justify-content:center}
        .pm-map-canvas-wrap::after{content:'\\1F3C1';font-size:3rem;opacity:.35}
        .pm-map-canvas-wrap canvas{width:100%;height:100%;display:block}
        .pm-map-info{padding:14px 18px}
        .pm-map-name{font-family:'Bungee','Impact',sans-serif;font-size:1.1rem;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px}
        .pm-map-mode{font-size:.8rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#ff0080}
        .pm-settings{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}
        .pm-setting-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:9999px;font-size:.72rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.13);color:rgba(255,255,255,.7)}
        .pm-players-panel{flex:1;min-width:300px}
        .pm-players-title{font-size:.75rem;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:12px}
        .pm-players-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px}
        .pm-player-card{border-radius:14px;padding:10px;text-align:center;background:rgba(255,255,255,.055);backdrop-filter:blur(8px) saturate(120%);border:1px solid rgba(255,255,255,.13);box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 8px 24px rgba(0,0,0,.3);transition:border-color .3s,box-shadow .3s}
        .pm-player-card.is-local{border-color:rgba(255,0,128,.4);box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 8px 24px rgba(255,0,128,.15)}
        .pm-glo-swatch{width:100%;height:6px;border-radius:3px;margin-bottom:4px}
        .pm-kart-canvas{width:140px;height:100px;margin:0 auto 4px;display:block;border-radius:8px}
        .pm-player-name{font-weight:700;font-size:.82rem;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pm-countdown-wrap{margin-top:28px;text-align:center}
        .pm-countdown-label{font-size:.7rem;font-weight:700;letter-spacing:6px;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:6px}
        .pm-countdown-num{font-family:'Bungee','Impact',sans-serif;font-size:clamp(3rem,8vw,5rem);color:#fff;text-shadow:0 0 40px rgba(255,0,128,.7),0 4px 20px rgba(0,0,0,.5);transition:transform .25s ease-out,opacity .25s ease-out}
        .pm-countdown-num.pulse{animation:pm-pulse .4s ease-out}
        @keyframes pm-pulse{0%{transform:scale(1.4);opacity:1}100%{transform:scale(1);opacity:1}}
      </style>
      <h1 class="pm-title">GLO KARTS</h1>
      <p class="pm-subtitle" id="pm-mode-label">GLO FLUX MULTIPLAYER</p>
      <div class="pm-body">
        <div class="pm-map-panel">
          <div class="pm-map-canvas-wrap"><canvas id="pm-map-canvas"></canvas></div>
          <div class="pm-map-info">
            <div class="pm-map-name" id="pm-map-name">Nuclear Desert</div>
            <div class="pm-map-mode" id="pm-map-mode-tag">GLO FLUX</div>
            <div class="pm-settings" id="pm-settings"></div>
          </div>
        </div>
        <div class="pm-players-panel">
          <div class="pm-players-title">PLAYERS</div>
          <div class="pm-players-grid" id="pm-players-grid"></div>
        </div>
      </div>
      <div class="pm-countdown-wrap">
        <div class="pm-countdown-label">WAITING FOR OTHERS</div>
        <div class="pm-countdown-num" id="pm-countdown">—</div>
      </div>
    </div>
;
if (!html.includes('prematch-lobby')) {
  html = html.replace('<body>', '<body>\n' + prematchLobbyHtml);
  fs.writeFileSync(path, html);
  console.log('patched HTML');
}
