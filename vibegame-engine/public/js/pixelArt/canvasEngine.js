// Motor do editor de pixel art. Um grid de células (ex: 16x16 ou 32x32),
// cada uma com uma cor (hex) ou null (transparente). Desenha em <canvas>
// com checkerboard nas células transparentes, e sabe exportar pra PNG
// dataURL (pro thumbnail) e pra matriz JS crua (pro jogo usar direto).
const CHECKER_A = "#20222d";
const CHECKER_B = "#282b38";

// Redimensiona uma matriz NxN de pixels para um novo tamanho, preservando
// o que já foi desenhado (corta ou preenche com transparente).
export function resizePixelMatrix(matrix, newSize) {
  return Array.from({ length: newSize }, (_, y) => Array.from({ length: newSize }, (_, x) => matrix[y]?.[x] ?? null));
}

export function blankMatrix(size) {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

// Pinta uma matriz de pixels num <canvas> qualquer (usado nas miniaturas de
// frame e na galeria de sprites) — mesma lógica de checkerboard do editor.
export function paintMatrix(canvasEl, matrix, { cell = 4 } = {}) {
  const size = matrix.length;
  canvasEl.width = size * cell;
  canvasEl.height = size * cell;
  const ctx = canvasEl.getContext("2d");
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = matrix[y][x];
      ctx.fillStyle = color || ((x + y) % 2 === 0 ? CHECKER_A : CHECKER_B);
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

export class PixelCanvas {
  constructor(canvasEl, { size = 16, cell = 20 } = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.size = size;
    this.cell = cell;
    this.pixels = Array.from({ length: size }, () => Array(size).fill(null));
    this.history = [];
    this.tool = "brush";
    this.color = "#ff5d73";
    this._resize();
    this._bindEvents();
    this.render();
  }

  _resize() {
    const px = this.size * this.cell;
    this.canvas.width = px;
    this.canvas.height = px;
  }

  setSize(size) {
    this.pixels = resizePixelMatrix(this.pixels, size);
    this.size = size;
    this._resize();
    this.render();
  }

  // Muda só o tamanho de cada célula em pixels (não a quantidade de
  // células) — usado para encolher o grid em telas estreitas sem perder o
  // desenho, já que o número de pixels do sprite continua o mesmo.
  setCellSize(cell) {
    cell = Math.max(4, Math.round(cell));
    if (cell === this.cell) return;
    this.cell = cell;
    this._resize();
    this.render();
  }

  loadPixels(pixels) {
    this.size = pixels.length;
    this.pixels = pixels.map((row) => row.slice());
    this._resize();
    this.render();
  }

  _pushHistory() {
    this.history.push(this.pixels.map((r) => r.slice()));
    if (this.history.length > 40) this.history.shift();
  }

  undo() {
    const prev = this.history.pop();
    if (prev) {
      this.pixels = prev;
      this.render();
    }
  }

  _cellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = Math.floor(((e.clientX - rect.left) * scaleX) / this.cell);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / this.cell);
    return { x, y };
  }

  _lastCell = null;

  // Desenha uma linha reta (Bresenham) entre duas células — sem isso, um
  // arraste rápido no touchscreen (que dispara menos eventos de movimento
  // que o mouse) deixa buracos entre um ponto e outro.
  _applyToolAlongLine(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0, y = y0;
    for (;;) {
      this._applyToolAt(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  _floodFill(x, y, target, replacement) {
    if (target === replacement) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= this.size || cy >= this.size) continue;
      if (this.pixels[cy][cx] !== target) continue;
      this.pixels[cy][cx] = replacement;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  _applyToolAt(x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    if (this.tool === "brush") this.pixels[y][x] = this.color;
    else if (this.tool === "eraser") this.pixels[y][x] = null;
    else if (this.tool === "bucket") this._floodFill(x, y, this.pixels[y][x], this.color);
    else if (this.tool === "eyedropper") {
      const picked = this.pixels[y][x];
      if (picked) {
        this.color = picked;
        this.onColorPicked?.(picked);
      }
    }
  }

  // Pointer Events cobrem mouse, caneta e dedo (touch) com a mesma API —
  // é o que faz o editor funcionar tanto no desktop quanto no celular.
  // setPointerCapture garante que o desenho continua recebendo movimento
  // mesmo se o dedo escorregar levemente para fora do canvas.
  _bindEvents() {
    let drawing = false;

    const start = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drawing = true;
      this.canvas.setPointerCapture?.(e.pointerId);
      this._pushHistory();
      const { x, y } = this._cellFromEvent(e);
      this._applyToolAt(x, y);
      this._lastCell = { x, y };
      this.render();
      e.preventDefault();
    };
    const move = (e) => {
      if (!drawing) return;
      const { x, y } = this._cellFromEvent(e);
      if (this._lastCell) this._applyToolAlongLine(this._lastCell.x, this._lastCell.y, x, y);
      else this._applyToolAt(x, y);
      this._lastCell = { x, y };
      this.render();
      e.preventDefault();
    };
    const end = (e) => {
      drawing = false;
      this._lastCell = null;
      if (e?.pointerId != null) this.canvas.releasePointerCapture?.(e.pointerId);
    };

    this.canvas.addEventListener("pointerdown", start);
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  render() {
    const { ctx, cell, size } = this;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const color = this.pixels[y][x];
        if (color) {
          ctx.fillStyle = color;
        } else {
          ctx.fillStyle = (x + y) % 2 === 0 ? CHECKER_A : CHECKER_B;
        }
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }

  toDataURL() {
    const off = document.createElement("canvas");
    off.width = this.size;
    off.height = this.size;
    const octx = off.getContext("2d");
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const c = this.pixels[y][x];
        if (c) {
          octx.fillStyle = c;
          octx.fillRect(x, y, 1, 1);
        }
      }
    }
    return off.toDataURL("image/png");
  }

  clear() {
    this._pushHistory();
    this.pixels = Array.from({ length: this.size }, () => Array(this.size).fill(null));
    this.render();
  }
}

export const DEFAULT_PALETTE = [
  "#000000", "#ffffff", "#ff5d73", "#ffb454", "#ffe66d",
  "#5ee6c4", "#4ea8ff", "#7d5eff", "#b45eff", "#2d3142",
  "#8b5a2b", "#4caf50", "#e91e63", "#607d8b", "#f5f5f5", null,
];
