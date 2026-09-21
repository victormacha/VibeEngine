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
  function platformsCollide(entity, platforms) {
    if (!(entity.vy > 0)) return false;
    var bottom = entity.y + entity.height;
    var prevBottom = bottom - entity.vy;
    for (var i = 0; i < platforms.length; i++) {
      var p = platforms[i];
      var withinX = entity.x + entity.width > p.x && entity.x < p.x + p.width;
      if (!withinX) continue;
      if (prevBottom <= p.y && bottom >= p.y) {
        entity.y = p.y - entity.height;
        entity.vy = 0;
        entity.onGround = true;
        return true;
      }
    }
    return false;
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

  function paintFrameToCanvas(frameMatrix) {
    var cached = frameCanvasCache.get(frameMatrix);
    if (cached) return cached;
    var n = frameMatrix.length;
    var c = document.createElement("canvas");
    c.width = n; c.height = n;
    var cx = c.getContext("2d");
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var color = frameMatrix[y][x];
        if (color) { cx.fillStyle = color; cx.fillRect(x, y, 1, 1); }
      }
    }
    frameCanvasCache.set(frameMatrix, c);
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
    var frameCanvas = paintFrameToCanvas(anim.frames[idx]);
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

  return {
    clamp: clamp,
    rectsOverlap: rectsOverlap,
    loop: loop,
    createCooldown: createCooldown,
    applyGravity: applyGravity,
    groundCollide: groundCollide,
    platformsCollide: platformsCollide,
    createJumpController: createJumpController,
    frameIndex: frameIndex,
    drawSprite: drawSprite,
    createCamera: createCamera,
    createParticleSystem: createParticleSystem,
  };
})();
</script>`;

export function assembleFinalGame(aiHtml, { sprites, mechanics }) {
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
