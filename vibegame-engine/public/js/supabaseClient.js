// Cliente Supabase minimalista, feito com fetch puro (sem depender do
// pacote @supabase/supabase-js). Cobre só o que o VibeGame Engine usa:
// auth por e-mail/senha, sessão em localStorage e queries REST simples.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const SESSION_KEY = "vibegame_session";

export function isSupabaseConfigured() {
  return !SUPABASE_URL.includes("SEU-PROJETO") && !SUPABASE_ANON_KEY.includes("SUA-CHAVE");
}

function assertConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase não configurado ainda (public/js/config.js está com os valores de exemplo). " +
        "Use o modo de teste local na tela de login, ou configure o Supabase — veja o README."
    );
  }
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function authRequest(path, body) {
  assertConfigured();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Falha na autenticação.");
  return data;
}

export const auth = {
  async signUp(email, password) {
    const data = await authRequest("signup", { email, password });
    if (data.access_token) saveSession(data);
    return data;
  },
  async signIn(email, password) {
    const data = await authRequest("token?grant_type=password", { email, password });
    saveSession(data);
    return data;
  },
  async signOut() {
    const session = loadSession();
    if (session?.access_token) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      }).catch(() => {});
    }
    saveSession(null);
  },
  getSession() {
    return loadSession();
  },
  currentUser() {
    return loadSession()?.user ?? null;
  },
};

// Query genérica contra o PostgREST do Supabase, já autenticada com a
// sessão atual (ou anon, se deslogado). `filters` vira querystring PostgREST,
// ex: { select: "*", user_id: "eq.123" }.
export async function dbQuery(table, filters = {}, { method = "GET", body } = {}) {
  assertConfigured();
  const session = loadSession();
  const qs = new URLSearchParams(filters).toString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs ? `?${qs}` : ""}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Erro no banco (${table}): ${await res.text()}`);
  if (method === "GET" || method === "POST") return res.json();
  return null;
}
