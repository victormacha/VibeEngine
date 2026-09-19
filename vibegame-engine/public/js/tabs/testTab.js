import { state } from "../state.js";
import { assembleFinalGame } from "../codeGen.js";
import { dbQuery } from "../supabaseClient.js";
import { toast } from "../ui.js";

export function mountTestTab(panel) {
  panel.innerHTML = `
    <div class="test-toolbar">
      <span id="test-title">🎮 Nenhum jogo gerado ainda</span>
      <span id="test-status" class="status-badge" hidden></span>
      <div class="actions">
        <button id="btn-reload" class="btn-ghost">🔄 Reiniciar</button>
        <button id="btn-view-code" class="btn-ghost">🔍 Ver código (nova aba)</button>
        <button id="btn-save-cloud" class="btn-ghost">☁️ Salvar (continuar depois)</button>
        <button id="btn-submit" class="btn-primary btn-danger">📤 Enviar pra avaliação</button>
        <button id="btn-download" class="btn-ghost">📥 Baixar (.html)</button>
      </div>
    </div>
    <div id="game-frame-wrap" class="game-frame-wrap"></div>`;

  const wrap = panel.querySelector("#game-frame-wrap");
  const titleEl = panel.querySelector("#test-title");
  const statusEl = panel.querySelector("#test-status");
  const submitBtn = panel.querySelector("#btn-submit");

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

  function renderStatusBadge() {
    if (!state.project.gameCode) {
      statusEl.hidden = true;
      return;
    }
    statusEl.hidden = false;
    const enviado = state.project.status === "enviado";
    statusEl.textContent = enviado ? "📤 Enviado pra avaliação" : "📝 Rascunho (só você vê)";
    statusEl.className = `status-badge ${enviado ? "status-enviado" : "status-rascunho"}`;
    submitBtn.textContent = enviado ? "📤 Reenviar pra avaliação" : "📤 Enviar pra avaliação";
  }

  function render() {
    renderStatusBadge();
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

  // Monta o corpo comum enviado pro banco, tanto pro insert quanto pro
  // update — mantém as duas ações (salvar / enviar) sempre em sincronia
  // com o que está no editor agora.
  function buildRow(extra) {
    return {
      title: state.project.title,
      genre: state.project.genre,
      html_code: assembleFinalGame(state.project.gameCode, {
        sprites: state.project.sprites,
        mechanics: state.project.mechanics,
      }),
      game_code: state.project.gameCode,
      chat_history: state.project.chatHistory,
      sprites: state.project.sprites,
      mechanics: state.project.mechanics,
      updated_at: new Date().toISOString(),
      ...extra,
    };
  }

  // Salva sem mexer no status: primeiro save cria a linha (INSERT) e
  // guarda o id; saves seguintes fazem UPDATE nessa mesma linha — é isso
  // que permite fechar o navegador e continuar o mesmo projeto depois,
  // em vez de acumular um jogo novo a cada clique.
  async function saveDraft({ silent = false } = {}) {
    if (!state.project.gameCode) {
      if (!silent) toast("Gere um jogo antes de salvar.", "error");
      return false;
    }
    if (!state.session) {
      if (!silent) toast("Você precisa estar logado.", "error");
      return false;
    }
    try {
      if (state.project.id) {
        await dbQuery("games", { id: `eq.${state.project.id}` }, {
          method: "PATCH",
          body: buildRow(),
        });
      } else {
        const [row] = await dbQuery("games", {}, {
          method: "POST",
          body: buildRow({ user_id: state.session.user.id, status: "rascunho" }),
        });
        if (row?.id) state.project.id = row.id;
      }
      if (!silent) toast("Jogo salvo — continue quando quiser, ele te espera aqui.", "success");
      renderStatusBadge();
      return true;
    } catch (err) {
      if (!silent) toast(err.message, "error");
      return false;
    }
  }

  panel.querySelector("#btn-save-cloud").addEventListener("click", () => saveDraft());

  submitBtn.addEventListener("click", async () => {
    if (!state.project.gameCode) return toast("Gere um jogo antes de enviar.", "error");
    const already = state.project.status === "enviado";
    const msg = already
      ? "Esse jogo já foi enviado. Enviar de novo atualiza a versão que a banca vai ver — continuar?"
      : "Enviar esse jogo pra avaliação da banca? Depois de enviado, quem avalia já pode ver e pontuar.";
    if (!confirm(msg)) return;
    submitBtn.disabled = true;
    try {
      if (!state.project.id) {
        // Ainda não tinha sido salvo nem uma vez: cria a linha já como
        // rascunho e SÓ DEPOIS promove pra enviado, num segundo passo —
        // mantém o mesmo caminho de código do save normal, sem duplicar
        // lógica de insert.
        const ok = await saveDraft({ silent: true });
        if (!ok) return;
      }
      await dbQuery("games", { id: `eq.${state.project.id}` }, {
        method: "PATCH",
        body: buildRow({ status: "enviado", submitted_at: new Date().toISOString() }),
      });
      state.project.status = "enviado";
      toast("Jogo enviado pra avaliação! 🎉", "success");
      renderStatusBadge();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  render();
  return { render };
}
