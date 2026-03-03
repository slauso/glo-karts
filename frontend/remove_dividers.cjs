const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// remove hr dividers
html = html.replace(/<hr class="divider">/g, '');

// remove or-dividers
html = html.replace(/<p class="or-divider"><span>OR<\/span><\/p>/g, '');

fs.writeFileSync('index.html', html);
