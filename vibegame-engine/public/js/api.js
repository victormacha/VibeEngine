import { SYSTEM_PROMPT, buildUserTurn } from "./prompts.js";
import { auth, dbQuery } from "./supabaseClient.js";
import { isLocalHost, getDevKey, askForDevKey } from "./devMode.js";

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite"; // usado só se o principal estiver sobrecarregado

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// A geração roda numa função em BACKGROUND do Netlify (até 15 minutos, em
// vez do teto de ~30s de uma função normal), porque um jogo completo pode
// legitimamente demorar mais que isso. Uma função em background responde
// 202 assim que começa e NÃO devolve o resultado direto — por isso o fluxo
// aqui é: cria uma linha "pending" na tabela ai_jobs, dispara a função
// (sem esperar o corpo da resposta), e fica perguntando ("polling") pra
// essa mesma linha até aparecer "done" ou "error". Ver
// functions/ai-chat-background.js pro lado do servidor desse fluxo.
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 150000; // um pouco acima do orçamento de 120s da função, pra folga

export async function askAI({ userText, chatHistory, mechanics, sprites, onStatus }) {
  const session = auth.getSession();
  const hasExistingGame = chatHistory.some((m) => m.role === "model");
  const message = buildUserTurn(userText, { mechanics, sprites, hasExistingGame });

  let functionMissing = false;
  try {
    if (!session?.user?.id) throw new Error("Sessão expirada. Faça login novamente.");
    const jobId = crypto.randomUUID();

    // 1) Cria o job como "pending" — assim o navegador já tem o que
    // consultar mesmo antes da função em background terminar de subir.
    await dbQuery("ai_jobs", {}, { method: "POST", body: { id: jobId, user_id: session.user.id, status: "pending" } });

    // 2) Dispara a função em background. Não precisa (nem adianta) esperar
    // o corpo da resposta — o Netlify já respondeu 202 e a função continua
    // rodando sozinha do outro lado.
    const startRes = await fetch("/.netlify/functions/ai-chat-background", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ jobId, system: SYSTEM_PROMPT, history: chatHistory, message }),
    });
    if (startRes.status === 404) functionMissing = true;
    else {
      // 3) Fica perguntando pro Supabase se o job já terminou.
      const startedAt = Date.now();
      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await sleep(POLL_INTERVAL_MS);
        const elapsedS = Math.round((Date.now() - startedAt) / 1000);
        onStatus?.(elapsedS);
        const rows = await dbQuery("ai_jobs", { select: "status,result,error", id: `eq.${jobId}` });
        const job = rows[0];
        if (!job) continue; // ainda não visível pra leitura — tenta de novo
        if (job.status === "done") return job.result;
        if (job.status === "error") throw new Error(job.error || "Falha ao chamar a IA.");
        // status "pending": continua esperando.
      }
      throw new Error("A IA demorou demais para responder (mais de 2 minutos). Tente de novo, ou peça algo mais simples.");
    }
  } catch (err) {
    if (!isLocalHost()) throw err;
    functionMissing = true;
  }

  if (functionMissing && isLocalHost()) {
    return askGeminiDirect({ system: SYSTEM_PROMPT, history: chatHistory, message });
  }
  throw new Error("Não foi possível falar com a IA.");
}

// Só usado em localhost como atalho de teste — chama a Gemini direto do
// navegador com uma chave temporária (nunca use isso em produção).
// Tenta com retry/backoff quando a Gemini responde "sobrecarregado" (503),
// e cai pro modelo de reserva se o principal continuar indisponível.
async function askGeminiDirect({ system, history, message }) {
  let key = getDevKey();
  if (!key) key = askForDevKey();
  if (!key) throw new Error("É preciso colar uma chave da Gemini para testar localmente.");

  const contents = [
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.85, maxOutputTokens: 32768 },
  };

  const models = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  const delays = [0, 1500, 3500]; // 3 tentativas por modelo

  let lastError;
  let overloadOnly = true; // vira false se o motivo de parar não foi sobrecarga

  outer: for (const model of models) {
    for (const delay of delays) {
      if (delay) await sleep(delay);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        );
        const data = await res.json();
        if (!res.ok) {
          lastError = new Error(data.error?.message || `Erro na IA (${res.status}).`);
          if (res.status === 503 || res.status === 429) continue; // sobrecarregado: tenta de novo
          overloadOnly = false;
          break outer; // outros erros (ex: chave inválida) não valem retry
        }
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
        if (data.candidates?.[0]?.finishReason === "MAX_TOKENS") {
          lastError = new Error(
            "A resposta da IA foi cortada porque o jogo pedido ficou grande demais para o limite " +
              "de tokens. Tente pedir algo mais simples, ou dividir em etapas (ex: primeiro só a " +
              "mecânica principal, depois peça para adicionar sons e efeitos)."
          );
          overloadOnly = false;
          break outer; // não adianta tentar de novo com o mesmo pedido
        }
        if (!text) {
          lastError = new Error("A IA não retornou conteúdo. Tente reformular o pedido.");
          continue;
        }
        return text;
      } catch (err) {
        lastError = err;
      }
    }
  }
  const suffix = overloadOnly ? ` (tentei ${models.length} modelos, todos sobrecarregados — espere um pouco e tente de novo.)` : "";
  throw new Error(`${lastError?.message || "Falha ao chamar a IA."}${suffix}`);
}

// Extrai o bloco de código HTML e a ficha técnica GAME_INFO da resposta bruta.
// A IA nem sempre devolve exatamente no formato pedido (às vezes esquece as
// cercas de markdown, às vezes bagunça a ordem), então usamos várias
// estratégias em cascata até achar algo que pareça um documento HTML válido.
export function parseAIResponse(rawText) {
  let code = extractHtmlCode(rawText);
  const truncated = !/<\/html\s*>/i.test(code);
  if (truncated) {
    throw new Error(
      "A resposta da IA veio incompleta (sem fechar o HTML) — provavelmente o jogo pedido " +
        "ficou grande demais. Tente pedir algo mais simples, ou dividir em etapas."
    );
  }

  const infoMatch = rawText.match(/<!--GAME_INFO([\s\S]*?)-->/i);
  let info = null;
  if (infoMatch) {
    info = {};
    infoMatch[1].split("\n").forEach((line) => {
      const m = line.match(/^\s*([\w]+)\s*:\s*(.+)$/);
      if (m) info[m[1].trim()] = m[2].trim();
    });
  }

  // Sprites que a IA desenhou por conta própria (matriz de pixels), pra
  // importar direto na galeria da aba Personagens.
  let sprites = null;
  const spritesMatch = rawText.match(/<!--SPRITES_DATA([\s\S]*?)-->/i);
  if (spritesMatch) {
    try {
      const parsed = JSON.parse(spritesMatch[1].trim());
      if (parsed && typeof parsed === "object") sprites = parsed;
    } catch {
      // JSON malformado: ignora silenciosamente, o jogo em si ainda funciona.
    }
  }

  return { code, info, sprites };
}

function extractHtmlCode(rawText) {
  // 1) Bloco cercado com ```html ... ``` (ou ``` ... ``` genérico).
  let m = rawText.match(/```html\s*([\s\S]*?)```/i) || rawText.match(/```\s*([\s\S]*?)```/);
  if (m && /<html|<!doctype/i.test(m[1])) return m[1].trim();

  // 2) Sem cercas (ou cercas quebradas): pega do <!DOCTYPE.../<html> até o </html>.
  const start = rawText.search(/<!doctype html/i);
  const startAlt = start === -1 ? rawText.search(/<html[\s>]/i) : start;
  const endTag = rawText.search(/<\/html\s*>/i);
  if (startAlt !== -1 && endTag !== -1 && endTag > startAlt) {
    return rawText.slice(startAlt, endTag + "</html>".length).trim();
  }

  // 3) Último recurso: usa a resposta inteira, mas limpa cercas de markdown
  // soltas que sobraram (```html, ``` isolado) pra não virar texto visível.
  return rawText.replace(/```html/gi, "").replace(/```/g, "").trim();
}
