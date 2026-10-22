// Estado central do projeto de jogo atual. Cada aba lê/escreve aqui,
// e o codeGen.js junta tudo na hora de montar o jogo final.

// Valores de partida da aba Mecânicas — extraídos aqui (em vez de escritos
// direto dentro de `state`) só pra dar pra COMPARAR depois: se o aluno
// nunca abriu a aba Mecânicas, `state.project.mechanics` é exatamente
// isso, e nesse caso não faz sentido a IA tratar esses valores como
// obrigatórios (ver mechanicsCustomized() e prompts.js/buildUserTurn) —
// um pedido de jogo de puzzle não devia ganhar gravidade/pulo só porque o
// formulário "veio preenchido" com o padrão de plataforma.
export const DEFAULT_MECHANICS = {
  movimento: "plataforma",      // plataforma | topdown | corredor
  gravidade: 0.6,
  forcaPulo: 12,
  velocidade: 4,
  vidas: 3,
  ia_inimigos: "patrulha",      // patrulha | perseguicao | parado
  condicaoVitoria: "pontuacao", // pontuacao | sobreviver | chegar_ao_fim
  pontuacaoAlvo: 100,
  cenario: "dia",               // dia | noite | caverna | espaco
  paralaxe: true,
  musica: true,
};

export const state = {
  session: null,
  profile: null,

  project: {
    id: null,        // id da linha em `games` no Supabase — null até o primeiro save.
                      // Enquanto tiver id, "Salvar" faz UPDATE nessa mesma linha (em vez
                      // de criar um jogo novo a cada clique), o que é o que permite
                      // continuar editando o mesmo projeto depois.
    status: "rascunho", // "rascunho" | "enviado" — só muda pra "enviado" ao clicar em
                         // "Enviar pra avaliação". Enquanto rascunho, só o próprio aluno
                         // e admins enxergam o jogo; banca só vê depois de enviado.

    title: "Meu Jogo",
    genre: "plataforma",
    chatHistory: [], // { role: "user" | "model", text }
    gameCode: "",    // HTML/JS final retornado pela IA
    gameInfo: null,  // { titulo, genero, controles, objetivo }

    backgroundImage: null, // data URL do fundo das fases (aba Perfil) — vira window.VIBE_BACKGROUND no jogo final

    // Sistema de dupla: teamName é obrigatório antes de enviar pra avaliação;
    // partnerId (uuid do colega) é o que dá acesso ao MESMO projeto pra ele,
    // via política de RLS "auth.uid() = partner_id" em games. partnerEmail
    // é só o que aparece na UI (o e-mail é resolvido pro id na hora de salvar).
    teamName: "",
    partnerId: null,
    partnerEmail: "",

    lore: {
      content: "",
      aiGenerated: false,
    },

    sprites: {},     // nome -> { size, anims: { idle: {frameDuration, frames}, andar: {...}, ... } }
                      // (sprites salvos antes de existirem múltiplas animações têm o formato
                      // antigo { size, frameDuration, frames } — use normalizeSprite() pra ler
                      // qualquer sprite de forma uniforme, os dois formatos convivem.)

    mechanics: { ...DEFAULT_MECHANICS },

    // Mapas em grade (aba Mapas): nome -> { tile, legenda, linhas, origem }.
    // origem "ia" = importado do código que a IA escreveu (a IA continua
    // dona dele e pode refazê-lo a cada pedido); origem "aluno" = o aluno
    // editou na aba Mapas — a partir daí a versão do aluno é a que vale no
    // jogo (injetada como window.VIBE_MAPS) e a IA não sobrescreve mais.
    maps: {},
  },
};

// Tipos de tile que a engine entende (ver Vibe.loadMap em codeGen.js).
export const MAP_TILE_TYPES = [
  { id: "solido", label: "Sólido (chão/parede)" },
  { id: "plataforma", label: "Plataforma (pousa por cima)" },
  { id: "quebravel", label: "Quebrável (bloco que quebra)" },
  { id: "mola", label: "Mola (joga pra cima)" },
  { id: "escada", label: "Escada (sobe e desce)" },
  { id: "perigo", label: "Perigo (espinho/lava)" },
  { id: "item", label: "Item (coletável)" },
  { id: "inimigo", label: "Inimigo (nasce aqui)" },
  { id: "jogador", label: "Jogador (começa aqui)" },
  { id: "checkpoint", label: "Checkpoint (respawn)" },
  { id: "saida", label: "Saída (fim da fase)" },
  { id: "decoracao", label: "Decoração (sem colisão)" },
];

// Legenda inicial de um mapa criado do zero na aba Mapas.
export const DEFAULT_MAP_LEGEND = {
  "#": { tipo: "solido", cor: "#7a5230", topo: "#4caf50" },
  "=": { tipo: "plataforma", cor: "#9c6b3c" },
  "B": { tipo: "quebravel", cor: "#b5651d" },
  "M": { tipo: "mola", cor: "#ff7043" },
  "H": { tipo: "escada", cor: "#c8a165" },
  "^": { tipo: "perigo", cor: "#e04848" },
  "o": { tipo: "item", cor: "#ffd23f", nome: "moeda" },
  "E": { tipo: "inimigo", cor: "#c0392b", nome: "inimigo" },
  "P": { tipo: "jogador", cor: "#3fa7ff" },
  "C": { tipo: "checkpoint", cor: "#29b6f6" },
  "F": { tipo: "saida", cor: "#2ecc71" },
  "~": { tipo: "decoracao", cor: "#3b5b7a" },
};

// Garante o formato que a aba Mapas e o jogo esperam: linhas todas com a
// mesma largura, tile numérico e legenda presente.
export function normalizeMap(map) {
  const linhas = Array.isArray(map?.linhas) ? map.linhas.map((l) => String(l)) : [];
  const cols = Math.max(1, ...linhas.map((l) => l.length));
  return {
    tile: Number(map?.tile || map?.tamanho) || 32,
    legenda: map?.legenda && typeof map.legenda === "object" ? map.legenda : { ...DEFAULT_MAP_LEGEND },
    linhas: linhas.length ? linhas.map((l) => l.padEnd(cols, ".")) : [".".repeat(cols)],
    origem: map?.origem === "aluno" ? "aluno" : "ia",
  };
}

export function updateMechanics(patch) {
  Object.assign(state.project.mechanics, patch);
}

// true só quando pelo menos um campo difere do padrão — ou seja, o aluno
// efetivamente mexeu na aba Mecânicas pra esse jogo. Usado por
// prompts.js/buildUserTurn pra decidir se CFG é regra travada (aluno
// configurou de propósito) ou só um ponto de partida que a IA pode adaptar
// ao gênero pedido (formulário ainda no padrão de fábrica).
export function mechanicsCustomized(mechanics) {
  return Object.keys(DEFAULT_MECHANICS).some((key) => mechanics[key] !== DEFAULT_MECHANICS[key]);
}

export function saveSprite(name, sprite) {
  state.project.sprites[name] = sprite;
}

export function deleteSprite(name) {
  delete state.project.sprites[name];
}

// Sprites salvos antes de existirem múltiplas animações têm o formato
// antigo `{ size, frameDuration, frames }` (uma animação só). Essa função
// devolve QUALQUER sprite (antigo ou novo) sempre no formato novo
// `{ size, anims: { idle: {frameDuration, frames}, ... } }`, tratando o
// formato antigo como se fosse uma única animação chamada "idle" — assim o
// resto do app (editor, prompt) só precisa entender um formato só.
export function normalizeSprite(sprite) {
  if (sprite && sprite.anims && Object.keys(sprite.anims).length) {
    return sprite;
  }
  const frames = sprite?.frames || (sprite?.pixels ? [sprite.pixels] : null);
  if (!frames || !frames.length) {
    return { size: sprite?.size || 24, anims: {} };
  }
  return {
    size: sprite.size || frames[0].length,
    anims: { idle: { frameDuration: sprite.frameDuration || 150, frames } },
  };
}

export function serializeProject() {
  return JSON.stringify(state.project, null, 2);
}

// Recarrega um projeto salvo (uma linha da tabela `games`) de volta pro
// estado do editor — é o que permite "continuar de onde parou" depois de
// sair e voltar. Substitui o projeto atual inteiro (chamado só no boot,
// antes do aluno começar a mexer em nada).
export function loadProjectFromRow(row) {
  state.project.id = row.id;
  state.project.status = row.status || "rascunho";
  state.project.title = row.title || "Meu Jogo";
  state.project.genre = row.genre || "plataforma";
  state.project.chatHistory = Array.isArray(row.chat_history) ? row.chat_history : [];
  state.project.gameCode = row.game_code || "";
  state.project.sprites = row.sprites || {};
  state.project.backgroundImage = row.background_image || null;
  state.project.teamName = row.team_name || "";
  state.project.partnerId = row.partner_id || null;
  Object.assign(state.project.mechanics, row.mechanics || {});
  state.project.maps = row.maps && typeof row.maps === "object" ? row.maps : {};
}

// Recarrega a lore (tabela separada `lore`, uma linha por jogo) de volta
// pro estado — chamado depois de loadProjectFromRow, já que só existe
// lore para um jogo que já tem `id`.
export function loadLoreFromRow(row) {
  state.project.lore.content = row?.content || "";
  state.project.lore.aiGenerated = !!row?.ai_generated;
}
