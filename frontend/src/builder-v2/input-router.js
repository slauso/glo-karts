/**
 * input-router.js - Keyboard and mouse dispatch for tools and shortcuts.
 */

export const TOOL = Object.freeze({
  SELECT: 'select',
  ROAD: 'road',
  PLACE: 'place',
  ERASE: 'erase',
});

export class InputRouter {
  /**
   * @param {HTMLElement} canvas
   * @param {Object} handlers
   * @param {(tool: string) => void} handlers.onToolChange
   * @param {(ndcX: number, ndcY: number, event: PointerEvent) => void} handlers.onPointerDown
   * @param {(ndcX: number, ndcY: number, event: PointerEvent) => void} handlers.onPointerMove
   * @param {(ndcX: number, ndcY: number, event: PointerEvent) => void} handlers.onPointerUp
   * @param {() => void} handlers.onUndo
   * @param {() => void} handlers.onRedo
   * @param {() => void} handlers.onDelete
   * @param {() => void} handlers.onDuplicate
   * @param {() => void} handlers.onSelectAll
   * @param {() => void} handlers.onEscape
   * @param {() => void} handlers.onSave
   * @param {() => void} [handlers.onCopy]
   * @param {() => void} [handlers.onPaste]
   * @param {() => void} handlers.onRotate
   * @param {() => void} handlers.onToggleGrid
   * @param {() => void} handlers.onToggleCam
   * @param {() => void} handlers.onFocus
   * @param {() => void} handlers.onTopView
   * @param {() => void} handlers.onToggleHelp
   * @param {(dx: number, dz: number, modifiers: { shift: boolean, alt: boolean }) => void} handlers.onNudge
   * @param {(mode: string) => void} handlers.onGizmoMode
   */
  constructor(canvas, handlers) {
    this._canvas = canvas;
    this._h = handlers;
    this.tool = TOOL.SELECT;
    this._pointerDown = false;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  setTool(tool) {
    this.tool = tool;
    this._h.onToolChange(tool);
  }

  _ndc(e) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    this._pointerDown = true;
    const ndc = this._ndc(e);
    this._h.onPointerDown(ndc.x, ndc.y, e);
  }

  _onPointerMove(e) {
    const ndc = this._ndc(e);
    this._h.onPointerMove(ndc.x, ndc.y, e);
  }

  _onPointerUp(e) {
    if (e.button !== 0) return;
    this._pointerDown = false;
    const ndc = this._ndc(e);
    this._h.onPointerUp(ndc.x, ndc.y, e);
  }

  _onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const key = e.key;
    const lower = typeof key === 'string' ? key.toLowerCase() : key;

    if (ctrl && !shift && lower === 'z') { e.preventDefault(); this._h.onUndo(); return; }
    if (ctrl && lower === 'y') { e.preventDefault(); this._h.onRedo(); return; }
    if (ctrl && shift && key === 'Z') { e.preventDefault(); this._h.onRedo(); return; }
    if (ctrl && lower === 's') { e.preventDefault(); this._h.onSave(); return; }
    if (ctrl && lower === 'a') { e.preventDefault(); this._h.onSelectAll(); return; }
    if (ctrl && !shift && lower === 'c') { e.preventDefault(); this._h.onCopy?.(); return; }
    if (ctrl && !shift && lower === 'v') { e.preventDefault(); this._h.onPaste?.(); return; }
    if (ctrl && lower === 'd') { e.preventDefault(); this._h.onDuplicate?.(); return; }

    if (key === '1') { this.setTool(TOOL.SELECT); return; }
    if (key === '2') { this.setTool(TOOL.ROAD); return; }
    if (key === '3') { this.setTool(TOOL.PLACE); return; }
    if (key === '4') { this.setTool(TOOL.ERASE); return; }

    if (lower === 'g' && !ctrl && !shift) { this._h.onToggleGrid(); return; }
    if (lower === 'c' && !ctrl && !shift) { this._h.onToggleCam(); return; }
    if (lower === 'f' && !ctrl && !shift) { e.preventDefault(); this._h.onFocus?.(); return; }
    if (lower === 'w' && !ctrl && !shift) { e.preventDefault(); this._h.onTopView?.(); return; }
    if ((key === '?' || (key === '/' && shift)) && !ctrl) { e.preventDefault(); this._h.onToggleHelp?.(); return; }

    if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); this._h.onDelete(); return; }
    if (key === 'Escape') { this._h.onEscape(); return; }
    if (lower === 'r' && !ctrl && !shift) { this._h.onRotate?.(); return; }
    if (lower === 'l' && !ctrl && !shift) { e.preventDefault(); this._h.onCycleLayer?.(); return; }

    if (key === 'ArrowUp') { e.preventDefault(); this._h.onNudge?.(0, -1, { shift, alt }); return; }
    if (key === 'ArrowDown') { e.preventDefault(); this._h.onNudge?.(0, 1, { shift, alt }); return; }
    if (key === 'ArrowLeft') { e.preventDefault(); this._h.onNudge?.(-1, 0, { shift, alt }); return; }
    if (key === 'ArrowRight') { e.preventDefault(); this._h.onNudge?.(1, 0, { shift, alt }); return; }
  }

  dispose() {
    this._canvas.removeEventListener('pointerdown', this._onPointerDown);
    this._canvas.removeEventListener('pointermove', this._onPointerMove);
    this._canvas.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
  }
}
