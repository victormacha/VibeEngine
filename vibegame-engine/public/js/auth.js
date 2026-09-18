import { auth, dbQuery, isSupabaseConfigured } from "./supabaseClient.js";
import { isLocalHost } from "./devMode.js";

// Busca o perfil (nome + cargo) do usuário logado na tabela `profiles`.
// Cargo decide o que a pessoa vê no app: aluno | banca | admin.
export async function fetchProfile(userId) {
  const rows = await dbQuery("profiles", { select: "*", id: `eq.${userId}` });
  return rows[0] || null;
}

export async function requireSession() {
  const session = auth.getSession();
  if (!session) return null;
  const profile = await fetchProfile(session.user.id).catch(() => null);
  return { session, profile };
}

export function mountLoginScreen(root, onLoggedIn) {
  const configured = isSupabaseConfigured();
  const showDevBypass = isLocalHost();

  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <div class="auth-logo">👾 <span>VibeGame Engine</span></div>
        <p class="auth-sub">Crie jogos conversando com uma IA. Entre com sua conta da olimpíada.</p>
        ${!configured ? `<div class="auth-notice">Supabase ainda não configurado em <code>public/js/config.js</code> — o login abaixo não vai funcionar até isso ser feito (veja o README).</div>` : ""}
        <form id="auth-form">
          <label>E-mail</label>
          <input type="email" id="auth-email" required placeholder="voce@escola.com" />
          <label>Senha</label>
          <input type="password" id="auth-password" required minlength="6" placeholder="mínimo 6 caracteres" />
          <div id="auth-error" class="auth-error" hidden></div>
          <button type="submit" class="btn-primary" id="auth-submit">Entrar</button>
          <button type="button" class="btn-ghost" id="auth-toggle">Não tenho conta — criar agora</button>
        </form>
        ${showDevBypass ? `
        <div class="auth-dev">
          <p>Modo de teste local (sem Supabase) — só aparece em localhost:</p>
          <select id="dev-role">
            <option value="aluno">Entrar como aluno</option>
            <option value="banca">Entrar como banca</option>
            <option value="admin">Entrar como admin</option>
          </select>
          <button type="button" class="btn-ghost" id="dev-enter">🧪 Entrar em modo teste</button>
        </div>` : ""}
      </div>
    </div>`;

  let mode = "signin";
  const form = root.querySelector("#auth-form");
  const toggle = root.querySelector("#auth-toggle");
  const errBox = root.querySelector("#auth-error");
  const submitBtn = root.querySelector("#auth-submit");

  toggle.addEventListener("click", () => {
    mode = mode === "signin" ? "signup" : "signin";
    submitBtn.textContent = mode === "signin" ? "Entrar" : "Criar conta";
    toggle.textContent = mode === "signin" ? "Não tenho conta — criar agora" : "Já tenho conta — entrar";
    errBox.hidden = true;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Aguarde...";
    const email = root.querySelector("#auth-email").value.trim();
    const password = root.querySelector("#auth-password").value;
    try {
      const data = mode === "signin" ? await auth.signIn(email, password) : await auth.signUp(email, password);
      if (mode === "signup") {
        // Cria a linha de perfil padrão (cargo "aluno") na primeira vez.
        await dbQuery("profiles", {}, { method: "POST", body: { id: data.user.id, email, role: "aluno" } }).catch(() => {});
      }
      const profile = await fetchProfile(data.user.id).catch(() => ({ role: "aluno" }));
      onLoggedIn({ session: data, profile });
    } catch (err) {
      errBox.hidden = false;
      errBox.textContent = err.message;
      submitBtn.disabled = false;
      submitBtn.textContent = mode === "signin" ? "Entrar" : "Criar conta";
    }
  });

  if (showDevBypass) {
    root.querySelector("#dev-enter").addEventListener("click", () => {
      const role = root.querySelector("#dev-role").value;
      onLoggedIn({
        session: { user: { id: "dev-local", email: `dev-${role}@local.test` } },
        profile: { id: "dev-local", role },
      });
    });
  }
}
