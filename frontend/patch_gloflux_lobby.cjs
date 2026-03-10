const fs = require('fs');
let r = fs.readFileSync('realtime.html', 'utf8');

// Regex for extracting CSS
let cssMatch = r.match(/(\/\*\s*[^\*]*Prematch Lobby[\s\S]*?)<\/style>/i);
if (!cssMatch) {
    console.log('No CSS match found');
    process.exit(1);
}
let css = cssMatch[1];

let htmlMatch = r.match(/(<!-- Prematch Lobby Screen -->[\s\S]*?<div class="pm-countdown-num" id="pm-countdown">.*?<\/div>\s*<\/div>\s*<\/div>)/i);
if (!htmlMatch) {
    console.log('No HTML match found');
    process.exit(1);
}
let html = htmlMatch[1];

let g = fs.readFileSync('gloflux.html', 'utf8');

if (!g.includes('id="prematch-lobby"')) {
    g = g.replace('</style>', '\n' + css + '\n</style>');
    g = g.replace('<!-- 3D Canvas -->', html + '\n    <!-- 3D Canvas -->');
    fs.writeFileSync('gloflux.html', g);
    console.log('gloflux.html updated successfully with lobby UI!');
} else {
    console.log('gloflux.html already has lobby UI.');
}