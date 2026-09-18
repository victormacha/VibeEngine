// Estado central do projeto de jogo atual. Cada aba lê/escreve aqui,
// e o codeGen.js junta tudo na hora de montar o jogo final.
export const state = {
  session: null,
  profile: null,

  project: {
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
