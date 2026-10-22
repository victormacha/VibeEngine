// Aba Mapas: o aluno edita (ou cria) os mapas em grade do jogo, pintando
// tiles. A IA continua criando os mapas — eles chegam aqui sozinhos depois
// de cada resposta dela (ver chatTab.js). A partir da primeira edição, o
// mapa passa a ser "do aluno": a versão daqui é injetada no jogo
// (window.VIBE_MAPS) e a IA não sobrescreve mais, até o aluno clicar em
// "Devolver pra IA".
import { state, normalizeMap, MAP_TILE_TYPES, DEFAULT_MAP_LEGEND } from "../state.js";
import { extractEmbeddedMaps } from "../api.js";
import { toast } from "../ui.js";

const MAX_COLS = 200;
const MAX_ROWS = 60;
// Caracteres que dá pra usar na legenda sem quebrar o formato do mapa
// (nada de aspas, vírgula, chaves, dois-pontos ou barra invertida).
const SAFE_CHARS = "#=^~*+-|/!?@$%&<>ABCDGHIJKLMNOQRSTUVWXYZabcdefghijklmnpqrstuvwxyz0123456789";
const TYPE_ICON = { item: "★", inimigo: "☠", jogador: "☺", saida: "⚑" };

export function mountMapEditorTab(panel) {
  panel.innerHTML = `
    <div class="map-editor">
      <aside class="map-sidebar">
        <label>Mapa</label>
        <select id="map-select"></select>
        <div class="map-row">
          <button id="map-new" class="btn-ghost">+ novo mapa</button>
          <button id="map-delete" class="btn-ghost btn-danger" title="Apagar este mapa">🗑️</button>
        </div>
        <div id="map-origin" class="map-origin"></div>

        <label>Tamanho (colunas × linhas)</label>
        <div class="map-row">
          <input type="number" id="map-cols" min="4" max="${MAX_COLS}" />
          <span>×</span>
          <input type="number" id="map-rows" min="3" max="${MAX_ROWS}" />
          <button id="map-resize" class="btn-ghost">Aplicar</button>
        </div>
        <p class="hint map-hint-tight">Linhas novas entram por cima (o chão fica onde está); colunas novas, à direita.</p>

        <label>Ferramenta <span class="hint-inline">(B/E/G/R)</span></label>
        <div class="tool-row">
          <button class="tool-btn active" data-tool="brush" title="Pincel (B)">🖌️</button>
          <button class="tool-btn" data-tool="eraser" title="Borracha (E)">🧽</button>
          <button class="tool-btn" data-tool="bucket" title="Balde (G)">🪣</button>
          <button class="tool-btn" data-tool="rect" title="Retângulo (R)">▭</button>
        </div>

        <label>Tiles <span class="hint-inline">(clique pra escolher)</span></label>
        <div id="map-legend" class="map-legend"></div>
        <button id="legend-add" class="btn-ghost map-full">+ novo tipo de tile</button>

        <div class="map-row">
          <button id="map-undo" class="btn-ghost" title="Desfazer (Ctrl+Z)">↩️ Desfazer</button>
          <button id="map-redo" class="btn-ghost" title="Refazer (Ctrl+Y)">↪️ Refazer</button>
        </div>

        <label>Zoom</label>
        <input type="range" id="map-zoom" min="8" max="40" value="20" />

        <p class="hint">As mudanças entram no jogo na hora (aba Testar → 🔄 Reiniciar) e vão
          pro banco quando você salvar o jogo na aba Testar. Pra a IA usar o mapa, peça
          na aba IA algo como <code>use o mapa fase1</code>.</p>
      </aside>

      <div class="map-main">
        <div id="map-empty" class="map-empty" hidden>
          <p>Nenhum mapa ainda.</p>
          <p class="hint">Peça pra IA criar um jogo de plataforma, labirinto ou top-down
            (ela cria o mapa sozinha), ou clique em <strong>+ novo mapa</strong> pra desenhar do zero.</p>
        </div>
        <div class="map-canvas-wrap" id="map-canvas-wrap">
          <canvas id="map-canvas"></canvas>
        </div>
        <div class="map-status" id="map-status"></div>
      </div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);
  const selectEl = $("#map-select");
  const originEl = $("#map-origin");
  const colsInput = $("#map-cols");
  const rowsInput = $("#map-rows");
  const legendEl = $("#map-legend");
  const zoomInput = $("#map-zoom");
  const canvas = $("#map-canvas");
  const ctx = canvas.getContext("2d");
  const wrap = $("#map-canvas-wrap");
  const emptyEl = $("#map-empty");
  const statusEl = $("#map-status");

  let currentName = null;
  let currentChar = "#";
  let tool = "brush";
  let undoStack = [];
  let redoStack = [];
  let painting = false;
  let rectStart = null;
  let hoverCell = null;
  let lastPaintCell = null;

  function map() {
    return currentName ? state.project.maps[currentName] : null;
  }

  // Primeira edição num mapa da IA: ele vira do aluno (ver topo do arquivo).
  function claim() {
    const m = map();
    if (m && m.origem !== "aluno") {
      m.origem = "aluno";
      renderOrigin();
      toast("Agora esse mapa é seu — a IA não vai mais sobrescrever ele.", "info");
    }
  }

  function snapshot() {
    const m = map();
    return { linhas: m.linhas.slice(), legenda: JSON.parse(JSON.stringify(m.legenda)) };
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }

  function restore(snap) {
    const m = map();
    m.linhas = snap.linhas.slice();
    m.legenda = JSON.parse(JSON.stringify(snap.legenda));
    syncSizeInputs();
    renderLegend();
    draw();
  }

  // ---------- lista de mapas ----------
  function renderSelect() {
    const names = Object.keys(state.project.maps);
    if (currentName && !state.project.maps[currentName]) currentName = null;
    if (!currentName && names.length) currentName = names[0];
    selectEl.innerHTML = names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join("");
    if (currentName) selectEl.value = currentName;
    const has = !!currentName;
    emptyEl.hidden = has;
    wrap.hidden = !has;
    panel.querySelectorAll(".map-sidebar input, .map-sidebar button:not(#map-new), .map-sidebar select").forEach((el) => {
      el.disabled = !has;
    });
    if (has) {
      state.project.maps[currentName] = normalizeMap(state.project.maps[currentName]);
      const leg = map().legenda;
      if (!leg[currentChar]) currentChar = Object.keys(leg)[0] || "#";
      syncSizeInputs();
      renderOrigin();
      renderLegend();
      draw();
    } else {
      originEl.innerHTML = "";
      legendEl.innerHTML = "";
      statusEl.textContent = "";
    }
  }

  function syncSizeInputs() {
    const m = map();
    colsInput.value = m.linhas[0].length;
    rowsInput.value = m.linhas.length;
  }

  function renderOrigin() {
    const m = map();
    if (!m) return;
    if (m.origem === "aluno") {
      originEl.innerHTML = `<span class="map-badge map-badge-aluno">✏️ Editado por você</span>
        <p class="hint map-hint-tight">A IA usa a sua versão e não mexe mais nela.</p>
        <button id="map-giveback" class="btn-ghost map-full">↩ Devolver pra IA (descarta suas edições)</button>`;
      originEl.querySelector("#map-giveback").addEventListener("click", giveBackToAI);
    } else {
      originEl.innerHTML = `<span class="map-badge map-badge-ia">🤖 Criado pela IA</span>
        <p class="hint map-hint-tight">Se você editar, ele vira seu. Enquanto não editar, a IA pode refazer ele a cada pedido.</p>`;
    }
  }

  function giveBackToAI() {
    const fromCode = state.project.gameCode ? extractEmbeddedMaps(state.project.gameCode)[currentName] : null;
    const msg = fromCode
      ? `Voltar o mapa "${currentName}" pra versão da IA? Suas edições nele serão perdidas.`
      : `O jogo atual não tem um mapa "${currentName}" feito pela IA — devolver vai APAGAR esse mapa. Continuar?`;
    if (!confirm(msg)) return;
    if (fromCode) state.project.maps[currentName] = { ...normalizeMap(fromCode), origem: "ia" };
    else delete state.project.maps[currentName];
    undoStack = [];
    redoStack = [];
    renderSelect();
    toast(fromCode ? "Mapa devolvido pra IA." : "Mapa removido.", "info");
  }

  selectEl.addEventListener("change", () => {
    currentName = selectEl.value;
    undoStack = [];
    redoStack = [];
    renderSelect();
  });

  $("#map-new").addEventListener("click", () => {
    const suggested = `fase${Object.keys(state.project.maps).length + 1}`;
    const raw = prompt("Nome do mapa (ex: fase1, fase2, labirinto):", suggested);
    if (raw == null) return;
    const name = raw.trim().replace(/[^\w]/g, "");
    if (!name) return toast("Use só letras, números e _ no nome.", "error");
    if (state.project.maps[name]) return toast(`Já existe um mapa "${name}".`, "error");
    const cols = 40;
    const rows = 14;
    const linhas = Array.from({ length: rows }, (_, y) => (y >= rows - 2 ? "#" : ".").repeat(cols));
    linhas[rows - 3] = "..P" + ".".repeat(cols - 3);
    state.project.maps[name] = { tile: 32, legenda: { ...DEFAULT_MAP_LEGEND }, linhas, origem: "aluno" };
    currentName = name;
    undoStack = [];
    redoStack = [];
    renderSelect();
  });

  $("#map-delete").addEventListener("click", () => {
    if (!currentName || !confirm(`Apagar o mapa "${currentName}"?`)) return;
    delete state.project.maps[currentName];
    currentName = null;
    renderSelect();
  });

  // ---------- tamanho ----------
  $("#map-resize").addEventListener("click", () => {
    const m = map();
    const cols = clampInt(colsInput.value, 4, MAX_COLS);
    const rows = clampInt(rowsInput.value, 3, MAX_ROWS);
    if (cols === m.linhas[0].length && rows === m.linhas.length) return;
    pushUndo();
    claim();
    let linhas = m.linhas.map((l) => (l.length >= cols ? l.slice(0, cols) : l.padEnd(cols, ".")));
    // Ancorado embaixo: chão continua no chão.
    if (rows > linhas.length) linhas = [...Array(rows - linhas.length).fill(".".repeat(cols)), ...linhas];
    else linhas = linhas.slice(linhas.length - rows);
    m.linhas = linhas;
    syncSizeInputs();
    draw();
  });

  // ---------- legenda ----------
  function renderLegend() {
    const m = map();
    legendEl.innerHTML = "";
    Object.entries(m.legenda).forEach(([ch, def]) => {
      const row = document.createElement("div");
      row.className = "legend-row" + (ch === currentChar ? " active" : "");
      row.innerHTML = `
        <button class="legend-pick" title="Pintar com este tile">
          <span class="legend-swatch" style="background:${escapeAttr(def.cor || "#777")}">${TYPE_ICON[def.tipo] || ""}</span>
          <code>${escapeHtml(ch)}</code>
          <span class="legend-name">${escapeHtml(def.nome || labelFor(def.tipo))}</span>
        </button>
        <input type="color" class="legend-color" value="${toHex(def.cor)}" title="Cor" />
        <select class="legend-type" title="Tipo">
          ${MAP_TILE_TYPES.map((t) => `<option value="${t.id}" ${t.id === def.tipo ? "selected" : ""}>${t.label}</option>`).join("")}
        </select>
        <button class="legend-del btn-ghost" title="Remover este tipo (apaga do mapa)">✕</button>`;
      row.querySelector(".legend-pick").addEventListener("click", () => {
        currentChar = ch;
        if (tool === "eraser") setTool("brush");
        renderLegend();
      });
      row.querySelector(".legend-color").addEventListener("change", (e) => {
        pushUndo();
        claim();
        def.cor = e.target.value;
        renderLegend();
        draw();
      });
      row.querySelector(".legend-type").addEventListener("change", (e) => {
        pushUndo();
        claim();
        def.tipo = e.target.value;
        renderLegend();
        draw();
      });
      row.querySelector(".legend-del").addEventListener("click", () => {
        if (Object.keys(m.legenda).length <= 1) return toast("O mapa precisa de pelo menos um tipo de tile.", "error");
        if (!confirm(`Remover o tile "${ch}"? Todas as células dele viram vazio.`)) return;
        pushUndo();
        claim();
        delete m.legenda[ch];
        m.linhas = m.linhas.map((l) => l.split(ch).join("."));
        if (currentChar === ch) currentChar = Object.keys(m.legenda)[0];
        renderLegend();
        draw();
      });
      legendEl.appendChild(row);
    });
  }

  $("#legend-add").addEventListener("click", () => {
    const m = map();
    const ch = [...SAFE_CHARS].find((c) => !m.legenda[c]);
    if (!ch) return toast("Não sobrou caractere livre pra um tile novo.", "error");
    pushUndo();
    claim();
    m.legenda[ch] = { tipo: "decoracao", cor: "#8e7cc3" };
    currentChar = ch;
    renderLegend();
  });

  // ---------- ferramentas ----------
  function setTool(t) {
    tool = t;
    panel.querySelectorAll(".map-sidebar .tool-btn").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
  }
  panel.querySelectorAll(".map-sidebar .tool-btn").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));

  function paintChar() {
    return tool === "eraser" ? "." : currentChar;
  }

  function setCell(col, row, ch) {
    const m = map();
    if (row < 0 || row >= m.linhas.length || col < 0 || col >= m.linhas[0].length) return false;
    const line = m.linhas[row];
    if (line[col] === ch) return false;
    // Só um "jogador" por mapa: pintar um novo apaga o anterior.
    if (m.legenda[ch]?.tipo === "jogador") {
      m.linhas = m.linhas.map((l) => [...l].map((c) => (m.legenda[c]?.tipo === "jogador" ? "." : c)).join(""));
    }
    claim();
    const fresh = m.linhas[row];
    m.linhas[row] = fresh.slice(0, col) + ch + fresh.slice(col + 1);
    return true;
  }

  function fill(col, row, ch) {
    const m = map();
    const target = m.linhas[row]?.[col];
    if (target == null || target === ch) return;
    const grid = m.linhas.map((l) => [...l]);
    const stack = [[col, row]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length || grid[y][x] !== target) continue;
      grid[y][x] = ch;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    claim();
    m.linhas = grid.map((r) => r.join(""));
  }

  function paintLine(a, b, ch) {
    let changedAny = false;
    const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row), 1);
    for (let i = 0; i <= steps; i++) {
      const col = Math.round(a.col + ((b.col - a.col) * i) / steps);
      const row = Math.round(a.row + ((b.row - a.row) * i) / steps);
      if (setCell(col, row, ch)) changedAny = true;
    }
    return changedAny;
  }

  function fillRect(a, b, ch) {
    const x0 = Math.min(a.col, b.col), x1 = Math.max(a.col, b.col);
    const y0 = Math.min(a.row, b.row), y1 = Math.max(a.row, b.row);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setCell(x, y, ch);
  }

  function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const z = cellSize();
    const sx = canvas.width / rect.width || 1; // canvas pode estar encolhido por CSS
    const sy = canvas.height / rect.height || 1;
    return { col: Math.floor(((e.clientX - rect.left) * sx) / z), row: Math.floor(((e.clientY - rect.top) * sy) / z) };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!map()) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const cell = cellFromEvent(e);
    pushUndo();
    if (tool === "bucket") {
      fill(cell.col, cell.row, paintChar());
      draw();
      return;
    }
    if (tool === "rect") {
      rectStart = cell;
      hoverCell = cell;
      draw();
      return;
    }
    painting = true;
    lastPaintCell = cell;
    if (setCell(cell.col, cell.row, paintChar())) draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!map()) return;
    const cell = cellFromEvent(e);
    const moved = !hoverCell || hoverCell.col !== cell.col || hoverCell.row !== cell.row;
    hoverCell = cell;
    if (painting) {
      // Pinta a linha inteira desde a última célula: mouse rápido pula
      // células entre um evento e outro, e sem isso o traço sai com buracos.
      if (paintLine(lastPaintCell || cell, cell, paintChar())) draw();
      lastPaintCell = cell;
    } else if (moved) {
      draw();
    }
    const m = map();
    const ch = m.linhas[cell.row]?.[cell.col];
    statusEl.textContent = ch == null ? "" : `coluna ${cell.col + 1}, linha ${cell.row + 1} — ${ch === "." ? "vazio" : `"${ch}" ${labelFor(m.legenda[ch]?.tipo)}`}`;
  });

  function endStroke() {
    if (rectStart && hoverCell) {
      fillRect(rectStart, hoverCell, paintChar());
      rectStart = null;
      draw();
    }
    painting = false;
    lastPaintCell = null;
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("pointerleave", () => {
    if (!painting && !rectStart) {
      hoverCell = null;
      draw();
    }
  });

  $("#map-undo").addEventListener("click", undo);
  $("#map-redo").addEventListener("click", redo);
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  // Atalhos só quando a aba Mapas está visível e o foco não está num campo.
  document.addEventListener("keydown", (e) => {
    if (!panel.isConnected || !panel.classList.contains("active") || !map()) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = { b: "brush", e: "eraser", g: "bucket", r: "rect" }[k];
    if (t) setTool(t);
  });

  zoomInput.addEventListener("input", draw);

  // ---------- desenho ----------
  function cellSize() {
    return Number(zoomInput.value) || 20;
  }

  function draw() {
    const m = map();
    if (!m) return;
    const z = cellSize();
    const rows = m.linhas.length;
    const cols = m.linhas[0].length;
    canvas.width = cols * z;
    canvas.height = rows * z;
    ctx.fillStyle = "#151824";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < rows; y++) {
      const line = m.linhas[y];
      for (let x = 0; x < cols; x++) {
        const ch = line[x];
        if (ch === "." || ch === " ") continue;
        drawCell(x, y, z, m.legenda[ch] || { tipo: "solido", cor: "#666" }, 1);
      }
    }

    // prévia do retângulo / célula sob o mouse
    if (rectStart && hoverCell) {
      const x0 = Math.min(rectStart.col, hoverCell.col), x1 = Math.max(rectStart.col, hoverCell.col);
      const y0 = Math.min(rectStart.row, hoverCell.row), y1 = Math.max(rectStart.row, hoverCell.row);
      ctx.fillStyle = "rgba(255,180,84,0.35)";
      ctx.fillRect(x0 * z, y0 * z, (x1 - x0 + 1) * z, (y1 - y0 + 1) * z);
    } else if (hoverCell && hoverCell.col < cols && hoverCell.row < rows && hoverCell.col >= 0 && hoverCell.row >= 0) {
      if (tool !== "eraser" && m.legenda[currentChar]) drawCell(hoverCell.col, hoverCell.row, z, m.legenda[currentChar], 0.5);
      ctx.strokeStyle = "#ffb454";
      ctx.lineWidth = 2;
      ctx.strokeRect(hoverCell.col * z + 1, hoverCell.row * z + 1, z - 2, z - 2);
    }

    // grade
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) { ctx.moveTo(x * z + 0.5, 0); ctx.lineTo(x * z + 0.5, rows * z); }
    for (let y = 0; y <= rows; y++) { ctx.moveTo(0, y * z + 0.5); ctx.lineTo(cols * z, y * z + 0.5); }
    ctx.stroke();
  }

  function drawCell(x, y, z, def, alpha) {
    ctx.globalAlpha = alpha;
    const px = x * z, py = y * z;
    ctx.fillStyle = def.cor || "#777";
    if (def.tipo === "plataforma") ctx.fillRect(px, py, z, Math.max(3, Math.round(z / 3)));
    else if (def.tipo === "perigo") {
      ctx.beginPath();
      ctx.moveTo(px, py + z);
      ctx.lineTo(px + z / 2, py + z * 0.25);
      ctx.lineTo(px + z, py + z);
      ctx.fill();
    } else if (TYPE_ICON[def.tipo]) {
      ctx.beginPath();
      ctx.arc(px + z / 2, py + z / 2, z * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0d0f16";
      ctx.font = `bold ${Math.round(z * 0.6)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(TYPE_ICON[def.tipo], px + z / 2, py + z / 2 + 1);
    } else {
      ctx.fillRect(px, py, z, z);
      if (def.tipo === "decoracao") {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(px + z / 4, py + z / 4, z / 2, z / 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  renderSelect();

  // Chamado pelo main.js quando a aba é aberta ou a IA cria/muda mapas.
  return {
    refresh() {
      renderSelect();
    },
  };
}

function labelFor(tipo) {
  return (MAP_TILE_TYPES.find((t) => t.id === tipo)?.label || tipo || "").split(" (")[0];
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function toHex(color) {
  return /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#777777";
}

function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
