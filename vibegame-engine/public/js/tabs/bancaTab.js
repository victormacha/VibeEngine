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
      const games = await dbQuery("games", { select: "*", status: "eq.enviado", order: "submitted_at.desc" });
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

  async function openGame(game) {
    const teamLine = game.team_name ? `<span class="banca-team">👥 Dupla: ${game.team_name}</span>` : "";
    previewEl.innerHTML = `
      <div class="test-toolbar">
        <span>🎮 ${game.title}</span>
        ${teamLine}
      </div>
      <div id="banca-lore-warning" hidden></div>
      <iframe class="banca-frame" sandbox="allow-scripts" srcdoc="${game.html_code.replace(/"/g, "&quot;")}"></iframe>
      <div class="banca-score">
        <label>Nota (0-4)</label>
        <input type="number" id="score-input" min="0" max="4" step="0.5" />
        <label>Comentário</label>
        <textarea id="score-comment" rows="2"></textarea>
        <button id="score-submit" class="btn-primary">Enviar avaliação</button>
      </div>`;

    // Item 2.1: avisa a banca quando a lore do jogo foi gerada pela IA (não
    // escrita pelo aluno) — a decisão de zerar continua sendo da banca, o
    // botão só preenche a nota como atalho.
    try {
      const [loreRow] = await dbQuery("lore", { select: "*", game_id: `eq.${game.id}` });
      const warningEl = previewEl.querySelector("#banca-lore-warning");
      if (loreRow?.ai_generated) {
        warningEl.hidden = false;
        warningEl.className = "banca-lore-warning";
        warningEl.innerHTML = `⚠️ <strong>Atenção:</strong> a lore deste jogo foi gerada pela IA, não escrita pelo aluno.
          <button id="banca-zerar" class="btn-ghost">Zerar nota</button>`;
        warningEl.querySelector("#banca-zerar").addEventListener("click", () => {
          previewEl.querySelector("#score-input").value = "0";
        });
      }
    } catch {
      // sem lore cadastrada pra esse jogo (ou tabela ainda não migrada) — segue sem aviso.
    }

    previewEl.querySelector("#score-submit").addEventListener("click", async () => {
      const nota = Number(previewEl.querySelector("#score-input").value);
      if (Number.isNaN(nota) || nota < 0 || nota > 4) {
        toast("A nota precisa estar entre 0 e 4.", "error");
        return;
      }
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
