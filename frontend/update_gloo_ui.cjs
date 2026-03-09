const fs = require('fs');

// Patching lobby-car.js
const carPath = 'src/lobby-car.js';
let carContent = fs.readFileSync(carPath, 'utf8');

const carStartMarker = '// ── Pick-your-GLO panel builder';
const carEndMarkerIndex = carContent.lastIndexOf('  }\n}\n\ndocument.addEventListener');

const carStart = carContent.indexOf(carStartMarker);
if (carStart === -1 || carEndMarkerIndex === -1) {
  console.error("Could not find lobby-car markers");
  process.exit(1);
}

const carPrefix = carContent.substring(0, carStart);
const carSuffix = carContent.substring(carEndMarkerIndex);

const newCarCode = `// ── Pick-your-GLO panel builder ───────────────────────────────
  buildGloPicker() {
    const container = document.getElementById('glo-carousel');
    if (!container) return;
    container.innerHTML = '';
    container.className = 'glo-modern-picker';

    const CHIP_BG = {
      'solid':          'var(--accent)',
      'pulse':          'linear-gradient(135deg,#ff0080,#cc0060)',
      'strobe':         'linear-gradient(90deg,#fff 50%,#111 50%)',
      'rainbow':        'linear-gradient(90deg,#f00,#ff8c00,#ff0,#0f0,#0ff,#00f,#f0f)',
      'two-color':      'linear-gradient(135deg,#ff0080 50%,#00e5ff 50%)',
      'chase':          'linear-gradient(90deg,rgba(255,0,128,0.1),#ff0080 50%,rgba(255,0,128,0.1))',
      'sunrise':        'linear-gradient(135deg,#3a0060,#e67300,#ffd700)',
      'sunset':         'linear-gradient(135deg,#ff6600,#ff0080,#7700cc)',
      'sunset-glow':    'linear-gradient(135deg,#ff8c00,#ff3300)',
      'fire':           'linear-gradient(135deg,#cc0000,#ff6600,#ffcc00)',
      'falling-leaves': 'linear-gradient(135deg,#cc5500,#994400,#dd3300)',
      'spring':         'linear-gradient(135deg,#ff99bb,#99ffcc,#cc99ff)',
      'full-rainbow':   'linear-gradient(90deg,#f00,#ff8c00,#ff0,#0f0,#0ff,#00f,#f0f)',
      'aurora':         'linear-gradient(135deg,#002a18,#00cc66,#00cccc,#5500cc)',
      'forest':         'linear-gradient(135deg,#001a00,#006600)',
      'spring-wind':    'linear-gradient(135deg,#bbddff,#ffccee,#ccffdd)',
      'falling-petals': 'linear-gradient(135deg,#ff88bb,#ffddee,#fff)',
      'firefly':        'linear-gradient(135deg,#000d1a,#003300,#aacc00)',
      'ocean':          'linear-gradient(135deg,#001f5e,#0055cc,#00ccff)',
      'waterfall':      'linear-gradient(135deg,#003399,#5599ff,#bbddff)',
      'river':          'linear-gradient(135deg,#004444,#007799,#00bbcc)',
      'wave':           'linear-gradient(135deg,#002266,#0066cc,#00bbee)',
      'raining':        'linear-gradient(135deg,#334455,#5577aa,#8899bb)',
      'snowing':        'linear-gradient(135deg,#aabbcc,#ddeeff,#f5fafe)',
      'cloudy':         'linear-gradient(135deg,#445566,#778899,#99aabb)',
      'water-drop':     'linear-gradient(135deg,#0055ee,#0099ff,#66ddff)',
    };
    const ANIM_CLASSES = {
      'pulse': 'glo-anim-pulse', 'strobe': 'glo-anim-strobe', 'rainbow': 'glo-anim-huerot', 'full-rainbow': 'glo-anim-huerot',
      'aurora': 'glo-anim-huerot', 'chase': 'glo-anim-chase', 'fire': 'glo-anim-flicker', 'firefly': 'glo-anim-flicker'
    };

    const SIMPLE_EFFECTS = ['solid', 'pulse', 'strobe', 'chase', 'two-color'];

    // --- Living Marquee Container ---
    const marqueeContainer = document.createElement('div');
    marqueeContainer.className = 'glo-marquee-container';

    // Split all effects roughly in half to create 2 infinite auto-scrolling rows
    const half = Math.ceil(GLO_EFFECTS.length / 2);
    const track1Effects = GLO_EFFECTS.slice(0, half);
    const track2Effects = GLO_EFFECTS.slice(half);

    let activeChipElements = [];
    let updateUI; 

    // Function to build an infinite track
    const createTrack = (effects, duration, direction) => {
      const trackWrapper = document.createElement('div');
      trackWrapper.className = 'glo-track-wrapper';
      
      const track = document.createElement('div');
      track.className = 'glo-marquee-track ' + direction;
      track.style.animationDuration = duration + 's';

      // We duplicate the set 3 times for a seamless infinite scroll
      // Because length of track needs to cover 2x screen space
      const repeatedEffects = [...effects, ...effects, ...effects];

      repeatedEffects.forEach(ef => {
        const chip = document.createElement('div');
        chip.className = 'glo-chip' + (gloEffect === ef.id ? ' active' : '');
        
        const bg = document.createElement('div');
        bg.className = 'glo-chip-bg ' + (ANIM_CLASSES[ef.id] || '');
        bg.style.background = CHIP_BG[ef.id] || 'var(--accent)';
        
        const lbl = document.createElement('div');
        lbl.className = 'glo-chip-lbl';
        
        // Add small icons to custom effects to help them stand out in the stream
        let icn = '';
        if(ef.id==='solid') icn = '🎨 ';
        if(ef.id==='pulse') icn = '💓 ';
        if(ef.id==='strobe') icn = '⚡ ';
        if(ef.id==='chase') icn = '🌀 ';
        if(ef.id==='two-color') icn = '🌗 ';
        
        lbl.textContent = icn + ef.label;

        chip.append(bg, lbl);
        chip.onpointerdown = () => { 
          gloEffect = ef.id; 
          updateUI(); 
          saveGlo(); 
        };
        chip._effectId = ef.id; // cache id for bulk update
        
        activeChipElements.push(chip);
        track.appendChild(chip);
      });
      trackWrapper.appendChild(track);
      return trackWrapper;
    };

    marqueeContainer.append(
      createTrack(track1Effects, 35, 'left'), // first row moves left
      createTrack(track2Effects, 40, 'right') // second row moves right
    );
    container.appendChild(marqueeContainer);

    // --- Custom Options Container (Fades in if a custom chip is active) ---
    const customOptionsWrap = document.createElement('div');
    customOptionsWrap.className = 'glo-custom-options-wrap';

    // Helpers
    const hslToHex = (h) => {
      const l = 0.5, a = Math.min(l, 1 - l);
      const f = n => {
        const k = (n + h / 30) % 12;
        return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      };
      const toH = x => Math.round(x * 255).toString(16).padStart(2, '0');
      return \`#\${toH(f(0))}\${toH(f(8))}\${toH(f(4))}\`;
    };
    const hueFromHex = (hex) => {
      const r = parseInt(hex.slice(1,3), 16)/255, g = parseInt(hex.slice(3,5), 16)/255, b = parseInt(hex.slice(5,7), 16)/255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
      if (max === min) return 0;
      return (max===r) ? ((g-b)/d + (g<b?6:0))/6 : (max===g) ? ((b-r)/d + 2)/6 : ((r-g)/d + 4)/6;
    };

    // Color Slider Factory
    const createSpectrum = (label, initialHex, onChange) => {
      const row = document.createElement('div');
      row.className = 'glo-spectrum-row';
      const lbl = document.createElement('div');
      lbl.className = 'glo-spectrum-label';
      lbl.textContent = label;
      const wrap = document.createElement('div');
      wrap.className = 'glo-spectrum-wrap';
      const thumb = document.createElement('div');
      thumb.className = 'glo-spectrum-thumb';
      thumb.style.left = \`\${(hueFromHex(initialHex) * 100).toFixed(1)}%\`;
      wrap.appendChild(thumb);
      
      const preview = document.createElement('div');
      preview.className = 'glo-spectrum-preview';
      preview.style.backgroundColor = initialHex;
      
      row.append(lbl, wrap, preview);

      let isDown = false;
      const updateThumb = (e) => {
        const rect = wrap.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        thumb.style.left = \`\${(t * 100).toFixed(1)}%\`;
        const nHex = hslToHex(Math.round(t * 360));
        preview.style.backgroundColor = nHex;
        onChange(nHex);
      };
      wrap.addEventListener('pointerdown', e => { isDown = true; wrap.setPointerCapture(e.pointerId); updateThumb(e); });
      wrap.addEventListener('pointermove', e => { if (isDown) updateThumb(e); });
      wrap.addEventListener('pointerup', () => isDown = false);
      wrap.addEventListener('pointercancel', () => isDown = false);
      
      return {row, thumb, preview};
    };

    const spec1 = createSpectrum('COLOR 1', gloColor, (hex) => { gloColor = hex; saveGlo(); });
    const spec2 = createSpectrum('COLOR 2', gloColor2, (hex) => { gloColor2 = hex; saveGlo(); });
    customOptionsWrap.append(spec1.row, spec2.row);
    container.appendChild(customOptionsWrap);

    // Dynamic UI Update
    updateUI = () => {
      activeChipElements.forEach(chip => {
        if (gloEffect === chip._effectId) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
      
      const isCustom = SIMPLE_EFFECTS.includes(gloEffect);
      if (isCustom) {
        customOptionsWrap.style.display = 'flex';
        // Add a slight delay trick to allow display:flex to apply before transition
        requestAnimationFrame(() => customOptionsWrap.classList.add('active'));
        spec2.row.style.display = (gloEffect === 'two-color') ? 'flex' : 'none';
        spec1.row.querySelector('.glo-spectrum-label').textContent = (gloEffect === 'two-color') ? 'COLOR 1' : 'COLOR';
      } else {
        customOptionsWrap.classList.remove('active');
        setTimeout(() => { if(!SIMPLE_EFFECTS.includes(gloEffect)) customOptionsWrap.style.display = 'none'; }, 300);
      }
    };
    updateUI(); // initial paint state
  }
`;

fs.writeFileSync(carPath, carPrefix + newCarCode + carSuffix);
console.log('Patched lobby-car.js');

// Patching lobby-style.css
const cssPath = 'src/lobby-style.css';
let cssContent = fs.readFileSync(cssPath, 'utf8');

const cssStartMarker = '/* ══════════════════════════════════════════════\n   GLO UNDERGLOW PICKER — LIQUID GLASS';
const cssStartMarker2 = '/* ══════════════════════════════════════════════\r\n   GLO UNDERGLOW PICKER — LIQUID GLASS';
const cssStart = Math.max(cssContent.indexOf(cssStartMarker), cssContent.indexOf(cssStartMarker2));

const endMatch = cssContent.match(/(@keyframes glo-anim-flicker \{[\s\S]*?\n\}\n)/);
if (cssStart === -1 || !endMatch) {
  console.error("Could not find lobby-style.css markers");
  process.exit(1);
}
const cssPrefix = cssContent.substring(0, cssStart);
const cssSuffix = cssContent.substring(endMatch.index + endMatch[0].length);

const newCssCode = `/* ══════════════════════════════════════════════
   GLO UNDERGLOW PICKER — LIVING MARQUEE MENU
══════════════════════════════════════════════ */

.glo-modern-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
}

/* Living Marquee Container with edge fades */
.glo-marquee-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  position: relative;
  width: 100%;
  padding: 5px 0;
  -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
}

.glo-track-wrapper {
  display: flex;
  width: 100%;
}

.glo-marquee-track {
  display: flex;
  gap: 10px;
  width: max-content;
  /* Hover to pause allows easy selection without chasing it */
  transition: filter 0.3s;
}

.glo-marquee-track:hover {
  animation-play-state: paused;
}

.glo-marquee-track.left {
  animation: marquee-left linear infinite;
}
.glo-marquee-track.right {
  animation: marquee-right linear infinite;
}

@keyframes marquee-left {
  0% { transform: translateX(0); }
  100% { transform: translateX(-33.3333%); } /* Travels one full set of the 3 repeated sets */
}
@keyframes marquee-right {
  0% { transform: translateX(-33.3333%); }
  100% { transform: translateX(0); }
}

.glo-chip {
  position: relative;
  height: 58px;
  width: 90px;
  flex-shrink: 0;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.15);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.25s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.2s, border-color 0.2s, filter 0.3s;
  box-shadow: 0 4px 10px rgba(0,0,0,0.3);
  /* slight perspective tilt trick */
  transform: perspective(600px) rotateY(-2deg);
}
.glo-marquee-track.right .glo-chip {
  transform: perspective(600px) rotateY(2deg);
}

.glo-chip:hover {
  transform: scale(1.05) perspective(600px) rotateY(0deg) !important;
  border-color: rgba(255,255,255,0.5);
  box-shadow: 0 6px 14px rgba(0,0,0,0.4);
  z-index: 3;
}
.glo-chip.active {
  border: 2px solid var(--neon-magenta);
  box-shadow: 0 0 14px var(--neon-magenta), inset 0 0 10px rgba(255,0,128,0.6);
  transform: scale(1.1) perspective(600px) rotateY(0deg) !important;
  z-index: 4;
}

/* Dim un-hovered chips when track is hovered */
.glo-marquee-track:hover .glo-chip:not(:hover):not(.active) {
  filter: grayscale(40%) brightness(0.6);
}

.glo-chip-bg {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  z-index: 1;
}
.glo-chip-lbl {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  background: linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,0.4) 70%, transparent 100%);
  color: #fff;
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: 0.58rem;
  letter-spacing: 0.05em;
  text-align: center;
  padding: 16px 2px 4px;
  z-index: 2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}

/* Custom Customization Options */
.glo-custom-options-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(0,0,0,0.2);
  border: 1px solid rgba(255,100,160,0.3);
  border-radius: 12px;
  padding: 12px;
  box-shadow: inset 0 2px 10px rgba(255,0,128,0.05), 0 4px 12px rgba(0,0,0,0.3);
  
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  padding-top: 0;
  padding-bottom: 0;
  border-width: 0;
  transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.glo-custom-options-wrap.active {
  max-height: 120px;
  opacity: 1;
  padding-top: 12px;
  padding-bottom: 12px;
  border-width: 1px;
}

.glo-spectrum-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.glo-spectrum-label {
  font-family: var(--font-ui);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--neon-cyan);
  width: 55px;
  text-transform: uppercase;
  text-align: right;
  text-shadow: 0 0 4px rgba(0,255,255,0.4);
}
.glo-spectrum-wrap {
  flex: 1;
  height: 20px;
  border-radius: 10px;
  background: linear-gradient(to right, #f00, #ff8c00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  position: relative;
  cursor: ew-resize;
  box-shadow: inset 0 2px 5px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.15);
}
.glo-spectrum-thumb {
  position: absolute;
  top: 50%;
  width: 26px; height: 26px;
  border-radius: 50%;
  background: #fff;
  border: 4px solid var(--lg-bg-base);
  transform: translate(-50%, -50%);
  box-shadow: 0 2px 8px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.5);
  pointer-events: none;
  transition: transform 0.1s;
}
.glo-spectrum-wrap:active .glo-spectrum-thumb {
  transform: translate(-50%, -50%) scale(1.15);
  box-shadow: 0 0 15px rgba(255,255,255,0.8);
}
.glo-spectrum-preview {
  width: 24px; height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.6);
  box-shadow: 0 2px 6px rgba(0,0,0,0.6), inset 0 2px 4px rgba(255,255,255,0.4);
}

/* Animations that are still used by Scenes */
@keyframes glo-anim-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.40; }
}
@keyframes glo-anim-strobe {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.05; }
}
@keyframes glo-anim-huerot {
  from { filter: hue-rotate(0deg); }
  to   { filter: hue-rotate(360deg); }
}
@keyframes glo-anim-chase {
  0%   { background-position: -100% 0; }
  100% { background-position: 200% 0; }
}
@keyframes glo-anim-flicker {
  0%, 85%, 100% { opacity: 1; }
  87%           { opacity: 0.3; }
  90%           { opacity: 0.9; }
  93%           { opacity: 0.2; }
}
`;

fs.writeFileSync(cssPath, cssPrefix + newCssCode);
console.log('Patched lobby-style.css');

