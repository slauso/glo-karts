const fs = require('fs');

const css = `
/* GloFLUX Mode Card Flourishes */
.mode-card[data-mode-id="gloflux"] {
  border-color: rgba(var(--glo-rgb), 0.5);
  background: rgba(var(--glo-rgb), 0.05);
  overflow: visible;
}
.mode-card[data-mode-id="gloflux"] .mode-card-icon {
  background: #fff;
  color: #000;
  border-radius: 50%;
  box-shadow: 0 0 10px rgba(var(--glo-rgb), 0.8), 0 0 20px rgba(var(--glo-rgb), 0.5);
  animation: fluxPulse 2s infinite alternate;
}
@keyframes fluxPulse {
  0% { box-shadow: 0 0 5px rgba(var(--glo-rgb), 0.4); transform: scale(0.95); }
  100% { box-shadow: 0 0 15px rgba(var(--glo-rgb), 0.9), 0 0 25px rgba(var(--glo-rgb), 0.6); transform: scale(1.05); }
}
.mode-card[data-mode-id="gloflux"].active .mode-card-icon {
  background: var(--accent);
  color: #fff;
}
.mode-card[data-mode-id="gloflux"]:hover .mode-card-icon {
  background: var(--accent);
  color: #fff;
}
`;

let code = fs.readFileSync('src/lobby-style.css', 'utf8');
if (!code.includes('GloFLUX Mode Card')) {
    fs.appendFileSync('src/lobby-style.css', css);
    console.log('Appended CSS');
} else {
    console.log('CSS already appended');
}
