/**
 * terrain-panel.js — Ground plane size, material, simple height editing.
 */
import * as THREE from 'three';

export class TerrainPanel {
  /**
   * @param {HTMLElement} container
   * @param {THREE.Mesh} ground
   * @param {THREE.GridHelper} grid
   */
  constructor(container, ground, grid) {
    this._container = container;
    this._ground = ground;
    this._grid = grid;
    this._size = 200;
    this._color = '#222240';
    this._center = new THREE.Vector3(0, 0, 0);
    this._build();
  }

  _build() {
    this._container.innerHTML = '';

    // Size control
    const sizeRow = this._makeRow('Arena Size');
    const sizeInput = document.createElement('input');
    sizeInput.type = 'range';
    sizeInput.min = '50';
    sizeInput.max = '500';
    sizeInput.step = '50';
    sizeInput.value = String(this._size);
    sizeInput.className = 'bv2-slider';
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'bv2-slider-val';
    sizeLabel.textContent = `${this._size}m`;
    sizeInput.addEventListener('input', () => {
      this._size = Number(sizeInput.value);
      sizeLabel.textContent = `${this._size}m`;
      this._updateGround();
    });
    sizeRow.appendChild(sizeInput);
    sizeRow.appendChild(sizeLabel);
    this._container.appendChild(sizeRow);

    // Ground color
    const colorRow = this._makeRow('Ground Color');
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = this._color;
    colorInput.className = 'bv2-color-input';
    colorInput.addEventListener('input', () => {
      this._color = colorInput.value;
      this._ground.material.color.set(this._color);
    });
    colorRow.appendChild(colorInput);
    this._container.appendChild(colorRow);

    // Grid toggle
    const gridRow = this._makeRow('Show Grid');
    const gridCheck = document.createElement('input');
    gridCheck.type = 'checkbox';
    gridCheck.checked = true;
    gridCheck.addEventListener('change', () => {
      this._grid.visible = gridCheck.checked;
    });
    gridRow.appendChild(gridCheck);
    this._container.appendChild(gridRow);
  }

  _makeRow(label) {
    const row = document.createElement('div');
    row.className = 'bv2-terrain-row';
    const lbl = document.createElement('label');
    lbl.className = 'bv2-terrain-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    return row;
  }

  _updateGround() {
    const s = this._size;
    this._ground.geometry.dispose();
    const geo = new THREE.PlaneGeometry(s * 2, s * 2);
    geo.rotateX(-Math.PI / 2);
    this._ground.geometry = geo;
    this._ground.position.set(this._center.x, this._ground.position.y, this._center.z);

    // Recreate grid
    const parent = this._grid.parent;
    const isVisible = this._grid.visible;
    const gridY = this._grid.position.y;
    parent.remove(this._grid);
    const newGrid = new THREE.GridHelper(s, s / 10, 0x444466, 0x2a2a3e);
    newGrid.name = '__grid';
    newGrid.position.set(this._center.x, gridY, this._center.z);
    newGrid.visible = isVisible;
    newGrid.renderOrder = 2;
    parent.add(newGrid);
    this._grid = newGrid;
  }

  setCenter(x = 0, z = 0) {
    this._center.set(x, 0, z);
    this._ground.position.set(this._center.x, this._ground.position.y, this._center.z);
    this._grid.position.set(this._center.x, this._grid.position.y, this._center.z);
  }

  getSettings() {
    return { size: this._size, color: this._color };
  }

  applySettings(settings) {
    if (settings?.size) {
      this._size = settings.size;
      this._updateGround();
    }
    if (settings?.color) {
      this._color = settings.color;
      this._ground.material.color.set(this._color);
    }
  }
}
