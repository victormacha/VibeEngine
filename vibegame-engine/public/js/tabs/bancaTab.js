import { dbQuery } from "../supabaseClient.js";
import { state } from "../state.js";
import { toast } from "../ui.js";
import { escapeHtml, fetchLore, loreBlockHtml, fetchScores, scoresBlockHtml, average, formatNota } from "../gameReview.js";

export function mountBancaTab(panel) {
  panel.innerHTML = `
    <div class="banca-panel">
      <div class="banca-list-wrap">
        <button id="banca-refresh" class="btn-ghost banca-refresh">🔄 Atualizar lista</button>
        <div class="banca-list" id="banca-list">Carregando jogos enviados...</div>
      </div>
      <div class="banca-preview" id="banca-preview">
        <p class="hint">Selecione um jogo na lista para avaliar.</p>
      </div>
    </div>`;

  const listEl = panel.querySelector("#banca-list");
  const previewEl = panel.querySelector("#banca-preview");
  const myId = state.session?.user?.id;

  panel.querySelector("#banca-refresh").addEventListener("click", () => loadGames());

  async function loadGames() {
    try {
      const games = await dbQuery("games", { select: "*", status: "eq.enviado", order: "submitted_at.desc" });
      if (!games.length) {
        listEl.innerHTML = `<p class="hint">Nenhum jogo enviado ainda.</p>`;
        return;
      }
      // Nome + ano de quem fez (tela de identificação v4). Se a coluna ainda
      // não existir no banco, a lista segue sem essa linha.
      const alunos = {};
      try {
        const ids = [...new Set(games.flatMap((g) => [g.user_id, g.partner_id]).filter(Boolean))];
        if (ids.length) {
          const rows = await dbQuery("perfil", { select: "id,nome_aluno,ano", id: `in.(${ids.join(",")})` });
          rows.forEach((r) => { if (r.nome_aluno) alunos[r.id] = `${r.nome_aluno}${r.ano ? ` (${r.ano}º ano)` : ""}`; });
        }
      } catch {
        // sem identificação disponível
      }
      // Resumo das notas de TODOS os avaliadores em cada jogo da lista.
      const notasPorJogo = {};
      try {
        const rows = await dbQuery("scores", { select: "game_id,nota,banca_id", game_id: `in.(${games.map((g) => g.id).join(",")})` });
        rows.forEach((r) => (notasPorJogo[r.game_id] ||= []).push(r));
      } catch {
        // sem resumo de notas
      }
      listEl.innerHTML = "";
      games.forEach((g) => {
        const item = document.createElement("button");
        item.className = "banca-item";
        const quem = [alunos[g.user_id], alunos[g.partner_id]].filter(Boolean).map(escapeHtml).join(" & ");
        const notas = notasPorJogo[g.id] || [];
        const jaAvaliei = notas.some((n) => n.banca_id === myId);
        const resumo = notas.length
          ? `<span class="banca-notas">🏆 ${notas.length} avaliação(ões) · média ${formatNota(average(notas))}${jaAvaliei ? " · ✔ você avaliou" : ""}</span>`
          : `<span class="banca-notas banca-notas-vazio">Ainda sem avaliação</span>`;
        item.innerHTML = `<strong>${escapeHtml(g.title)}</strong><span>${escapeHtml(g.genre)}</span>${quem ? `<span class="banca-aluno">👤 ${quem}</span>` : ""}${resumo}`;
        item.addEventListener("click", () => openGame(g));
        listEl.appendChild(item);
      });
    } catch (err) {
      listEl.innerHTML = `<p class="hint">Erro ao carregar: ${escapeHtml(err.message)}</p>`;
    }
  }

  async function openGame(game) {
    const teamLine = game.team_name ? `<span class="banca-team">👥 Dupla: ${escapeHtml(game.team_name)}</span>` : "";
    previewEl.innerHTML = `
      <div class="test-toolbar">
        <span>🎮 ${escapeHtml(game.title)}</span>
        ${teamLine}
      </div>
      <div id="banca-lore-warning" hidden></div>
      <iframe class="banca-frame" sandbox="allow-scripts" srcdoc="${game.html_code.replace(/"/g, "&quot;")}"></iframe>
      <div class="banca-details">
        <div id="banca-lore"><p class="hint">Carregando lore...</p></div>
        <div id="banca-scores"><p class="hint">Carregando avaliações...</p></div>
        <div class="banca-score">
          <label>Sua nota (0-4)</label>
          <input type="number" id="score-input" min="0" max="4" step="0.5" />
          <label>Comentário</label>
          <textarea id="score-comment" rows="2"></textarea>
          <button id="score-submit" class="btn-primary">Enviar avaliação</button>
        </div>
      </div>`;

    const scoreInput = previewEl.querySelector("#score-input");
    const commentInput = previewEl.querySelector("#score-comment");
    const submitBtn = previewEl.querySelector("#score-submit");

    // Lore: texto completo pra banca ler + aviso quando foi a IA que escreveu.
    // O botão de zerar só preenche a nota como atalho — a decisão é da banca.
    fetchLore(game.id).then((loreRow) => {
      previewEl.querySelector("#banca-lore").innerHTML = loreBlockHtml(loreRow);
      if (loreRow?.ai_generated) {
        const warningEl = previewEl.querySelector("#banca-lore-warning");
        warningEl.hidden = false;
        warningEl.className = "banca-lore-warning";
        warningEl.innerHTML = `⚠️ <strong>Atenção:</strong> a lore deste jogo foi gerada pela IA, não escrita pelo aluno.
          <button id="banca-zerar" class="btn-ghost">Zerar nota</button>`;
        warningEl.querySelector("#banca-zerar").addEventListener("click", () => { scoreInput.value = "0"; });
      }
    });

    async function refreshScores({ fillMine = false } = {}) {
      const box = previewEl.querySelector("#banca-scores");
      try {
        const scores = await fetchScores(game.id);
        box.innerHTML = scoresBlockHtml(scores, myId);
        const mine = scores.find((s) => s.banca_id === myId);
        if (mine) {
          if (fillMine) {
            scoreInput.value = mine.nota;
            commentInput.value = mine.comentario || "";
          }
          submitBtn.textContent = "Atualizar minha avaliação";
        }
      } catch (err) {
        box.innerHTML = `<p class="hint">Erro ao carregar avaliações: ${escapeHtml(err.message)}</p>`;
      }
    }
    refreshScores({ fillMine: true });

    submitBtn.addEventListener("click", async () => {
      const raw = scoreInput.value.trim();
      const nota = Number(raw);
      if (!raw || Number.isNaN(nota) || nota < 0 || nota > 4) {
        toast("A nota precisa estar entre 0 e 4.", "error");
        return;
      }
      const comentario = commentInput.value.trim();
      submitBtn.disabled = true;
      try {
        // Upsert: cada avaliador tem UMA nota por jogo (unique game_id +
        // banca_id). Antes era só INSERT — avaliar de novo dava erro de
        // chave duplicada; agora atualiza a nota anterior.
        await dbQuery("scores", { on_conflict: "game_id,banca_id" }, {
          method: "POST",
          body: { game_id: game.id, banca_id: myId, nota, comentario },
          prefer: "resolution=merge-duplicates,return=representation",
        });
        toast("Avaliação enviada!", "success");
        await refreshScores();
        loadGames();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  loadGames();
}
