// Estado central do projeto de jogo atual. Cada aba lê/escreve aqui,
// e o codeGen.js junta tudo na hora de montar o jogo final.
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

    sprites: {},     // nome -> { size, frameDuration, frames: [matrizNxN, ...] }

    mechanics: {
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
    },
  },
};

export function updateMechanics(patch) {
  Object.assign(state.project.mechanics, patch);
}

export function saveSprite(name, sprite) {
  state.project.sprites[name] = sprite;
}

export function deleteSprite(name) {
  delete state.project.sprites[name];
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
  Object.assign(state.project.mechanics, row.mechanics || {});
}
