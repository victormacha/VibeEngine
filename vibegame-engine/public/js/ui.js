export function toast(message, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 3200);
}

// Modal genérico, reaproveitado pelo update log (item 3) e pelo modal de
// dupla (item 5). `dismissible: false` tira o botão de fechar e o clique
// no fundo — usado quando a pessoa É OBRIGADA a preencher algo antes de
// continuar (ex.: nome da dupla antes de enviar pra avaliação).
export function openModal(innerHTML, { dismissible = true } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "vibe-modal-overlay";
  overlay.innerHTML = `
    <div class="vibe-modal">
      ${dismissible ? `<button class="vibe-modal-close" aria-label="Fechar">✕</button>` : ""}
      <div class="vibe-modal-body">${innerHTML}</div>
    </div>`;
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
  }

  if (dismissible) {
    overlay.querySelector(".vibe-modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
  }

  return { overlay, close };
}

export function mountTabs(root, tabs, { onSwitch } = {}) {
  const nav = document.createElement("div");
  nav.className = "tab-nav";
  const panels = document.createElement("div");
  panels.className = "tab-panels";

  tabs.forEach((tab, i) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (i === 0 ? " active" : "");
    btn.innerHTML = `<span class="tab-icon">${tab.icon}</span><span>${tab.label}</span>`;
    btn.addEventListener("click", () => {
      nav.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      panels.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      panel.classList.add("active");
      onSwitch?.(tab.id);
    });
    nav.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "tab-panel" + (i === 0 ? " active" : "");
    panel.dataset.tab = tab.id;
    panels.appendChild(panel);
    tab.mount(panel);
  });

  root.appendChild(nav);
  root.appendChild(panels);
}
