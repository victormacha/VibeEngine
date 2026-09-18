import { state, saveSprite } from "../state.js";
import { askAI, parseAIResponse } from "../api.js";
import { toast } from "../ui.js";

const GENRE_CHIPS = [
  { id: "plataforma", label: "🕹️ Plataforma" },
  { id: "corredor", label: "🏃 Corredor infinito" },
  { id: "topdown", label: "🔼 Top-down" },
  { id: "puzzle", label: "🧩 Puzzle" },
  { id: "tiro", label: "🚀 Nave/Tiro" },
];

export function mountChatTab(panel, { onGameUpdated }) {
  panel.innerHTML = `
    <div class="chat-chips" id="chat-chips"></div>
    <div class="chat-messages" id="chat-messages">
      <div class="message system">
        <strong>Bem-vindo à VibeGame Engine!</strong><br>
        Descreva o jogo que quer criar, ou escolha um gênero abaixo.
        Depois use as abas <em>Personagens</em> e <em>Mecânicas</em> para deixar
        o jogo com a sua cara — a IA vai respeitar o que você desenhar e configurar.
      </div>
    </div>
    <div class="chat-input-area">
      <textarea id="chat-input" placeholder="Descreva o jogo ou peça uma alteração..." rows="2"></textarea>
      <button id="chat-send" class="btn-primary">Enviar</button>
    </div>`;

  const chipsEl = panel.querySelector("#chat-chips");
  const messagesEl = panel.querySelector("#chat-messages");
  const inputEl = panel.querySelector("#chat-input");
  const sendBtn = panel.querySelector("#chat-send");

  GENRE_CHIPS.forEach((g) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = g.label;
    chip.addEventListener("click", () => {
      state.project.genre = g.id;
      inputEl.value = `Quero um jogo de ${g.label.replace(/^\S+\s/, "").toLowerCase()}. `;
      inputEl.focus();
    });
    chipsEl.appendChild(chip);
  });

  function addMessage(role, text) {
    const div = document.createElement("div");
    div.className = `message ${role}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    sendBtn.disabled = true;
    addMessage("user", text);
    state.project.chatHistory.push({ role: "user", text });

    const thinking = addMessage("system", "Gerando o jogo... (se a IA estiver sobrecarregada, ele tenta de novo sozinho — pode levar alguns segundos a mais)");
    try {
      const raw = await askAI({
        userText: text,
        chatHistory: state.project.chatHistory,
        mechanics: state.project.mechanics,
        sprites: state.project.sprites,
      });
      const { code, info, sprites } = parseAIResponse(raw);
      state.project.chatHistory.push({ role: "model", text: raw });
      state.project.gameCode = code;
      state.project.gameInfo = info;
      if (info?.titulo) state.project.title = info.titulo;

      // Sprites que a IA desenhou por conta própria: importa pra galeria da
      // aba Personagens, sem sobrescrever nada que o aluno já tenha desenhado.
      let newSpriteCount = 0;
      if (sprites) {
        Object.entries(sprites).forEach(([name, sprite]) => {
          const frames = sprite?.frames;
          if (Array.isArray(frames) && frames.length && !state.project.sprites[name]) {
            saveSprite(name, {
              size: frames[0].length,
              frameDuration: sprite.frameDuration || 150,
              frames,
            });
            newSpriteCount++;
          }
        });
      }

      thinking.remove();
      addMessage("model", info ? `✅ ${info.titulo} — ${info.objetivo}` : "✅ Jogo atualizado.");
      if (newSpriteCount > 0) {
        addMessage("system", `🎨 ${newSpriteCount} sprite(s) desenhado(s) pela IA foram importados para a aba Personagens — você já pode editá-los lá.`);
      }
      onGameUpdated();
    } catch (err) {
      thinking.remove();
      addMessage("system", `⚠️ ${err.message}`);
      toast(err.message, "error");
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
}
