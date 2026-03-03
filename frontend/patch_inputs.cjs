const fs = require('fs');
const cssPath = 'src/lobby-style.css';
let css = fs.readFileSync(cssPath, 'utf8');

css = css.replace(/\.glass-input,[\s\S]*?outline: none;\s*\}/m, 
  (match) => match
    .replace(/padding: 10px;/, 'padding: 16px 18px;\n  min-height: 52px;\n  font-size: 1.1rem;')
    .replace(/border-radius: 10px;/, 'border-radius: 12px;')
);

fs.writeFileSync(cssPath, css);
console.log('Inputs updated');
