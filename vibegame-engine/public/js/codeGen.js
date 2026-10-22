// Junta o código gerado pela IA com o que o aluno controla manualmente:
// os sprites desenhados na aba Personagens e a configuração da aba
// Mecânicas. Injeta os dois como globals ANTES do script da IA rodar,
// exatamente como o contrato descrito em prompts.js espera.
//
// Também injeta um capturador de erros: se o script da IA quebrar (erro de
// JS), em vez de ficar com a tela preta e nenhuma pista, mostra o erro por
// cima do jogo — essencial porque a IA às vezes gera código com bug.
// Overlay universal de controles touch: como quase todo jogo gerado lê
// teclado (setas + espaço, às vezes Z/X como ação secundária — é o que o
// system prompt pede), a gente não depende da IA lembrar de desenhar botões
// na tela. Em vez disso, injeta um D-pad + botões de ação que disparam os
// MESMOS eventos de teclado que o jogo já escuta. Só aparece em dispositivos
// de toque (media query pointer:coarse) e some sozinho se o jogo detectar
// teclado físico depois.
const TOUCH_CONTROLS_BLOCK = `
<style id="__vibe_touch_style">
  #__vibe_touch_controls { display: none; }
  @media (pointer: coarse) {
    #__vibe_touch_controls { display: block; }
  }
  #__vibe_touch_controls {
    position: fixed; inset: 0; z-index: 999998; pointer-events: none;
    font-family: system-ui, sans-serif; user-select: none; -webkit-user-select: none;
  }
  #__vibe_touch_controls .vtc-pad, #__vibe_touch_controls .vtc-actions {
    position: absolute; bottom: max(18px, env(safe-area-inset-bottom));
    display: grid; pointer-events: auto;
  }
  #__vibe_touch_controls .vtc-pad {
    left: 18px; grid-template-columns: repeat(3, 52px); grid-template-rows: repeat(3, 52px); gap: 4px;
  }
  #__vibe_touch_controls .vtc-actions {
    right: 18px; grid-template-columns: repeat(2, 60px); grid-auto-rows: 60px; gap: 10px; align-items: end;
  }
  #__vibe_touch_controls button {
    background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.35); border-radius: 12px;
    color: #fff; font-size: 20px; display: flex; align-items: center; justify-content: center;
    touch-action: none; -webkit-tap-highlight-color: transparent;
  }
  #__vibe_touch_controls button:active { background: rgba(255,255,255,0.32); }
  #__vibe_touch_controls .vtc-actions button { border-radius: 50%; font-weight: 700; font-size: 15px; }
  #__vibe_touch_controls .vtc-up { grid-column: 2; grid-row: 1; }
  #__vibe_touch_controls .vtc-left { grid-column: 1; grid-row: 2; }
  #__vibe_touch_controls .vtc-right { grid-column: 3; grid-row: 2; }
  #__vibe_touch_controls .vtc-down { grid-column: 2; grid-row: 3; }
</style>
<div id="__vibe_touch_controls">
  <div class="vtc-pad">
    <button class="vtc-up" data-key="ArrowUp" data-code="ArrowUp">▲</button>
    <button class="vtc-left" data-key="ArrowLeft" data-code="ArrowLeft">◀</button>
    <button class="vtc-right" data-key="ArrowRight" data-code="ArrowRight">▶</button>
    <button class="vtc-down" data-key="ArrowDown" data-code="ArrowDown">▼</button>
  </div>
  <div class="vtc-actions">
    <button data-key=" " data-code="Space">●</button>
    <button data-key="x" data-code="KeyX">X</button>
  </div>
</div>
<script>
(function () {
  function fire(type, key, code) {
    var ev = new KeyboardEvent(type, { key: key, code: code, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
  }
  document.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("__vibe_touch_controls");
    if (!root) return;
    root.querySelectorAll("button").forEach(function (btn) {
      var key = btn.dataset.key, code = btn.dataset.code;
      var down = function (e) { e.preventDefault(); fire("keydown", key, code); };
      var up = function (e) { e.preventDefault(); fire("keyup", key, code); };
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("pointerleave", up);
      btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    });
  });
})();
</script>`;

// Motor auxiliar injetado em todo jogo gerado, como window.Vibe. Código
// nosso, testado, sem dependência externa — a IA usa essas funções em vez
// de reescrever física/animação/câmera do zero a cada resposta. Isso é o
// que resolve, na raiz, bugs recorrentes tipo "personagem flutuando" (a
// colisão de chão/plataforma vira uma função só, sempre certa) e "sprite
// não aparece" (desenhar um sprite de SPR vira uma chamada só).
const VIBE_RUNTIME_SCRIPT = `<script>
window.Vibe = (function () {
  "use strict";

  // ---------- Utilidades ----------
  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
           a.y < b.y + b.height && a.y + a.height > b.y;
  }

  // ---------- Loop do jogo (controla o dt pra ninguém precisar calcular na mão) ----------
  // Gerencia o requestAnimationFrame e calcula dt (segundos desde o
  // frame anterior) de um jeito seguro: nunca NaN no primeiro frame, e
  // limitado a no máximo 50ms mesmo se a aba ficar em segundo plano por um
  // tempo (senão a física "explode" quando a aba volta ao foco, com um dt
  // gigante de uma vez só). É o jeito recomendado de estruturar TODO o
  // loop do jogo — ver documentação em prompts.js.
  function loop(update) {
    var last = null;
    function frame(now) {
      if (last == null) last = now;
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      update(dt, now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Cooldown genérico — o uso mais comum é invencibilidade (i-frames)
  // depois de tomar dano, mas serve pra qualquer "isso só pode acontecer
  // de novo depois de X segundos" (cooldown de ataque, de dash, etc.).
  // Sem isso, colisão de dano continuada (jogador parado encostando no
  // inimigo) dispara o dano em TODO frame — 60x por segundo — e a vida
  // some quase instantaneamente, o que parece "colisão bugada".
  function createCooldown(durationSeconds) {
    return {
      duration: durationSeconds,
      _remaining: 0,
      update: function (dt) { this._remaining = Math.max(0, this._remaining - dt); },
      ready: function () { return this._remaining <= 0; },
      trigger: function () { this._remaining = this.duration; },
    };
  }

  // ---------- Física ----------
  // Os valores de CFG.gravidade/CFG.forcaPulo (config da aba Mecânicas) são
  // calibrados como "quanto por frame a 60fps", não "por segundo" — por
  // isso a gravidade aqui multiplica o dt por 60 antes de aplicar: assim o
  // jogo sente igual independente do frame rate real da máquina, E os
  // valores que o aluno ajusta na aba Mecânicas continuam batendo com a
  // sensação que ele configurou lá, sem precisar reescalar nada na mão.
  function applyGravity(entity, gravity, dt) {
    entity.vy = (entity.vy || 0) + gravity * dt * 60;
  }

  // Colisão com uma linha de chão fixa (ex.: const GROUND_Y = canvas.height - 80).
  // Encosta o "pé" da entidade exatamente na linha, zera vy e marca onGround.
  // Chame TODO frame, pra TODA entidade que deve ficar em pé (jogador,
  // inimigos que patrulham, NPCs) — usar a mesma função pra todo mundo é o
  // que garante que ninguém fica flutuando ou afundado.
  // NOTA IMPORTANTE DE COMPOSIÇÃO: nem groundCollide nem platformsCollide
  // jamais zeram entity.onGround sozinhas — as duas só ESCREVEM true
  // quando realmente detectam um pouso. Quem chama é responsável por
  // resetar entity.onGround = false UMA VEZ por frame, antes de chamar
  // qualquer uma delas (normalmente as duas, quando o jogo tem chão fixo
  // E plataformas soltas). Se cada função resetasse onGround sozinha, a
  // segunda chamada apagaria o resultado correto da primeira — foi
  // exatamente esse bug que fazia pular no chão comum parar de funcionar
  // depois de ~1 frame parado (platformsCollide desfazia o que
  // groundCollide tinha acabado de marcar certo).
  function groundCollide(entity, groundY) {
    var bottom = entity.y + entity.height;
    if (bottom >= groundY && (entity.vy || 0) >= 0) {
      entity.y = groundY - entity.height;
      entity.vy = 0;
      entity.onGround = true;
      return true;
    }
    return false;
  }

  // Colisão com uma lista de plataformas soltas [{x,y,width,height}, ...].
  // Só resolve pouso vindo de cima (a forma normal de plataforma em jogo de
  // pulo) — não empurra de lado nem por baixo, pra não "grudar" em beiradas.
  //
  // COMO DETECTA O POUSO (importante — já foi fonte de um bug feio): pouso
  // = o "pé" estava ACIMA (ou encostado no) topo da plataforma no frame
  // anterior e agora está na altura dele ou abaixo. Pra isso precisamos
  // saber onde o pé estava no frame anterior. NÃO dá pra deduzir isso de
  // "bottom - vy": vy é calibrado em "pixels por frame a 60fps", mas o
  // deslocamento real do frame é vy * dt * 60 — então, sempre que dt é
  // maior que 1/60s (qualquer jitter de monitor 60Hz, 45fps, 30fps...), a
  // conta subestimava o deslocamento, o pouso NÃO era detectado e o
  // jogador atravessava a plataforma e caía no chão. Em vez de adivinhar,
  // a gente guarda a posição do pé da última vez que esta função rodou
  // (entity._vibePrevBottom) — é exatamente onde ele estava, com qualquer
  // dt e independente de a colisão ser chamada antes ou depois de mover.
  // Por isso: chame UMA vez por frame por entidade. Se reposicionar a
  // entidade "na marra" (respawn/checkpoint), use Vibe.placeEntity.
  var LAND_EPSILON = 1; // tolerância (px) pra erro de ponto flutuante no "encostado"
  function platformsCollide(entity, platforms) {
    var bottom = entity.y + entity.height;
    var prevBottom = entity._vibePrevBottom;
    // 1º frame (sem histórico): estima o quanto o pé pode ter andado. Vibe.loop
    // limita dt a 0.05s = no máximo 3 "frames de 60fps" de deslocamento, então
    // vy * 3 é o teto seguro. Estimar por baixo (vy * 1) reintroduz o bug de
    // atravessar a plataforma; estimar pra cima demais snapparia entidades
    // que nasceram embaixo da plataforma. vy * 3 cobre o caso sem esse risco.
    if (prevBottom == null) prevBottom = bottom - Math.max(entity.vy || 0, 0) * 3;
    var landed = false;
    // vy >= 0 (e não > 0): parado em cima da plataforma (vy = 0) também
    // precisa contar como "no chão", senão onGround pisca e o pulo falha.
    if ((entity.vy || 0) >= 0) {
      for (var i = 0; i < platforms.length; i++) {
        var p = platforms[i];
        var withinX = entity.x + entity.width > p.x && entity.x < p.x + p.width;
        if (!withinX) continue;
        if (prevBottom <= p.y + LAND_EPSILON && bottom >= p.y) {
          entity.y = p.y - entity.height;
          entity.vy = 0;
          entity.onGround = true;
          landed = true;
          break;
        }
      }
    }
    entity._vibePrevBottom = entity.y + entity.height; // já com o pouso aplicado
    return landed;
  }

  // Coloca uma entidade numa posição nova "de uma vez" (respawn, checkpoint,
  // teleporte) sem deixar sobrar velocidade nem histórico de colisão do
  // lugar antigo. Sem isso, o histórico da posição anterior poderia fazer
  // a entidade "pousar" numa plataforma que ela só atravessou no teleporte.
  function placeEntity(entity, x, y) {
    entity.x = x;
    entity.y = y;
    entity.vx = 0;
    entity.vy = 0;
    entity.onGround = false;
    entity._vibePrevBottom = null;
  }

  // Controlador de pulo "gostoso" de jogo de plataforma — os truques que
  // fazem a diferença entre um pulo capenga e um bom (tipo Mario/Celeste),
  // prontos, pra não depender da IA acertar esses detalhes toda vez:
  //   - coyote time: ainda dá pra pular por uma fração de segundo depois de
  //     sair da borda, mesmo sem estar mais tecnicamente no chão (senão o
  //     jogo pune por 1 frame de atraso, parece "travado").
  //   - jump buffer: se apertar o pulo um pouco ANTES de aterrissar, o pulo
  //     ainda acontece assim que tocar o chão, em vez de exigir timing
  //     perfeito.
  //   - pulo variável (jump cut): segurar o botão = pulo mais alto, soltar
  //     cedo = pulo mais baixo — dá controle fino, sem isso todo pulo tem
  //     sempre a mesma altura e fica com "peso" errado.
  //   - gravidade assimétrica: cai mais rápido do que sobe, deixa o pulo
  //     mais seco/responsivo em vez de flutuar no ar.
  function createJumpController(opts) {
    opts = opts || {};
    return {
      coyoteTime: opts.coyoteTime != null ? opts.coyoteTime : 0.12,
      bufferTime: opts.bufferTime != null ? opts.bufferTime : 0.12,
      jumpForce: opts.jumpForce || 12,
      gravity: opts.gravity || 0.6,
      fallMultiplier: opts.fallMultiplier != null ? opts.fallMultiplier : 1.6,
      lowJumpMultiplier: opts.lowJumpMultiplier != null ? opts.lowJumpMultiplier : 2.2,
      _coyote: 0,
      _buffer: 0,
      // Chame TODO frame, depois de já saber se entity.onGround está
      // certo (rode DEPOIS de groundCollide/platformsCollide). jumpPressed
      // deve ser true só no frame em que o botão foi apertado (não
      // enquanto segurado — use uma flag setada no listener de keydown e
      // consumida/zerada aqui). jumpHeld é true enquanto o botão continua
      // pressionado (para o jump cut). Aplica a gravidade sozinho — não
      // chame Vibe.applyGravity de novo pra essa entidade.
      update: function (entity, dt, jumpPressed, jumpHeld) {
        this._coyote = entity.onGround ? this.coyoteTime : Math.max(0, this._coyote - dt);
        this._buffer = jumpPressed ? this.bufferTime : Math.max(0, this._buffer - dt);

        if (this._buffer > 0 && this._coyote > 0) {
          entity.vy = -this.jumpForce;
          this._buffer = 0;
          this._coyote = 0;
          entity.onGround = false;
        }

        var g = this.gravity;
        if (entity.vy < 0 && !jumpHeld) g *= this.lowJumpMultiplier; // soltou cedo: corta o pulo
        else if (entity.vy > 0) g *= this.fallMultiplier; // caindo: acelera mais que a subida
        entity.vy += g * dt * 60; // mesma normalização de applyGravity — CFG é calibrado por frame
      },
    };
  }

  // ---------- Animação / desenho de sprite (lê o formato de VIBE_SPRITES) ----------
  var frameCanvasCache = new WeakMap(); // matriz do frame -> <canvas> já pintado, evita repintar pixel a pixel todo frame

  // Um frame pode vir em dois formatos:
  // - matriz de cores (desenhado na aba Personagens): [["#3b2f2f", null, ...], ...]
  // - LEVE (desenhado pela IA, ~10x menos tokens): linhas de texto, uma letra
  //   por pixel, com a paleta do sprite: ["..aabb..", ...] + paleta { a: "#3b2f2f" }.
  //   "." ou espaço = transparente.
  function paintFrameToCanvas(frame, palette) {
    var cached = frameCanvasCache.get(frame);
    if (cached) return cached;
    var rows = frame.length;
    var cols = 0;
    for (var r = 0; r < rows; r++) cols = Math.max(cols, frame[r].length);
    var c = document.createElement("canvas");
    c.width = cols || 1; c.height = rows || 1;
    var cx = c.getContext("2d");
    for (var y = 0; y < rows; y++) {
      var row = frame[y];
      var isText = typeof row === "string";
      for (var x = 0; x < row.length; x++) {
        var color = isText ? (row[x] === "." || row[x] === " " ? null : (palette || {})[row[x]]) : row[x];
        if (color) { cx.fillStyle = color; cx.fillRect(x, y, 1, 1); }
      }
    }
    frameCanvasCache.set(frame, c);
    return c;
  }

  // Índice do frame atual, dado o tempo total decorrido em ms.
  function frameIndex(elapsedMs, frameDurationMs, frameCount) {
    if (frameCount <= 1) return 0;
    return Math.floor(elapsedMs / (frameDurationMs || 150)) % frameCount;
  }

  // Acha a animação certa dentro de um sprite, aceitando os dois formatos:
  // o novo, com várias animações nomeadas ({ anims: { idle: {...}, ... } }),
  // e o antigo, de uma animação só ({ frames: [...], frameDuration }) — pra
  // jogos salvos antes de existirem animações nomeadas continuarem
  // funcionando sem reescrever nada.
  function resolveAnim(sprite, animName) {
    if (!sprite) return null;
    if (sprite.anims) {
      return sprite.anims[animName] || sprite.anims.idle || Object.values(sprite.anims)[0] || null;
    }
    if (sprite.frames) return sprite; // formato antigo: o próprio sprite já É a animação
    return null;
  }

  // Desenha uma animação de um sprite de window.VIBE_SPRITES, escalado pra
  // w x h, sempre pixelado (sem borrão), com flip horizontal opcional pra
  // virar o personagem pro outro lado sem precisar de um segundo sprite.
  //
  // Uso (formato atual, com animações nomeadas):
  //   Vibe.drawSprite(ctx, SPR.jogador, "andar", tempoDecorridoMs, x, y, w, h, { flipX });
  //
  // Compatibilidade: se o 3º argumento for um número em vez de string, é
  // uma chamada no formato ANTIGO (de antes de existirem animações
  // nomeadas) — os argumentos são reencaixados automaticamente, então jogos
  // já salvos continuam funcionando mesmo depois dessa engine atualizar.
  function drawSprite(ctx, sprite, animName, elapsedMs, x, y, w, h, opts) {
    if (typeof animName !== "string") {
      // assinatura antiga: drawSprite(ctx, sprite, elapsedMs, x, y, w, h, opts)
      opts = h; h = w; w = y; y = x; x = elapsedMs; elapsedMs = animName; animName = null;
    }
    opts = opts || {};
    var anim = resolveAnim(sprite, animName);
    if (!anim || !anim.frames || !anim.frames.length) return;
    var idx = frameIndex(elapsedMs, anim.frameDuration, anim.frames.length);
    var frameCanvas = paintFrameToCanvas(anim.frames[idx], sprite.paleta || sprite.palette);
    var prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (opts.flipX) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(frameCanvas, 0, 0, w, h);
    } else {
      ctx.drawImage(frameCanvas, x, y, w, h);
    }
    ctx.restore();
    ctx.imageSmoothingEnabled = prevSmoothing;
  }

  // ---------- Câmera ----------
  // createCamera({ canvasWidth, canvasHeight, worldWidth, worldHeight, smoothing }):
  // cam.follow(entidade); no loop: cam.update(); cam.apply(ctx); ...desenhe
  // o mundo em coordenadas normais...; cam.restore(ctx); depois disso
  // desenhe o HUD (que não deve se mover com a câmera).
  function createCamera(opts) {
    opts = opts || {};
    return {
      x: 0, y: 0,
      canvasWidth: opts.canvasWidth || 800,
      canvasHeight: opts.canvasHeight || 450,
      worldWidth: opts.worldWidth || Infinity,
      worldHeight: opts.worldHeight || Infinity,
      smoothing: opts.smoothing != null ? opts.smoothing : 0.12,
      target: null,
      follow: function (entity) { this.target = entity; },
      update: function () {
        if (!this.target) return;
        var desiredX = this.target.x + (this.target.width || 0) / 2 - this.canvasWidth / 2;
        var desiredY = this.target.y + (this.target.height || 0) / 2 - this.canvasHeight / 2;
        desiredX = clamp(desiredX, 0, Math.max(0, this.worldWidth - this.canvasWidth));
        desiredY = clamp(desiredY, 0, Math.max(0, this.worldHeight - this.canvasHeight));
        this.x += (desiredX - this.x) * this.smoothing;
        this.y += (desiredY - this.y) * this.smoothing;
      },
      apply: function (ctx) { ctx.save(); ctx.translate(-Math.round(this.x), -Math.round(this.y)); },
      restore: function (ctx) { ctx.restore(); },
    };
  }

  // ---------- Partículas ----------
  // sys.emit(x, y, { count, speed, life, size, color }); todo frame:
  // sys.update(dt); sys.draw(ctx) (depois de desenhar o mundo, antes do HUD).
  function createParticleSystem() {
    var particles = [];
    return {
      emit: function (x, y, opts) {
        opts = opts || {};
        var count = opts.count || 8;
        for (var i = 0; i < count; i++) {
          var angle = Math.random() * Math.PI * 2;
          var speed = (opts.speed || 80) * (0.5 + Math.random() * 0.5);
          particles.push({
            x: x, y: y,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: opts.life || 0.5, age: 0,
            size: opts.size || 3, color: opts.color || "#ffffff",
          });
        }
      },
      update: function (dt) {
        for (var i = particles.length - 1; i >= 0; i--) {
          var p = particles[i];
          p.age += dt;
          if (p.age >= p.life) { particles.splice(i, 1); continue; }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
      },
      draw: function (ctx) {
        for (var i = 0; i < particles.length; i++) {
          var p = particles[i];
          ctx.globalAlpha = clamp(1 - p.age / p.life, 0, 1);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
      },
    };
  }

  // ---------- Mapas em grade (tilemap) ----------
  // Formato de um mapa (o mesmo que a aba Mapas edita e que a IA escreve):
  //   { tile: 32, legenda: { "#": { tipo: "solido", cor: "#5a3d2b" }, ... },
  //     linhas: ["..........", "....o.....", "##########"] }
  // Cada caractere de "linhas" é uma célula; "." (ou espaço) = vazio. O tipo
  // de cada caractere vem da legenda:
  //   solido     — chão/parede: bloqueia por todos os lados
  //   plataforma — só dá pra pousar por cima (atravessa pulando por baixo)
  //   perigo     — espinho/lava: o jogo decide o que acontece ao encostar
  //   item       — ponto onde nasce um coletável (não é desenhado pelo mapa)
  //   inimigo    — ponto onde nasce um inimigo (não é desenhado pelo mapa)
  //   jogador    — onde o jogador começa (não é desenhado pelo mapa)
  //   saida      — porta/bandeira de fim de fase
  //   decoracao  — só visual, sem colisão
  // Caractere que não está na legenda conta como "solido".
  var MAP_TIPOS_DESENHADOS = { solido: 1, plataforma: 1, perigo: 1, saida: 1, decoracao: 1 };

  function loadMap(map) {
    map = map || {};
    var T = map.tile || map.tamanho || 32;
    var linhas = map.linhas || [];
    var legenda = map.legenda || {};
    var rows = linhas.length, cols = 0;
    for (var r = 0; r < rows; r++) cols = Math.max(cols, (linhas[r] || "").length);
    var solidGrid = new Uint8Array(cols * rows);
    var platGrid = new Uint8Array(cols * rows);
    var world = {
      tile: T, cols: cols, rows: rows, width: cols * T, height: rows * T,
      jogador: null, itens: [], inimigos: [], perigos: [], saidas: [],
      solidos: [], plataformas: [], decoracoes: [], tiles: [],
    };
    for (var y = 0; y < rows; y++) {
      var linha = linhas[y] || "";
      for (var x = 0; x < linha.length; x++) {
        var ch = linha[x];
        if (ch === "." || ch === " ") continue;
        var def = legenda[ch] || { tipo: "solido", cor: "#666666" };
        var cell = {
          x: x * T, y: y * T, width: T, height: T, col: x, row: y,
          char: ch, tipo: def.tipo || "solido", nome: def.nome || def.tipo || "solido", def: def,
        };
        if (cell.tipo === "solido") { solidGrid[y * cols + x] = 1; world.solidos.push(cell); }
        else if (cell.tipo === "plataforma") { platGrid[y * cols + x] = 1; world.plataformas.push(cell); }
        else if (cell.tipo === "perigo") world.perigos.push(cell);
        else if (cell.tipo === "item") world.itens.push(cell);
        else if (cell.tipo === "inimigo") world.inimigos.push(cell);
        else if (cell.tipo === "jogador") { if (!world.jogador) world.jogador = cell; }
        else if (cell.tipo === "saida") world.saidas.push(cell);
        else world.decoracoes.push(cell);
        if (MAP_TIPOS_DESENHADOS[cell.tipo]) world.tiles.push(cell);
      }
    }

    world.isSolid = function (col, row) {
      if (col < 0 || col >= cols) return true;   // bordas laterais do mapa são parede
      if (row < 0) return false;                 // acima do mapa: livre (dá pra pular alto)
      if (row >= rows) return false;             // abaixo: buraco (o jogo trata a queda)
      return solidGrid[row * cols + col] === 1;
    };
    world.isPlatform = function (col, row) {
      if (col < 0 || col >= cols || row < 0 || row >= rows) return false;
      return platGrid[row * cols + col] === 1;
    };
    world.solidAt = function (px, py) { return world.isSolid(Math.floor(px / T), Math.floor(py / T)); };

    // Desenha os tiles visíveis (com câmera, só o que está na tela). Se a
    // legenda tiver "sprite: "nome"", usa esse sprite de SPR; senão, a cor.
    world.draw = function (ctx, nowMs, cam) {
      var sprites = window.VIBE_SPRITES || {};
      var vx0 = cam ? cam.x - T : -Infinity, vx1 = cam ? cam.x + cam.canvasWidth + T : Infinity;
      var vy0 = cam ? cam.y - T : -Infinity, vy1 = cam ? cam.y + cam.canvasHeight + T : Infinity;
      for (var i = 0; i < world.tiles.length; i++) {
        var t = world.tiles[i];
        if (t.x < vx0 || t.x > vx1 || t.y < vy0 || t.y > vy1) continue;
        var spr = t.def.sprite && sprites[t.def.sprite];
        if (spr) { drawSprite(ctx, spr, "idle", nowMs || 0, t.x, t.y, T, T); continue; }
        drawTile(ctx, t, T);
      }
    };
    return world;
  }

  function shade(hex, amount) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    var r = clamp((n >> 16) + amount, 0, 255), g = clamp(((n >> 8) & 255) + amount, 0, 255), b = clamp((n & 255) + amount, 0, 255);
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function drawTile(ctx, t, T) {
    var cor = t.def.cor || "#777777";
    if (t.tipo === "plataforma") {
      var h = Math.max(4, Math.round(T / 3));
      ctx.fillStyle = cor; ctx.fillRect(t.x, t.y, T, h);
      ctx.fillStyle = shade(cor, 40); ctx.fillRect(t.x, t.y, T, 2);
      ctx.fillStyle = shade(cor, -40); ctx.fillRect(t.x, t.y + h - 2, T, 2);
    } else if (t.tipo === "perigo") {
      ctx.fillStyle = cor;
      var n = 3, w = T / n;
      ctx.beginPath();
      for (var k = 0; k < n; k++) {
        ctx.moveTo(t.x + k * w, t.y + T);
        ctx.lineTo(t.x + k * w + w / 2, t.y + T * 0.35);
        ctx.lineTo(t.x + (k + 1) * w, t.y + T);
      }
      ctx.fill();
    } else if (t.tipo === "saida") {
      ctx.fillStyle = shade(cor, -50); ctx.fillRect(t.x + T * 0.15, t.y, T * 0.1, T);
      ctx.fillStyle = cor; ctx.fillRect(t.x + T * 0.25, t.y + T * 0.08, T * 0.6, T * 0.4);
    } else {
      ctx.fillStyle = cor; ctx.fillRect(t.x, t.y, T, T);
      if (t.tipo === "solido") {
        ctx.fillStyle = shade(cor, 35); ctx.fillRect(t.x, t.y, T, 3);
        ctx.fillStyle = shade(cor, -30); ctx.fillRect(t.x, t.y + T - 2, T, 2);
      }
    }
  }

  // Move uma entidade {x,y,width,height} por (dx, dy) pixels respeitando o
  // mapa: paredes/chão sólidos bloqueiam por todos os lados, plataformas só
  // por cima. Resolve X e Y separados (é o que deixa deslizar encostado na
  // parede sem travar). Atualiza entity.onGround (pisou em algo neste
  // frame), entity.hitWall, entity.hitCeiling e zera vx/vy no eixo bloqueado.
  // É A ÚNICA função de colisão necessária num jogo com mapa — não misture
  // com groundCollide/platformsCollide pra mesma entidade.
  function moveAndCollide(entity, dx, dy, world) {
    var T = world.tile;
    var EPS = 0.001;
    entity.onGround = false;
    entity.hitWall = false;
    entity.hitCeiling = false;

    // ---- eixo X ----
    entity.x += dx;
    if (dx !== 0) {
      var r0 = Math.floor(entity.y / T), r1 = Math.floor((entity.y + entity.height - EPS) / T);
      var col = dx > 0 ? Math.floor((entity.x + entity.width - EPS) / T) : Math.floor(entity.x / T);
      for (var r = r0; r <= r1; r++) {
        if (world.isSolid(col, r)) {
          entity.x = dx > 0 ? col * T - entity.width : (col + 1) * T;
          entity.vx = 0;
          entity.hitWall = true;
          break;
        }
      }
    }

    // ---- eixo Y ----
    var prevBottom = entity.y + entity.height;
    entity.y += dy;
    var c0 = Math.floor(entity.x / T), c1 = Math.floor((entity.x + entity.width - EPS) / T);
    if (dy > 0) {
      var rowB = Math.floor((entity.y + entity.height - EPS) / T);
      var top = rowB * T;
      for (var c = c0; c <= c1; c++) {
        var solid = world.isSolid(c, rowB) && rowB >= 0;
        var plat = !solid && world.isPlatform(c, rowB) && prevBottom <= top + 1;
        if (solid || plat) {
          entity.y = top - entity.height;
          entity.vy = 0;
          entity.onGround = true;
          break;
        }
      }
    } else if (dy < 0) {
      var rowT = Math.floor(entity.y / T);
      for (var c2 = c0; c2 <= c1; c2++) {
        if (rowT >= 0 && world.isSolid(c2, rowT)) {
          entity.y = (rowT + 1) * T;
          entity.vy = 0;
          entity.hitCeiling = true;
          break;
        }
      }
    }
    // Parado exatamente em cima de algo (dy = 0, ex.: jogo top-down ou frame
    // sem gravidade): ainda conta como no chão.
    if (!entity.onGround && dy >= 0) {
      var feet = entity.y + entity.height;
      var below = Math.round(feet / T);
      if (Math.abs(feet - below * T) < 0.5) {
        for (var c3 = c0; c3 <= c1; c3++) {
          if ((below >= 0 && world.isSolid(c3, below)) || world.isPlatform(c3, below)) { entity.onGround = true; break; }
        }
      }
    }
    entity._vibePrevBottom = entity.y + entity.height;
    return entity;
  }

  // Põe uma entidade em cima de uma célula do mapa (ex.: mundo.jogador,
  // um item de mundo.itens): centralizada na horizontal e com o "pé"
  // encostado no fundo da célula. Zera velocidade (igual placeEntity).
  function placeOnTile(entity, cell) {
    placeEntity(entity, cell.x + (cell.width - entity.width) / 2, cell.y + cell.height - entity.height);
  }

  return {
    clamp: clamp,
    rectsOverlap: rectsOverlap,
    loop: loop,
    createCooldown: createCooldown,
    applyGravity: applyGravity,
    groundCollide: groundCollide,
    platformsCollide: platformsCollide,
    placeEntity: placeEntity,
    createJumpController: createJumpController,
    frameIndex: frameIndex,
    drawSprite: drawSprite,
    createCamera: createCamera,
    createParticleSystem: createParticleSystem,
    loadMap: loadMap,
    moveAndCollide: moveAndCollide,
    placeOnTile: placeOnTile,
  };
})();
</script>`;

export function assembleFinalGame(aiHtml, { sprites, mechanics, backgroundImage, maps }) {
  // Passa o sprite quase como está — os dois formatos (novo, com `anims`
  // nomeadas, ou antigo, de uma animação só) são resolvidos em tempo de
  // execução por Vibe.drawSprite (ver resolveAnim no motor auxiliar acima).
  const spritesJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(sprites).map(([name, s]) => {
        if (s.anims && Object.keys(s.anims).length) return [name, { anims: s.anims }];
        return [name, { frames: s.frames || [s.pixels], frameDuration: s.frameDuration || 150 }];
      })
    )
  );
  const mechanicsJson = JSON.stringify(mechanics);
  // Fundo de fase carregado na aba Perfil (data URL ou null). A IA é
  // instruída (prompts.js) a usar isso como pano de fundo do jogo quando
  // presente, em vez de desenhar/inventar um cenário do zero.
  const backgroundJson = JSON.stringify(backgroundImage || null);
  // Mapas: só os que o ALUNO editou na aba Mapas entram aqui. Os que ainda
  // são da IA já estão no próprio código do jogo (if (!MAPAS.x) MAPAS.x = ...)
  // — injetar a cópia importada só arriscaria sobrescrever uma versão mais
  // nova da IA com uma antiga.
  const mapsJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(maps || {})
        .filter(([, m]) => m && m.origem === "aluno")
        .map(([name, m]) => [name, { tile: m.tile, legenda: m.legenda, linhas: m.linhas }])
    )
  );

  // Rede de segurança de responsividade: independente do que a IA definiu
  // no <canvas>, isso garante que ele encolhe pra caber na tela (mobile ou
  // desktop) mantendo a proporção, em vez de vazar pra fora ou cortar.
  const responsiveCss = `<style id="__vibe_responsive_style">
    html, body { margin: 0; overflow: hidden; overscroll-behavior: none; }
    canvas { max-width: 100vw; max-height: 100vh; display: block; margin: 0 auto; touch-action: none; }
  </style>`;

  const injection = `<script>
    window.VIBE_SPRITES = ${spritesJson};
    window.VIBE_MECHANICS = ${mechanicsJson};
    window.VIBE_BACKGROUND = ${backgroundJson};
    window.VIBE_MAPS = ${mapsJson};

    (function () {
      function showError(msg) {
        var box = document.getElementById("__vibe_error_box");
        if (!box) {
          box = document.createElement("div");
          box.id = "__vibe_error_box";
          box.style.cssText = "position:fixed;inset:0;z-index:999999;background:rgba(10,4,4,.94);" +
            "color:#ff8a8a;font:13px/1.6 monospace;padding:20px;overflow:auto;white-space:pre-wrap;";
          box.innerHTML = "<strong style='color:#ffb454'>⚠️ O jogo gerado pela IA quebrou com um erro de JavaScript:</strong><br><br>";
          document.body ? document.body.appendChild(box) : window.addEventListener("DOMContentLoaded", function () { document.body.appendChild(box); });
        }
        var line = document.createElement("div");
        line.textContent = msg;
        box.appendChild(line);
      }
      window.addEventListener("error", function (e) {
        showError((e.message || "Erro desconhecido") + " — " + (e.filename || "") + ":" + (e.lineno || "?"));
      });
      window.addEventListener("unhandledrejection", function (e) {
        showError("Promise rejeitada: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
      });
    })();
  </script>`;

  const viewportMeta = /<meta[^>]+name=["']viewport["']/i.test(aiHtml)
    ? ""
    : `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`;
  const headInjection = `${viewportMeta}\n${responsiveCss}\n${VIBE_RUNTIME_SCRIPT}\n${injection}`;
  // O overlay de controles precisa existir no <body>, não no <head> — vai
  // logo antes de </body> (ou no fim do documento se não houver </body>).
  const withHead = /<head[^>]*>/i.test(aiHtml)
    ? aiHtml.replace(/<head[^>]*>/i, (m) => `${m}\n${headInjection}`)
    : `${headInjection}\n${aiHtml}`; // sem <head> explícito: injeta no início
  return /<\/body>/i.test(withHead)
    ? withHead.replace(/<\/body>/i, () => `${TOUCH_CONTROLS_BLOCK}\n</body>`)
    : `${withHead}\n${TOUCH_CONTROLS_BLOCK}`;
}
