import { state, updateMechanics } from "../state.js";
import { toast } from "../ui.js";

const FIELDS = [
  { key: "movimento", label: "Tipo de movimento", type: "select", options: ["plataforma", "topdown", "corredor"] },
  { key: "gravidade", label: "Gravidade", type: "range", min: 0, max: 1.5, step: 0.05 },
  { key: "forcaPulo", label: "Força do pulo", type: "range", min: 4, max: 24, step: 1 },
  { key: "velocidade", label: "Velocidade do jogador", type: "range", min: 1, max: 10, step: 0.5 },
  { key: "vidas", label: "Vidas", type: "range", min: 1, max: 9, step: 1 },
  { key: "ia_inimigos", label: "Comportamento dos inimigos", type: "select", options: ["patrulha", "perseguicao", "parado"] },
  { key: "condicaoVitoria", label: "Condição de vitória", type: "select", options: ["pontuacao", "sobreviver", "chegar_ao_fim"] },
  { key: "pontuacaoAlvo", label: "Pontuação alvo", type: "range", min: 10, max: 1000, step: 10 },
  { key: "cenario", label: "Ambientação visual", type: "select", options: ["dia", "noite", "caverna", "espaco"] },
  { key: "paralaxe", label: "Fundo com parallax", type: "checkbox" },
  { key: "musica", label: "Música/efeitos sonoros", type: "checkbox" },
];

export function mountMechanicsTab(panel) {
  panel.innerHTML = `
    <div class="mechanics-panel">
      <p class="hint">Essas opções são enviadas junto de cada pedido à IA — ela é
        instruída a respeitá-las em vez de decidir sozinha. Ajuste e depois peça
        no chat, ex.: "aplique as mecânicas que configurei".</p>
      <div class="mechanics-grid" id="mechanics-grid"></div>
    </div>`;

  const grid = panel.querySelector("#mechanics-grid");
  const m = state.project.mechanics;

  FIELDS.forEach((field) => {
    const row = document.createElement("div");
    row.className = "mechanics-field";

    const label = document.createElement("label");
    label.textContent = field.label;
    row.appendChild(label);

    let input;
    if (field.type === "select") {
      input = document.createElement("select");
      field.options.forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (m[field.key] === opt) o.selected = true;
        input.appendChild(o);
      });
      input.addEventListener("change", () => updateMechanics({ [field.key]: input.value }));
    } else if (field.type === "range") {
      input = document.createElement("input");
      input.type = "range";
      input.min = field.min;
      input.max = field.max;
      input.step = field.step;
      input.value = m[field.key];
      const valueTag = document.createElement("span");
      valueTag.className = "range-value";
      valueTag.textContent = m[field.key];
      input.addEventListener("input", () => {
        valueTag.textContent = input.value;
        updateMechanics({ [field.key]: Number(input.value) });
      });
      row.appendChild(input);
      row.appendChild(valueTag);
      grid.appendChild(row);
      return;
    } else if (field.type === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!m[field.key];
      input.addEventListener("change", () => updateMechanics({ [field.key]: input.checked }));
    }

    row.appendChild(input);
    grid.appendChild(row);
  });

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn-ghost";
  resetBtn.textContent = "Restaurar padrões";
  resetBtn.addEventListener("click", () => {
    toast("Ajuste os campos manualmente para os valores desejados.", "info");
  });
  panel.querySelector(".mechanics-panel").appendChild(resetBtn);
}
