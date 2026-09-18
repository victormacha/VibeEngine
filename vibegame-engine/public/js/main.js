import { state } from "./state.js";
import { requireSession, mountLoginScreen } from "./auth.js";
import { auth } from "./supabaseClient.js";
import { mountTabs } from "./ui.js";
import { mountChatTab } from "./tabs/chatTab.js";
import { mountPixelEditorTab } from "./tabs/pixelEditorTab.js";
import { mountMechanicsTab } from "./tabs/mechanicsTab.js";
import { mountTestTab } from "./tabs/testTab.js";
import { mountBancaTab } from "./tabs/bancaTab.js";

const root = document.getElementById("app");

async function boot() {
  const existing = await requireSession();
  if (existing) startApp(existing);
  else mountLoginScreen(root, startApp);
}

function startApp({ session, profile }) {
  state.session = session;
  state.profile = profile;
  renderShell();
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
    { id: "testar", icon: "🧪", label: "Testar", mount: (panel) => (testTabApi = mountTestTab(panel)) },
  ];

  if (role === "banca" || role === "admin") {
    tabs.push({ id: "banca", icon: "🏆", label: "Avaliação", mount: mountBancaTab });
  }

  mountTabs(root.querySelector("#tabs-root"), tabs, {
    onSwitch: (id) => {
      if (id === "testar") testTabApi?.render();
    },
  });
}

boot();
