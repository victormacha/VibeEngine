import { SYSTEM_PROMPT, buildUserTurn } from "./prompts.js";
import { auth, SUPABASE_URL } from "./supabaseClient.js";
import { isLocalHost, getDevKey, askForDevKey } from "./devMode.js";

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite"; // usado só se o principal estiver sobrecarregado

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Chama a Edge Function do Supabase (supabase/functions/ai-chat), que por
// sua vez chama a IA com a chave guardada como secret no servidor.
// Nenhuma chave passa pelo navegador. Edge Functions do Supabase têm até
// 150s de prazo no plano gratuito — bem mais que os ~30s de uma função
// serverless comum, suficiente pra gerar um jogo inteiro sem cortar por
// tempo, sem precisar de fila/polling.
//
// Em localhost, se a função não responder (ex: sem `supabase functions
// serve` rodando), cai automaticamente para uma chamada direta à Gemini
// com uma chave só de teste (sessionStorage). Isso NUNCA acontece fora de
// localhost.
export async function askAI({ userText, chatHistory, mechanics, sprites, onStatus }) {
  const session = await auth.ensureFreshSession();
  const hasExistingGame = chatHistory.some((m) => m.role === "model");
  const message = buildUserTurn(userText, { mechanics, sprites, hasExistingGame });

  // Só pra dar feedback de "ainda gerando..." pro usuário — não depende de
  // resposta nenhuma do servidor, é só o relógio local enquanto o fetch
  // único (sem fila) está em andamento.
  const tickStartedAt = Date.now();
  const tick = onStatus ? setInterval(() => onStatus(Math.round((Date.now() - tickStartedAt) / 1000)), 1000) : null;

  let functionMissing = false;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token || ""}`,
      },
      body: JSON.stringify({ system: SYSTEM_PROMPT, history: chatHistory, message }),
    });

    if (res.status === 404) functionMissing = true;
    else if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erro do servidor (${res.status})`);
    } else {
      const data = await res.json();
      return data.text;
    }
  } catch (err) {
    if (!isLocalHost()) throw err;
    functionMissing = true;
  } finally {
    if (tick) clearInterval(tick);
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
  //
  // Duas fontes, combinadas: (1) o próprio código do jogo já contém
  // `SPR.nome = { frames: [...], frameDuration }` (é o padrão de
  // inicialização que o prompt exige) — extraímos isso diretamente do HTML,
  // sem precisar que a IA mande uma segunda cópia. (2) o bloco separado
  // SPRITES_DATA, se vier, tem prioridade quando os dois trazem o mesmo
  // nome (é uma cópia "oficial", pensada pra ser mais limpa de parsear).
  // Extrair direto do HTML é o que garante que os sprites voltem pra engine
  // mesmo em jogos grandes, onde a IA às vezes fica sem orçamento de tokens
  // pra duplicar os dados no bloco separado — sem essa extração, esses
  // sprites simplesmente sumiam (o jogo funcionava, mas a aba Personagens
  // ficava vazia).
  const htmlSprites = extractEmbeddedSprites(code);

  let blockSprites = null;
  const spritesMatch = rawText.match(/<!--SPRITES_DATA([\s\S]*?)-->/i);
  if (spritesMatch) {
    try {
      const parsed = JSON.parse(spritesMatch[1].trim());
      if (parsed && typeof parsed === "object") blockSprites = parsed;
    } catch {
      // JSON malformado nesse bloco: ignora, ainda sobra o que veio do HTML.
    }
  }

  const combined = { ...htmlSprites, ...blockSprites };
  const sprites = Object.keys(combined).length ? combined : null;

  return { code, info, sprites };
}

// Varre o HTML gerado atrás de atribuições `SPR.nome = {...}` (ou
// `SPR["nome"] = {...}`) e devolve um objeto { nome: { frames, frameDuration } }
// com o que achou. Não usa eval/Function em nenhum momento — faz um
// balanceamento manual de chaves pra recortar o trecho, e uma transformação
// leve (aspas em chaves soltas, tipo `frames:` → `"frames":`) pra poder usar
// JSON.parse de forma segura. Qualquer trecho que não fechar direito ou não
// parsear é ignorado silenciosamente — nunca derruba o resto da importação.
function extractEmbeddedSprites(html) {
  const sprites = {};
  const assignRe = /SPR(?:\.(\w+)|\[["'](\w+)["']\])\s*=\s*/g;
  let m;
  while ((m = assignRe.exec(html))) {
    const name = m[1] || m[2];
    const start = assignRe.lastIndex;
    if (html[start] !== "{") continue; // só nos interessa `SPR.x = {...}` (objeto literal)

    let depth = 0;
    let inStr = false;
    let strCh = "";
    let i = start;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (ch === "\\") { i++; continue; }
        if (ch === strCh) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { inStr = true; strCh = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    if (depth !== 0) continue; // chave nunca fechou (HTML cortado ou algo estranho) — ignora

    const raw = html.slice(start, i);
    try {
      const jsonish = raw
        .replace(/'/g, '"')
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/,(\s*[}\]])/g, "$1");
      const parsed = JSON.parse(jsonish);
      if (parsed && Array.isArray(parsed.frames) && parsed.frames.length) {
        sprites[name] = { frames: parsed.frames, frameDuration: parsed.frameDuration || 150 };
      }
    } catch {
      // trecho não virou JSON válido mesmo depois da limpeza — pula esse sprite,
      // segue tentando os próximos matches do regex.
    }
    assignRe.lastIndex = i;
  }
  return sprites;
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
