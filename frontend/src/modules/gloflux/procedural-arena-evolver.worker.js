const DEFAULT_PATCH_SIZE = 24;

function seededNoise(seed, x, z, scale) {
  const nx = x * scale + seed * 0.00173;
  const nz = z * scale + seed * 0.00217;
  return Math.sin(nx * 1.83) * Math.cos(nz * 1.29) + Math.sin((nx + nz) * 0.91) * 0.5;
}

function buildPatchHeights({ seed, patchX, patchZ, patchSize, amplitude, scale, familyBias, chainStrength }) {
  const heights = new Array(patchSize * patchSize);
  for (let z = 0; z < patchSize; z += 1) {
    for (let x = 0; x < patchSize; x += 1) {
      const sampleX = patchX + x;
      const sampleZ = patchZ + z;
      const base = seededNoise(seed, sampleX, sampleZ, scale);
      const radialX = (x / Math.max(1, patchSize - 1)) * 2 - 1;
      const radialZ = (z / Math.max(1, patchSize - 1)) * 2 - 1;
      const falloff = Math.max(0, 1 - Math.sqrt(radialX * radialX + radialZ * radialZ));
      heights[z * patchSize + x] = base * amplitude * falloff * familyBias * chainStrength;
    }
  }
  return heights;
}

self.onmessage = (event) => {
  const { type, payload } = event.data || {};
  if (type !== 'generatePatch') return;

  const result = {
    patchId: payload.patchId,
    patchX: payload.patchX,
    patchZ: payload.patchZ,
    patchSize: payload.patchSize || DEFAULT_PATCH_SIZE,
    familyId: payload.familyId,
    comboId: payload.comboId,
    heights: buildPatchHeights(payload),
    chainStrength: payload.chainStrength,
    generatedAt: Date.now(),
  };

  self.postMessage({ type: 'patchGenerated', payload: result });
};