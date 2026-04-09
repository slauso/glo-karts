/**
 * command-stack.js — Undo/redo with command pattern.
 */

const MAX_STACK = 100;

export class CommandStack {
  constructor() {
    /** @type {Array<{execute: () => void, undo: () => void, description: string}>} */
    this._undoStack = [];
    this._redoStack = [];
    this._onChange = null;
  }

  /** Set callback fired after any undo/redo/execute. */
  setOnChange(fn) { this._onChange = fn; }

  /**
   * Execute a command and push it onto the undo stack.
   * @param {{ execute: () => void, undo: () => void, description: string }} cmd
   */
  execute(cmd) {
    cmd.execute();
    this._undoStack.push(cmd);
    if (this._undoStack.length > MAX_STACK) this._undoStack.shift();
    this._redoStack.length = 0;
    this._onChange?.();
  }

  /** Undo the last command. */
  undo() {
    const cmd = this._undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this._redoStack.push(cmd);
    this._onChange?.();
    return true;
  }

  /** Redo the last undone command. */
  redo() {
    const cmd = this._redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this._undoStack.push(cmd);
    this._onChange?.();
    return true;
  }

  get canUndo() { return this._undoStack.length > 0; }
  get canRedo() { return this._redoStack.length > 0; }

  clear() {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._onChange?.();
  }
}

// ── Pre-built command factories ────────────────────────────────

/**
 * @param {import('./scene-graph.js').SceneGraph} graph
 * @param {object} entityData - full entity object
 */
export function PlaceObjectCmd(graph, entityData) {
  return {
    description: `Place ${entityData.type}`,
    execute() { graph.add(entityData); },
    undo() { graph.remove(entityData.id); },
  };
}

/**
 * @param {import('./scene-graph.js').SceneGraph} graph
 * @param {number} id
 * @param {object} removedEntity - saved reference for undo
 */
export function DeleteObjectCmd(graph, id, removedEntity) {
  return {
    description: `Delete #${id}`,
    execute() { graph.remove(id); },
    undo() { graph.add(removedEntity); },
  };
}

/**
 * @param {import('./scene-graph.js').SceneGraph} graph
 * @param {number} id
 * @param {{x:number,y:number,z:number}} oldPos
 * @param {number} oldRot
 * @param {number} oldScale
 * @param {{x:number,y:number,z:number}} newPos
 * @param {number} newRot
 * @param {number} newScale
 */
export function TransformCmd(graph, id, oldPos, oldRot, oldScale, newPos, newRot, newScale) {
  return {
    description: `Transform #${id}`,
    execute() { graph.updateTransform(id, newPos, newRot, newScale); },
    undo() { graph.updateTransform(id, oldPos, oldRot, oldScale); },
  };
}
