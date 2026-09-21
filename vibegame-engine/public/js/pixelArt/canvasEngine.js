// Motor do editor de pixel art. Um grid de células (ex: 16x16 ou 32x32),
// cada uma com uma cor (hex) ou null (transparente). Desenha em <canvas>
// com checkerboard nas células transparentes, e sabe exportar pra PNG
// dataURL (pro thumbnail) e pra matriz JS crua (pro jogo usar direto).
const CHECKER_A = "#20222d";
const CHECKER_B = "#282b38";
const SELECTION_COLOR = "#ffb454";
const ONION_PREV_COLOR = "#ff5d73"; // silhueta do frame ANTERIOR (vermelho-coral)
const ONION_NEXT_COLOR = "#4ea8ff"; // silhueta do PRÓXIMO frame (azul)

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

// Células de uma linha reta (Bresenham) entre dois pontos — usada tanto
// pra "arrastar sem buraco" (brush/eraser) quanto pela ferramenta Linha.
function lineCells(x0, y0, x1, y1) {
  const cells = [];
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (;;) {
    cells.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return cells;
}

// Células de um retângulo PREENCHIDO entre dois cantos.
function rectCells(x0, y0, x1, y1) {
  const cells = [];
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) cells.push({ x, y });
  }
  return cells;
}

function normalizeRect(a, b) {
  return {
    x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
  };
}

export class PixelCanvas {
  constructor(canvasEl, { size = 16, cell = 20 } = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.size = size;
    this.cell = cell;
    this.pixels = Array.from({ length: size }, () => Array(size).fill(null));
    this.history = [];
    this.future = []; // pilha de redo — some sempre que uma ação NOVA é feita
    this.tool = "brush";
    this.color = "#ff5d73";

    // Seleção/mover/copiar (ferramenta "select"): `selection` é o
    // retângulo atual ({x0,y0,x1,y1}, inclusive) ou null. `clipboard` é
    // { w, h, cells } — sobrevive a troca de frame (é da instância, não
    // do frame), pra dar pra colar em outro frame/animação.
    this.selection = null;
    this.clipboard = null;
    this._moveBuffer = null; // durante um arraste de "mover seleção": { originX, originY, cells }

    // Onion skinning: matrizes do frame anterior/seguinte, setadas de fora
    // (pixelEditorTab.js é quem sabe qual é o frame anterior/seguinte).
    this.onionEnabled = false;
    this.onionPrev = null;
    this.onionNext = null;

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
    this.selection = null;
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
    this.selection = null;
    this._moveBuffer = null;
    this._resize();
    this.render();
  }

  setOnionSkin(enabled, prevMatrix, nextMatrix) {
    this.onionEnabled = enabled;
    this.onionPrev = prevMatrix || null;
    this.onionNext = nextMatrix || null;
    this.render();
  }

  _pushHistory() {
    this.history.push(this.pixels.map((r) => r.slice()));
    if (this.history.length > 40) this.history.shift();
    this.future = []; // qualquer ação nova invalida o "refazer" pendente
  }

  undo() {
    const prev = this.history.pop();
    if (prev) {
      this.future.push(this.pixels.map((r) => r.slice()));
      this.pixels = prev;
      this.selection = null;
      this.render();
    }
  }

  redo() {
    const next = this.future.pop();
    if (next) {
      this.history.push(this.pixels.map((r) => r.slice()));
      this.pixels = next;
      this.selection = null;
      this.render();
    }
  }

  // ---------- Espelhar ----------
  flipHorizontal() {
    this._pushHistory();
    this.pixels = this.pixels.map((row) => row.slice().reverse());
    this.render();
  }

  flipVertical() {
    this._pushHistory();
    this.pixels = this.pixels.slice().reverse();
    this.render();
  }

  // ---------- Seleção / copiar / colar / mover ----------
  hasSelection() {
    return !!this.selection;
  }

  copySelection() {
    if (!this.selection) return false;
    const { x0, y0, x1, y1 } = this.selection;
    const cells = [];
    for (let y = y0; y <= y1; y++) {
      const row = [];
      for (let x = x0; x <= x1; x++) row.push(this.pixels[y]?.[x] ?? null);
      cells.push(row);
    }
    this.clipboard = { w: x1 - x0 + 1, h: y1 - y0 + 1, cells };
    return true;
  }

  cutSelection() {
    if (!this.selection) return false;
    this.copySelection();
    this._pushHistory();
    const { x0, y0, x1, y1 } = this.selection;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.pixels[y]?.[x] !== undefined) this.pixels[y][x] = null;
      }
    }
    this.render();
    return true;
  }

  // Cola no canto superior esquerdo da seleção atual (ou 0,0 sem seleção),
  // e já seleciona a área colada — assim dá pra mover ela em seguida sem
  // precisar reselecionar.
  pasteClipboard() {
    if (!this.clipboard) return false;
    this._pushHistory();
    const originX = this.selection ? this.selection.x0 : 0;
    const originY = this.selection ? this.selection.y0 : 0;
    const { w, h, cells } = this.clipboard;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ty = originY + y, tx = originX + x;
        if (ty < 0 || tx < 0 || ty >= this.size || tx >= this.size) continue;
        this.pixels[ty][tx] = cells[y][x];
      }
    }
    this.selection = {
      x0: originX, y0: originY,
      x1: Math.min(this.size - 1, originX + w - 1),
      y1: Math.min(this.size - 1, originY + h - 1),
    };
    this.render();
    return true;
  }

  clearSelection() {
    if (!this.selection) return false;
    this._pushHistory();
    const { x0, y0, x1, y1 } = this.selection;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) this.pixels[y][x] = null;
    }
    this.render();
    return true;
  }

  _cellFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = Math.floor(((e.clientX - rect.left) * scaleX) / this.cell);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / this.cell);
    return { x, y };
  }

  _clampCell({ x, y }) {
    return { x: Math.max(0, Math.min(this.size - 1, x)), y: Math.max(0, Math.min(this.size - 1, y)) };
  }

  _lastCell = null;

  _applyToolAlongLine(x0, y0, x1, y1) {
    lineCells(x0, y0, x1, y1).forEach(({ x, y }) => this._applyToolAt(x, y));
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
    let shapeStart = null; // { x, y } — âncora de line/rect
    let movingSelection = false;
    let moveAnchor = null; // cell onde o arraste de mover começou
    let selectStart = null; // âncora de uma nova seleção sendo desenhada

    const start = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drawing = true;
      this.canvas.setPointerCapture?.(e.pointerId);
      const cell = this._clampCell(this._cellFromEvent(e));

      if (this.tool === "line" || this.tool === "rect") {
        this._pushHistory();
        shapeStart = cell;
        this._previewCells = [cell];
      } else if (this.tool === "select") {
        const inSelection =
          this.selection &&
          cell.x >= this.selection.x0 && cell.x <= this.selection.x1 &&
          cell.y >= this.selection.y0 && cell.y <= this.selection.y1;
        if (inSelection) {
          // Começa a MOVER o conteúdo selecionado: corta pro buffer,
          // limpa o buraco original, e vai desenhando o buffer "flutuando"
          // por cima até soltar.
          this._pushHistory();
          movingSelection = true;
          moveAnchor = cell;
          const { x0, y0, x1, y1 } = this.selection;
          const cells = [];
          for (let y = y0; y <= y1; y++) {
            const row = [];
            for (let x = x0; x <= x1; x++) {
              row.push(this.pixels[y][x]);
              this.pixels[y][x] = null;
            }
            cells.push(row);
          }
          this._moveBuffer = { originX: x0, originY: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, cells };
        } else {
          selectStart = cell;
          this.selection = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
        }
      } else {
        this._pushHistory();
        this._applyToolAt(cell.x, cell.y);
      }

      this._lastCell = cell;
      this.render();
      e.preventDefault();
    };

    const move = (e) => {
      if (!drawing) return;
      const cell = this._clampCell(this._cellFromEvent(e));

      if (this.tool === "line" && shapeStart) {
        this._previewCells = lineCells(shapeStart.x, shapeStart.y, cell.x, cell.y);
      } else if (this.tool === "rect" && shapeStart) {
        this._previewCells = rectCells(shapeStart.x, shapeStart.y, cell.x, cell.y);
      } else if (this.tool === "select") {
        if (movingSelection && this._moveBuffer && moveAnchor) {
          const dx = cell.x - moveAnchor.x, dy = cell.y - moveAnchor.y;
          this._moveBuffer.previewX = this._moveBuffer.originX + dx;
          this._moveBuffer.previewY = this._moveBuffer.originY + dy;
        } else if (selectStart) {
          this.selection = normalizeRect(selectStart, cell);
        }
      } else {
        if (this._lastCell) this._applyToolAlongLine(this._lastCell.x, this._lastCell.y, cell.x, cell.y);
        else this._applyToolAt(cell.x, cell.y);
      }

      this._lastCell = cell;
      this.render();
      e.preventDefault();
    };

    const end = (e) => {
      if (drawing) {
        if (this.tool === "line" || this.tool === "rect") {
          (this._previewCells || []).forEach(({ x, y }) => {
            if (x >= 0 && y >= 0 && x < this.size && y < this.size) this.pixels[y][x] = this.color;
          });
          this._previewCells = null;
          shapeStart = null;
        } else if (this.tool === "select" && movingSelection && this._moveBuffer) {
          const buf = this._moveBuffer;
          const px = buf.previewX ?? buf.originX;
          const py = buf.previewY ?? buf.originY;
          for (let y = 0; y < buf.h; y++) {
            for (let x = 0; x < buf.w; x++) {
              const ty = py + y, tx = px + x;
              if (ty < 0 || tx < 0 || ty >= this.size || tx >= this.size) continue;
              this.pixels[ty][tx] = buf.cells[y][x];
            }
          }
          this.selection = { x0: px, y0: py, x1: px + buf.w - 1, y1: py + buf.h - 1 };
          this._moveBuffer = null;
          movingSelection = false;
          moveAnchor = null;
        } else if (this.tool === "select") {
          selectStart = null;
        }
      }
      drawing = false;
      this._lastCell = null;
      if (e?.pointerId != null) this.canvas.releasePointerCapture?.(e.pointerId);
      this.render();
    };

    this.canvas.addEventListener("pointerdown", start);
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  _drawOnionLayer(matrix, color) {
    if (!matrix) return;
    const { ctx, cell, size } = this;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (matrix[y]?.[x]) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.restore();
  }

  render() {
    const { ctx, cell, size } = this;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const color = this.pixels[y][x];
        ctx.fillStyle = color || ((x + y) % 2 === 0 ? CHECKER_A : CHECKER_B);
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    if (this.onionEnabled) {
      this._drawOnionLayer(this.onionPrev, ONION_PREV_COLOR);
      this._drawOnionLayer(this.onionNext, ONION_NEXT_COLOR);
      // Redesenha os pixels reais por cima da onion skin nas células que o
      // frame atual já usa, senão o desenho atual fica "lavado" pela tinta.
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const color = this.pixels[y][x];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(x * cell, y * cell, cell, cell);
          }
        }
      }
    }

    // Preview ao vivo de linha/retângulo, antes de soltar o ponteiro.
    if (this._previewCells) {
      ctx.fillStyle = this.color;
      this._previewCells.forEach(({ x, y }) => {
        if (x >= 0 && y >= 0 && x < size && y < size) ctx.fillRect(x * cell, y * cell, cell, cell);
      });
    }

    // Buffer "flutuante" sendo arrastado (mover seleção).
    if (this._moveBuffer) {
      const buf = this._moveBuffer;
      const px = buf.previewX ?? buf.originX;
      const py = buf.previewY ?? buf.originY;
      for (let y = 0; y < buf.h; y++) {
        for (let x = 0; x < buf.w; x++) {
          const c = buf.cells[y][x];
          if (!c) continue;
          const tx = px + x, ty = py + y;
          if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue;
          ctx.fillStyle = c;
          ctx.fillRect(tx * cell, ty * cell, cell, cell);
        }
      }
    }

    // Contorno tracejado da seleção.
    if (this.selection) {
      const { x0, y0, x1, y1 } = this.selection;
      ctx.save();
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = Math.max(1, cell * 0.08);
      ctx.setLineDash([Math.max(3, cell * 0.3), Math.max(3, cell * 0.3)]);
      ctx.strokeRect(x0 * cell, y0 * cell, (x1 - x0 + 1) * cell, (y1 - y0 + 1) * cell);
      ctx.restore();
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
    this.selection = null;
    this.render();
  }
}

export const DEFAULT_PALETTE = [
  "#000000", "#ffffff", "#ff5d73", "#ffb454", "#ffe66d",
  "#5ee6c4", "#4ea8ff", "#7d5eff", "#b45eff", "#2d3142",
  "#8b5a2b", "#4caf50", "#e91e63", "#607d8b", "#f5f5f5", null,
];
