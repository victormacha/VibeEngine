// Painel do admin: gerenciar cargos (nomear banca) e acompanhar o
// progresso de cada aluno — inclusive os rascunhos ainda não enviados,
// que a banca não enxerga (ver política de RLS em supabase/schema.sql).
import { dbQuery } from "../supabaseClient.js";
import { state } from "../state.js";
import { toast } from "../ui.js";

export function mountAdminTab(panel) {
  panel.innerHTML = `
    <div class="admin-panel">
      <div class="admin-users" id="admin-users">Carregando usuários...</div>
      <div class="admin-detail" id="admin-detail">
        <p class="hint">Selecione um usuário à esquerda pra ver o cargo, o progresso e os jogos salvos dele.</p>
      </div>
    </div>`;

  const usersEl = panel.querySelector("#admin-users");
  const detailEl = panel.querySelector("#admin-detail");

  let profiles = [];
  let gamesByUser = {};

  async function load() {
    try {
      const [profileRows, gameRows] = await Promise.all([
        dbQuery("profiles", { select: "*", order: "email.asc" }),
        // Lista "leve" (sem html_code, que pode ser grande) pra montar os
        // cards; o HTML completo só é buscado quando o admin abre um jogo
        // específico pra pré-visualizar (ver previewGame).
        dbQuery("games", {
          select: "id,user_id,title,genre,status,created_at,submitted_at,updated_at",
          order: "updated_at.desc",
        }),
      ]);
      profiles = profileRows;
      gamesByUser = {};
      gameRows.forEach((g) => {
        (gamesByUser[g.user_id] ||= []).push(g);
      });
      renderUsers();
    } catch (err) {
      usersEl.innerHTML = `<p class="hint">Erro ao carregar: ${err.message}</p>`;
    }
  }

  function renderUsers() {
    usersEl.innerHTML = "";
    profiles.forEach((p) => {
      const games = gamesByUser[p.id] || [];
      const enviados = games.filter((g) => g.status === "enviado").length;
      const row = document.createElement("button");
      row.className = "admin-user-row";
      row.innerHTML = `
        <div class="admin-user-main">
          <strong>${p.name || p.email}</strong>
          <span class="role-badge role-${p.role}">${p.role}</span>
        </div>
        <span class="admin-user-sub">${games.length} salvo(s) · ${enviados} enviado(s)</span>`;
      row.addEventListener("click", () => openUser(p));
      usersEl.appendChild(row);
    });
  }

  function openUser(p) {
    const games = (gamesByUser[p.id] || [])
      .slice()
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    const isSelf = p.id === state.session?.user?.id;

    detailEl.innerHTML = `
      <div class="admin-detail-header">
        <div>
          <strong>${p.name || p.email}</strong>
          <div class="admin-user-sub">${p.email}</div>
        </div>
        <div class="admin-role-editor">
          <label>Cargo</label>
          <select id="admin-role-select" ${isSelf ? "disabled" : ""}>
            <option value="aluno" ${p.role === "aluno" ? "selected" : ""}>aluno</option>
            <option value="banca" ${p.role === "banca" ? "selected" : ""}>banca</option>
            <option value="admin" ${p.role === "admin" ? "selected" : ""}>admin</option>
          </select>
          <button id="admin-role-save" class="btn-primary" ${isSelf ? "disabled" : ""}>Salvar cargo</button>
        </div>
      </div>
      ${isSelf ? `<p class="hint">Não dá pra mudar o próprio cargo por aqui (evita travar sem querer fora do admin) — peça a outro admin, se precisar.</p>` : ""}
      <div class="admin-games-list" id="admin-games-list">
        ${games.length ? "" : `<p class="hint">Nenhum jogo salvo ainda.</p>`}
      </div>
      <div class="admin-games-preview" id="admin-games-preview"></div>`;

    const gamesListEl = detailEl.querySelector("#admin-games-list");
    games.forEach((g) => {
      const item = document.createElement("button");
      item.className = "admin-game-item";
      const enviado = g.status === "enviado";
      item.innerHTML = `<strong>${g.title}</strong><span class="status-badge ${enviado ? "status-enviado" : "status-rascunho"}">${enviado ? "📤 enviado" : "📝 rascunho"}</span>`;
      item.addEventListener("click", () => previewGame(g));
      gamesListEl.appendChild(item);
    });

    if (!isSelf) {
      detailEl.querySelector("#admin-role-save").addEventListener("click", async () => {
        const select = detailEl.querySelector("#admin-role-select");
        const newRole = select.value;
        try {
          await dbQuery("profiles", { id: `eq.${p.id}` }, { method: "PATCH", body: { role: newRole } });
          p.role = newRole;
          toast(`${p.email} agora é ${newRole}.`, "success");
          renderUsers();
        } catch (err) {
          toast(err.message, "error");
        }
      });
    }
  }

  async function previewGame(g) {
    const previewEl = detailEl.querySelector("#admin-games-preview");
    previewEl.innerHTML = `<p class="hint">Carregando jogo...</p>`;
    try {
      const [full] = await dbQuery("games", { select: "html_code", id: `eq.${g.id}` });
      previewEl.innerHTML = `
        <div class="test-toolbar"><span>🎮 ${g.title}</span></div>
        <iframe class="banca-frame" sandbox="allow-scripts" srcdoc="${(full?.html_code || "").replace(/"/g, "&quot;")}"></iframe>`;
    } catch (err) {
      previewEl.innerHTML = `<p class="hint">Erro ao carregar jogo: ${err.message}</p>`;
    }
  }

  load();
}
