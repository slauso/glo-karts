const fs = require('fs');
let code = fs.readFileSync('src/lobby-style.css', 'utf8');

const additionalCss = 

/* GloFLUX Mode Card Flourishes */
.mode-card[data-mode-id="gloflux"] {
  border-color: rgba(var(--glo-rgb), 0.5);
  background: rgba(var(--glo-rgb), 0.05);
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
  background: rgba(var(--glo-rgb), 1);
  color: #fff;
}
;

if (!code.includes('GloFLUX Mode Card')) {
    code += additionalCss;
    fs.writeFileSync('src/lobby-style.css', code);
    console.log('CSS updated');
} else {
    console.log('CSS already updated');
}
