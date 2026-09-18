import { dbQuery } from "../supabaseClient.js";
import { state } from "../state.js";
import { toast } from "../ui.js";

export function mountBancaTab(panel) {
  panel.innerHTML = `
    <div class="banca-panel">
      <div class="banca-list" id="banca-list">Carregando jogos enviados...</div>
      <div class="banca-preview" id="banca-preview">
        <p class="hint">Selecione um jogo na lista para avaliar.</p>
      </div>
    </div>`;

  const listEl = panel.querySelector("#banca-list");
  const previewEl = panel.querySelector("#banca-preview");

  async function loadGames() {
    try {
      const games = await dbQuery("games", { select: "*", order: "created_at.desc" });
      if (!games.length) {
        listEl.innerHTML = `<p class="hint">Nenhum jogo enviado ainda.</p>`;
        return;
      }
      listEl.innerHTML = "";
      games.forEach((g) => {
        const item = document.createElement("button");
        item.className = "banca-item";
        item.innerHTML = `<strong>${g.title}</strong><span>${g.genre}</span>`;
        item.addEventListener("click", () => openGame(g));
        listEl.appendChild(item);
      });
    } catch (err) {
      listEl.innerHTML = `<p class="hint">Erro ao carregar: ${err.message}</p>`;
    }
  }

  function openGame(game) {
    previewEl.innerHTML = `
      <div class="test-toolbar">
        <span>🎮 ${game.title}</span>
      </div>
      <iframe class="banca-frame" sandbox="allow-scripts" srcdoc="${game.html_code.replace(/"/g, "&quot;")}"></iframe>
      <div class="banca-score">
        <label>Nota (0-10)</label>
        <input type="number" id="score-input" min="0" max="10" step="0.5" />
        <label>Comentário</label>
        <textarea id="score-comment" rows="2"></textarea>
        <button id="score-submit" class="btn-primary">Enviar avaliação</button>
      </div>`;

    previewEl.querySelector("#score-submit").addEventListener("click", async () => {
      const nota = Number(previewEl.querySelector("#score-input").value);
      const comentario = previewEl.querySelector("#score-comment").value.trim();
      try {
        await dbQuery("scores", {}, {
          method: "POST",
          body: { game_id: game.id, banca_id: state.session.user.id, nota, comentario },
        });
        toast("Avaliação enviada!", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  loadGames();
}
