import { PixelCanvas, DEFAULT_PALETTE, resizePixelMatrix, blankMatrix, paintMatrix } from "../pixelArt/canvasEngine.js";
import { state, saveSprite, deleteSprite, normalizeSprite } from "../state.js";
import { toast } from "../ui.js";

export function mountPixelEditorTab(panel) {
  panel.innerHTML = `
    <div class="pixel-editor">
      <aside class="pixel-sidebar">
        <label>Sprite</label>
        <select id="sprite-select"></select>
        <div class="sprite-name-row">
          <input id="sprite-name" placeholder="nome do sprite (ex: jogador)" />
          <button id="sprite-new" class="btn-ghost">+ novo</button>
        </div>

        <label>Animação</label>
        <div class="sprite-anim-row">
          <select id="anim-select"></select>
          <button id="anim-new" class="btn-ghost" title="Nova animação (ex: andar, atacar, dash)">+ anim</button>
          <button id="anim-del" class="btn-ghost btn-danger" title="Apagar esta animação">🗑️</button>
        </div>

        <label>Tamanho do grid</label>
        <select id="sprite-size">
          <option value="16">16 × 16</option>
          <option value="24" selected>24 × 24</option>
          <option value="32">32 × 32</option>
          <option value="48">48 × 48 (bosses/detalhado)</option>
        </select>

        <label>Ferramenta</label>
        <div class="tool-row">
          <button class="tool-btn active" data-tool="brush" title="Pincel">🖌️</button>
          <button class="tool-btn" data-tool="eraser" title="Borracha">🧽</button>
          <button class="tool-btn" data-tool="bucket" title="Balde">🪣</button>
          <button class="tool-btn" data-tool="eyedropper" title="Conta-gotas">💧</button>
        </div>

        <label>Cor atual</label>
        <input type="color" id="color-picker" value="#ff5d73" />
        <div class="palette" id="palette"></div>

        <div class="pixel-actions">
          <button id="btn-undo" class="btn-ghost">↩️ Desfazer</button>
          <button id="btn-clear" class="btn-ghost">🗑️ Limpar frame</button>
          <button id="btn-save-sprite" class="btn-primary">💾 Salvar sprite</button>
          <button id="btn-delete-sprite" class="btn-ghost btn-danger">🗑️ Apagar sprite</button>
        </div>
        <p class="hint">Dica: use os nomes <code>jogador</code>, <code>inimigo</code>,
          <code>item</code> ou <code>cenario</code> para a IA usar sua arte automaticamente
          no jogo. Crie animações como <code>andar</code>, <code>atacar</code> ou
          <code>dash</code> dentro do mesmo sprite — a IA escolhe a animação certa pra
          cada momento do jogo, em vez de usar sempre a mesma pose.</p>
      </aside>

      <div class="pixel-main">
        <div class="pixel-canvas-wrap">
          <canvas id="pixel-canvas"></canvas>
        </div>

        <div class="frames-bar">
          <div class="frames-strip" id="frames-strip"></div>
          <div class="frames-controls">
            <button id="frame-add" class="btn-ghost" title="Duplicar frame atual como novo">➕ Frame</button>
            <button id="frame-del" class="btn-ghost" title="Excluir frame atual">🗑️ Frame</button>
            <button id="frame-left" class="btn-ghost" title="Mover frame pra esquerda">◀</button>
            <button id="frame-right" class="btn-ghost" title="Mover frame pra direita">▶</button>
            <label class="frame-speed-label">Velocidade (ms/frame)
              <input type="number" id="frame-duration" min="50" max="2000" step="10" value="150" />
            </label>
            <button id="frame-play" class="btn-ghost">▶️ Prévia da animação</button>
            <canvas id="frame-preview" width="64" height="64" hidden></canvas>
          </div>
        </div>
      </div>

      <aside class="sprite-gallery" id="sprite-gallery">
        <h4>Sprites salvos</h4>
        <div class="gallery-grid" id="gallery-grid"></div>
      </aside>
    </div>`;

  const canvasEl = panel.querySelector("#pixel-canvas");
  const canvasWrapEl = panel.querySelector(".pixel-canvas-wrap");
  const editor = new PixelCanvas(canvasEl, { size: 24, cell: 18 });

  // Em telas estreitas, um grid 32×32 a 18px/célula (576px) não cabe —
  // recalcula o tamanho da célula pro grid caber na largura disponível,
  // sem nunca deixar o pixel tão pequeno que fique impossível de tocar.
  const MAX_CELL = 18;
  const MIN_CELL = 8;
  function fitCanvasToWrap() {
    const available = canvasWrapEl.clientWidth - 24; // margem de respiro
    if (available <= 0) return;
    const ideal = Math.floor(available / editor.size);
    editor.setCellSize(Math.max(MIN_CELL, Math.min(MAX_CELL, ideal)));
  }
  new ResizeObserver(() => fitCanvasToWrap()).observe(canvasWrapEl);

  const nameInput = panel.querySelector("#sprite-name");
  const animSelect = panel.querySelector("#anim-select");
  const animNewBtn = panel.querySelector("#anim-new");
  const animDelBtn = panel.querySelector("#anim-del");
  const sizeSelect = panel.querySelector("#sprite-size");
  const spriteSelect = panel.querySelector("#sprite-select");
  const colorPicker = panel.querySelector("#color-picker");
  const paletteEl = panel.querySelector("#palette");
  const galleryEl = panel.querySelector("#gallery-grid");
  const framesStripEl = panel.querySelector("#frames-strip");
  const durationInput = panel.querySelector("#frame-duration");
  const playBtn = panel.querySelector("#frame-play");
  const previewCanvas = panel.querySelector("#frame-preview");

  // Estado do sprite em edição: um mapa de animações — cada uma com sua
  // lista de frames + velocidade própria — no mesmo formato de
  // `normalizeSprite().anims` (ver state.js). currentAnim é a animação
  // sendo editada agora, currentFrame o índice do frame dela na tela.
  let anims = { idle: { frameDuration: 150, frames: [blankMatrix(editor.size)] } };
  let currentAnim = "idle";
  let currentFrame = 0;
  let playTimer = null;

  function curFrames() {
    return anims[currentAnim].frames;
  }

  editor.onColorPicked = (c) => (colorPicker.value = c);

  DEFAULT_PALETTE.forEach((c) => {
    const sw = document.createElement("button");
    sw.className = "swatch" + (c === null ? " swatch-empty" : "");
    if (c) sw.style.background = c;
    sw.addEventListener("click", () => {
      if (c === null) {
        editor.tool = "eraser";
        panel.querySelectorAll(".tool-btn").forEach((b) => b.classList.toggle("active", b.dataset.tool === "eraser"));
      } else {
        editor.color = c;
        colorPicker.value = c;
      }
    });
    paletteEl.appendChild(sw);
  });

  colorPicker.addEventListener("input", () => (editor.color = colorPicker.value));

  panel.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".tool-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      editor.tool = btn.dataset.tool;
    });
  });

  // Guarda o que está no canvas de volta no frame atual antes de trocar de
  // frame/animação/sprite/tamanho — senão a edição em andamento se perde.
  function syncCurrentFrameFromEditor() {
    curFrames()[currentFrame] = editor.pixels.map((r) => r.slice());
  }

  function loadFrame(index) {
    const frames = curFrames();
    currentFrame = Math.max(0, Math.min(index, frames.length - 1));
    editor.loadPixels(frames[currentFrame]);
    renderFramesStrip();
  }

  function renderFramesStrip() {
    const frames = curFrames();
    framesStripEl.innerHTML = "";
    frames.forEach((frame, i) => {
      const thumb = document.createElement("button");
      thumb.className = "frame-thumb" + (i === currentFrame ? " active" : "");
      const c = document.createElement("canvas");
      paintMatrix(c, frame, { cell: 2 });
      thumb.appendChild(c);
      const num = document.createElement("span");
      num.textContent = i + 1;
      thumb.appendChild(num);
      thumb.addEventListener("click", () => {
        syncCurrentFrameFromEditor();
        loadFrame(i);
      });
      framesStripEl.appendChild(thumb);
    });
  }

  panel.querySelector("#frame-add").addEventListener("click", () => {
    syncCurrentFrameFromEditor();
    const frames = curFrames();
    frames.splice(currentFrame + 1, 0, frames[currentFrame].map((r) => r.slice()));
    loadFrame(currentFrame + 1);
  });

  panel.querySelector("#frame-del").addEventListener("click", () => {
    const frames = curFrames();
    if (frames.length <= 1) {
      toast("A animação precisa de pelo menos um frame.", "error");
      return;
    }
    frames.splice(currentFrame, 1);
    loadFrame(Math.min(currentFrame, frames.length - 1));
  });

  panel.querySelector("#frame-left").addEventListener("click", () => {
    if (currentFrame === 0) return;
    syncCurrentFrameFromEditor();
    const frames = curFrames();
    [frames[currentFrame - 1], frames[currentFrame]] = [frames[currentFrame], frames[currentFrame - 1]];
    loadFrame(currentFrame - 1);
  });

  panel.querySelector("#frame-right").addEventListener("click", () => {
    const frames = curFrames();
    if (currentFrame === frames.length - 1) return;
    syncCurrentFrameFromEditor();
    [frames[currentFrame + 1], frames[currentFrame]] = [frames[currentFrame], frames[currentFrame + 1]];
    loadFrame(currentFrame + 1);
  });

  durationInput.addEventListener("input", () => {
    anims[currentAnim].frameDuration = Number(durationInput.value) || 150;
  });

  playBtn.addEventListener("click", () => {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
      previewCanvas.hidden = true;
      playBtn.textContent = "▶️ Prévia da animação";
      return;
    }
    const frames = curFrames();
    if (frames.length < 2) {
      toast("Adicione mais de um frame para ter algo pra animar.", "info");
      return;
    }
    syncCurrentFrameFromEditor();
    previewCanvas.hidden = false;
    playBtn.textContent = "⏸️ Parar prévia";
    let i = 0;
    const tick = () => {
      paintMatrix(previewCanvas, frames[i % frames.length], { cell: previewCanvas.width / frames[0].length });
      i++;
    };
    tick();
    playTimer = setInterval(tick, Number(durationInput.value) || 150);
  });

  sizeSelect.addEventListener("change", () => {
    const newSize = Number(sizeSelect.value);
    syncCurrentFrameFromEditor();
    const anim = anims[currentAnim];
    anim.frames = anim.frames.map((f) => resizePixelMatrix(f, newSize));
    editor.setSize(newSize);
    fitCanvasToWrap();
    renderFramesStrip();
  });
  panel.querySelector("#btn-undo").addEventListener("click", () => editor.undo());
  panel.querySelector("#btn-clear").addEventListener("click", () => editor.clear());

  function refreshAnimSelect() {
    const names = Object.keys(anims);
    animSelect.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join("");
    animSelect.value = currentAnim;
  }

  // Troca de animação dentro do MESMO sprite (idle -> andar -> atacar...).
  // Diferente de loadSprite: não mexe em `anims` nem no nome do sprite, só
  // muda qual entrada desse mapa está sendo editada agora.
  function loadAnim(animName) {
    currentAnim = animName;
    const frames = curFrames();
    const size = frames[0].length;
    sizeSelect.value = String(size);
    editor.setSize(size);
    durationInput.value = anims[currentAnim].frameDuration;
    loadFrame(0);
    fitCanvasToWrap();
  }

  animSelect.addEventListener("change", () => {
    syncCurrentFrameFromEditor();
    loadAnim(animSelect.value);
  });

  animNewBtn.addEventListener("click", () => {
    const raw = window.prompt("Nome da nova animação (ex: andar, atacar, dash):");
    if (!raw) return;
    const animName = raw.trim().toLowerCase().replace(/\s+/g, "_");
    if (!animName) return;
    if (anims[animName]) {
      toast(`Já existe uma animação "${animName}" nesse sprite.`, "error");
      return;
    }
    syncCurrentFrameFromEditor();
    anims[animName] = { frameDuration: 150, frames: [blankMatrix(Number(sizeSelect.value))] };
    refreshAnimSelect();
    loadAnim(animName);
  });

  animDelBtn.addEventListener("click", () => {
    const names = Object.keys(anims);
    if (names.length <= 1) {
      toast("O sprite precisa de pelo menos uma animação.", "error");
      return;
    }
    if (!confirm(`Apagar a animação "${currentAnim}"? Essa ação não pode ser desfeita.`)) return;
    delete anims[currentAnim];
    refreshAnimSelect();
    loadAnim(Object.keys(anims)[0]);
  });

  function refreshSelect() {
    const names = Object.keys(state.project.sprites);
    spriteSelect.innerHTML = `<option value="">— escolher sprite existente —</option>` + names.map((n) => `<option value="${n}">${n}</option>`).join("");
  }

  function refreshGallery() {
    galleryEl.innerHTML = "";
    Object.entries(state.project.sprites).forEach(([name, sprite]) => {
      const normalized = normalizeSprite(sprite);
      const animNames = Object.keys(normalized.anims);
      if (!animNames.length) return; // sprite vazio/corrompido — não quebra a galeria
      const firstAnim = normalized.anims[animNames.includes("idle") ? "idle" : animNames[0]];
      const card = document.createElement("button");
      card.className = "gallery-card";
      const c = document.createElement("canvas");
      paintMatrix(c, firstAnim.frames[0], { cell: 48 / firstAnim.frames[0].length });
      card.appendChild(c);
      const label = document.createElement("span");
      label.textContent = animNames.length > 1 ? `${name} (${animNames.length} anim)` : name;
      card.appendChild(label);

      const delBtn = document.createElement("span");
      delBtn.className = "gallery-card-delete";
      delBtn.textContent = "✕";
      delBtn.title = `Apagar "${name}"`;
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // não deixa o clique também "abrir" o sprite pra edição
        if (!confirm(`Apagar o sprite "${name}"? Essa ação não pode ser desfeita.`)) return;
        deleteSprite(name);
        if (nameInput.value.trim().toLowerCase() === name) resetEditorToBlank();
        refreshSelect();
        refreshGallery();
        toast(`Sprite "${name}" apagado.`, "success");
      });
      card.appendChild(delBtn);

      card.addEventListener("click", () => loadSprite(name, sprite));
      galleryEl.appendChild(card);
    });
  }

  function loadSprite(name, sprite) {
    nameInput.value = name;
    const normalized = normalizeSprite(sprite);
    // Clona pra não editar o objeto do state direto por acidente antes de
    // clicar em "Salvar" — só grava de volta explicitamente.
    anims = {};
    Object.entries(normalized.anims).forEach(([animName, anim]) => {
      anims[animName] = { frameDuration: anim.frameDuration, frames: anim.frames.map((f) => f.map((r) => r.slice())) };
    });
    if (!Object.keys(anims).length) anims = { idle: { frameDuration: 150, frames: [blankMatrix(24)] } };
    currentAnim = anims.idle ? "idle" : Object.keys(anims)[0];
    refreshAnimSelect();
    loadAnim(currentAnim);
  }

  spriteSelect.addEventListener("change", () => {
    const name = spriteSelect.value;
    if (!name) return;
    loadSprite(name, state.project.sprites[name]);
  });

  function resetEditorToBlank() {
    nameInput.value = "";
    const size = Number(sizeSelect.value) || 24;
    anims = { idle: { frameDuration: 150, frames: [blankMatrix(size)] } };
    currentAnim = "idle";
    refreshAnimSelect();
    editor.setSize(size);
    fitCanvasToWrap();
    loadFrame(0);
  }

  panel.querySelector("#sprite-new").addEventListener("click", () => {
    resetEditorToBlank();
    nameInput.focus();
  });

  // Apaga o sprite cujo nome está no campo (o que está carregado/sendo
  // editado no momento) — todas as animações dele junto. Pede confirmação
  // porque não tem como desfazer.
  panel.querySelector("#btn-delete-sprite").addEventListener("click", () => {
    const name = nameInput.value.trim().toLowerCase();
    if (!name || !state.project.sprites[name]) {
      toast("Escolha um sprite salvo antes de apagar.", "error");
      return;
    }
    if (!confirm(`Apagar o sprite "${name}" (com todas as animações)? Essa ação não pode ser desfeita.`)) return;
    deleteSprite(name);
    resetEditorToBlank();
    refreshSelect();
    refreshGallery();
    toast(`Sprite "${name}" apagado.`, "success");
  });

  panel.querySelector("#btn-save-sprite").addEventListener("click", () => {
    const name = nameInput.value.trim().toLowerCase();
    if (!name) {
      toast("Dê um nome ao sprite antes de salvar.", "error");
      return;
    }
    syncCurrentFrameFromEditor();
    const clonedAnims = {};
    Object.entries(anims).forEach(([animName, anim]) => {
      clonedAnims[animName] = {
        frameDuration: anim.frameDuration,
        frames: anim.frames.map((f) => f.map((r) => r.slice())),
      };
    });
    saveSprite(name, { size: Number(sizeSelect.value), anims: clonedAnims });
    refreshSelect();
    refreshGallery();
    const animCount = Object.keys(clonedAnims).length;
    toast(`Sprite "${name}" salvo (${animCount} animaç${animCount > 1 ? "ões" : "ão"}).`, "success");
  });

  refreshAnimSelect();
  refreshSelect();
  refreshGallery();
  renderFramesStrip();

  return {
    refresh: () => {
      refreshSelect();
      refreshGallery();
    },
  };
}
