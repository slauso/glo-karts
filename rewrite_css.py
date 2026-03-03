import re

with open('frontend/src/lobby-style.css', 'r', encoding='utf-8') as f:
    css = f.read()

# Remove old .game-content grid layout
css = re.sub(r'\.game-content\s*\{[^}]+\}', '', css)

# Add new layout CSS
new_css = '''
/* --- NEW CLEAN LAYOUT --- */
.game-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 2rem 4rem;
  position: relative;
  z-index: 1;
}

.game-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
}

.header-left {
  display: flex;
  flex-direction: column;
}

.header-right {
  display: flex;
  align-items: center;
}

.profile-section .input-group {
  display: flex;
  align-items: center;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  padding: 0.5rem 1rem;
  backdrop-filter: blur(10px);
}

.profile-icon {
  color: var(--nx-red);
  margin-right: 0.8rem;
  font-size: 1.2rem;
}

#player-name-input {
  background: transparent;
  border: none;
  color: var(--text-inverse);
  font-family: var(--font-ui);
  font-size: 1.1rem;
  font-weight: 600;
  outline: none;
  width: 150px;
}

.main-layout {
  display: flex;
  flex: 1;
  gap: 4rem;
  min-height: 0;
}

.side-nav {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 250px;
  padding-top: 2rem;
}

.nav-item {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 700;
  text-align: left;
  padding: 1rem 1.5rem;
  cursor: pointer;
  transition: all var(--transition);
  border-left: 4px solid transparent;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.nav-item:hover {
  color: var(--text-inverse);
  background: var(--bg-hover);
  transform: translateX(10px);
}

.nav-item.active {
  color: var(--nx-red);
  border-left-color: var(--nx-red);
  background: linear-gradient(90deg, rgba(0,243,255,0.1) 0%, transparent 100%);
}

.content-area {
  flex: 1;
  position: relative;
  max-width: 600px; /* Keep panels constrained so 3D car is visible on right */
}

.menu-section {
  display: none;
  animation: slideIn 0.3s ease forwards;
}

.menu-section.active {
  display: flex;
  flex-direction: column;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}

.bottom-bar {
  position: absolute;
  bottom: 2rem;
  right: 4rem;
  display: flex;
  align-items: flex-end;
  gap: 2rem;
}

/* Adjust glass panels for new layout */
.glass-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 2rem;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: var(--shadow-lg);
  max-height: 100%;
  overflow-y: auto;
  position: relative;
}

/* Hide old title nav */
.title-nav {
  display: none;
}

/* Responsive */
@media (max-width: 1024px) {
  .game-container { padding: 1rem; }
  .main-layout { flex-direction: column; gap: 2rem; }
  .side-nav { width: 100%; flex-direction: row; justify-content: center; padding-top: 0; }
  .nav-item { font-size: 1.2rem; padding: 0.5rem 1rem; border-left: none; border-bottom: 3px solid transparent; }
  .nav-item.active { border-left-color: transparent; border-bottom-color: var(--nx-red); background: linear-gradient(0deg, rgba(0,243,255,0.1) 0%, transparent 100%); }
  .nav-item:hover { transform: translateY(-5px); }
  .content-area { max-width: 100%; }
  .bottom-bar { position: static; justify-content: center; margin-top: 2rem; }
}

/* --- LIVING UI ENHANCEMENTS --- */
.glass-panel::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: conic-gradient(
    transparent, 
    rgba(0, 243, 255, 0.1), 
    transparent 30%
  );
  animation: rotateGlow 10s linear infinite;
  z-index: -1;
  pointer-events: none;
}

@keyframes rotateGlow {
  100% { transform: rotate(360deg); }
}

.nav-item::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: var(--nx-red);
  transform: scaleX(0);
  transform-origin: right;
  transition: transform 0.3s ease;
}

.nav-item:hover::after {
  transform: scaleX(1);
  transform-origin: left;
}

.nav-item.active::after {
  transform: scaleX(1);
}

.bottom-bar {
  animation: floatUp 0.5s ease-out forwards;
  animation-delay: 0.2s;
  opacity: 0;
  transform: translateY(20px);
}

@keyframes floatUp {
  to { opacity: 1; transform: translateY(0); }
}

.hero-carousel {
  width: auto !important;
  max-width: 400px;
}
'''

# Append new CSS
css += new_css

with open('frontend/src/lobby-style.css', 'w', encoding='utf-8') as f:
    f.write(css)

print("Updated lobby-style.css")
