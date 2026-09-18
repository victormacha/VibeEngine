// Função serverless (Netlify Function). Roda no servidor, então a
// GEMINI_API_KEY nunca é exposta ao navegador. Configure a variável de
// ambiente GEMINI_API_KEY no painel do Netlify (Site settings → Environment
// variables) antes do deploy.
//
// Também verifica (opcionalmente, se SUPABASE_URL/SUPABASE_ANON_KEY estiverem
// configuradas) que quem está chamando tem uma sessão Supabase válida, pra
// evitar que a chave da IA seja usada por gente de fora da engine.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// fetch com prazo próprio: sem isso, uma única chamada travada (Gemini
// demorando demais pra responder) consome sozinha todo o tempo que a
// função tinha pra tentar o modelo de reserva depois.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// Chama a Gemini com fallback pra um segundo modelo se o principal estiver
// sobrecarregado (503/429). O tempo total precisa caber dentro do limite
// de execução da função serverless (30s neste projeto) — por isso: uma
// tentativa por modelo (a troca de modelo já funciona como "a segunda
// chance"), sem atraso artificial entre elas, e um teto de tempo por
// chamada que não deixe uma única requisição travada consumir tudo.
async function callGeminiWithRetry({ apiKey, system, contents }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.85, maxOutputTokens: 16384 },
  };
  const models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  const delays = [0];

  let lastError = { status: 500, message: "Falha ao chamar a IA." };
  for (const model of models) {
    for (const delay of delays) {
      if (delay) await sleep(delay);
      try {
        const res = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
          12000
        );
        const data = await res.json();
        if (!res.ok) {
          lastError = { status: res.status, message: data.error?.message || "Erro na IA." };
          if (res.status === 503 || res.status === 429) continue;
          return { error: lastError };
        }
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
        if (!text) {
          lastError = { status: 502, message: "A IA não retornou conteúdo. Tente reformular o pedido." };
          continue;
        }
        if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
          return {
            error: {
              status: 422,
              message:
                "A resposta da IA foi cortada porque o jogo pedido ficou grande demais para o " +
                "limite de tokens. Tente pedir algo mais simples, ou dividir em etapas.",
            },
          };
        }
        return { text };
      } catch (err) {
        const timedOut = err.name === "AbortError";
        lastError = {
          status: timedOut ? 504 : 500,
          message: timedOut ? "A IA demorou demais para responder." : `Falha ao chamar a IA: ${err.message}`,
        };
      }
    }
  }
  return { error: { status: lastError.status, message: `${lastError.message} (todos os modelos estavam sobrecarregados — tente de novo em instantes.)` } };
}

async function verifySupabaseUser(authHeader) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey || !authHeader) return true; // verificação desligada se não configurada
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authHeader },
    });
    return res.ok;
  } catch {
    return true; // não bloqueia por falha de rede na verificação
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Método não permitido" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "GEMINI_API_KEY não configurada no servidor." }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  const authorized = await verifySupabaseUser(authHeader);
  if (!authorized) {
    return { statusCode: 401, body: JSON.stringify({ error: "Sessão inválida. Faça login novamente." }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido." }) };
  }

  const { system, history = [], message } = payload;
  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: "Mensagem vazia." }) };
  }

  // Converte o histórico { role: "user"|"model", text } pro formato da Gemini.
  const contents = [
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  try {
    const result = await callGeminiWithRetry({ apiKey, system, contents });
    if (result.error) {
      return { statusCode: result.error.status, body: JSON.stringify({ error: result.error.message }) };
    }
    return { statusCode: 200, body: JSON.stringify({ text: result.text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: `Falha ao chamar a IA: ${err.message}` }) };
  }
};
