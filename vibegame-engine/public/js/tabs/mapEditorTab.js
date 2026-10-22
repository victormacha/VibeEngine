// Aba Mapas: o aluno edita (ou cria) os mapas em grade do jogo, pintando
// tiles. A IA continua criando os mapas — eles chegam aqui sozinhos depois
// de cada resposta dela (ver chatTab.js) — e também dá pra pedir uma fase
// nova direto daqui ("✨ Gerar com IA"). A partir da primeira edição, o
// mapa passa a ser "do aluno": a versão daqui é injetada no jogo
// (window.VIBE_MAPS) e a IA não sobrescreve mais, até o aluno clicar em
// "Devolver pra IA".
import { state, normalizeMap, normalizeSprite, MAP_TILE_TYPES, MAP_TILE_SHAPES, defaultLegendFor } from "../state.js";
import { generateMapWithAI } from "../api.js";
import { drawMapTile, sameBlock } from "../mapRender.js";
import { toast, openModal } from "../ui.js";

const MAX_COLS = 200;
const MAX_ROWS = 60;
// Caracteres que dá pra usar na legenda sem quebrar o formato do mapa
// (nada de aspas, vírgula, chaves ou barra invertida).
const SAFE_CHARS = "#=^~*+-|/!?@$%&<>_:;ABCDGHIJKLMNOQRSTUVWXYZabcdefghijklmnpqrstuvwxyz0123456789";
const SPAWN_ICON = { item: "★", inimigo: "☠", jogador: "☺", npc: "!" };
const TOOLS = [
  { id: "brush", icon: "🖌️", key: "b", label: "Pincel" },
  { id: "eraser", icon: "🧽", key: "e", label: "Borracha" },
  { id: "bucket", icon: "🪣", key: "g", label: "Balde" },
  { id: "line", icon: "📏", key: "l", label: "Linha" },
  { id: "rect", icon: "▭", key: "r", label: "Retângulo" },
  { id: "eyedropper", icon: "💧", key: "i", label: "Conta-gotas" },
  { id: "select", icon: "🔲", key: "s", label: "Seleção (Ctrl+C/X/V)" },
];

export function mountMapEditorTab(panel, { onPlay } = {}) {
  panel.innerHTML = `
    <div class="map-editor">
      <aside class="map-sidebar">
        <label>Mapa</label>
        <select id="map-select"></select>
        <div class="map-row map-row-wrap">
          <button id="map-new" class="btn-ghost">+ novo</button>
          <button id="map-dup" class="btn-ghost" title="Duplicar este mapa">⧉ duplicar</button>
          <button id="map-rename" class="btn-ghost" title="Renomear">✎</button>
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

        <label>Estilo do mapa</label>
        <select id="map-estilo">
          <option value="plataforma">🏃 Plataforma (vista de lado)</option>
          <option value="topdown">🧭 Top-down / RPG (vista de cima)</option>
        </select>
        <button id="map-estilo-legend" class="btn-ghost map-full" title="Acrescenta os tiles prontos do estilo (piso, árvore, água, porta, NPC...)">+ Tiles prontos deste estilo</button>

        <label>Tamanho do tile no jogo</label>
        <select id="map-tile">
          <option value="16">16 px (bem pequeno)</option>
          <option value="24">24 px</option>
          <option value="32">32 px (padrão)</option>
          <option value="48">48 px (grandão)</option>
        </select>

        <label>Tiles <span class="hint-inline">(clique pra pintar com ele)</span></label>
        <div id="map-legend" class="map-legend"></div>
        <button id="legend-add" class="btn-ghost map-full">+ novo tipo de tile</button>

        <p class="hint">Atalhos: B pincel · E borracha · G balde · L linha · R retângulo ·
          I conta-gotas · S seleção · [ ] tamanho do pincel · Ctrl+Z/Y desfazer/refazer ·
          Ctrl+C/X/V copiar/recortar/colar · Delete apaga a seleção · Esc cancela ·
          Ctrl+roda do mouse = zoom · Espaço+arrastar (ou botão do meio) = mover a tela.</p>
        <p class="hint">As mudanças entram no jogo na hora (▶ Testar) e vão pro banco quando
          você salvar o jogo na aba Testar.</p>
      </aside>

      <div class="map-main">
        <div class="map-toolbar" id="map-toolbar">
          <div class="map-tools" id="map-tools"></div>
          <label class="map-inline" title="Tamanho do pincel ([ e ])">Pincel
            <select id="map-brush"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select>
          </label>
          <label class="map-inline"><input type="checkbox" id="map-grid" checked /> Grade</label>
          <label class="map-inline">Zoom <input type="range" id="map-zoom" min="8" max="48" value="22" /></label>
          <span class="map-spacer"></span>
          <button id="map-undo" class="btn-ghost" title="Desfazer (Ctrl+Z)">↩️</button>
          <button id="map-redo" class="btn-ghost" title="Refazer (Ctrl+Y)">↪️</button>
          <button id="map-ai" class="btn-ghost map-ai-btn" title="Pedir pra IA gerar uma fase">✨ Gerar com IA</button>
          <button id="map-play" class="btn-primary" title="Abrir o jogo na aba Testar">▶ Testar</button>
        </div>
        <div id="map-empty" class="map-empty" hidden>
          <p>Nenhum mapa ainda.</p>
          <p class="hint">Peça pra IA criar um jogo de plataforma, labirinto ou top-down (ela cria o
            mapa sozinha), clique em <strong>✨ Gerar com IA</strong> pra pedir só uma fase, ou em
            <strong>+ novo</strong> pra desenhar do zero.</p>
          <div class="map-row">
            <button id="map-empty-ai" class="btn-primary">✨ Gerar fase com IA</button>
            <button id="map-empty-new" class="btn-ghost">+ Mapa vazio</button>
          </div>
        </div>
        <div class="map-canvas-wrap" id="map-canvas-wrap">
          <canvas id="map-canvas"></canvas>
        </div>
        <div class="map-status">
          <span id="map-status"></span>
          <span id="map-stats" class="map-stats"></span>
        </div>
      </div>
    </div>`;

  const $ = (sel) => panel.querySelector(sel);
  const selectEl = $("#map-select");
  const originEl = $("#map-origin");
  const colsInput = $("#map-cols");
  const rowsInput = $("#map-rows");
  const tileSelect = $("#map-tile");
  const legendEl = $("#map-legend");
  const zoomInput = $("#map-zoom");
  const brushSelect = $("#map-brush");
  const gridToggle = $("#map-grid");
  const canvas = $("#map-canvas");
  const ctx = canvas.getContext("2d");
  const wrap = $("#map-canvas-wrap");
  const emptyEl = $("#map-empty");
  const statusEl = $("#map-status");
  const statsEl = $("#map-stats");

  let currentName = null;
  let currentChar = "#";
  let tool = "brush";
  let undoStack = [];
  let redoStack = [];
  let painting = false;
  let dragStart = null;   // linha/retângulo/seleção: célula onde o arraste começou
  let hoverCell = null;
  let lastPaintCell = null;
  let selection = null;   // { c0, r0, c1, r1 }
  let clipboard = null;   // string[] (linhas do trecho copiado)
  let pasting = false;    // colando: o trecho segue o mouse até clicar
  let panning = null;     // { x, y, sl, st }
  let spaceDown = false;
  let animTimer = null;

  const map = () => (currentName ? state.project.maps[currentName] : null);

  // ---------- quem mexeu por último (IA x aluno) ----------
  // IA e aluno editam o MESMO mapa: o que o aluno pinta aqui vai pra IA no
  // próximo pedido, e ela pode alterar o mapa quando ajudar. `origem` só
  // registra quem mexeu por último.
  function claim() {
    const m = map();
    if (m && m.origem !== "aluno") {
      m.origem = "aluno";
      renderOrigin();
    }
  }

  // Versão deste mapa antes da última resposta da IA, se ela mudou algo nele.
  function versionBeforeAI() {
    const before = state.project.mapsBeforeAI;
    const m = map();
    if (!before || !m || m.origem !== "ia") return undefined;
    const old = before[currentName];
    if (old && JSON.stringify(old.linhas) === JSON.stringify(m.linhas) && JSON.stringify(old.legenda) === JSON.stringify(m.legenda)) return undefined;
    return old || null; // null = a IA criou esse mapa agora
  }

  function renderOrigin() {
    const m = map();
    if (!m) return (originEl.innerHTML = "");
    const badge = m.origem === "aluno"
      ? `<span class="map-badge map-badge-aluno">✏️ Você mexeu por último</span>`
      : `<span class="map-badge map-badge-ia">🤖 A IA mexeu por último</span>`;
    const prev = versionBeforeAI();
    originEl.innerHTML = `${badge}
      <p class="hint map-hint-tight">Você e a IA editam o mesmo mapa: o que você pintar vai pra IA no
        próximo pedido, e dá pra pedir na aba IA coisas como <code>coloca mais inimigos na fase1</code>.</p>
      ${prev !== undefined ? `<button id="map-undo-ai" class="btn-ghost map-full">↩ Desfazer mudança da IA</button>` : ""}`;
    originEl.querySelector("#map-undo-ai")?.addEventListener("click", () => undoAIChange(prev));
  }

  function undoAIChange(prev) {
    const msg = prev
      ? `Voltar o mapa "${currentName}" pra como estava antes da última resposta da IA?`
      : `A IA criou o mapa "${currentName}" na última resposta. Desfazer vai apagar esse mapa. Continuar?`;
    if (!confirm(msg)) return;
    if (prev) {
      pushUndo();
      state.project.maps[currentName] = { ...normalizeMap(prev), origem: "aluno" };
    } else {
      delete state.project.maps[currentName];
      resetHistory();
    }
    renderAll();
    toast("Mudança da IA desfeita. (Pra a IA não refazer, diga isso no próximo pedido.)", "info");
  }

  // ---------- desfazer ----------
  function snapshot() {
    const m = map();
    return { linhas: m.linhas.slice(), legenda: JSON.parse(JSON.stringify(m.legenda)), tile: m.tile, origem: m.origem };
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
  }
  function resetHistory() {
    undoStack = [];
    redoStack = [];
    selection = null;
    pasting = false;
  }
  function restore(snap) {
    Object.assign(map(), JSON.parse(JSON.stringify(snap)));
    renderAll();
  }
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

  // ---------- lista de mapas ----------
  function renderAll() {
    const names = Object.keys(state.project.maps);
    if (currentName && !state.project.maps[currentName]) currentName = null;
    if (!currentName && names.length) currentName = names[0];
    selectEl.innerHTML = names.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join("");
    if (currentName) selectEl.value = currentName;
    const has = !!currentName;
    emptyEl.hidden = has;
    wrap.hidden = !has;
    panel.querySelectorAll(".map-sidebar input, .map-sidebar select, .map-sidebar button, .map-toolbar input, .map-toolbar select, .map-toolbar button").forEach((el) => {
      if (["map-new", "map-ai", "map-play"].includes(el.id)) return;
      el.disabled = !has;
    });
    if (!has) {
      originEl.innerHTML = "";
      legendEl.innerHTML = "";
      statusEl.textContent = "";
      statsEl.textContent = "";
      return;
    }
    state.project.maps[currentName] = normalizeMap(state.project.maps[currentName]);
    const leg = map().legenda;
    if (!leg[currentChar]) currentChar = Object.keys(leg)[0] || "#";
    colsInput.value = map().linhas[0].length;
    rowsInput.value = map().linhas.length;
    tileSelect.value = String(map().tile);
    if (!tileSelect.value) tileSelect.value = "32";
    estiloSelect.value = map().estilo;
    renderOrigin();
    renderLegend();
    draw();
  }

  const estiloSelect = $("#map-estilo");
  estiloSelect.addEventListener("change", () => {
    pushUndo();
    claim();
    map().estilo = estiloSelect.value;
    draw();
    renderLegend();
  });

  // Junta na legenda os tiles prontos do estilo que ainda não existem (pelo
  // nome/tipo), em caracteres livres — não mexe em nada que já está pintado.
  $("#map-estilo-legend").addEventListener("click", () => {
    const m = map();
    const ready = defaultLegendFor(m.estilo);
    const have = new Set(Object.values(m.legenda).map((d) => `${d.tipo}:${d.nome || ""}:${d.forma || ""}`));
    let added = 0;
    pushUndo();
    Object.entries(ready).forEach(([ch, def]) => {
      if (have.has(`${def.tipo}:${def.nome || ""}:${def.forma || ""}`)) return;
      const free = !m.legenda[ch] ? ch : [...SAFE_CHARS].find((c) => !m.legenda[c]);
      if (!free) return;
      m.legenda[free] = def;
      added++;
    });
    if (!added) return toast("A legenda já tem todos os tiles prontos desse estilo.", "info");
    claim();
    renderLegend();
    draw();
    toast(`${added} tile(s) adicionado(s) à legenda.`, "success");
  });

  selectEl.addEventListener("change", () => {
    currentName = selectEl.value;
    resetHistory();
    renderAll();
  });

  function askMapName(title, suggested) {
    const raw = prompt(title, suggested);
    if (raw == null) return null;
    const name = raw.trim().replace(/[^\w]/g, "");
    if (!name) {
      toast("Use só letras, números e _ no nome.", "error");
      return null;
    }
    if (state.project.maps[name]) {
      toast(`Já existe um mapa "${name}".`, "error");
      return null;
    }
    return name;
  }

  function nextMapName() {
    let i = Object.keys(state.project.maps).length + 1;
    while (state.project.maps[`fase${i}`]) i++;
    return `fase${i}`;
  }

  function guessEstilo() {
    const mov = state.project.mechanics?.movimento;
    return mov === "topdown" || ["topdown", "puzzle"].includes(state.project.genre) ? "topdown" : "plataforma";
  }

  // Mapa novo: escolhe o estilo (plataforma = vista de lado; top-down = RPG
  // / aventura / labirinto vista de cima) e já vem com um esboço mínimo.
  function newEmptyMap() {
    const { overlay, close } = openModal(`
      <h2>🗺️ Novo mapa</h2>
      <label>Nome</label>
      <input type="text" id="new-name" value="${escapeAttr(nextMapName())}" maxlength="30" />
      <label>Estilo</label>
      <div class="map-style-pick">
        <button class="map-style-opt" data-estilo="plataforma">🏃 Plataforma<span>vista de lado, com pulo e gravidade</span></button>
        <button class="map-style-opt" data-estilo="topdown">🧭 Top-down / RPG<span>vista de cima, tipo Zelda, Pokémon, Undertale</span></button>
      </div>
      <div class="map-gen-grid">
        <label>Colunas <input type="number" id="new-cols" min="8" max="${MAX_COLS}" /></label>
        <label>Linhas <input type="number" id="new-rows" min="6" max="${MAX_ROWS}" /></label>
      </div>
      <button id="new-go" class="btn-primary map-full">Criar mapa</button>
    `);
    let estilo = guessEstilo();
    const colsIn = overlay.querySelector("#new-cols");
    const rowsIn = overlay.querySelector("#new-rows");
    const pick = (e) => {
      estilo = e;
      overlay.querySelectorAll(".map-style-opt").forEach((b) => b.classList.toggle("selected", b.dataset.estilo === e));
      colsIn.value = e === "topdown" ? 25 : 40;
      rowsIn.value = e === "topdown" ? 15 : 14;
    };
    overlay.querySelectorAll(".map-style-opt").forEach((b) => b.addEventListener("click", () => pick(b.dataset.estilo)));
    pick(estilo);
    overlay.querySelector("#new-go").addEventListener("click", () => {
      const name = overlay.querySelector("#new-name").value.trim().replace(/[^\w]/g, "");
      if (!name) return toast("Use só letras, números e _ no nome.", "error");
      if (state.project.maps[name]) return toast(`Já existe um mapa "${name}".`, "error");
      const cols = clampInt(colsIn.value, 8, MAX_COLS);
      const rows = clampInt(rowsIn.value, 6, MAX_ROWS);
      let linhas;
      if (estilo === "topdown") {
        // sala cercada de árvores, com grama por dentro
        linhas = Array.from({ length: rows }, (_, y) =>
          Array.from({ length: cols }, (_, x) => (y === 0 || x === 0 || y === rows - 1 || x === cols - 1 ? "T" : "_")).join(""));
        const mid = Math.floor(rows / 2);
        linhas[mid] = linhas[mid].slice(0, 2) + "P" + linhas[mid].slice(3);
      } else {
        linhas = Array.from({ length: rows }, (_, y) => (y >= rows - 2 ? "#" : ".").repeat(cols));
        linhas[rows - 3] = "..P" + ".".repeat(cols - 5) + "F.";
      }
      state.project.maps[name] = { estilo, tile: 32, legenda: defaultLegendFor(estilo), linhas, origem: "aluno" };
      currentName = name;
      resetHistory();
      close();
      renderAll();
    });
  }
  $("#map-new").addEventListener("click", newEmptyMap);
  $("#map-empty-new").addEventListener("click", newEmptyMap);

  $("#map-dup").addEventListener("click", () => {
    const name = askMapName("Nome da cópia:", `${currentName}_copia`);
    if (!name) return;
    state.project.maps[name] = { ...JSON.parse(JSON.stringify(map())), origem: "aluno" };
    currentName = name;
    resetHistory();
    renderAll();
    toast(`Mapa duplicado como "${name}".`, "success");
  });

  $("#map-rename").addEventListener("click", () => {
    const name = askMapName(`Novo nome pro mapa "${currentName}":`, currentName);
    if (!name) return;
    // Renomear = a IA perde a referência ao nome antigo; o mapa vira do aluno.
    state.project.maps[name] = { ...map(), origem: "aluno" };
    delete state.project.maps[currentName];
    currentName = name;
    renderAll();
    toast(`Renomeado. Peça na aba IA pra usar o mapa "${name}" no jogo.`, "info");
  });

  $("#map-delete").addEventListener("click", () => {
    if (!currentName || !confirm(`Apagar o mapa "${currentName}"?`)) return;
    delete state.project.maps[currentName];
    currentName = null;
    resetHistory();
    renderAll();
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
    selection = null;
    renderAll();
  });

  tileSelect.addEventListener("change", () => {
    pushUndo();
    claim();
    map().tile = Number(tileSelect.value) || 32;
    draw();
  });

  // ---------- legenda ----------
  function renderLegend() {
    const m = map();
    const spriteNames = Object.keys(state.project.sprites || {});
    legendEl.innerHTML = "";
    Object.entries(m.legenda).forEach(([ch, def]) => {
      const row = document.createElement("div");
      row.className = "legend-row" + (ch === currentChar ? " active" : "");
      const swatch = document.createElement("canvas");
      swatch.width = swatch.height = 24;
      swatch.className = "legend-swatch";
      drawCellPreview(swatch.getContext("2d"), def, 24, m.estilo);
      const otherMaps = Object.keys(state.project.maps).filter((n) => n !== currentName);
      row.innerHTML = `
        <button class="legend-pick" title="Pintar com este tile">
          <span class="legend-swatch-slot"></span>
          <code>${escapeHtml(ch)}</code>
          <span class="legend-name">${escapeHtml(def.nome || labelFor(def.tipo))}</span>
          <span class="legend-count">${countChar(m, ch)}</span>
        </button>
        <div class="legend-edit">
          <select class="legend-type" title="Tipo">
            ${MAP_TILE_TYPES.map((t) => `<option value="${t.id}" ${t.id === def.tipo ? "selected" : ""}>${t.label}</option>`).join("")}
          </select>
          <label class="legend-field">Cor <input type="color" class="legend-color" value="${toHex(def.cor)}" /></label>
          ${def.tipo === "solido" && m.estilo !== "topdown" && !def.forma ? `<label class="legend-field">Grama <input type="color" class="legend-topo" value="${toHex(def.topo, "#4caf50")}" /></label>` : ""}
          <label class="legend-field legend-field-wide">Forma
            <select class="legend-forma">
              ${MAP_TILE_SHAPES.map((f) => `<option value="${f.id}" ${(def.forma || "") === f.id ? "selected" : ""}>${f.label}</option>`).join("")}
            </select>
          </label>
          ${def.tipo === "porta" ? `<label class="legend-field legend-field-wide">Leva pra
            <select class="legend-destino">
              <option value="">— nenhum mapa —</option>
              ${otherMaps.map((n) => `<option value="${escapeAttr(n)}" ${def.destino === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
            </select>
          </label>` : ""}
          <label class="legend-field legend-field-wide">Nome <input type="text" class="legend-nome" value="${escapeAttr(def.nome || "")}" placeholder="${escapeAttr(labelFor(def.tipo))}" maxlength="24" /></label>
          <label class="legend-field legend-field-wide">Sprite
            <select class="legend-sprite">
              <option value="">— desenho padrão —</option>
              ${spriteNames.map((n) => `<option value="${escapeAttr(n)}" ${def.sprite === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
            </select>
          </label>
          <button class="legend-del btn-ghost btn-danger" title="Remover este tipo (apaga do mapa)">✕ remover tile</button>
        </div>`;
      row.querySelector(".legend-swatch-slot").replaceWith(swatch);
      row.querySelector(".legend-pick").addEventListener("click", () => {
        currentChar = ch;
        if (tool === "eraser" || tool === "eyedropper" || tool === "select") setTool("brush");
        renderLegend();
      });
      const edit = (fn) => {
        pushUndo();
        claim();
        fn();
        renderLegend();
        draw();
      };
      row.querySelector(".legend-type").addEventListener("change", (e) => edit(() => { def.tipo = e.target.value; }));
      row.querySelector(".legend-color").addEventListener("change", (e) => edit(() => { def.cor = e.target.value; }));
      row.querySelector(".legend-topo")?.addEventListener("change", (e) => edit(() => { def.topo = e.target.value; }));
      row.querySelector(".legend-forma").addEventListener("change", (e) => edit(() => {
        if (e.target.value) def.forma = e.target.value;
        else delete def.forma;
      }));
      row.querySelector(".legend-destino")?.addEventListener("change", (e) => edit(() => { def.destino = e.target.value; }));
      row.querySelector(".legend-nome").addEventListener("change", (e) => edit(() => {
        const v = e.target.value.trim();
        if (v) def.nome = v;
        else delete def.nome;
      }));
      row.querySelector(".legend-sprite").addEventListener("change", (e) => edit(() => {
        if (e.target.value) def.sprite = e.target.value;
        else delete def.sprite;
      }));
      row.querySelector(".legend-del").addEventListener("click", () => {
        if (Object.keys(m.legenda).length <= 1) return toast("O mapa precisa de pelo menos um tipo de tile.", "error");
        if (!confirm(`Remover o tile "${ch}"? Todas as células dele viram vazio.`)) return;
        edit(() => {
          delete m.legenda[ch];
          m.linhas = m.linhas.map((l) => l.split(ch).join("."));
          if (currentChar === ch) currentChar = Object.keys(m.legenda)[0];
        });
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
  const toolsEl = $("#map-tools");
  TOOLS.forEach((t) => {
    const b = document.createElement("button");
    b.className = "tool-btn" + (t.id === tool ? " active" : "");
    b.dataset.tool = t.id;
    b.title = `${t.label} (${t.key.toUpperCase()})`;
    b.textContent = t.icon;
    b.addEventListener("click", () => setTool(t.id));
    toolsEl.appendChild(b);
  });
  function setTool(t) {
    tool = t;
    pasting = false;
    if (t !== "select") selection = null;
    toolsEl.querySelectorAll(".tool-btn").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    canvas.style.cursor = t === "eyedropper" ? "copy" : "crosshair";
    draw();
  }

  const paintChar = () => (tool === "eraser" ? "." : currentChar);
  const brushSize = () => Number(brushSelect.value) || 1;

  function inBounds(col, row) {
    const m = map();
    return row >= 0 && row < m.linhas.length && col >= 0 && col < m.linhas[0].length;
  }

  function setCell(col, row, ch) {
    const m = map();
    if (!inBounds(col, row) || m.linhas[row][col] === ch) return false;
    claim();
    // Só um "jogador" por mapa: pintar um novo apaga o anterior.
    if (m.legenda[ch]?.tipo === "jogador") {
      m.linhas = m.linhas.map((l) => [...l].map((c) => (m.legenda[c]?.tipo === "jogador" ? "." : c)).join(""));
    }
    const line = m.linhas[row];
    m.linhas[row] = line.slice(0, col) + ch + line.slice(col + 1);
    return true;
  }

  // Pincel quadrado (1, 2 ou 3) — itens/inimigos/jogador sempre 1 célula.
  function stamp(col, row, ch) {
    const single = ch !== "." && ["jogador", "item", "inimigo", "npc"].includes(map().legenda[ch]?.tipo);
    const size = single ? 1 : brushSize();
    const off = Math.floor((size - 1) / 2);
    let any = false;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (setCell(col - off + x, row - off + y, ch)) any = true;
    return any;
  }

  function lineCells(a, b) {
    const out = [];
    const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row), 1);
    for (let i = 0; i <= steps; i++) {
      out.push({ col: Math.round(a.col + ((b.col - a.col) * i) / steps), row: Math.round(a.row + ((b.row - a.row) * i) / steps) });
    }
    return out;
  }

  function fill(col, row, ch) {
    const m = map();
    const target = m.linhas[row]?.[col];
    if (target == null || target === ch) return;
    claim();
    const grid = m.linhas.map((l) => [...l]);
    const stack = [[col, row]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length || grid[y][x] !== target) continue;
      grid[y][x] = ch;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    m.linhas = grid.map((r) => r.join(""));
  }

  const rectOf = (a, b) => ({
    c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col),
    r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row),
  });

  // ---------- seleção / copiar / colar ----------
  function copySelection(cut) {
    if (!selection) return toast("Selecione uma área primeiro (ferramenta 🔲).", "error");
    const m = map();
    clipboard = [];
    for (let r = selection.r0; r <= selection.r1; r++) clipboard.push(m.linhas[r].slice(selection.c0, selection.c1 + 1));
    if (cut) {
      pushUndo();
      clearSelection(false);
    }
    toast(cut ? "Recortado — Ctrl+V pra colar." : "Copiado — Ctrl+V pra colar.", "success");
  }
  function clearSelection(withUndo = true) {
    if (!selection) return;
    if (withUndo) pushUndo();
    for (let r = selection.r0; r <= selection.r1; r++) for (let c = selection.c0; c <= selection.c1; c++) setCell(c, r, ".");
    draw();
  }
  function startPaste() {
    if (!clipboard) return toast("Nada copiado ainda — selecione (🔲) e use Ctrl+C.", "error");
    setTool("select");
    pasting = true;
    draw();
  }
  function placePaste(cell) {
    pushUndo();
    clipboard.forEach((line, dy) => [...line].forEach((ch, dx) => {
      if (ch !== ".") setCell(cell.col + dx, cell.row + dy, ch); // vazio do trecho não apaga o que está embaixo
    }));
    selection = { c0: cell.col, r0: cell.row, c1: cell.col + clipboard[0].length - 1, r1: cell.row + clipboard.length - 1 };
    pasting = false;
    draw();
  }

  // ---------- mouse ----------
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
    // Mover a tela: botão do meio, ou Espaço segurado.
    if (e.button === 1 || spaceDown) {
      panning = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const cell = cellFromEvent(e);

    if (tool === "eyedropper") {
      const ch = map().linhas[cell.row]?.[cell.col];
      if (ch && ch !== ".") {
        currentChar = ch;
        setTool("brush");
        renderLegend();
      }
      return;
    }
    if (tool === "select") {
      if (pasting) return placePaste(cell);
      dragStart = cell;
      selection = rectOf(cell, cell);
      draw();
      return;
    }
    pushUndo();
    if (tool === "bucket") {
      fill(cell.col, cell.row, paintChar());
      draw();
      return;
    }
    if (tool === "rect" || tool === "line") {
      dragStart = cell;
      draw();
      return;
    }
    painting = true;
    lastPaintCell = cell;
    if (stamp(cell.col, cell.row, paintChar())) draw();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!map()) return;
    if (panning) {
      wrap.scrollLeft = panning.sl - (e.clientX - panning.x);
      wrap.scrollTop = panning.st - (e.clientY - panning.y);
      return;
    }
    const cell = cellFromEvent(e);
    const moved = !hoverCell || hoverCell.col !== cell.col || hoverCell.row !== cell.row;
    hoverCell = cell;
    if (painting) {
      // Pinta a linha inteira desde a última célula: mouse rápido pula
      // células entre um evento e outro, e sem isso o traço sai com buracos.
      let any = false;
      lineCells(lastPaintCell || cell, cell).forEach((c) => { if (stamp(c.col, c.row, paintChar())) any = true; });
      lastPaintCell = cell;
      if (any) draw();
    } else if (tool === "select" && dragStart) {
      selection = rectOf(dragStart, cell);
      draw();
    } else if (moved) {
      draw();
    }
    renderStatus();
  });

  function endStroke() {
    if (panning) {
      panning = null;
      return;
    }
    if (dragStart && hoverCell && (tool === "rect" || tool === "line")) {
      const ch = paintChar();
      if (tool === "rect") {
        const r = rectOf(dragStart, hoverCell);
        for (let y = r.r0; y <= r.r1; y++) for (let x = r.c0; x <= r.c1; x++) setCell(x, y, ch);
      } else {
        lineCells(dragStart, hoverCell).forEach((c) => stamp(c.col, c.row, ch));
      }
      draw();
    }
    dragStart = null;
    painting = false;
    lastPaintCell = null;
  }
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("pointerleave", () => {
    if (!painting && !dragStart) {
      hoverCell = null;
      draw();
    }
  });
  canvas.addEventListener("auxclick", (e) => e.preventDefault());

  // Ctrl + roda = zoom (mantém a célula sob o mouse no lugar).
  wrap.addEventListener("wheel", (e) => {
    if (!e.ctrlKey || !map()) return;
    e.preventDefault();
    const before = cellSize();
    const after = Math.max(8, Math.min(48, before + (e.deltaY < 0 ? 2 : -2)));
    if (after === before) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    zoomInput.value = after;
    draw();
    wrap.scrollLeft += (mx * after) / before - mx;
    wrap.scrollTop += (my * after) / before - my;
  }, { passive: false });

  $("#map-undo").addEventListener("click", undo);
  $("#map-redo").addEventListener("click", redo);
  zoomInput.addEventListener("input", draw);
  gridToggle.addEventListener("change", draw);
  $("#map-play").addEventListener("click", () => onPlay?.());

  // Atalhos só quando a aba Mapas está visível e o foco não está num campo.
  document.addEventListener("keydown", (e) => {
    if (!panel.isConnected || !panel.classList.contains("active") || !map()) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector(".vibe-modal-overlay")) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z") { e.preventDefault(); return undo(); }
    if (mod && k === "y") { e.preventDefault(); return redo(); }
    if (mod && k === "c") { e.preventDefault(); return copySelection(false); }
    if (mod && k === "x") { e.preventDefault(); return copySelection(true); }
    if (mod && k === "v") { e.preventDefault(); return startPaste(); }
    if (mod || e.altKey) return;
    if (e.key === " ") { spaceDown = true; canvas.style.cursor = "grab"; e.preventDefault(); return; }
    if (e.key === "Escape") { pasting = false; selection = null; dragStart = null; return draw(); }
    if (e.key === "Delete" || e.key === "Backspace") { if (selection) { e.preventDefault(); clearSelection(); } return; }
    if (e.key === "[" || e.key === "]") {
      brushSelect.value = String(Math.max(1, Math.min(3, brushSize() + (e.key === "]" ? 1 : -1))));
      return draw();
    }
    const t = TOOLS.find((x) => x.key === k);
    if (t) setTool(t.id);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      spaceDown = false;
      canvas.style.cursor = tool === "eyedropper" ? "copy" : "crosshair";
    }
  });

  // ---------- gerar com IA ----------
  function openGenerateModal() {
    const m = map();
    const cols = m ? m.linhas[0].length : 60;
    const rows = m ? m.linhas.length : 15;
    const { overlay, close } = openModal(`
      <h2>✨ Gerar fase com IA</h2>
      <p class="hint" style="margin-top:0">Descreva a fase. A IA monta o mapa com os tiles da legenda
        ${m ? `do mapa <strong>${escapeHtml(currentName)}</strong>` : "padrão"} — depois é só ajustar pintando.</p>
      <label>Como é a fase?</label>
      <textarea id="gen-desc" rows="3" placeholder="ex: uma vila com casas, um lago no meio, 3 NPCs e uma porta pra floresta — ou: caverna com espinhos, duas molas e moedas escondidas"></textarea>
      <label>Estilo</label>
      <select id="gen-estilo">
        <option value="plataforma">🏃 Plataforma (vista de lado)</option>
        <option value="topdown">🧭 Top-down / RPG (vista de cima)</option>
      </select>
      <div class="map-gen-grid">
        <label>Colunas <input type="number" id="gen-cols" min="10" max="${MAX_COLS}" value="${cols}" /></label>
        <label>Linhas <input type="number" id="gen-rows" min="6" max="${MAX_ROWS}" value="${rows}" /></label>
      </div>
      <label>Onde colocar</label>
      <select id="gen-target">
        ${m ? `<option value="replace">Substituir o mapa "${escapeHtml(currentName)}"</option>` : ""}
        <option value="new">Criar um mapa novo (${nextMapName()})</option>
      </select>
      <div id="gen-error" class="auth-error" hidden></div>
      <button id="gen-go" class="btn-primary map-full">✨ Gerar</button>
    `);
    const go = overlay.querySelector("#gen-go");
    const errBox = overlay.querySelector("#gen-error");
    const estiloIn = overlay.querySelector("#gen-estilo");
    estiloIn.value = m ? m.estilo : guessEstilo();
    go.addEventListener("click", async () => {
      const c = clampInt(overlay.querySelector("#gen-cols").value, 10, MAX_COLS);
      const r = clampInt(overlay.querySelector("#gen-rows").value, 6, MAX_ROWS);
      const target = overlay.querySelector("#gen-target").value;
      const estilo = estiloIn.value;
      // Mesma legenda do mapa atual quando o estilo é o mesmo; senão, os tiles prontos do estilo.
      const legenda = m && m.estilo === estilo ? JSON.parse(JSON.stringify(m.legenda)) : defaultLegendFor(estilo);
      go.disabled = true;
      errBox.hidden = true;
      let secs = 0;
      const tick = setInterval(() => { go.textContent = `Gerando... (${++secs}s)`; }, 1000);
      go.textContent = "Gerando...";
      try {
        const gen = await generateMapWithAI({
          descricao: overlay.querySelector("#gen-desc").value.trim(),
          cols: c, rows: r, legenda, tile: m?.tile || 32, estilo,
          genero: state.project.genre,
          lore: state.project.lore?.content,
          outrosMapas: Object.keys(state.project.maps).filter((n) => n !== currentName),
        });
        if (target === "replace" && m) {
          pushUndo();
          Object.assign(m, gen, { origem: "aluno" });
        } else {
          const name = nextMapName();
          state.project.maps[name] = { ...gen, origem: "aluno" };
          currentName = name;
          resetHistory();
        }
        close();
        renderAll();
        toast("Fase gerada! Ajuste pintando e teste no ▶.", "success");
      } catch (err) {
        errBox.hidden = false;
        errBox.textContent = err.message;
      } finally {
        clearInterval(tick);
        go.disabled = false;
        go.textContent = "✨ Gerar";
      }
    });
  }
  $("#map-ai").addEventListener("click", openGenerateModal);
  $("#map-empty-ai").addEventListener("click", openGenerateModal);

  // ---------- desenho ----------
  const cellSize = () => Number(zoomInput.value) || 22;

  const spriteCanvasCache = new Map();
  function spriteThumb(name) {
    const s = state.project.sprites?.[name];
    if (!s) return null;
    const frames = Object.values(normalizeSprite(s).anims)[0]?.frames;
    const frame = frames?.[0];
    if (!frame) return null;
    const key = `${name}:${JSON.stringify(frame).length}`;
    if (spriteCanvasCache.has(key)) return spriteCanvasCache.get(key);
    const c = document.createElement("canvas");
    c.width = frame[0]?.length || frame.length;
    c.height = frame.length;
    const cx = c.getContext("2d");
    frame.forEach((row, y) => [...row].forEach((color, x) => {
      if (color) { cx.fillStyle = color; cx.fillRect(x, y, 1, 1); }
    }));
    spriteCanvasCache.set(key, c);
    return c;
  }

  function tipoAt(m, col, row) {
    const ch = m.linhas[row]?.[col];
    if (!ch || ch === ".") return null;
    return m.legenda[ch]?.tipo || "solido";
  }

  // Mesmo desenho do jogo (mapRender.js), com ícones nos pontos de nascimento.
  // Piso mais usado do mapa top-down — desenhado embaixo de jogador, itens,
  // NPCs, árvores e portas (igual ao jogo, ver Vibe.loadMap).
  function mainFloor(m) {
    if (!m || m.estilo !== "topdown") return null;
    const count = {};
    m.linhas.forEach((l) => { for (const ch of l) if (m.legenda[ch]?.tipo === "piso") count[ch] = (count[ch] || 0) + 1; });
    const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    return best ? m.legenda[best] : null;
  }
  let floorCache = null;

  function drawCell(target, m, col, row, z, def, now, alpha = 1, estiloOverride) {
    target.globalAlpha = alpha;
    const estilo = estiloOverride || m?.estilo || "plataforma";
    const t = { x: col * z, y: row * z, col, row, tipo: def.tipo || "solido", def, estilo };
    const floor = m === map() ? floorCache : mainFloor(m);
    if (floor && t.tipo !== "piso" && (SPAWN_ICON[t.tipo] || def.forma || ["porta", "decoracao", "perigo"].includes(t.tipo))) {
      drawMapTile(target, { x: t.x, y: t.y, col, row, tipo: "piso", def: floor, estilo }, z, {}, now);
    }
    const thumb = def.sprite && spriteThumb(def.sprite);
    if (thumb) {
      target.imageSmoothingEnabled = false;
      target.drawImage(thumb, t.x, t.y, z, z);
    } else if (SPAWN_ICON[t.tipo]) {
      target.fillStyle = def.cor || "#777";
      target.beginPath();
      target.arc(t.x + z / 2, t.y + z / 2, z * 0.42, 0, Math.PI * 2);
      target.fill();
      target.fillStyle = "#0d0f16";
      target.font = `bold ${Math.round(z * 0.6)}px sans-serif`;
      target.textAlign = "center";
      target.textBaseline = "middle";
      target.fillText(SPAWN_ICON[t.tipo], t.x + z / 2, t.y + z / 2 + 1);
    } else {
      const tp = t.tipo;
      drawMapTile(target, t, z, m ? {
        up: sameBlock(tp, tipoAt(m, col, row - 1)), down: sameBlock(tp, tipoAt(m, col, row + 1)),
        left: sameBlock(tp, tipoAt(m, col - 1, row)), right: sameBlock(tp, tipoAt(m, col + 1, row)),
      } : {}, now);
    }
    target.globalAlpha = 1;
  }

  function drawCellPreview(target, def, size, estilo) {
    target.clearRect(0, 0, size, size);
    target.fillStyle = "#151824";
    target.fillRect(0, 0, size, size);
    drawCell(target, null, 0, 0, size, def, 0, 1, estilo);
  }

  function draw() {
    const m = map();
    if (!m) return;
    const z = cellSize();
    const rows = m.linhas.length;
    const cols = m.linhas[0].length;
    const now = performance.now();
    if (canvas.width !== cols * z) canvas.width = cols * z;
    if (canvas.height !== rows * z) canvas.height = rows * z;
    floorCache = mainFloor(m);
    if (m.estilo === "topdown") {
      // vista de cima: fundo escuro liso (célula vazia = fora do mapa)
      ctx.fillStyle = "#0f1118";
    } else {
      // céu em degradê, pra ficar parecido com um jogo e não com uma planilha
      const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
      sky.addColorStop(0, "#1d2b4a");
      sky.addColorStop(1, "#151824");
      ctx.fillStyle = sky;
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < rows; y++) {
      const line = m.linhas[y];
      for (let x = 0; x < cols; x++) {
        const ch = line[x];
        if (ch === "." || ch === " ") continue;
        drawCell(ctx, m, x, y, z, m.legenda[ch] || { tipo: "solido", cor: "#666" }, now);
      }
    }

    if (gridToggle.checked) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= cols; x++) { ctx.moveTo(x * z + 0.5, 0); ctx.lineTo(x * z + 0.5, rows * z); }
      for (let y = 0; y <= rows; y++) { ctx.moveTo(0, y * z + 0.5); ctx.lineTo(cols * z, y * z + 0.5); }
      ctx.stroke();
    }

    // prévias
    const preview = (cells, ch) => {
      const def = ch === "." ? null : m.legenda[ch];
      cells.forEach(({ col, row }) => {
        if (!inBounds(col, row)) return;
        if (def) drawCell(ctx, m, col, row, z, def, now, 0.55);
        else { ctx.fillStyle = "rgba(255,93,115,0.35)"; ctx.fillRect(col * z, row * z, z, z); }
      });
    };
    if (dragStart && hoverCell && tool === "rect") {
      const r = rectOf(dragStart, hoverCell);
      const cells = [];
      for (let y = r.r0; y <= r.r1; y++) for (let x = r.c0; x <= r.c1; x++) cells.push({ col: x, row: y });
      preview(cells, paintChar());
    } else if (dragStart && hoverCell && tool === "line") {
      preview(lineCells(dragStart, hoverCell), paintChar());
    } else if (pasting && hoverCell && clipboard) {
      clipboard.forEach((line, dy) => [...line].forEach((ch, dx) => {
        if (ch !== ".") preview([{ col: hoverCell.col + dx, row: hoverCell.row + dy }], ch);
      }));
      outline(hoverCell.col, hoverCell.row, clipboard[0].length, clipboard.length, "#5ee6c4");
    } else if (hoverCell && inBounds(hoverCell.col, hoverCell.row) && ["brush", "eraser"].includes(tool)) {
      const size = brushSize();
      const off = Math.floor((size - 1) / 2);
      outline(hoverCell.col - off, hoverCell.row - off, size, size, tool === "eraser" ? "#ff5d73" : "#ffb454");
    } else if (hoverCell && inBounds(hoverCell.col, hoverCell.row)) {
      outline(hoverCell.col, hoverCell.row, 1, 1, "#ffb454");
    }
    if (selection) {
      ctx.setLineDash([6, 4]);
      outline(selection.c0, selection.r0, selection.c1 - selection.c0 + 1, selection.r1 - selection.r0 + 1, "#5ee6c4");
      ctx.setLineDash([]);
    }
    renderStats();
  }

  function outline(col, row, w, h, color) {
    const z = cellSize();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(col * z + 1, row * z + 1, w * z - 2, h * z - 2);
  }

  function renderStatus() {
    const m = map();
    if (!m || !hoverCell) return (statusEl.textContent = "");
    const ch = m.linhas[hoverCell.row]?.[hoverCell.col];
    statusEl.textContent = ch == null ? "" : `coluna ${hoverCell.col + 1}, linha ${hoverCell.row + 1} — ${ch === "." ? "vazio" : `"${ch}" ${m.legenda[ch]?.nome || labelFor(m.legenda[ch]?.tipo)}`}`;
  }

  // Contagem por tipo + avisos de coisas que deixam a fase injogável.
  function renderStats() {
    const m = map();
    const count = {};
    m.linhas.forEach((l) => [...l].forEach((ch) => {
      if (ch === ".") return;
      const t = m.legenda[ch]?.tipo || "solido";
      count[t] = (count[t] || 0) + 1;
    }));
    const parts = [];
    if (count.item) parts.push(`★ ${count.item} itens`);
    if (count.inimigo) parts.push(`☠ ${count.inimigo} inimigos`);
    if (count.checkpoint) parts.push(`🚩 ${count.checkpoint} checkpoints`);
    if (count.npc) parts.push(`! ${count.npc} NPCs`);
    if (count.porta) parts.push(`🚪 ${count.porta} portas`);
    const warn = [];
    if (!count.jogador) warn.push("sem ponto do jogador (☺)");
    // plataforma termina numa saída; no top-down a fase pode acabar por porta/NPC/objetivo
    if (m.estilo !== "topdown" && !count.saida) warn.push("sem saída (⚑)");
    const portasSemDestino = Object.entries(m.legenda).some(([ch, d]) => d.tipo === "porta" && !d.destino && m.linhas.some((l) => l.includes(ch)));
    if (portasSemDestino) warn.push("porta sem destino");
    const estiloTxt = m.estilo === "topdown" ? "🧭 top-down" : "🏃 plataforma";
    statsEl.innerHTML = `${estiloTxt} · ${m.linhas[0].length}×${m.linhas.length} · tile ${m.tile}px${parts.length ? " · " + parts.join(" · ") : ""}` +
      (warn.length ? ` <span class="map-warn">⚠ ${warn.join(", ")}</span>` : "");
  }

  // Perigos/bandeiras animam devagar no editor também (só com a aba aberta).
  animTimer = setInterval(() => {
    if (!panel.isConnected) return clearInterval(animTimer);
    if (panel.classList.contains("active") && map() && !painting && !document.hidden) draw();
  }, 200);

  renderAll();

  // Chamado pelo main.js quando a aba é aberta ou a IA cria/muda mapas.
  return {
    refresh() {
      renderAll();
    },
  };
}

function countChar(m, ch) {
  let n = 0;
  m.linhas.forEach((l) => { for (const c of l) if (c === ch) n++; });
  return n || "";
}

function labelFor(tipo) {
  return (MAP_TILE_TYPES.find((t) => t.id === tipo)?.label || tipo || "").split(" (")[0];
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function toHex(color, fallback = "#777777") {
  return /^#[0-9a-f]{6}$/i.test(color || "") ? color : fallback;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
