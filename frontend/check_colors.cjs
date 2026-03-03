const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/laptop/twistedkart/frontend/public/textures/block_fort';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.png'));

files.forEach(f => {
    const buf = fs.readFileSync(path.join(dir, f));
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    // IHDR chunk: length (4), type (4), width (4), height (4), bit depth (1), color type (1), compression (1), filter (1), interlace (1)
    // IDAT chunk: length (4), type (4), data...
    
    // Let's just use a simple approach: we know the file sizes.
    console.log(f, buf.length);
});
