const fs = require('fs');
const cssPath = 'src/lobby-style.css';
let css = fs.readFileSync(cssPath, 'utf8');

// Update body scrolling for safe responsive usage
css = css.replace(/body \{\s*font-family: [^\}]+;\s*color: [^\}]+;\s*background: [^\}]+;\s*overflow: hidden;\s*\}/m,
  (match) => match.replace('overflow: hidden;', 'overflow-y: auto;\n  overflow-x: hidden;\n  min-height: 100vh;')
);

// Update game-container
css = css.replace(/\.game-container \{[\s\S]*?z-index: 1;\s*\}/m,
  `.game-container {
  width: 100%;
  max-width: 1520px;
  min-height: calc(100vh - 4vh);
  padding: 2vh 16px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}`
);

// Update game-content grid structure (mobile first to desktop)
css = css.replace(/\.game-content \{[\s\S]*?align-items: stretch;\s*\}/m,
  `.game-content {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-areas: 'track kart lobby';
  gap: 24px;
  padding-top: 10px;
  align-items: stretch;
}`
);

// Remove existing panel height constraints and overflow constraints
css = css.replace(/\.panel\s*\{\s*min-height: 0;\s*overflow: hidden;\s*height: 100%;\s*align-self: stretch;\s*\}/m,
  `.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}`
);

css = css.replace(/\.glass-panel\s*\{[\s\S]*?flex-direction: column;\s*gap: 10px;\s*\}/m,
  `.glass-panel {
  position: relative;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 20px;
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  padding: 24px;   /* Increased padding for spacious feel */
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;       /* Increased gap */
}`
);

// Touch UI Improvements
css = css.replace(/\.btn-primary,[\s\S]*?font-weight: 800;[\s\S]*?\}/m,
  (match) => match.replace(/padding: 10px 18px;/, 'padding: 16px 24px;\n  min-height: 48px;').replace(/font-size: 1rem;/, 'font-size: 1.05rem;')
);

css = css.replace(/\.mode-selector\s*\{[\s\S]*?gap: 8px;\s*\}/m,
  `.mode-selector {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}`
);

css = css.replace(/\.mode-btn\s*\{[\s\S]*?padding: 8px 12px;[\s\S]*?\}/m,
  (match) => match.replace(/padding: 8px 12px;/, 'padding: 14px 12px;\n  min-height: 52px;').replace(/font-size: 0\.8rem;/, 'font-size: 0.95rem;')
);

// Replace fixed kart preview
css = css.replace(/#kart-preview-container\s*\{[\s\S]*?overflow: hidden;\s*\}/m,
  `#kart-preview-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  min-height: 240px;
  max-height: 400px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.4));
  overflow: hidden;
  margin-bottom: auto; /* Push things down */
}`
);

// Better inputs
css = css.replace(/\.input-group input,[\s\S]*?color: var\(--text\);\s*\}/m,
  (match) => {
    return match
      .replace(/padding: 10px 14px;/, 'padding: 16px 18px;\n  min-height: 52px;')
      .replace(/font-size: 1rem;/, 'font-size: 1.1rem;')
      .replace(/border-radius: var\(--radius-md\);/, 'border-radius: 12px;')
  }
);

// Replace the media queries completely at the bottom
css = css.replace(/@media \(max-width: 1280px\)[\s\S]*?@media \(orientation: portrait\) and \(max-width: 920px\) \{[\s\S]*?\}\s*\}/m,
  `/* Responsive Layout - Touch & Devices */
@media (max-width: 1280px) {
  .game-content {
    grid-template-columns: repeat(2, 1fr);
    grid-template-areas:
      'kart kart'
      'track lobby';
    gap: 20px;
  }
}

@media (max-width: 900px) {
  .game-container {
    padding: 16px 10px;
  }
  .game-content {
    grid-template-columns: 1fr;
    grid-template-areas:
      'kart'
      'track'
      'lobby';
    gap: 20px;
  }
  .glass-panel {
    padding: 20px;
  }
  #kart-preview-container {
    max-height: 350px;
  }
}

@media (max-width: 480px) {
  .game-title {
    font-size: 3rem;
  }
  .title-nav {
    flex-wrap: wrap;
    justify-content: center;
  }
  .mode-selector {
    grid-template-columns: 1fr;
  }
}`
);

fs.writeFileSync(cssPath, css);
console.log('CSS updated successfully.');
