// Edge Function do Supabase (roda em Deno, hospedagem do próprio
// Supabase). Tem até 150 segundos de prazo no plano gratuito — bem mais
// que os ~30s de uma função serverless comum no Netlify — suficiente pra
// gerar um jogo inteiro com a IA sem cortar por tempo.
//
// Deploy: `supabase functions deploy ai-chat` (CLI), ou pelo painel do
// Supabase em Edge Functions → New Function, colando este código.
// Configure a secret GEMINI_API_KEY em Edge Functions → Secrets (ou
// `supabase secrets set GEMINI_API_KEY=sua-chave`).
//
// "Verify JWT" deve ficar LIGADO (é o padrão) — assim o próprio Supabase
// recusa automaticamente qualquer chamada sem uma sessão de login válida,
// sem precisar escrever essa checagem aqui.

const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
const GEMINI_FALLBACK_MODEL = Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite";

// Um pouco abaixo do teto de 150s da plataforma, pra sempre sobrar tempo
// de gerar e enviar a resposta antes do corte automático.
const TOTAL_BUDGET_MS = 140000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callGeminiWithRetry({
  apiKey,
  system,
  contents,
}: {
  apiKey: string;
  system: string;
  contents: unknown[];
}) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 32768,
      // Os modelos Gemini 3.x "pensam" antes de responder; por padrão o
      // nível é "high" (o mais lento). "low" prioriza velocidade — o que
      // basta aqui já que o prompt do sistema já guia bem o formato
      // esperado da resposta.
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
  const models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  const startedAt = Date.now();

  let lastErrorMessage = "Falha ao chamar a IA.";
  let lastStatus = 500;
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
        lastStatus = res.status;
        if (res.status === 503 || res.status === 429) continue; // sobrecarregado: tenta o próximo modelo
        return { error: lastErrorMessage, status: lastStatus };
      }
      const text = data.candidates?.[0]?.content?.parts?.map((p: { text: string }) => p.text).join("") || "";
      if (!text) {
        lastErrorMessage = "A IA não retornou conteúdo. Tente reformular o pedido.";
        continue;
      }
      if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
        return {
          error:
            "A resposta da IA foi cortada porque o jogo pedido ficou grande demais para o " +
            "limite de tokens. Tente pedir algo mais simples, ou dividir em etapas.",
          status: 422,
        };
      }
      return { text };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      lastErrorMessage = timedOut
        ? "A IA demorou demais para responder."
        : `Falha ao chamar a IA: ${(err as Error).message}`;
      lastStatus = timedOut ? 504 : 500;
    }
  }
  return {
    error: `${lastErrorMessage} (tente de novo em instantes, ou peça algo mais simples.)`,
    status: lastStatus,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return jsonResponse({ error: "GEMINI_API_KEY não configurada (Edge Functions → Secrets)." }, 500);

  let payload: { system?: string; history?: { role: string; text: string }[]; message?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }
  const { system = "", history = [], message } = payload;
  if (!message) return jsonResponse({ error: "Mensagem vazia." }, 400);

  const contents = [
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];

  const result = await callGeminiWithRetry({ apiKey, system, contents });
  if (result.error) return jsonResponse({ error: result.error }, result.status || 500);
  return jsonResponse({ text: result.text });
});
