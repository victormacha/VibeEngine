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

export function assembleFinalGame(aiHtml, { sprites, mechanics }) {
  const spritesJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(sprites).map(([name, s]) => [
        name,
        { frames: s.frames || [s.pixels], frameDuration: s.frameDuration || 150 },
      ])
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
  const headInjection = `${viewportMeta}\n${responsiveCss}\n${injection}`;
  // O overlay de controles precisa existir no <body>, não no <head> — vai
  // logo antes de </body> (ou no fim do documento se não houver </body>).
  const withHead = /<head[^>]*>/i.test(aiHtml)
    ? aiHtml.replace(/<head[^>]*>/i, (m) => `${m}\n${headInjection}`)
    : `${headInjection}\n${aiHtml}`; // sem <head> explícito: injeta no início
  return /<\/body>/i.test(withHead)
    ? withHead.replace(/<\/body>/i, () => `${TOUCH_CONTROLS_BLOCK}\n</body>`)
    : `${withHead}\n${TOUCH_CONTROLS_BLOCK}`;
}
