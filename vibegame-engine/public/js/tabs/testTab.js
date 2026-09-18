import { state } from "../state.js";
import { assembleFinalGame } from "../codeGen.js";
import { dbQuery } from "../supabaseClient.js";
import { toast } from "../ui.js";

export function mountTestTab(panel) {
  panel.innerHTML = `
    <div class="test-toolbar">
      <span id="test-title">🎮 Nenhum jogo gerado ainda</span>
      <div class="actions">
        <button id="btn-reload" class="btn-ghost">🔄 Reiniciar</button>
        <button id="btn-view-code" class="btn-ghost">🔍 Ver código (nova aba)</button>
        <button id="btn-save-cloud" class="btn-ghost">☁️ Salvar no meu perfil</button>
        <button id="btn-download" class="btn-primary">📥 Baixar (.html)</button>
      </div>
    </div>
    <div id="game-frame-wrap" class="game-frame-wrap"></div>`;

  const wrap = panel.querySelector("#game-frame-wrap");
  const titleEl = panel.querySelector("#test-title");

  // Recriamos o <iframe> do zero a cada render, em vez de reaproveitar o
  // mesmo elemento. Reusar o mesmo <iframe> e só trocar `.srcdoc` pode não
  // recarregar quando a aba Testar está escondida (display:none) — o
  // navegador "congela" o iframe antigo. Um elemento novo sempre carrega
  // do zero assim que a aba fica visível.
  function renderInto(html) {
    wrap.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.id = "game-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.srcdoc = html;
    wrap.appendChild(frame);
  }

  function render() {
    if (!state.project.gameCode) {
      titleEl.textContent = "🎮 Nenhum jogo gerado ainda — use a aba IA";
      renderInto(`<body style="background:#12141c;color:#8a8fa3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">Peça um jogo na aba IA para vê-lo aqui.</body>`);
      return;
    }
    if (!/<html[\s>]|<!doctype html/i.test(state.project.gameCode)) {
      titleEl.textContent = "⚠️ Resposta da IA não parece um jogo válido";
      renderInto(`<body style="background:#1a0e0e;color:#ff8a8a;font-family:monospace;padding:20px;white-space:pre-wrap;margin:0">A IA não devolveu um HTML completo dessa vez. Tente enviar o pedido de novo na aba IA (às vezes reformular ajuda), ou use "Ver código" para inspecionar a resposta bruta.</body>`);
      return;
    }
    titleEl.textContent = `🎮 ${state.project.title}`;
    const finalHtml = assembleFinalGame(state.project.gameCode, {
      sprites: state.project.sprites,
      mechanics: state.project.mechanics,
    });
    renderInto(finalHtml);
  }

  panel.querySelector("#btn-reload").addEventListener("click", render);

  panel.querySelector("#btn-view-code").addEventListener("click", () => {
    if (!state.project.gameCode) return toast("Gere um jogo antes.", "error");
    const finalHtml = assembleFinalGame(state.project.gameCode, {
      sprites: state.project.sprites,
      mechanics: state.project.mechanics,
    });
    const blob = new Blob([finalHtml], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  });

  panel.querySelector("#btn-download").addEventListener("click", () => {
    if (!state.project.gameCode) return toast("Gere um jogo antes de baixar.", "error");
    const finalHtml = assembleFinalGame(state.project.gameCode, {
      sprites: state.project.sprites,
      mechanics: state.project.mechanics,
    });
    const blob = new Blob([finalHtml], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.project.title || "jogo").replace(/\s+/g, "_")}.html`;
    a.click();
  });

  panel.querySelector("#btn-save-cloud").addEventListener("click", async () => {
    if (!state.project.gameCode) return toast("Gere um jogo antes de salvar.", "error");
    if (!state.session) return toast("Você precisa estar logado.", "error");
    try {
      await dbQuery("games", {}, {
        method: "POST",
        body: {
          user_id: state.session.user.id,
          title: state.project.title,
          genre: state.project.genre,
          html_code: assembleFinalGame(state.project.gameCode, {
            sprites: state.project.sprites,
            mechanics: state.project.mechanics,
          }),
          sprites: state.project.sprites,
          mechanics: state.project.mechanics,
        },
      });
      toast("Jogo salvo no seu perfil!", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });

  render();
  return { render };
}
