/**
 * playtest-bridge.js — Launch arena in realtime mode for playtesting.
 */

export class PlaytestBridge {
  /**
   * @param {import('./serializer.js').Serializer} serializer
   */
  constructor(serializer) {
    this._serializer = serializer;
  }

  /**
   * Launch playtest: saves TrackData to sessionStorage, opens realtime.html.
   * @param {string} name
   * @param {string} author
   */
  launch(name, author) {
    const json = this._serializer.exportJSON(name, author);
    const data = JSON.parse(json);

    // Validate minimum requirements
    if (!data.roadCells?.length && !data.segments?.length) {
      return { ok: false, reason: 'Place some track pieces or road cells before playtesting.' };
    }
    if (!data.startPositions?.length) {
      // Auto-generate a single spawn at the center of placed pieces
      const bounds = data.bounds || { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
      const cx = (bounds.min.x + bounds.max.x) / 2;
      const cz = (bounds.min.z + bounds.max.z) / 2;
      data.startPositions = [{ id: 1, position: { x: cx, y: 0, z: cz }, heading: 0 }];
    }

    // Store for runtime consumption
    sessionStorage.setItem('customTrackData', JSON.stringify(data));

    // Open realtime mode
    const url = new URL('/realtime.html', window.location.origin);
    url.searchParams.set('map', 'custom_import');
    url.searchParams.set('mode', 'battle');
    url.searchParams.set('fromBuilder', '1');
    window.open(url.toString(), '_blank');

    return { ok: true };
  }
}
