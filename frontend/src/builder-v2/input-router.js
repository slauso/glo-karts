/**
 * input-router.js — Keyboard + mouse event dispatch to tools & shortcuts.
 */

export const TOOL = Object.freeze({
  SELECT: 'select',
  ROAD:   'road',
  PLACE:  'place',
  ERASE:  'erase',
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
   * @param {() => void} handlers.onSelectAll
   * @param {() => void} handlers.onEscape
   * @param {() => void} handlers.onSave
   * @param {() => void} handlers.onRotate
   * @param {() => void} handlers.onToggleGrid
   * @param {() => void} handlers.onToggleCam
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
    if (e.button !== 0) return; // left click only
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
    // Don't intercept if typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key;

    // Undo/Redo
    if (ctrl && !shift && key === 'z') { e.preventDefault(); this._h.onUndo(); return; }
    if (ctrl && key === 'y') { e.preventDefault(); this._h.onRedo(); return; }
    if (ctrl && shift && key === 'Z') { e.preventDefault(); this._h.onRedo(); return; }

    // Save
    if (ctrl && key === 's') { e.preventDefault(); this._h.onSave(); return; }

    // Select all
    if (ctrl && key === 'a') { e.preventDefault(); this._h.onSelectAll(); return; }

    // Gizmo modes
    if (shift && key === 'G') { e.preventDefault(); this._h.onGizmoMode('translate'); return; }
    if (shift && key === 'R') { e.preventDefault(); this._h.onGizmoMode('rotate'); return; }
    if (shift && key === 'S') { e.preventDefault(); this._h.onGizmoMode('scale'); return; }

    // Tool shortcuts
    if (key === '1') { this.setTool(TOOL.SELECT); return; }
    if (key === '2') { this.setTool(TOOL.ROAD); return; }
    if (key === '3') { this.setTool(TOOL.PLACE); return; }
    if (key === '4') { this.setTool(TOOL.ERASE); return; }

    // Grid snap toggle
    if (key === 'g' && !ctrl && !shift) { this._h.onToggleGrid(); return; }

    // Camera toggle
    if (key === 'c' && !ctrl && !shift) { this._h.onToggleCam(); return; }

    // Delete
    if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); this._h.onDelete(); return; }

    // Escape
    if (key === 'Escape') { this._h.onEscape(); return; }

    // Rotate piece (R without modifiers)
    if (key === 'r' && !ctrl && !shift) { this._h.onRotate?.(); return; }
  }

  dispose() {
    this._canvas.removeEventListener('pointerdown', this._onPointerDown);
    this._canvas.removeEventListener('pointermove', this._onPointerMove);
    this._canvas.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
  }
}
