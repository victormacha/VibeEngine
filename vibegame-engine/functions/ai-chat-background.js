// Função em BACKGROUND do Netlify: qualquer arquivo terminado em
// "-background.js" ganha até 15 MINUTOS pra rodar (em vez do teto de ~30s
// de uma função normal), porque gerar um jogo inteiro com IA pode
// legitimamente passar disso — principalmente pedidos mais elaborados.
//
// A troca é que o Netlify responde 202 pro navegador assim que a chamada
// começa, e o que essa função "retorna" no final NUNCA chega no navegador.
// Por isso ela grava o resultado direto na tabela `ai_jobs` do Supabase
// (usando o token de quem pediu, respeitando as políticas de RLS — sem
// precisar de nenhuma chave nova de servidor), e o navegador fica
// consultando essa tabela ("polling") até o job aparecer como pronto.
// Ver public/js/api.js (função askAI) pro lado do cliente desse fluxo.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

// Aqui dentro o teto é bem mais folgado (até 15 minutos de verdade), mas
// ainda vale ter um limite: sem ele, um pedido preso na Gemini deixaria o
// job "pending" pra sempre e o navegador ficaria esperando até desistir
// sozinho (ver POLL_TIMEOUT_MS em api.js).
const TOTAL_BUDGET_MS = 120000; // 2 minutos

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callGeminiWithRetry({ apiKey, system, contents }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 32768,
      // "low" evita que o modelo gaste um tempo enorme "pensando" antes de
      // começar a escrever — ver histórico de commits pra mais contexto.
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
  const models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  const startedAt = Date.now();

  let lastErrorMessage = "Falha ao chamar a IA.";
  for (const model of models) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < 5000) break; // não sobrou tempo útil pra outra tentativa
    try {
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        remaining
      );
      const data = await res.json();
      if (!res.ok) {
        lastErrorMessage = data.error?.message || "Erro na IA.";
        if (res.status === 503 || res.status === 429) continue; // sobrecarregado: tenta o próximo modelo
        return { error: lastErrorMessage };
      }
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      if (!text) {
        lastErrorMessage = "A IA não retornou conteúdo. Tente reformular o pedido.";
        continue;
      }
      if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
        return {
          error:
            "A resposta da IA foi cortada porque o jogo pedido ficou grande demais para o " +
            "limite de tokens. Tente pedir algo mais simples, ou dividir em etapas.",
        };
      }
      return { text };
    } catch (err) {
      const timedOut = err.name === "AbortError";
      lastErrorMessage = timedOut ? "A IA demorou demais para responder." : `Falha ao chamar a IA: ${err.message}`;
    }
  }
  return { error: `${lastErrorMessage} (tente de novo em instantes, ou peça algo mais simples.)` };
}

// Grava o resultado (ou erro) na linha do job, usando o token de quem
// pediu — a política de RLS "usuário atualiza os próprios jobs" garante
// que isso só funciona pro dono do job (ver supabase/schema.sql).
async function writeJobResult({ supabaseUrl, authHeader, jobId, patch }) {
  if (!supabaseUrl || !authHeader) return; // sem sessão não tem como gravar o resultado
  const url = supabaseUrl.replace(/\/+$/, "");
  await fetch(`${url}/rest/v1/ai_jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_ANON_KEY || "",
      Authorization: authHeader,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

exports.handler = async (event) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const authHeader = event.headers.authorization || event.headers.Authorization;

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return; // corpo inválido: sem jobId, não tem nem onde gravar um erro
  }
  const { jobId, system, history = [], message } = payload;
  if (!jobId) return;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    await writeJobResult({
      supabaseUrl,
      authHeader,
      jobId,
      patch: { status: "error", error: "GEMINI_API_KEY não configurada no servidor." },
    });
    return;
  }

  const contents = [
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  try {
    const result = await callGeminiWithRetry({ apiKey, system, contents });
    if (result.error) {
      await writeJobResult({ supabaseUrl, authHeader, jobId, patch: { status: "error", error: result.error } });
    } else {
      await writeJobResult({ supabaseUrl, authHeader, jobId, patch: { status: "done", result: result.text } });
    }
  } catch (err) {
    await writeJobResult({
      supabaseUrl,
      authHeader,
      jobId,
      patch: { status: "error", error: `Falha ao chamar a IA: ${err.message}` },
    });
  }
};
