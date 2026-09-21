// Item 2 — Perfil: tempo de uso da engine, jogo atual sendo feito, e o
// "perfil do jogo" (nome + fundo das fases). Também reúne a configuração
// de dupla (item 5), já que é o lugar mais natural pra "meu perfil / meu
// jogo atual" incluir com quem estou fazendo esse jogo.
import { state } from "../state.js";
import { dbQuery } from "../supabaseClient.js";
import { toast } from "../ui.js";
import { getTotalSecondsForDisplay, formatSeconds } from "../usageTracking.js";
import { findPartnerByEmail, startTeamSync } from "../team.js";

export function mountPerfilTab(panel, { onProjectChanged } = {}) {
  panel.innerHTML = `
    <div class="perfil-panel">
      <section class="perfil-card">
        <h3>⏱️ Seu uso da engine</h3>
        <p id="perfil-time" class="perfil-big">Carregando...</p>
        <p class="hint">Tempo total logado na VibeGame Engine.</p>
      </section>

      <section class="perfil-card">
        <h3>🎮 Jogo atual</h3>
        <label>Nome do jogo</label>
        <div class="perfil-row">
          <input type="text" id="perfil-title" value="${escapeAttr(state.project.title)}" />
          <button id="perfil-title-save" class="btn-primary">Salvar nome</button>
        </div>
        <p class="hint">Status: ${state.project.status === "enviado" ? "📤 enviado pra avaliação" : "📝 rascunho"}</p>
      </section>

      <section class="perfil-card">
        <h3>🖼️ Fundo das fases</h3>
        <p class="hint">A imagem carregada aqui é usada pela IA como pano de fundo do jogo (aba IA/Testar) em vez de um cenário genérico.</p>
        <input type="file" id="perfil-bg-input" accept="image/*" />
        <div id="perfil-bg-preview" class="perfil-bg-preview"></div>
        <div class="perfil-row">
          <button id="perfil-bg-save" class="btn-primary">Salvar fundo</button>
          <button id="perfil-bg-clear" class="btn-ghost">Remover fundo</button>
        </div>
      </section>

      <section class="perfil-card">
        <h3>👥 Dupla</h3>
        <label>Nome da dupla</label>
        <input type="text" id="perfil-team-name" value="${escapeAttr(state.project.teamName)}" placeholder="ex: Ana & Bruno" />
        <label>E-mail do colega</label>
        <div class="perfil-row">
          <input type="email" id="perfil-partner-email" value="${escapeAttr(state.project.partnerEmail)}" placeholder="colega@escola.com" />
          <button id="perfil-partner-link" class="btn-primary">Vincular</button>
        </div>
        <p id="perfil-partner-status" class="hint">${state.project.partnerId ? "✅ Colega vinculado — vocês compartilham este projeto." : "Ainda sem colega vinculado (opcional até o envio)."}</p>
      </section>
    </div>`;

  const timeEl = panel.querySelector("#perfil-time");
  const titleInput = panel.querySelector("#perfil-title");
  const bgInput = panel.querySelector("#perfil-bg-input");
  const bgPreview = panel.querySelector("#perfil-bg-preview");
  const teamNameInput = panel.querySelector("#perfil-team-name");
  const partnerEmailInput = panel.querySelector("#perfil-partner-email");
  const partnerStatusEl = panel.querySelector("#perfil-partner-status");

  let pendingBackground = state.project.backgroundImage;
  renderBgPreview();

  getTotalSecondsForDisplay().then((secs) => {
    timeEl.textContent = formatSeconds(secs);
  });

  function renderBgPreview() {
    bgPreview.innerHTML = pendingBackground
      ? `<img src="${pendingBackground}" alt="Fundo escolhido" />`
      : `<span class="hint">Nenhum fundo carregado ainda.</span>`;
  }

  // Salva qualquer patch parcial no jogo já existente. Se o jogo ainda não
  // tem id (nunca foi salvo na aba Testar), guarda só localmente — vai
  // junto no próximo "Salvar" de lá.
  async function persist(patch) {
    Object.assign(state.project, patch);
    if (!state.project.id) return;
    try {
      await dbQuery("games", { id: `eq.${state.project.id}` }, {
        method: "PATCH",
        body: { ...toDbPatch(patch), updated_at: new Date().toISOString() },
      });
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function toDbPatch(patch) {
    const map = { backgroundImage: "background_image", teamName: "team_name", partnerId: "partner_id" };
    const out = {};
    Object.entries(patch).forEach(([k, v]) => {
      out[map[k] || k] = v;
    });
    return out;
  }

  panel.querySelector("#perfil-title-save").addEventListener("click", async () => {
    const title = titleInput.value.trim() || "Meu Jogo";
    await persist({ title });
    toast("Nome do jogo atualizado.", "success");
    onProjectChanged?.();
  });

  bgInput.addEventListener("change", () => {
    const file = bgInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingBackground = reader.result;
      renderBgPreview();
    };
    reader.readAsDataURL(file);
  });

  panel.querySelector("#perfil-bg-save").addEventListener("click", async () => {
    await persist({ backgroundImage: pendingBackground });
    toast("Fundo salvo — a IA vai usá-lo no próximo jogo gerado/reiniciado.", "success");
    onProjectChanged?.();
  });

  panel.querySelector("#perfil-bg-clear").addEventListener("click", async () => {
    pendingBackground = null;
    renderBgPreview();
    await persist({ backgroundImage: null });
    toast("Fundo removido.", "info");
    onProjectChanged?.();
  });

  panel.querySelector("#perfil-partner-link").addEventListener("click", async () => {
    const email = partnerEmailInput.value.trim();
    const teamName = teamNameInput.value.trim();
    if (!email) {
      toast("Digite o e-mail do colega.", "error");
      return;
    }
    try {
      const partner = await findPartnerByEmail(email);
      if (!partner) {
        toast("Não achei nenhum aluno cadastrado com esse e-mail.", "error");
        return;
      }
      await persist({ partnerId: partner.id, partnerEmail: email, teamName: teamName || state.project.teamName });
      partnerStatusEl.textContent = "✅ Colega vinculado — vocês compartilham este projeto.";
      toast("Colega vinculado ao projeto!", "success");
      if (state.project.id) startTeamSync({ onRemoteChange: () => onProjectChanged?.() });
    } catch (err) {
      toast(err.message, "error");
    }
  });

  teamNameInput.addEventListener("change", () => {
    persist({ teamName: teamNameInput.value.trim() });
  });
}

function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;");
}
