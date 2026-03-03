const fs = require('fs');
let html = fs.readFileSync('realtime.html', 'utf8');

// remove old countdown
html = html.replace(/<div id="countdown-overlay".*?>3<\/div>/, '');

const splashHtml = 
    <div id="splash-screen">
      <div class="splash-content">
        <h1 class="splash-title">TWISTED KART</h1>
        <h2 id="splash-mode">RACE - COCOA TEMPLE</h2>
        <div id="splash-players"></div>
        <div id="splash-status">WAITING FOR OTHERS...</div>
        <div id="splash-countdown"></div>
      </div>
    </div>
;
if (!html.includes('splash-screen')) {
    html = html.replace('<body>', '<body>\n' + splashHtml);
    fs.writeFileSync('realtime.html', html);
}

let css = fs.readFileSync('src/realtime-style.css', 'utf8');
const splashCss = 
#splash-screen {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  background: radial-gradient(circle at center, rgba(10,10,20,0.85) 0%, rgba(0,0,0,0.95) 100%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: white;
  transition: opacity 0.5s ease-in-out;
  backdrop-filter: blur(5px);
}
.splash-content {
  text-align: center;
  background: rgba(0,0,0,0.5);
  padding: 40px 80px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.1);
  box-shadow: 0 0 40px rgba(0,0,0,0.8);
}
.splash-title {
  font-family: 'Arial Black', sans-serif;
  font-size: 64px;
  margin: 0 0 10px 0;
  background: linear-gradient(to bottom, #ff0055, #ffaa00);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(255,0,85,0.5));
}
#splash-mode {
  color: #aaa;
  font-size: 24px;
  margin-top: 0;
  margin-bottom: 30px;
  text-transform: uppercase;
  letter-spacing: 4px;
}
#splash-players {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin: 30px 0;
  flex-wrap: wrap;
  max-width: 800px;
}
.splash-player {
  background: rgba(255,255,255,0.1);
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 18px;
  font-weight: bold;
}
#splash-countdown {
  font-family: 'Arial Black', sans-serif;
  font-size: 100px;
  color: #fff;
  text-shadow: 0 0 20px #ff0055, 4px 4px 0px #000;
  margin-top: 20px;
}
#splash-status {
  font-size: 20px;
  margin-top: 20px;
  color: #00e5ff;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
}
;
if (!css.includes('splash-screen')) {
    css += splashCss;
    fs.writeFileSync('src/realtime-style.css', css);
}
console.log("Patched HTML and CSS");
