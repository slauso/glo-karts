/**
 * track-thumb.js — tiny isometric SVG snapshot of a track placement list.
 *
 * Used by the studio landing tiles to give each template/community card
 * a recognisable preview without spinning up a full Three.js scene. Pure
 * function: takes the same `placements` array the editor consumes and
 * returns an SVG string ready to drop into innerHTML.
 *
 * Pieces are drawn as flat top-down quads in an isometric projection;
 * elevated cells (plateau / bridge tiers) get a subtle vertical offset
 * + side wall so the elevation reads at a glance.
 */

import { getFootprint, getCellTiers, rotateCell, SEGMENTS } from './segments.js';

// Visual style per category. Keys not in SEGMENTS fall through to ROAD.
const STYLE = {
  road:     { fill: '#1d1d22', stroke: '#3a3a44' },
  height:   { fill: '#262229', stroke: '#3a3a44' },
  junction: { fill: '#1f2230', stroke: '#3a3a44' },
  bridge:   { fill: '#23202c', stroke: '#3a3a44' },
  special:  { fill: '#1d1d22', stroke: '#3a3a44' },
  combat:   { fill: '#251c22', stroke: '#3a3a44' },
};
const SPAWN_FILL  = '#00e5ff';
const FINISH_FILL = '#ffffff';

// Iso projection constants (classic 2:1 dimetric).
const COS_A = Math.cos(Math.PI / 6);   // ≈ 0.866
const SIN_A = Math.sin(Math.PI / 6);   // 0.5
const TIER_LIFT = 0.55;                // cell-units of vertical lift per tier

/**
 * Render an SVG isometric thumbnail of a track.
 * @param {Array<{k:string,x:number,z:number,r:number}>} placements
 * @param {{ width?:number, height?:number, padding?:number }} opts
 * @returns {string} SVG markup
 */
export function renderTrackThumb(placements, { width = 320, height = 180, padding = 14 } = {}) {
  if (!Array.isArray(placements) || placements.length === 0) {
    return _emptySvg(width, height);
  }

  // 1) Expand each placement into a flat list of {gx, gz, tier, key, idx}
  //    cells, where idx is the placement's order (so spawn/finish overlays
  //    paint on top of their footprint cell).
  const cells = [];
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const fp = getFootprint(p.k);
    const tiers = getCellTiers(p.k);
    for (let c = 0; c < fp.length; c++) {
      const [rx, rz] = rotateCell(fp[c][0], fp[c][1], p.r | 0);
      cells.push({
        gx: (p.x | 0) + rx,
        gz: (p.z | 0) + rz,
        tier: tiers[c] || 0,
        key: p.k,
      });
    }
  }

  // 2) Project to iso, find the bounding box, then scale to fit canvas.
  const projected = cells.map((cell) => {
    // Centre of the cell in iso 2D space (before scale + translate).
    const ix = (cell.gx - cell.gz) * COS_A;
    const iy = (cell.gx + cell.gz) * SIN_A - cell.tier * TIER_LIFT;
    return { ...cell, ix, iy };
  });

  // Each cell occupies 1 unit in grid space → ±COS_A wide, ±SIN_A tall in iso.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of projected) {
    if (c.ix - COS_A < minX) minX = c.ix - COS_A;
    if (c.ix + COS_A > maxX) maxX = c.ix + COS_A;
    if (c.iy - SIN_A < minY) minY = c.iy - SIN_A;
    if (c.iy + SIN_A > maxY) maxY = c.iy + SIN_A;
  }
  const innerW = width  - padding * 2;
  const innerH = height - padding * 2;
  const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
  const tx = padding + (innerW - (maxX - minX) * scale) / 2 - minX * scale;
  const ty = padding + (innerH - (maxY - minY) * scale) / 2 - minY * scale;

  // 3) Sort painters back-to-front (smaller iy → further away).
  projected.sort((a, b) => (a.iy - b.iy) || (a.tier - b.tier));

  // 4) Emit SVG — top diamond + (for elevated cells) two side wall quads.
  const dx = COS_A * scale;
  const dy = SIN_A * scale;
  const lift = TIER_LIFT * scale;
  const polys = [];
  for (const c of projected) {
    const cx = c.ix * scale + tx;
    const cy = c.iy * scale + ty;
    const def = SEGMENTS[c.key];
    const cat = def?.category || 'road';
    const style = STYLE[cat] || STYLE.road;

    // Side walls for elevated cells (drawn first so the top sits on top).
    if (c.tier > 0) {
      // Front-left wall.
      const w1 = `M ${cx - dx},${cy} L ${cx - dx},${cy + lift} L ${cx},${cy + dy + lift} L ${cx},${cy + dy} Z`;
      // Front-right wall.
      const w2 = `M ${cx + dx},${cy} L ${cx + dx},${cy + lift} L ${cx},${cy + dy + lift} L ${cx},${cy + dy} Z`;
      polys.push(`<path d="${w1}" fill="#0d0d11" stroke="${style.stroke}" stroke-width="0.6"/>`);
      polys.push(`<path d="${w2}" fill="#16161c" stroke="${style.stroke}" stroke-width="0.6"/>`);
    }

    // Top diamond.
    const top = `M ${cx},${cy - dy} L ${cx + dx},${cy} L ${cx},${cy + dy} L ${cx - dx},${cy} Z`;
    polys.push(`<path d="${top}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="0.6"/>`);

    // Spawn / finish accents.
    if (c.key === 'spawn') {
      polys.push(`<circle cx="${cx}" cy="${cy}" r="${Math.max(2, scale * 0.18)}" fill="${SPAWN_FILL}" opacity="0.85"/>`);
    } else if (c.key === 'finish') {
      const fw = dx * 0.9;
      const fh = dy * 0.4;
      polys.push(`<rect x="${cx - fw / 2}" y="${cy - fh / 2}" width="${fw}" height="${fh}" fill="${FINISH_FILL}" opacity="0.85"/>`);
    }
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="thumbBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1a1620"/>
          <stop offset="1" stop-color="#0e0c12"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#thumbBg)"/>
      ${polys.join('')}
    </svg>
  `;
}

function _emptySvg(width, height) {
  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#0e0c12"/>
      <text x="50%" y="50%" fill="#5a5566" font-family="Exo 2, sans-serif"
            font-size="11" text-anchor="middle" dominant-baseline="middle">no preview</text>
    </svg>
  `;
}
