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
