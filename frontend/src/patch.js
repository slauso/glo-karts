const fs = require('fs');
const path = './lobby-car.js';
let content = fs.readFileSync(path, 'utf8');

const startMarker = '// ── Pick-your-GLO panel builder';
const stopString = '  }\n}\n\ndocument.addEventListener';

const startIndex = content.indexOf(startMarker);
if (startIndex === -1) { console.error('Start not found'); process.exit(1); }

const endIndex = content.indexOf('document.addEventListener', startIndex);
if (endIndex === -1) { console.error('End not found'); process.exit(1); }

// Find the last closing brace of the class before the document listener
let beforeEnd = content.slice(0, endIndex);
let lastBrace = beforeEnd.lastIndexOf('}');
let classEndIndex = beforeEnd.lastIndexOf('}', lastBrace - 1); // the next to last brace

const prefix = content.slice(0, startIndex);
const suffix = content.slice(endIndex);

const newCode = `// ── Pick-your-GLO panel builder ───────────────────────────────
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
    const scenes = GLO_EFFECTS.filter(e => !SIMPLE_EFFECTS.includes(e.id));
    const simples = GLO_EFFECTS.filter(e => SIMPLE_EFFECTS.includes(e.id));

    // Tab Navigation
    const tabsRow = document.createElement('div');
    tabsRow.className = 'glo-tabs';
    const btnScenes = document.createElement('button');
    btnScenes.className = 'glo-tab' + (!SIMPLE_EFFECTS.includes(gloEffect) ? ' active' : '');
    btnScenes.textContent = '✨ SCENES';
    const btnCustom = document.createElement('button');
    btnCustom.className = 'glo-tab' + (SIMPLE_EFFECTS.includes(gloEffect) ? ' active' : '');
    btnCustom.textContent = '🎨 CUSTOM DIY';
    tabsRow.append(btnScenes, btnCustom);
    container.appendChild(tabsRow);

    // Panes
    const contentWrap = document.createElement('div');
    contentWrap.className = 'glo-panes-wrapper';
    const scenesPane = document.createElement('div');
    scenesPane.className = 'glo-pane glo-pane-scenes' + (!SIMPLE_EFFECTS.includes(gloEffect) ? ' active' : '');
    const customPane = document.createElement('div');
    customPane.className = 'glo-pane glo-pane-custom' + (SIMPLE_EFFECTS.includes(gloEffect) ? ' active' : '');
    contentWrap.append(scenesPane, customPane);
    container.appendChild(contentWrap);

    // Switch logic
    btnScenes.onclick = () => {
      btnScenes.classList.add('active'); btnCustom.classList.remove('active');
      scenesPane.classList.add('active'); customPane.classList.remove('active');
    };
    btnCustom.onclick = () => {
      btnCustom.classList.add('active'); btnScenes.classList.remove('active');
      customPane.classList.add('active'); scenesPane.classList.remove('active');
      if (!SIMPLE_EFFECTS.includes(gloEffect)) { gloEffect = 'solid'; updateUI(); saveGlo(); }
    };

    let updateUI; // Forward declare

    // --- SCENES PANE ---
    const scenesGrid = document.createElement('div');
    scenesGrid.className = 'glo-grid';
    scenes.forEach(ef => {
      const chip = document.createElement('div');
      chip.className = 'glo-chip' + (gloEffect === ef.id ? ' active' : '');
      const bg = document.createElement('div');
      bg.className = 'glo-chip-bg ' + (ANIM_CLASSES[ef.id] || '');
      bg.style.background = CHIP_BG[ef.id];
      const lbl = document.createElement('div');
      lbl.className = 'glo-chip-lbl';
      lbl.textContent = ef.label;
      chip.append(bg, lbl);
      chip.onclick = () => { gloEffect = ef.id; updateUI(); saveGlo(); };
      scenesGrid.appendChild(chip);
    });
    scenesPane.appendChild(scenesGrid);

    // --- CUSTOM PANE ---
    const customModesRow = document.createElement('div');
    customModesRow.className = 'glo-custom-modes';
    simples.forEach(ef => {
      const btn = document.createElement('button');
      btn.className = 'glo-custom-mode-btn' + (gloEffect === ef.id ? ' active' : '');
      const icon = document.createElement('span');
      // small icons just for fun
      let icn = '🔴';
      if(ef.id==='pulse') icn = '💓';
      if(ef.id==='strobe') icn = '⚡';
      if(ef.id==='chase') icn = '🌀';
      if(ef.id==='two-color') icn = '🌗';
      icon.innerText = icn;
      btn.append(icon, document.createTextNode(' ' + ef.label));
      
      btn.onclick = () => { gloEffect = ef.id; updateUI(); saveGlo(); };
      customModesRow.appendChild(btn);
    });
    customPane.appendChild(customModesRow);
    
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

    // Color Slider
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
    customPane.append(spec1.row, spec2.row);

    // Update Function
    updateUI = () => {
      Array.from(scenesGrid.children).forEach((chip, i) => {
        chip.className = 'glo-chip' + (gloEffect === scenes[i].id ? ' active' : '');
      });
      Array.from(customModesRow.children).forEach((btn, i) => {
        btn.className = 'glo-custom-mode-btn' + (gloEffect === simples[i].id ? ' active' : '');
      });
      spec2.row.style.display = (gloEffect === 'two-color') ? 'flex' : 'none';
      if (gloEffect === 'two-color') {
        spec1.row.querySelector('.glo-spectrum-label').textContent = 'COLOR 1';
      } else {
        spec1.row.querySelector('.glo-spectrum-label').textContent = 'COLOR';
      }
    };
    updateUI();
  }
}
`;

fs.writeFileSync(path, prefix + newCode + '\n' + suffix);
console.log('patched lobby-car.js!');
