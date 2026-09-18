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
