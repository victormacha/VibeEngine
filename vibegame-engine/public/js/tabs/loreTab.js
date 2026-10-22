// Item 2.1 — Lore: história do mundo/personagens/inimigos/bosses/NPCs.
// Se o aluno deixar em branco, a IA pode gerar algo SIMPLES sob pedido
// (nunca automaticamente) — e nesse caso a lore fica marcada como
// `ai_generated`, o que a aba Avaliação (bancaTab.js) usa pra avisar a
// banca que aquela lore não foi escrita pelo aluno.
import { state } from "../state.js";
import { generateSimpleLore } from "../api.js";
import { persistLore } from "../lore.js";
import { toast } from "../ui.js";

export function mountLoreTab(panel) {
  panel.innerHTML = `
    <div class="lore-panel">
      <p class="hint">
        Escreva a história do seu jogo: de onde vem o mundo, quem é o protagonista,
        os inimigos, bosses, NPCs etc. A IA usa isso pra dar nomes e contexto
        consistentes ao criar o jogo na aba IA.
      </p>
      <div id="lore-ai-badge" class="lore-ai-badge" hidden>
        🤖 Esta lore foi gerada pela IA, não pelo aluno.
      </div>
      <textarea id="lore-text" rows="14" placeholder="Era uma vez, num reino..."></textarea>
      <div class="lore-actions">
        <button id="lore-generate" class="btn-ghost">✨ Gerar uma lore simples com IA</button>
        <button id="lore-save" class="btn-primary">💾 Salvar lore</button>
      </div>
    </div>`;

  const textEl = panel.querySelector("#lore-text");
  const badgeEl = panel.querySelector("#lore-ai-badge");
  const generateBtn = panel.querySelector("#lore-generate");
  const saveBtn = panel.querySelector("#lore-save");

  let lastAIText = state.project.lore.aiGenerated ? state.project.lore.content : null;

  textEl.value = state.project.lore.content;
  badgeEl.hidden = !state.project.lore.aiGenerated;

  textEl.addEventListener("input", () => {
    // Se o aluno alterar o texto gerado pela IA, deixa de valer o aviso
    // (o texto que vai ser salvo já não é mais 100% da IA) — só continua
    // marcado se o que está na caixa é EXATAMENTE o que a IA devolveu.
    badgeEl.hidden = textEl.value !== lastAIText;
    // Guarda no estado a cada tecla: trocar de aba, salvar o jogo na aba
    // Testar ou a sincronização da dupla não perdem mais o que foi escrito
    // (antes o texto só existia dentro da caixa até clicar em Salvar lore).
    syncState();
  });

  function syncState() {
    const content = textEl.value;
    state.project.lore.content = content;
    state.project.lore.aiGenerated = content === lastAIText && content.trim().length > 0;
  }

  generateBtn.addEventListener("click", async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = "Gerando...";
    try {
      const text = await generateSimpleLore({ genre: state.project.genre, mechanics: state.project.mechanics });
      textEl.value = text;
      lastAIText = text;
      badgeEl.hidden = false;
      syncState();
      toast("Lore simples gerada pela IA — pode editar à vontade.", "info");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "✨ Gerar uma lore simples com IA";
    }
  });

  saveBtn.addEventListener("click", async () => {
    syncState();
    if (!state.project.id) {
      // Jogo ainda não existe no banco (nunca foi salvo na aba Testar) — a
      // lore fica guardada e vai junto no primeiro "Salvar" de lá.
      toast("Lore guardada! Ela vai pro banco junto com o jogo quando você clicar em Salvar na aba Testar.", "info");
      return;
    }
    saveBtn.disabled = true;
    try {
      await persistLore(state.project.id, state.project.lore.content, state.project.lore.aiGenerated);
      toast("Lore salva.", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      saveBtn.disabled = false;
    }
  });
}
