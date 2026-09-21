import { state, loadProjectFromRow, loadLoreFromRow } from "./state.js";
import { requireSession, mountLoginScreen } from "./auth.js";
import { auth, dbQuery } from "./supabaseClient.js";
import { mountTabs, toast } from "./ui.js";
import { mountChatTab } from "./tabs/chatTab.js";
import { mountPixelEditorTab } from "./tabs/pixelEditorTab.js";
import { mountMechanicsTab } from "./tabs/mechanicsTab.js";
import { mountTestTab } from "./tabs/testTab.js";
import { mountBancaTab } from "./tabs/bancaTab.js";
import { mountAdminTab } from "./tabs/adminTab.js";
import { mountLoreTab } from "./tabs/loreTab.js";
import { mountPerfilTab } from "./tabs/perfilTab.js";
import { startUsageTracking, stopUsageTracking } from "./usageTracking.js";
import { maybeShowUpdateLog } from "./updateLog.js";
import { startTeamSync } from "./team.js";

const root = document.getElementById("app");

async function boot() {
  const existing = await requireSession();
  if (existing) startApp(existing);
  else mountLoginScreen(root, startApp);
}

// Traz de volta o projeto mais recente do aluno, se existir, pra ele
// continuar de onde parou em vez de começar do zero toda vez que abre a
// engine de novo. Inclui projetos onde o aluno é o DONO (user_id) ou o
// PARCEIRO de dupla (partner_id) — sem o "or" abaixo, quem entra numa
// dupla como parceiro nunca veria o projeto compartilhado, só quem criou.
async function loadOwnLastProject(userId) {
  try {
    const [row] = await dbQuery("games", {
      select: "*",
      or: `(user_id.eq.${userId},partner_id.eq.${userId})`,
      order: "updated_at.desc",
      limit: "1",
    });
    if (row) {
      loadProjectFromRow(row);
      toast(`Projeto retomado: ${row.title}`, "info");
      try {
        const [loreRow] = await dbQuery("lore", { select: "*", game_id: `eq.${row.id}` });
        if (loreRow) loadLoreFromRow(loreRow);
      } catch {
        // tabela lore pode não existir ainda em bancos antigos sem a migração — segue sem lore.
      }
      if (row.partner_id) startTeamSync({ onRemoteChange: () => renderShell() });
    }
  } catch {
    // Sem sorte (offline, tabela ainda não migrada, etc.) — segue com projeto em branco.
  }
}

async function startApp({ session, profile }) {
  state.session = session;
  state.profile = profile;
  if (profile?.role === "aluno" && session.user.id !== "dev-local") {
    await loadOwnLastProject(session.user.id);
  }
  renderShell();
  if (session.user.id !== "dev-local") {
    startUsageTracking(session.user.id);
    await maybeShowUpdateLog();
  }
}

function renderShell() {
  const role = state.profile?.role || "aluno";

  root.innerHTML = `
    <header class="topbar">
      <div class="brand">👾 <span>VibeGame Engine</span></div>
      <div class="user-box">
        <span class="role-badge role-${role}">${role}</span>
        <span>${state.session.user.email}</span>
        <button id="btn-logout" class="btn-ghost">Sair</button>
      </div>
    </header>
    <main id="tabs-root" class="tabs-root"></main>`;

  root.querySelector("#btn-logout").addEventListener("click", async () => {
    await stopUsageTracking({ flush: true });
    await auth.signOut();
    location.reload();
  });

  let testTabApi = null;
  let pixelTabApi = null;

  const tabs = [
    { id: "ia", icon: "💬", label: "IA", mount: (panel) => mountChatTab(panel, {
        onGameUpdated: () => {
          testTabApi?.render();
          pixelTabApi?.refresh();
        },
      }) },
    { id: "personagens", icon: "🎨", label: "Personagens", mount: (panel) => (pixelTabApi = mountPixelEditorTab(panel)) },
    { id: "mecanicas", icon: "⚙️", label: "Mecânicas", mount: mountMechanicsTab },
    { id: "lore", icon: "📜", label: "Lore", mount: mountLoreTab },
    { id: "perfil", icon: "🙍", label: "Perfil", mount: (panel) => mountPerfilTab(panel, { onProjectChanged: () => testTabApi?.render() }) },
    { id: "testar", icon: "🧪", label: "Testar", mount: (panel) => (testTabApi = mountTestTab(panel)) },
  ];

  if (role === "banca" || role === "admin") {
    tabs.push({ id: "banca", icon: "🏆", label: "Avaliação", mount: mountBancaTab });
  }
  if (role === "admin") {
    tabs.push({ id: "admin", icon: "🛠️", label: "Admin", mount: mountAdminTab });
  }

  mountTabs(root.querySelector("#tabs-root"), tabs, {
    onSwitch: (id) => {
      if (id === "testar") testTabApi?.render();
    },
  });
}

boot();
