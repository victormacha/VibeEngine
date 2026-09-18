import { auth, dbQuery, isSupabaseConfigured } from "./supabaseClient.js";
import { isLocalHost } from "./devMode.js";

// Busca o perfil (nome + cargo) do usuário logado na tabela `profiles`.
// Cargo decide o que a pessoa vê no app: aluno | banca | admin.
export async function fetchProfile(userId) {
  const rows = await dbQuery("profiles", { select: "*", id: `eq.${userId}` });
  return rows[0] || null;
}

// Garante que existe uma linha em `profiles` pro usuário logado, criando
// com cargo "aluno" se ainda não existir. Isso cobre tanto o cadastro
// normal quanto contas que ficaram "órfãs" (usuário criado no Auth, mas
// sem perfil) por causa de alguma falha no meio do cadastro anterior.
async function ensureProfile(user, email) {
  const existing = await fetchProfile(user.id).catch(() => null);
  if (existing) return existing;
  await dbQuery("profiles", {}, { method: "POST", body: { id: user.id, email, role: "aluno" } }).catch(() => {});
  return await fetchProfile(user.id).catch(() => ({ role: "aluno" }));
}

export async function requireSession() {
  const session = auth.getSession();
  if (!session) return null;
  const profile = await ensureProfile(session.user, session.user.email).catch(() => null);
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

      // Se o Supabase estiver configurado para exigir confirmação por
      // e-mail, o signup NÃO devolve sessão nem usuário logado ainda —
      // devolve só o registro do usuário criado (ou, em algumas versões,
      // um objeto {id: ...} solto). Detectar isso aqui evita quebrar
      // tentando ler `.user.id` de algo que não é uma sessão.
      const user = data?.user ?? (data?.id ? data : null);
      if (!data?.access_token || !user) {
        errBox.hidden = false;
        errBox.className = "auth-error auth-info";
        errBox.textContent = mode === "signup"
          ? "Conta criada! Verifique seu e-mail e clique no link de confirmação antes de entrar. (Se seu professor desativou a confirmação por e-mail no Supabase, tente entrar de novo em alguns segundos.)"
          : "Sua conta ainda não foi confirmada — verifique seu e-mail antes de entrar.";
        submitBtn.disabled = false;
        submitBtn.textContent = mode === "signin" ? "Entrar" : "Criar conta";
        return;
      }

      if (mode === "signup") {
        // Cria a linha de perfil padrão (cargo "aluno") na primeira vez.
        await dbQuery("profiles", {}, { method: "POST", body: { id: user.id, email, role: "aluno" } }).catch(() => {});
      }
      const profile = mode === "signup"
        ? await fetchProfile(user.id).catch(() => ({ role: "aluno" }))
        : await ensureProfile(user, email).catch(() => ({ role: "aluno" }));
      onLoggedIn({ session: data, profile });
    } catch (err) {
      errBox.hidden = false;
      errBox.className = "auth-error";
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
