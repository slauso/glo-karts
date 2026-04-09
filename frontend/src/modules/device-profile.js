export function detectDeviceProfile() {
  if (typeof navigator === 'undefined') return 'balanced';

  const ua = (navigator.userAgent || '').toLowerCase();
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const smallScreen = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;

  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isMobile = isIOS || isAndroid || /mobile/.test(ua);

  if (memory <= 2 || cores <= 2 || (isMobile && smallScreen)) {
    return 'lite';
  }

  if (memory >= 8 && cores >= 8 && !isMobile) {
    return 'full';
  }

  return 'balanced';
}

export function pickByManifestProfile(manifest, type, profile = 'balanced') {
  const fallback = Array.isArray(manifest?.[type]) ? manifest[type] : [];
  const profileMap = manifest?.profiles?.[profile];
  if (!profileMap || !Array.isArray(profileMap[type])) {
    return fallback;
  }

  const idSet = new Set(profileMap[type]);
  const selected = fallback.filter(item => idSet.has(item.id));
  return selected.length > 0 ? selected : fallback;
}
