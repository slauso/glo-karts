const fs = require('fs');
const cssPath = 'src/lobby-style.css';
let css = fs.readFileSync(cssPath, 'utf8');

css = css.replace(/padding: 10px 12px;([\s\S]*?)font-weight: 800;/m, 
  'padding: 16px 20px;\n    min-height: 48px;\n    -weight: 800;'
);

css = css.replace(/\.btn-mega,[\s\S]*?min-height: 46px;[\s\S]*?\}/m, 
  (match) => match.replace(/min-height: 46px;/, 'min-height: 58px;\n    padding: 18px;').replace(/font-size: 0\.96rem;/, 'font-size: 1.1rem; font-weight: 900;')
);

fs.writeFileSync(cssPath, css);
console.log('Buttons updated');
