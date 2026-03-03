const fs = require("fs");
const cssPath = "src/lobby-style.css";
let css = fs.readFileSync(cssPath, "utf8");

// Wipe out Lightship gradients and go pure bold Smashkarts style
// 1. Panels
css = css.replace(/\.glass-panel \{[\s\S]*?gap: 10px;\s*\}/m, 
`.glass-panel {
  position: relative;
  background: rgba(12, 16, 24, 0.65);
  border: none;
  border-radius: 20px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  padding: 24px;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}`);

// 2. Buttons
css = css.replace(/\.btn-primary,[\s\S]*?border-radius: 12px;[\s\S]*?\}/m,
`.btn-primary,
.btn-secondary,
.btn-danger,
.btn-mega,
.game-btn,
.icon-btn,
.btn-icon,
.glow-btn,
.glow-btn-green,
.glow-btn-red {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 14px;
  padding: 14px 18px;
  min-height: 48px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  background: #00d26a !important; /* Smashkarts / Krunker vibrant green */
  color: #ffffff !important;
  border-color: transparent !important;
  box-shadow: 0 6px 0 #00a050 !important; /* Thick bottom border for 3D tactile feel */
}`);

css = css.replace(/\.btn-mega,[\s\S]*?letter-spacing: 0\.03em;\s*\}/m,
`.btn-mega,
#play-btn,
#battle-start-btn {
  width: 100%;
  min-height: 80px;
  padding: 16px;
  font-size: 1.6rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  border-radius: 16px;
  text-transform: uppercase;
  margin-top: auto;
  background: #00d26a !important;
  color: #fff !important;
  border: none !important;
  box-shadow: 0 8px 0 #00a050 !important;
  transition: transform 0.1s, box-shadow 0.1s;
}
.btn-mega:active, #play-btn:active, #battle-start-btn:active {
  transform: translateY(8px);
  box-shadow: 0 0 0 #00a050 !important;
}`);


css = css.replace(/\.btn-primary:active,[\s\S]*?transform: translateY\(0\);\s*\}/m,
`.btn-primary:active,
.btn-secondary:active,
.btn-danger:active,
.btn-icon:active,
.game-btn:active {
  transform: translateY(6px);
  box-shadow: none !important;
}`);

css = css.replace(/\.btn-secondary, \.btn-icon \{[\s\S]*?border-color: rgba\(255,255,255,0\.3\); \}/m,
`.btn-secondary, .btn-icon { 
  background: #445577 !important; 
  color: #ffffff !important; 
  border: none !important; 
  box-shadow: 0 6px 0 #2b364d !important; 
  border-radius: 12px;
}`);

css = css.replace(/\.btn-danger, \.glow-btn-red \{[\s\S]*?box-shadow: none; \}/m,
`.btn-danger, .glow-btn-red { 
  background: #ff3333 !important; 
  color: #ffffff !important; 
  border: none !important; 
  box-shadow: 0 6px 0 #cc0000 !important; 
  border-radius: 12px;
}`);

// 3. Inputs - Chunky and solid
css = css.replace(/\.glass-input,[\s\S]*?outline: none;\s*\}/m,
`.glass-input,
.glass-input-small,
.glass-select,
#battle-score-limit,
#battle-weapon-set,
#singleplayer-race-mode,
#singleplayer-cup,
#battle-arena-select,
#player-name-input,
#join-code-input,
input,
select {
  border: none;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 12px;
  color: #fff;
  padding: 16px 20px;
  min-height: 52px;
  font-size: 1.2rem;
  font-weight: 700;
  outline: none;
  box-shadow: inset 0 4px 10px rgba(0,0,0,0.5);
}`);

// 4. Kart Preview - Blend it in
css = css.replace(/#kart-preview-container \{[\s\S]*?overflow: hidden;\s*\n\}/m,
`#kart-preview-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  min-height: 260px;
  max-height: 480px;
  border-radius: 16px;
  background: transparent;
  border: none;
  box-shadow: none;
  overflow: visible;
  margin-bottom: auto;
}`);

// 5. Titles / Typography - Big and bold
css = css.replace(/\.section-title \{\s*font-size: 1\.28rem;\s*\}/m,
`.section-title {
  font-size: 1.6rem;
  font-weight: 900;
  letter-spacing: 0.02em;
  color: #ffffff;
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 4px;
  text-transform: uppercase;
  text-shadow: 0 4px 6px rgba(0,0,0,0.6);
}`);

// 7. Simplify Catalog Cards
css = css.replace(/\.catalog-card \{[\s\S]*?transition: 0\.18s ease;\s*\n\}/m,
`.catalog-card {
  width: 100%;
  padding: 14px 18px;
  min-height: 60px;
  border-radius: 12px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  font-weight: 800;
  text-transform: uppercase;
  box-shadow: 0 4px 0 rgba(0,0,0,0.2);
  transition: 0.1s ease;
}`);

css = css.replace(/\.catalog-card\.active \{[\s\S]*?box-shadow: 0 0 0\.3rem rgba\(255, 234, 0, 0\.35\);\s*\n\}/m,
`.catalog-card.active {
  border: none;
  background: #ffcc00;
  color: #000;
  border-radius: 12px;
  box-shadow: 0 4px 0 #cc9900;
}`);

// 8. Toggles / Mode Buttons
css = css.replace(/\.mode-btn \{[\s\S]*?transition: 0\.18s ease;\s*\n\}/m,
`.mode-btn {
  border: none;
  border-radius: 12px;
  background: rgba(255,255,255,0.1);
  color: #ddd;
  padding: 14px 18px;
  min-height: 52px;
  font-weight: 800;
  font-size: 1.05rem;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 4px 0 rgba(0,0,0,0.2);
  transition: transform 0.1s, box-shadow 0.1s;
}`);

// Hide specific elements that cause clutter
css += `
.preview-placeholder { display: none; }
.selection-pill {
  background: rgba(0,0,0,0.3);
  border: none;
  border-radius: 8px;
  font-weight: 700;
  text-transform: uppercase;
}
`;

fs.writeFileSync(cssPath, css);
console.log("Applied SmashKarts style (rev 2)!");
