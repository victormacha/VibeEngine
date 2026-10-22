// Peças compartilhadas entre a aba Avaliação (banca) e o painel Admin pra
// olhar um jogo enviado: a lore escrita pelo aluno e as avaliações que
// TODOS os avaliadores já deram pra ele.
import { dbQuery } from "./supabaseClient.js";

export function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Busca a lore do jogo (ou null). Erro de rede/tabela vira null — a tela
// segue funcionando sem a lore.
export async function fetchLore(gameId) {
  try {
    const [row] = await dbQuery("lore", { select: "*", game_id: `eq.${gameId}` });
    return row || null;
  } catch {
    return null;
  }
}

// HTML do bloco "📜 Lore" (sanfona aberta por padrão).
export function loreBlockHtml(loreRow) {
  if (!loreRow || !loreRow.content?.trim()) {
    return `<details class="review-block" open><summary>📜 Lore</summary><p class="hint">O aluno não escreveu lore pra este jogo.</p></details>`;
  }
  const aiTag = loreRow.ai_generated ? `<span class="review-ai-tag">🤖 gerada pela IA</span>` : "";
  return `<details class="review-block" open>
      <summary>📜 Lore ${aiTag}</summary>
      <div class="review-lore">${escapeHtml(loreRow.content)}</div>
    </details>`;
}

// Todas as avaliações do jogo, já com o nome de quem avaliou.
// A política de RLS "banca e admin criam e leem notas" já deixa qualquer
// avaliador ler as notas dos outros — o que faltava era a tela mostrar.
export async function fetchScores(gameId) {
  const scores = await dbQuery("scores", { select: "*", game_id: `eq.${gameId}`, order: "created_at.asc" });
  const ids = [...new Set(scores.map((s) => s.banca_id))];
  const names = {};
  if (ids.length) {
    try {
      const rows = await dbQuery("profiles", { select: "id,name,email", id: `in.(${ids.join(",")})` });
      rows.forEach((r) => { names[r.id] = r.name || r.email; });
    } catch {
      // sem nomes: mostra só as notas
    }
  }
  return scores.map((s) => ({ ...s, avaliador: names[s.banca_id] || "avaliador" }));
}

export function average(scores) {
  if (!scores.length) return null;
  return scores.reduce((sum, s) => sum + Number(s.nota), 0) / scores.length;
}

export function formatNota(n) {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

// HTML da lista de avaliações. `myId` destaca a linha de quem está vendo.
export function scoresBlockHtml(scores, myId) {
  if (!scores.length) {
    return `<details class="review-block" open><summary>🏆 Avaliações</summary><p class="hint">Ninguém avaliou este jogo ainda.</p></details>`;
  }
  const media = average(scores);
  const rows = scores
    .map((s) => `
      <li class="review-score${s.banca_id === myId ? " review-score-mine" : ""}">
        <div class="review-score-head">
          <strong>${escapeHtml(s.avaliador)}${s.banca_id === myId ? " (você)" : ""}</strong>
          <span class="review-nota">${formatNota(s.nota)} / 4</span>
        </div>
        ${s.comentario ? `<p>${escapeHtml(s.comentario)}</p>` : ""}
      </li>`)
    .join("");
  return `<details class="review-block" open>
      <summary>🏆 Avaliações — média <strong>${formatNota(media)}</strong> (${scores.length} avaliador${scores.length > 1 ? "es" : ""})</summary>
      <ul class="review-scores">${rows}</ul>
    </details>`;
}
