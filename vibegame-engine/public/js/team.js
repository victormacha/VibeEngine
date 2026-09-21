// Sistema de dupla: 2 alunos trabalhando no MESMO projeto (mesmos sprites,
// mesma conversa com a IA), como pedido — "2 pessoas vão conversar e
// editar juntas os sprites e a mesma IA, vendo o site de forma conjunta em
// tempo real". O cliente Supabase deste projeto é fetch puro (sem
// WebSocket/Realtime), então "tempo real" aqui é feito por POLLING: a cada
// poucos segundos, cada integrante busca a linha mais recente do jogo no
// servidor e, se o outro salvou algo novo nesse meio tempo, atualiza a
// tela sozinho — não é instantâneo (pode levar alguns segundos), mas os
// dois sempre convergem pro mesmo estado sem precisar recarregar a página.
import { state, loadProjectFromRow, loadLoreFromRow } from "./state.js";
import { dbQuery } from "./supabaseClient.js";
import { openModal } from "./ui.js";
import { toast } from "./ui.js";

const POLL_MS = 4000;
let pollTimer = null;

// Acha o uuid do parceiro pelo e-mail. Depende da política de RLS
// "qualquer usuário logado pode localizar perfil pra dupla" (schema.sql) —
// sem ela, alunos só enxergam o próprio perfil e essa busca sempre viria vazia.
export async function findPartnerByEmail(email) {
  const clean = (email || "").trim().toLowerCase();
  if (!clean) return null;
  const rows = await dbQuery("profiles", { select: "id,email,role", email: `eq.${clean}` });
  return rows[0] || null;
}

// Modal obrigatório (sem botão de fechar) antes de enviar pra avaliação,
// caso o projeto ainda não tenha nome de dupla definido. Devolve
// { teamName, partnerId, partnerEmail } ou null se a pessoa decidir que é
// trabalho solo (deixando o campo de parceiro em branco é permitido — nem
// todo grupo precisa ser dupla — mas o NOME da dupla é sempre obrigatório
// pra identificar quem entregou, mesmo sendo 1 pessoa só).
export function askTeamInfo() {
  return new Promise((resolve) => {
    const { overlay, close } = openModal(
      `
      <h2>👥 Antes de enviar: identifique a dupla</h2>
      <p class="hint">Obrigatório informar o nome da dupla (ou seu nome, se for sozinho) antes do jogo ir pra avaliação.</p>
      <label>Nome da dupla</label>
      <input type="text" id="team-name-input" placeholder="ex: Ana &amp; Bruno" value="${escapeAttr(state.project.teamName)}" />
      <label>E-mail do colega (opcional — dá acesso ao mesmo projeto pra ele editar junto)</label>
      <input type="email" id="team-partner-input" placeholder="colega@escola.com" value="${escapeAttr(state.project.partnerEmail)}" />
      <div id="team-error" class="auth-error" hidden></div>
      <button id="team-confirm" class="btn-primary">Confirmar e enviar</button>
    `,
      { dismissible: false }
    );

    const nameInput = overlay.querySelector("#team-name-input");
    const partnerInput = overlay.querySelector("#team-partner-input");
    const errBox = overlay.querySelector("#team-error");
    const confirmBtn = overlay.querySelector("#team-confirm");

    confirmBtn.addEventListener("click", async () => {
      const teamName = nameInput.value.trim();
      const partnerEmail = partnerInput.value.trim();
      errBox.hidden = true;
      if (!teamName) {
        errBox.hidden = false;
        errBox.textContent = "Digite o nome da dupla (ou seu nome).";
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Verificando...";
      try {
        let partnerId = null;
        if (partnerEmail) {
          const partner = await findPartnerByEmail(partnerEmail);
          if (!partner) {
            errBox.hidden = false;
            errBox.textContent = "Não achei nenhum aluno cadastrado com esse e-mail — confira se ele já criou conta na engine.";
            confirmBtn.disabled = false;
            confirmBtn.textContent = "Confirmar e enviar";
            return;
          }
          partnerId = partner.id;
        }
        close();
        resolve({ teamName, partnerId, partnerEmail });
      } catch (err) {
        errBox.hidden = false;
        errBox.textContent = err.message;
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirmar e enviar";
      }
    });
  });
}

function escapeAttr(str) {
  return String(str || "").replace(/"/g, "&quot;");
}

// Sincronização por polling: só roda quando o projeto tem um id salvo E
// um parceiro vinculado (partner_id) — trabalho solo não paga o custo de
// ficar consultando o servidor à toa. `onRemoteChange` é chamado toda vez
// que uma versão mais nova (updated_at maior) chega do servidor, DEPOIS de
// já ter sido aplicada ao `state` — quem chama só precisa re-renderizar a
// UI (ex.: aba Testar, galeria de sprites).
export function startTeamSync({ onRemoteChange } = {}) {
  stopTeamSync();
  let lastSeenUpdatedAt = null;

  pollTimer = setInterval(async () => {
    if (!state.project.id || !state.project.partnerId) return;
    try {
      const [row] = await dbQuery("games", { select: "*", id: `eq.${state.project.id}` });
      if (!row) return;
      if (lastSeenUpdatedAt === null) {
        lastSeenUpdatedAt = row.updated_at;
        return; // primeira leitura só define a base de comparação
      }
      if (row.updated_at && row.updated_at !== lastSeenUpdatedAt) {
        lastSeenUpdatedAt = row.updated_at;
        loadProjectFromRow(row);
        const [loreRow] = await dbQuery("lore", { select: "*", game_id: `eq.${row.id}` }).catch(() => [null]);
        if (loreRow) loadLoreFromRow(loreRow);
        toast("A dupla atualizou o projeto — tela sincronizada.", "info");
        onRemoteChange?.(row);
      }
    } catch {
      // offline momentâneo ou RLS ainda propagando o partner_id — tenta de novo no próximo tick.
    }
  }, POLL_MS);
}

export function stopTeamSync() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
