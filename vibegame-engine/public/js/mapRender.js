// Desenho de UM tile de mapa — usado tanto pela aba Mapas (editor) quanto
// pelo jogo final (Vibe.loadMap, em codeGen.js). Pra os dois ficarem
// idênticos sem duplicar código, o codeGen injeta esta MESMA função no jogo
// via drawMapTile.toString() — por isso ela precisa ser autossuficiente:
// nada de import, nada de variável de fora, só o que chega por parâmetro.
//
//   t   = { x, y, tipo, def }   (posição em px, tipo e entrada da legenda)
//   T   = tamanho do tile em px
//   nb  = vizinhos do MESMO tipo de bloco: { up, down, left, right } (bool)
//         — é o que dá o "auto-tile": grama só no topo exposto, borda só
//         onde o bloco termina, escada contínua etc.
//   now = tempo em ms (animações leves: brilho do checkpoint, perigo pulsando)
export function drawMapTile(ctx, t, T, nb, now) {
  function shade(hex, amt) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    var c = function (v) { return Math.max(0, Math.min(255, v + amt)); };
    return "rgb(" + c(n >> 16) + "," + c((n >> 8) & 255) + "," + c(n & 255) + ")";
  }
  var x = t.x, y = t.y, cor = (t.def && t.def.cor) || "#777777", tipo = t.tipo;
  var s = Math.max(1, Math.round(T / 16)); // "pixel" de detalhe, escala com o tile
  nb = nb || {};
  var forma = t.def && t.def.forma;
  // variação "aleatória" mas fixa por célula (mesma em todo frame)
  var seed = (((t.col || 0) * 73856093) ^ ((t.row || 0) * 19349663)) >>> 0;
  var rnd = function (k) { return ((seed * (k + 1) * 2654435761) >>> 0) % 1000 / 1000; };

  // ---- formas (árvore, pedra, arbusto, caixa, flor) — servem pros dois estilos ----
  if (forma === "arvore") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(x + T / 2, y + T * 0.9, T * 0.32, T * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#6d4c41";
    ctx.fillRect(x + T * 0.42, y + T * 0.55, T * 0.16, T * 0.38);
    ctx.fillStyle = shade(cor, -30);
    ctx.beginPath(); ctx.arc(x + T / 2, y + T * 0.42, T * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.arc(x + T * 0.45, y + T * 0.36, T * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(cor, 35);
    ctx.fillRect(x + T * 0.32, y + T * 0.22, s * 3, s * 2);
    return;
  }
  if (forma === "pedra") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(x + T / 2, y + T * 0.85, T * 0.4, T * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(cor, -25);
    ctx.beginPath(); ctx.ellipse(x + T / 2, y + T * 0.58, T * 0.42, T * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.ellipse(x + T * 0.46, y + T * 0.5, T * 0.34, T * 0.24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(cor, 40);
    ctx.fillRect(x + T * 0.32, y + T * 0.38, s * 3, s * 2);
    return;
  }
  if (forma === "arbusto") {
    ctx.fillStyle = shade(cor, -30);
    ctx.beginPath(); ctx.arc(x + T * 0.3, y + T * 0.6, T * 0.25, 0, Math.PI * 2); ctx.arc(x + T * 0.7, y + T * 0.6, T * 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.arc(x + T * 0.5, y + T * 0.45, T * 0.28, 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (forma === "caixa") {
    ctx.fillStyle = cor; ctx.fillRect(x + s * 2, y + s * 2, T - s * 4, T - s * 4);
    ctx.strokeStyle = shade(cor, -50); ctx.lineWidth = s * 2;
    ctx.strokeRect(x + s * 3, y + s * 3, T - s * 6, T - s * 6);
    ctx.beginPath(); ctx.moveTo(x + s * 3, y + s * 3); ctx.lineTo(x + T - s * 3, y + T - s * 3); ctx.stroke();
    return;
  }
  if (forma === "flor") {
    for (var f = 0; f < 3; f++) {
      var fx = x + T * (0.2 + rnd(f) * 0.6), fy = y + T * (0.2 + rnd(f + 5) * 0.6);
      ctx.fillStyle = "#2e7d32"; ctx.fillRect(fx, fy + s, s, s * 2);
      ctx.fillStyle = cor; ctx.fillRect(fx - s, fy - s, s * 3, s * 2);
      ctx.fillStyle = "#fff59d"; ctx.fillRect(fx, fy - s / 2, s, s);
    }
    return;
  }

  if (tipo === "porta") {
    ctx.fillStyle = shade(cor, -45); ctx.fillRect(x + T * 0.12, y, T * 0.76, T);
    ctx.fillStyle = cor; ctx.fillRect(x + T * 0.18, y + s * 2, T * 0.64, T - s * 2);
    ctx.fillStyle = shade(cor, -25);
    ctx.fillRect(x + T * 0.48, y + s * 2, s, T - s * 2);
    ctx.fillStyle = "#ffd54f"; ctx.fillRect(x + T * 0.66, y + T * 0.55, s * 2, s * 2);
    return;
  }

  // ---- estilo top-down (RPG, labirinto, aventura vista de cima) ----
  if (t.estilo === "topdown") {
    if (tipo === "piso") {
      ctx.fillStyle = cor; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = shade(cor, rnd(1) > 0.5 ? 10 : -10);
      for (var p = 0; p < 3; p++) ctx.fillRect(x + rnd(p + 2) * (T - s * 2), y + rnd(p + 7) * (T - s * 2), s * 2, s);
      return;
    }
    if (tipo === "agua") {
      ctx.fillStyle = cor; ctx.fillRect(x, y, T, T);
      var ph = (now || 0) / 400 + (t.col || 0) * 0.8 + (t.row || 0) * 0.5;
      ctx.fillStyle = shade(cor, 45);
      ctx.fillRect(x + T * 0.15 + Math.sin(ph) * s * 2, y + T * 0.3, T * 0.3, s);
      ctx.fillRect(x + T * 0.5 + Math.cos(ph) * s * 2, y + T * 0.7, T * 0.3, s);
      ctx.fillStyle = shade(cor, 70);
      if (!nb.up) ctx.fillRect(x, y, T, s * 2);
      if (!nb.left) ctx.fillRect(x, y, s * 2, T);
      if (!nb.right) ctx.fillRect(x + T - s * 2, y, s * 2, T);
      return;
    }
    if (tipo === "solido" || tipo === "quebravel") {
      // parede em 3/4: topo claro e, onde a parede termina embaixo, a "frente" escura
      var front = nb.down ? 0 : Math.round(T * 0.4);
      ctx.fillStyle = shade(cor, 25); ctx.fillRect(x, y, T, T - front);
      ctx.fillStyle = shade(cor, 45);
      if (!nb.up) ctx.fillRect(x, y, T, s * 2);
      if (front) {
        ctx.fillStyle = shade(cor, -35); ctx.fillRect(x, y + T - front, T, front);
        ctx.fillStyle = shade(cor, -55);
        ctx.fillRect(x, y + T - front, T, s);
        if (tipo === "quebravel") { ctx.fillRect(x + T / 2, y + T - front, s, front); }
        else for (var b = 0; b < T; b += T / 4) ctx.fillRect(x + b + ((t.row || 0) % 2) * T / 8, y + T - front / 2, s, front / 2);
      }
      ctx.fillStyle = shade(cor, -20);
      if (!nb.left) ctx.fillRect(x, y, s, T);
      if (!nb.right) ctx.fillRect(x + T - s, y, s, T);
      return;
    }
    if (tipo === "perigo") {
      ctx.fillStyle = shade(cor, -50); ctx.fillRect(x + s, y + s, T - s * 2, T - s * 2);
      ctx.fillStyle = cor;
      for (var gx = 0; gx < 2; gx++) for (var gy = 0; gy < 2; gy++) {
        var cx0 = x + T * (0.28 + gx * 0.44), cy0 = y + T * (0.28 + gy * 0.44);
        ctx.beginPath(); ctx.moveTo(cx0 - T * 0.14, cy0 + T * 0.12); ctx.lineTo(cx0, cy0 - T * 0.16); ctx.lineTo(cx0 + T * 0.14, cy0 + T * 0.12); ctx.fill();
      }
      return;
    }
    if (tipo === "decoracao") {
      ctx.fillStyle = cor;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x + s * 2, y + s * 2, T - s * 4, T - s * 4);
      ctx.globalAlpha = 1;
      return;
    }
    // escada, mola, saída, checkpoint: mesmo desenho do estilo plataforma (abaixo)
  }

  if (tipo === "solido" || tipo === "quebravel") {
    ctx.fillStyle = cor;
    ctx.fillRect(x, y, T, T);
    if (tipo === "quebravel") {
      // tijolinhos
      ctx.fillStyle = shade(cor, -45);
      ctx.fillRect(x, y + T / 2 - s / 2, T, s);
      ctx.fillRect(x + T / 2 - s / 2, y, s, T / 2);
      ctx.fillRect(x + T / 4 - s / 2, y + T / 2, s, T / 2);
      ctx.fillRect(x + (3 * T) / 4 - s / 2, y + T / 2, s, T / 2);
      ctx.fillStyle = shade(cor, 30);
      ctx.fillRect(x, y, T, s);
      return;
    }
    // textura simples (pontinhos) pra não ficar um bloco liso
    ctx.fillStyle = shade(cor, -22);
    ctx.fillRect(x + T * 0.2, y + T * 0.55, s * 2, s);
    ctx.fillRect(x + T * 0.65, y + T * 0.75, s * 2, s);
    ctx.fillRect(x + T * 0.45, y + T * 0.35, s, s);
    // bordas onde o bloco termina
    ctx.fillStyle = shade(cor, -40);
    if (!nb.down) ctx.fillRect(x, y + T - s * 2, T, s * 2);
    if (!nb.left) ctx.fillRect(x, y, s * 2, T);
    if (!nb.right) ctx.fillRect(x + T - s * 2, y, s * 2, T);
    // topo exposto: faixa de "grama" (cor `topo` na legenda, ou um verde)
    if (!nb.up) {
      var topo = (t.def && t.def.topo) || "#4caf50";
      ctx.fillStyle = topo;
      ctx.fillRect(x, y, T, s * 4);
      ctx.fillStyle = shade(topo, 45);
      ctx.fillRect(x, y, T, s);
      ctx.fillStyle = shade(topo, -35);
      for (var g = 0; g < T; g += s * 4) ctx.fillRect(x + g + s, y + s * 4, s * 2, s);
    }
    return;
  }

  if (tipo === "plataforma") {
    var h = Math.max(4, Math.round(T / 3));
    ctx.fillStyle = cor;
    ctx.fillRect(x, y, T, h);
    ctx.fillStyle = shade(cor, 40);
    ctx.fillRect(x, y, T, s);
    ctx.fillStyle = shade(cor, -40);
    ctx.fillRect(x, y + h - s, T, s);
    // apoios nas pontas
    if (!nb.left) ctx.fillRect(x + s, y + h, s * 2, s * 3);
    if (!nb.right) ctx.fillRect(x + T - s * 3, y + h, s * 2, s * 3);
    return;
  }

  if (tipo === "perigo") {
    var pulse = 0.85 + 0.15 * Math.sin((now || 0) / 180);
    ctx.fillStyle = cor;
    var n = 3, w = T / n;
    ctx.beginPath();
    for (var k = 0; k < n; k++) {
      ctx.moveTo(x + k * w, y + T);
      ctx.lineTo(x + k * w + w / 2, y + T * 0.3);
      ctx.lineTo(x + (k + 1) * w, y + T);
    }
    ctx.fill();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = shade(cor, 70);
    for (var k2 = 0; k2 < n; k2++) ctx.fillRect(x + k2 * w + w / 2 - s / 2, y + T * 0.3, s, s * 2);
    ctx.globalAlpha = 1;
    return;
  }

  if (tipo === "escada") {
    ctx.fillStyle = shade(cor, -30);
    ctx.fillRect(x + T * 0.2, y, s * 2, T);
    ctx.fillRect(x + T * 0.8 - s * 2, y, s * 2, T);
    ctx.fillStyle = cor;
    for (var d = s * 2; d < T; d += T / 4) ctx.fillRect(x + T * 0.2, y + d, T * 0.6, s * 2);
    return;
  }

  if (tipo === "mola") {
    ctx.fillStyle = shade(cor, -50);
    ctx.fillRect(x + T * 0.15, y + T - s * 3, T * 0.7, s * 3);
    ctx.fillStyle = "#cfd8dc";
    for (var c = 0; c < 3; c++) ctx.fillRect(x + T * (0.25 + (c % 2) * 0.1), y + T * 0.45 + c * s * 3, T * 0.4, s * 2);
    ctx.fillStyle = cor;
    ctx.fillRect(x + T * 0.1, y + T * 0.35, T * 0.8, s * 3);
    return;
  }

  if (tipo === "saida" || tipo === "checkpoint") {
    ctx.fillStyle = "#d7ccc8";
    ctx.fillRect(x + T * 0.2, y + T * 0.05, s * 2, T * 0.95);
    var wave = Math.sin((now || 0) / 200) * s;
    ctx.fillStyle = cor;
    ctx.fillRect(x + T * 0.2 + s * 2, y + T * 0.08 + wave, T * (tipo === "saida" ? 0.6 : 0.45), T * 0.35);
    if (tipo === "saida") {
      ctx.fillStyle = shade(cor, 60);
      ctx.fillRect(x + T * 0.35, y + T * 0.15 + wave, s * 2, s * 2);
    }
    return;
  }

  // decoração (e qualquer tipo desconhecido): bloco translúcido sem colisão
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = cor;
  ctx.fillRect(x, y, T, T);
  ctx.fillStyle = shade(cor, 25);
  ctx.fillRect(x + s * 2, y + s * 2, T - s * 4, s);
  ctx.globalAlpha = 1;
}

// Tipos que se ligam visualmente ao vizinho (auto-tile).
export function sameBlock(a, b) {
  if (!a || !b) return false;
  var solid = { solido: 1, quebravel: 1 };
  if (solid[a] && solid[b]) return true;
  return a === b;
}
