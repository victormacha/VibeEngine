// Cliente Supabase minimalista, feito com fetch puro (sem depender do
// pacote @supabase/supabase-js). Cobre só o que o VibeGame Engine usa:
// auth por e-mail/senha, sessão em localStorage e queries REST simples.
import { SUPABASE_URL as RAW_SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Tira barra(s) no final da URL — um "/" sobrando em config.js (fácil de
// digitar sem querer) faz toda chamada virar "...co//auth/v1/..." e o
// Supabase devolve 404 pra rota com barra dupla, com um erro difícil de
// entender. Resolver aqui uma vez é mais seguro que confiar que ninguém
// nunca vai colar a URL com "/" no fim.
const SUPABASE_URL = RAW_SUPABASE_URL.replace(/\/+$/, "");

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
  const data = await res.json().catch(() => ({}));
  // O Supabase usa nomes de campo diferentes dependendo de QUEM recusou o
  // pedido: o gateway Kong na frente (chave inválida/faltando) devolve
  // `message`/`hint`; o GoTrue (auth de verdade) devolve `error_description`,
  // `msg` ou `error`. Checar só um desses fazia erros reais virarem uma
  // mensagem genérica e inútil.
  if (!res.ok) {
    const reason = data.error_description || data.msg || data.error || data.message || data.hint;
    throw new Error(reason ? `${reason}` : `Falha na autenticação (HTTP ${res.status}).`);
  }
  return data;
}

// Renova a sessão sozinho quando o token estiver perto de vencer (o
// Supabase expira o access_token depois de ~1h por padrão). Sem isso,
// qualquer pessoa com a aba aberta por muito tempo (bem comum numa prova
// com banca avaliando por um bom tempo) começa a ver "JWT expired" do
// nada. `expires_at` vem em segundos desde epoch; renovamos com uma folga
// de 1 minuto antes do vencimento real.
async function ensureFreshSession() {
  const session = loadSession();
  if (!session?.refresh_token) return session;
  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  if (expiresAtMs && expiresAtMs - Date.now() > 60000) return session;
  try {
    const fresh = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
    saveSession(fresh);
    return fresh;
  } catch {
    return session; // falhou em renovar: segue com o que tem (vai dar erro claro adiante, se preciso)
  }
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
  // Versão que renova o token se estiver perto de vencer — use esta antes
  // de qualquer chamada autenticada que possa demorar, já que getSession()
  // sozinho pode devolver um token prestes a expirar.
  ensureFreshSession,
  currentUser() {
    return loadSession()?.user ?? null;
  },
};

// URL já limpa (sem barra sobrando), pra quem precisar montar outras
// chamadas diretas à API do Supabase (ex: a Edge Function de IA em api.js).
export { SUPABASE_URL };

// Query genérica contra o PostgREST do Supabase, já autenticada com a
// sessão atual (renovando o token sozinho se estiver perto de vencer).
// `filters` vira querystring PostgREST, ex: { select: "*", user_id: "eq.123" }.
export async function dbQuery(table, filters = {}, { method = "GET", body } = {}) {
  assertConfigured();
  const session = await ensureFreshSession();
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
