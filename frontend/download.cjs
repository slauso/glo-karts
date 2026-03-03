const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://evilgames.eu/files/texture-packs/mk64-reloaded-v2025.07.20-gliden64-png-hd.zip';
const dest = path.join(__dirname, 'public', 'mk64-reloaded.zip');

console.log('Downloading...');
const file = fs.createWriteStream(dest);
https.get(url, function(response) {
  if (response.statusCode !== 200) {
    console.error('Failed to download, status code:', response.statusCode);
    process.exit(1);
  }
  response.pipe(file);
  file.on('finish', function() {
    file.close(() => {
      console.log('Download complete.');
    });
  });
}).on('error', function(err) {
  fs.unlink(dest, () => {});
  console.error('Error downloading:', err.message);
});
