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
export async function askAI({ userText, chatHistory, mechanics, sprites, lore, hasBackground, currentCode, mechanicsCustomized, maps, onStatus }) {
  const hasExistingGame = chatHistory.some((m) => m.role === "model");
  const message = buildUserTurn(userText, {
    mechanics, sprites, hasExistingGame, lore, hasBackground, currentCode, mechanicsCustomized, maps,
  });
  // Enxuga o histórico ANTES de enviar (ver slimHistoryForApi) — o código
  // completo do jogo atual já vai na mensagem acima, então repetir o HTML
  // inteiro de cada resposta anterior no histórico é só custo de token à
  // toa (e cresce a cada volta de conversa, sem limite).
  return callAIRaw({ system: SYSTEM_PROMPT, history: slimHistoryForApi(chatHistory), message, onStatus });
}

// Numa conversa longa, cada resposta anterior do "model" contém um jogo
// HTML inteiro (podem ser vários KB). Reenviar TODAS as versões anteriores
// a cada nova mensagem é o maior gasto de token deste app — e é
// desnecessário, porque buildUserTurn() já anexa o código ATUAL na
// mensagem mais recente (ver "currentCode" acima). Aqui a gente troca cada
// resposta antiga por um resumo de uma linha (extraído do GAME_INFO dela),
// só pra IA saber que ali houve uma versão anterior, sem pagar o custo de
// reler o HTML inteiro dela de novo. As mensagens do aluno (role "user")
// são só o texto do pedido — já são curtas, não precisam de enxugamento.
function slimHistoryForApi(chatHistory) {
  return chatHistory.map((m) => {
    if (m.role !== "model") return m;
    const infoMatch = m.text.match(/<!--GAME_INFO([\s\S]*?)-->/i);
    const summary = infoMatch
      ? infoMatch[1].trim().replace(/\s*\n\s*/g, " · ")
      : "jogo gerado, sem ficha técnica reconhecida";
    return {
      role: "model",
      text: `[Essa resposta gerou um jogo completo em HTML — resumo da ficha técnica: ${summary}. ` +
        `Essa versão JÁ FOI SUBSTITUÍDA; o código vigente vem anexado na mensagem mais recente do aluno.]`,
    };
  });
}

// Chamada de baixo nível pra IA, sem nenhum contrato de "responder um
// jogo em HTML" — usada tanto por askAI (que monta o `message` a partir
// do pedido do aluno) quanto por qualquer outro uso que só precise de
// texto livre de volta (ex.: geração simples de Lore, ver loreTab.js).
// Mantém toda a lógica de proxy seguro / fallback local já existente.
export async function callAIRaw({ system, history, message, onStatus }) {
  const session = await auth.ensureFreshSession();

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
      body: JSON.stringify({ system, history, message }),
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
    return askGeminiDirect({ system, history, message });
  }
  throw new Error("Não foi possível falar com a IA.");
}

// Prompt simples e direto pra gerar uma lore mínima quando o aluno deixa
// a aba Lore em branco. De propósito curta ("simples", como pedido) — não
// é pra competir com o que o aluno escreveria, é só um placeholder
// honesto, e por isso mesmo o app marca `ai_generated = true` nesse caso
// e avisa a banca (ver loreTab.js e tabs/bancaTab.js).
export async function generateSimpleLore({ genre, mechanics }) {
  const system =
    "Você escreve lores CURTAS e SIMPLES (4 a 6 frases) para jogos escolares. " +
    "Sem firulas, sem markdown, só texto corrido em português, cobrindo: onde a história " +
    "se passa, quem é o protagonista, um antagonista/ameaça simples, e o objetivo geral.";
  const message =
    `Gênero do jogo: ${genre || "não definido"}. ` +
    `Ambientação: ${mechanics?.cenario || "não definida"}. ` +
    "Escreva uma lore simples pra esse jogo.";
  const text = await callAIRaw({ system, history: [], message });
  return text.trim();
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
      if (parsed && typeof parsed === "object") {
        blockSprites = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, expandCompactSprite(v)]));
      }
    } catch {
      // JSON malformado nesse bloco: ignora, ainda sobra o que veio do HTML.
    }
  }

  const combined = { ...htmlSprites, ...blockSprites };
  const sprites = Object.keys(combined).length ? combined : null;

  // Mapas (`if (!MAPAS.fase1) MAPAS.fase1 = { tile, legenda, linhas }`),
  // mesmo esquema de extração dos sprites — vão pra aba Mapas.
  const maps = extractEmbeddedMaps(code);

  return { code, info, sprites, maps: Object.keys(maps).length ? maps : null };
}

// Recorta todos os objetos literais atribuídos a `PREFIXO.nome = {...}` (ou
// `PREFIXO["nome"] = {...}`) e devolve [{ name, raw }] com o texto de cada um.
// Balanceamento manual de chaves (respeitando strings) — sem eval.
function sliceAssignedObjects(html, prefix) {
  const out = [];
  const assignRe = new RegExp(`${prefix}(?:\\.(\\w+)|\\[["'](\\w+)["']\\])\\s*=\\s*`, "g");
  let m;
  while ((m = assignRe.exec(html))) {
    const name = m[1] || m[2];
    const start = assignRe.lastIndex;
    if (html[start] !== "{") continue;
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
    if (depth !== 0) continue;
    out.push({ name, raw: html.slice(start, i) });
    assignRe.lastIndex = i;
  }
  return out;
}

// Converte um objeto literal JS "simples" (chaves sem aspas, aspas simples,
// vírgula sobrando) em JSON. Diferente da limpeza dos sprites, aqui as
// strings são preservadas exatamente: linhas de mapa usam símbolos como
// "#", "=", "^" e ":" que uma troca por regex no texto inteiro estragaria.
function looseObjectToJson(raw) {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let str = "";
      while (j < raw.length && raw[j] !== ch) {
        if (raw[j] === "\\" && j + 1 < raw.length) { str += raw[j] + raw[j + 1]; j += 2; continue; }
        str += raw[j];
        j++;
      }
      // reescreve sempre com aspas duplas
      out += '"' + str.replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"') + '"';
      i = j + 1;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(raw.slice(i));
    if (ident) {
      const after = raw.slice(i + ident[0].length);
      if (/^\s*:/.test(after)) out += `"${ident[0]}"`;
      else out += ident[0];
      i += ident[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function extractEmbeddedMaps(html) {
  const maps = {};
  sliceAssignedObjects(html, "MAPAS").forEach(({ name, raw }) => {
    try {
      const parsed = JSON.parse(looseObjectToJson(raw));
      if (parsed && Array.isArray(parsed.linhas) && parsed.linhas.length && parsed.linhas.every((l) => typeof l === "string")) {
        maps[name] = { tile: Number(parsed.tile || parsed.tamanho) || 32, legenda: parsed.legenda || {}, linhas: parsed.linhas };
      }
    } catch {
      // mapa que não virou JSON — ignora só ele
    }
  });
  return maps;
}

// "✨ Gerar fase com IA" da aba Mapas: pede SÓ o mapa (sem jogo inteiro),
// então é rápido e barato. Devolve { tile, legenda, linhas } já limpo:
// linhas do tamanho pedido, caracteres fora da legenda viram vazio e no
// máximo um jogador.
export async function generateMapWithAI({ descricao, cols, rows, legenda, tile, genero, lore }) {
  const legendaTxt = Object.entries(legenda)
    .map(([ch, d]) => `"${ch}" = ${d.tipo}${d.nome ? ` (${d.nome})` : ""}`)
    .join("\n");
  const system =
    "Você é um level designer de jogos 2D. Responda SOMENTE com um objeto JSON " +
    '{"linhas": [...]} — nada de texto antes ou depois, nada de markdown. ' +
    "Cada item de linhas é uma string; cada caractere é uma célula do mapa; \".\" = vazio. " +
    "Use apenas os caracteres da legenda informada. Regras de bom design: o jogador (tipo jogador) " +
    "aparece exatamente uma vez, em pé sobre algo sólido; a saída é alcançável; todo pulo necessário " +
    "cabe em no máximo 3 tiles de altura e 4 de distância; dificuldade crescente da esquerda pra direita; " +
    "itens recompensam caminhos opcionais; perigos e inimigos com espaço pra reagir; nada de áreas " +
    "impossíveis ou presas. Em jogos de plataforma, a linha de baixo é chão com alguns buracos.";
  const message =
    `Gênero: ${genero || "plataforma"}.\n` +
    `Tamanho: EXATAMENTE ${cols} colunas (caracteres por linha) e ${rows} linhas.\n` +
    `Legenda:\n${legendaTxt}\n` +
    (lore ? `Contexto da história: ${lore.slice(0, 600)}\n` : "") +
    `Pedido do aluno: ${descricao || "uma fase divertida e equilibrada"}`;
  const text = await callAIRaw({ system, history: [], message });

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("A IA não devolveu um mapa válido. Tente de novo.");
  let parsed;
  try {
    parsed = JSON.parse(looseObjectToJson(text.slice(start, end + 1)));
  } catch {
    throw new Error("A IA devolveu um mapa quebrado. Tente de novo (às vezes ajuda simplificar o pedido).");
  }
  const raw = Array.isArray(parsed?.linhas) ? parsed.linhas.map(String) : [];
  if (!raw.length) throw new Error("A IA não devolveu nenhuma linha de mapa. Tente de novo.");

  let jogadorVisto = false;
  const linhas = Array.from({ length: rows }, (_, y) => {
    // se vier menos linhas, completa EM CIMA (o chão fica embaixo)
    const src = raw[raw.length - rows + y] ?? "";
    return Array.from({ length: cols }, (_, x) => {
      const ch = src[x] || ".";
      if (!legenda[ch]) return ".";
      if (legenda[ch].tipo === "jogador") {
        if (jogadorVisto) return ".";
        jogadorVisto = true;
      }
      return ch;
    }).join("");
  });
  return { tile, legenda, linhas };
}

// Exposto pra aba Mapas conseguir "devolver pra IA": relê a versão do mapa
// que está no código atual do jogo.
export { extractEmbeddedMaps }

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
      const parsed = expandCompactSprite(JSON.parse(jsonish));
      if (parsed && parsed.anims && typeof parsed.anims === "object") {
        // Formato novo: várias animações nomeadas (idle, andar, atacar, ...).
        // Só guarda as entradas que realmente parecem uma animação válida.
        const anims = {};
        Object.entries(parsed.anims).forEach(([animName, anim]) => {
          if (anim && Array.isArray(anim.frames) && anim.frames.length) {
            anims[animName] = { frames: anim.frames, frameDuration: anim.frameDuration || 150 };
          }
        });
        if (Object.keys(anims).length) sprites[name] = { anims };
      } else if (parsed && Array.isArray(parsed.frames) && parsed.frames.length) {
        // Formato antigo: uma animação só — mantido por compatibilidade,
        // normalizeSprite() em state.js trata os dois de forma uniforme.
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

// A IA desenha sprites no formato LEVE (ver prompts.js): uma paleta
// { a: "#3b2f2f", ... } + cada frame como linhas de texto ("..aabb..", uma
// letra por pixel, "." = transparente) — ~10x menos tokens que a matriz de
// cores. A aba Personagens (e o resto da engine) trabalha com a matriz, então
// aqui convertemos de volta: o aluno recebe o sprite pronto pra editar à mão.
// Sprites que já vêm como matriz passam sem mudança.
export function expandCompactSprite(sprite) {
  if (!sprite || typeof sprite !== "object") return sprite;
  const palette = sprite.paleta || sprite.palette || {};
  const expandFrame = (frame) => {
    if (!Array.isArray(frame) || typeof frame[0] !== "string") return frame;
    const width = Math.max(...frame.map((row) => row.length));
    const size = Math.max(width, frame.length); // a aba Personagens usa grade quadrada
    return Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => {
        const ch = (frame[y] || "")[x];
        return ch && ch !== "." && ch !== " " ? palette[ch] || null : null;
      })
    );
  };
  const expandAnim = (anim) => (anim && Array.isArray(anim.frames) ? { ...anim, frames: anim.frames.map(expandFrame) } : anim);
  const out = { ...sprite };
  delete out.paleta;
  delete out.palette;
  if (sprite.anims && typeof sprite.anims === "object") {
    out.anims = Object.fromEntries(Object.entries(sprite.anims).map(([n, a]) => [n, expandAnim(a)]));
  } else if (Array.isArray(sprite.frames)) {
    out.frames = sprite.frames.map(expandFrame);
  }
  return out;
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
