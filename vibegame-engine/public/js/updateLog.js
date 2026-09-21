// Item 3 — "na PRIMEIRA vez que um usuário entrar na Engine vai abrir uma
// tabela de update explicando tudo que vai vir pra essa update". Compara
// a versão mais recente de `update_logs` com `perfil.last_seen_update_version`
// e, se forem diferentes (ou o aluno nunca viu nenhuma), mostra o modal e
// grava a versão como vista — assim só aparece uma vez por atualização.
import { state } from "./state.js";
import { dbQuery } from "./supabaseClient.js";
import { openModal } from "./ui.js";

function renderContentAsHtml(content) {
  // Conteúdo é markdown BEM simples (só linhas "- item" e **negrito**) —
  // não vale a pena puxar uma lib de markdown inteira só pra isso.
  const lines = content.split("\n").map((l) => l.trim());
  let html = "";
  let inList = false;
  for (const line of lines) {
    const bolded = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (line.startsWith("- ")) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${bolded.slice(2)}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line) html += `<p>${bolded}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

export async function maybeShowUpdateLog() {
  if (!state.session || state.session.user.id === "dev-local") return;
  try {
    const [latest] = await dbQuery("update_logs", { select: "*", order: "created_at.desc", limit: "1" });
    if (!latest) return;

    const [perfilRow] = await dbQuery("perfil", { select: "last_seen_update_version", id: `eq.${state.session.user.id}` });
    if (perfilRow?.last_seen_update_version === latest.version) return;

    openModal(
      `
      <h2>${latest.title}</h2>
      <div class="update-log-body">${renderContentAsHtml(latest.content)}</div>
      <button id="update-log-ok" class="btn-primary">Entendi, bora criar!</button>
      `,
      { dismissible: false }
    );

    document.getElementById("update-log-ok").addEventListener("click", async () => {
      document.querySelector(".vibe-modal-overlay")?.remove();
      try {
        if (perfilRow) {
          await dbQuery("perfil", { id: `eq.${state.session.user.id}` }, {
            method: "PATCH",
            body: { last_seen_update_version: latest.version },
          });
        } else {
          // Mesma corrida possível descrita em usageTracking.js: se outra
          // chamada já criou a linha entre o SELECT e este POST, cai pro PATCH.
          try {
            await dbQuery("perfil", {}, {
              method: "POST",
              body: { id: state.session.user.id, last_seen_update_version: latest.version },
            });
          } catch {
            await dbQuery("perfil", { id: `eq.${state.session.user.id}` }, {
              method: "PATCH",
              body: { last_seen_update_version: latest.version },
            });
          }
        }
      } catch {
        // se não salvar, o modal só volta a aparecer no próximo login — não é grave.
      }
    });
  } catch {
    // tabela update_logs/perfil pode não existir ainda em bancos sem a migração — ignora.
  }
}
