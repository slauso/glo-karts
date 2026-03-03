const fs = require('fs');
const data = fs.readFileSync('C:/Users/laptop/twistedkart/frontend/public/models/stk/tracks/cocoa_temple/track.glb');
const str = data.toString('utf8');
const match = str.match(/"name":"[^"]*start[^"]*"/gi);
console.log(match);
