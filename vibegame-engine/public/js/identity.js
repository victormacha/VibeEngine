// Tela de identificação do aluno: na primeira vez que entra (ou enquanto
// não tiver preenchido), o aluno informa o NOME e o ANO (2º ou 3º). Fica na
// tabela `perfil` (colunas nome_aluno/ano, ver supabase/schema.sql) e não em
// `profiles` de propósito: em `profiles` só o admin pode editar — liberar o
// aluno a editar a própria linha ali deixaria ele trocar o próprio cargo.
import { state } from "./state.js";
import { dbQuery } from "./supabaseClient.js";
import { openModal } from "./ui.js";

const ANOS = ["2", "3"];

function escapeAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Junta espaços e capitaliza cada palavra ("ana  CLARA silva" -> "Ana Clara Silva"),
// mantendo preposições minúsculas ("de", "da", "dos"...).
function normalizeName(raw) {
  const minusculas = new Set(["de", "da", "das", "do", "dos", "e"]);
  return raw.trim().replace(/\s+/g, " ").toLowerCase().split(" ")
    .map((w, i) => (i > 0 && minusculas.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

async function saveIdentity(userId, nome, ano) {
  const body = { nome_aluno: nome, ano };
  const [row] = await dbQuery("perfil", { select: "id", id: `eq.${userId}` });
  if (row) {
    await dbQuery("perfil", { id: `eq.${userId}` }, { method: "PATCH", body });
    return;
  }
  // Mesma corrida possível descrita em usageTracking.js: se outra chamada
  // criou a linha entre o SELECT e este POST, o PATCH cobre.
  try {
    await dbQuery("perfil", {}, { method: "POST", body: { id: userId, ...body } });
  } catch {
    await dbQuery("perfil", { id: `eq.${userId}` }, { method: "PATCH", body });
  }
}

// Resolve quando o aluno já tem nome e ano (cadastrados agora ou antes).
// Deixa o resultado em state.identity = { nome, ano }.
export async function ensureStudentIdentity() {
  const userId = state.session?.user?.id;
  if (!userId || userId === "dev-local") return;

  let row;
  try {
    [row] = await dbQuery("perfil", { select: "nome_aluno,ano", id: `eq.${userId}` });
  } catch (err) {
    // Banco sem as colunas novas (schema.sql ainda não aplicado): não trava o
    // aluno fora da engine por causa disso — segue sem a tela.
    console.warn("Identificação do aluno indisponível:", err.message);
    return;
  }
  if (row?.nome_aluno && ANOS.includes(row.ano)) {
    state.identity = { nome: row.nome_aluno, ano: row.ano };
    return;
  }

  await new Promise((resolve) => {
    openModal(
      `
      <h2>👋 Antes de começar</h2>
      <p class="hint">Conta pra gente quem é você — é assim que a banca vai te identificar.</p>
      <form id="identity-form" class="identity-form" novalidate>
        <label for="identity-name">Seu nome completo</label>
        <input type="text" id="identity-name" autocomplete="name" maxlength="80"
               placeholder="ex: Ana Clara Souza" value="${escapeAttr(row?.nome_aluno)}" />
        <label>Seu ano</label>
        <div class="identity-years" role="radiogroup">
          ${ANOS.map((a) => `<button type="button" class="identity-year${row?.ano === a ? " selected" : ""}" data-ano="${a}" role="radio" aria-checked="${row?.ano === a}">${a}º ano</button>`).join("")}
        </div>
        <p id="identity-error" class="identity-error" hidden></p>
        <button type="submit" id="identity-save" class="btn-primary">Continuar</button>
      </form>`,
      { dismissible: false }
    );

    const form = document.getElementById("identity-form");
    const nameInput = document.getElementById("identity-name");
    const errorEl = document.getElementById("identity-error");
    const saveBtn = document.getElementById("identity-save");
    let ano = ANOS.includes(row?.ano) ? row.ano : null;
    let falhas = 0;

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }

    form.querySelectorAll(".identity-year").forEach((btn) => {
      btn.addEventListener("click", () => {
        ano = btn.dataset.ano;
        form.querySelectorAll(".identity-year").forEach((b) => {
          b.classList.toggle("selected", b === btn);
          b.setAttribute("aria-checked", String(b === btn));
        });
        errorEl.hidden = true;
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nome = normalizeName(nameInput.value);
      if (nome.length < 3 || !/\p{L}{2,}/u.test(nome)) return showError("Escreva o seu nome (pelo menos nome e sobrenome, de preferência).");
      if (!ano) return showError("Escolha se você é do 2º ou do 3º ano.");

      saveBtn.disabled = true;
      saveBtn.textContent = "Salvando...";
      try {
        await saveIdentity(userId, nome, ano);
        state.identity = { nome, ano };
        document.querySelector(".vibe-modal-overlay")?.remove();
        resolve();
      } catch {
        falhas += 1;
        saveBtn.disabled = false;
        saveBtn.textContent = "Tentar de novo";
        showError("Não deu pra salvar agora (internet?). Tente de novo.");
        // nunca prende o aluno fora da engine: depois de 2 falhas, deixa seguir
        if (falhas >= 2 && !document.getElementById("identity-skip")) {
          const skip = document.createElement("button");
          skip.type = "button";
          skip.id = "identity-skip";
          skip.className = "btn-ghost";
          skip.textContent = "Continuar sem salvar (pergunto de novo no próximo login)";
          skip.addEventListener("click", () => {
            state.identity = { nome, ano };
            document.querySelector(".vibe-modal-overlay")?.remove();
            resolve();
          });
          form.appendChild(skip);
        }
      }
    });

    nameInput.focus();
  });
}
