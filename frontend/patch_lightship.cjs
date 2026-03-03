const fs = require("fs");
const cssPath = "src/lobby-style.css";
let css = fs.readFileSync(cssPath, "utf8");

// 1. Root variables - Deep premium aesthetic
css = css.replace(/:root \{[\s\S]*?--font-ui: [^\n]+;\n\}/m, `:root {
  --neon-cyan: #ffffff;
  --neon-yellow: #f4f4f4;
  --neon-blue: #111111;
  --neon-red: #ff3333;

  --bg-body: #050505;
  --bg-panel: linear-gradient(180deg, rgba(20, 20, 20, 0.5) 0%, rgba(8, 8, 12, 0.8) 100%);
  --bg-panel-soft: rgba(255, 255, 255, 0.03);
  --bg-input: rgba(255, 255, 255, 0.04);
  --bg-hover: rgba(255, 255, 255, 0.08);

  --text: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.65);
  --text-muted: rgba(255, 255, 255, 0.4);

  --border: rgba(255, 255, 255, 0.08);
  --border-highlight: rgba(255, 255, 255, 0.18);

  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 28px;
  --radius-pill: 9999px;

  --shadow-lg: 0 40px 80px rgba(0, 0, 0, 0.8), 0 10px 20px rgba(0, 0, 0, 0.4);
  --shadow-inner: inset 0 1px 1px rgba(255, 255, 255, 0.12);

  --font-display: 'Barlow Condensed', 'Helvetica Neue', sans-serif;
  --font-ui: 'Inter', 'Helvetica Neue', sans-serif;
}`);

// 2. Body background to feel more atmospheric
css = css.replace(/body \{\s*font-family: var\(--font-ui\);\s*color: var\(--text\);\s*background: [^\}]+;\s*overflow-y: auto;/m, `body {
  font-family: var(--font-ui);
  color: var(--text);
  background:
    radial-gradient(120% 100% at 50% -10%, rgba(200, 220, 255, 0.1) 0%, transparent 60%),
    radial-gradient(100% 100% at 50% 100%, rgba(100, 150, 255, 0.06) 0%, transparent 60%),
    var(--bg-body);
  overflow-y: auto;`);

// 3. Title typography - Massive & impressive
css = css.replace(/\.game-title \{[\s\S]*?color: #ffffff;\s*\}/m,
`.game-title {
  font-family: var(--font-display);
  font-size: clamp(4.5rem, 9vw, 9rem);
  letter-spacing: -0.015em;
  font-weight: 800;
  text-transform: uppercase;
  line-height: 0.8;
  background: linear-gradient(180deg, #ffffff 0%, #a0a5b0 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 15px 35px rgba(0, 0, 0, 0.8));
  margin-bottom: 0.5rem;
}`);

// 4. Panel Glassmorphism
css = css.replace(/\.glass-panel \{[\s\S]*?gap: 16px;\s*\/\*\s*Increased gap\s*\*\/\s*\}/m, `.glass-panel {
  position: relative;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-top: 1px solid var(--border-highlight);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg), var(--shadow-inner);
  backdrop-filter: blur(48px);
  -webkit-backdrop-filter: blur(48px);
  padding: 32px;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}`);

// 5. Animations - elegant staggered load
css += `
@keyframes elegantSlide {
  from { opacity: 0; transform: translateY(40px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.game-header { animation: elegantSlide 1s cubic-bezier(0.16, 1, 0.3, 1) 0s both; }
.panel-kart { animation: elegantSlide 1s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both; }
.panel-track { animation: elegantSlide 1s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both; }
.panel-lobby { animation: elegantSlide 1s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both; }
`;

// 6. Kart Preview Window - High-end studio lighting floor
css = css.replace(/#kart-preview-container \{[\s\S]*?margin-bottom: auto; \/\* Push things down \*\/\s*\}/m, `#kart-preview-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  min-height: 260px;
  max-height: 480px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: radial-gradient(circle at 50% 65%, rgba(200, 220, 255, 0.12), rgba(0, 0, 0, 0.8) 85%);
  box-shadow: inset 0 0 80px rgba(0,0,0,0.9);
  overflow: hidden;
  margin-bottom: auto;
}`);

// 7. Buttons - Pill shaped and luxurious
css = css.replace(/\.btn-primary, \.btn-primary:active, \.game-btn, \.glow-btn, \.glow-btn-green \{[\s\S]*?box-shadow: none !important; \}/m, `.btn-primary, .btn-primary:active, .game-btn, .glow-btn, .glow-btn-green {
  background: linear-gradient(180deg, #ffffff 0%, #e8e8e8 100%) !important;
  color: #000000 !important;
  border-color: transparent !important;
  box-shadow: 0 8px 30px rgba(255,255,255,0.15), inset 0 1px 1px #ffffff !important;
  border-radius: var(--radius-pill);
}`);

css = css.replace(/\.btn-mega,\n\s*#play-btn,\n\s*#battle-start-btn\s*\{[\s\S]*?letter-spacing: 0\.03em;\s*\}/m, `.btn-mega,
#play-btn,
#battle-start-btn {
  width: 100%;
  min-height: 72px;
  padding: 16px;
  font-size: 1.25rem;
  font-weight: 900;
  letter-spacing: 0.05em;
  border-radius: var(--radius-pill);
  text-transform: uppercase;
  margin-top: auto;
}`);

// 8. Catalog Cards - Glassy and tactile
css = css.replace(/\.catalog-card \{[\s\S]*?background: rgba\(255, 255, 255, 0\.05\);\s*/m, `.catalog-card {
  width: 100%;
  padding: 16px 20px;
  min-height: 64px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--bg-input);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`);

css = css.replace(/\.catalog-card:hover \{[\s\S]*?box-shadow: var\(--shadow-neon-cyan\);\s*\}/m, `.catalog-card:hover {
  transform: translateY(-2px);
  background: var(--bg-hover);
  border-color: rgba(255, 255, 255, 0.3);
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}`);

css = css.replace(/\.catalog-card\.active \{[\s\S]*?box-shadow: 0 0 0\.3rem rgba\(255, 234, 0, 0\.35\);\s*\}/m, `.catalog-card.active {
  border-color: #ffffff;
  background: rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 24px rgba(0,0,0,0.4), inset 0 0 0 1px #ffffff;
}`);

// 9. Mode Button Toggles (Pill Selectors)
css = css.replace(/\.mode-btn \{[\s\S]*?transition: 0\.18s ease;\s*\}/m, `.mode-btn {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-pill);
  background: var(--bg-input);
  color: var(--text-secondary);
  padding: 14px 18px;
  min-height: 52px;
  font-weight: 700;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}`);

css = css.replace(/\.mode-btn\.active \{[\s\S]*?box-shadow: var\(--shadow-neon-cyan\);\s*\}/m, `.mode-btn.active {
  background: #ffffff;
  color: #000000;
  border-color: #ffffff;
  box-shadow: 0 6px 20px rgba(255,255,255,0.2);
}`);

// Make section titles pop
css = css.replace(/\.section-title \{\s*font-size: 1\.28rem;\s*\}/m,
`.section-title {
  font-size: 1.8rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #ffffff;
  border-bottom: 1px solid var(--border);
  padding-bottom: 12px;
  margin-bottom: 8px;
}`);

fs.writeFileSync(cssPath, css);
console.log("Lightship style updated!");
