import { readFile } from 'node:fs/promises';
const s = JSON.parse(await readFile('dev-snapshots/banked-physics/samples.json', 'utf8'));
for (const x of s) {
  if (x.z > -5000 && x.z < 200000) {
    console.log(`t=${x.t.toFixed(2)} pos=(${x.x.toFixed(0)},${x.y.toFixed(0)},${x.z.toFixed(0)}) v=(${x.vx.toFixed(0)},${x.vy.toFixed(0)},${x.vz.toFixed(0)}) sp=${Math.hypot(x.vx,x.vz).toFixed(0)}`);
  }
}
