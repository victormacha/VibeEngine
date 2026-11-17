// =====================================================================
// Migração nov/2026 — passo 2: tira os fundos em base64 de dentro da
// tabela `games` e manda pro Supabase Storage.
//
// Para cada jogo com background_image = "data:image/...;base64,...":
//   1. envia a imagem pro bucket game-backgrounds/{user_id}/{id}.{ext}
//   2. troca background_image pela URL pública
//   3. troca a mesma imagem dentro do html_code (window.VIBE_BACKGROUND)
//
// Requisitos: Node 18 ou mais novo (não precisa instalar nada).
// Como rodar (PowerShell, nesta pasta):
//   $env:SUPABASE_SERVICE_ROLE_KEY="cole_a_service_role_key_aqui"
//   node 2-migrar-fundos.mjs
//
// A service_role key fica em Project Settings > API Keys (secret).
// NUNCA coloque ela no site nem faça commit dela.
//
// Pode rodar quantas vezes quiser: só mexe em quem ainda está em base64.
// O backup (passo 1) guarda o valor original de tudo.
// =====================================================================
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xwqztktalujumulayudx.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "game-backgrounds";

if (!KEY) {
  console.error("Defina SUPABASE_SERVICE_ROLE_KEY antes de rodar (veja o topo do arquivo).");
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Só os IDs (leve) de quem ainda tem fundo em base64
const pendentes = await rest("games?select=id,user_id&background_image=like.data:*");
console.log(`${pendentes.length} fundo(s) para migrar.`);

let ok = 0, falhas = 0, economia = 0;

for (const { id, user_id } of pendentes) {
  try {
    // Um jogo por vez, pra não dar timeout
    const [row] = await rest(`games?select=background_image,html_code&id=eq.${id}`);
    const dataUrl = row?.background_image || "";
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) { console.warn(`- ${id}: formato inesperado, pulando.`); continue; }

    const contentType = m[1];
    const ext = contentType.split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
    const buffer = Buffer.from(m[2], "base64");
    const path = `${user_id}/${id}.${ext}`;

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": contentType, "x-upsert": "true", "cache-control": "31536000" },
      body: buffer,
    });
    if (!up.ok) throw new Error(`upload: ${up.status} ${await up.text()}`);

    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    const patch = { background_image: url };
    if (row.html_code && row.html_code.includes(dataUrl)) {
      patch.html_code = row.html_code.split(dataUrl).join(url);
    }

    await rest(`games?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch), headers: { Prefer: "return=minimal" } });

    const antes = dataUrl.length + (row.html_code?.length || 0);
    const depois = url.length + (patch.html_code?.length ?? row.html_code?.length ?? 0);
    economia += antes - depois;
    ok++;
    console.log(`✔ ${id}  (${(buffer.length / 1024).toFixed(0)} kB → Storage)`);
  } catch (e) {
    falhas++;
    console.error(`✖ ${id}: ${e.message}`);
  }
}

console.log(`\nPronto: ${ok} migrado(s), ${falhas} falha(s). ~${(economia / 1024 / 1024).toFixed(1)} MB a menos na tabela.`);
if (falhas) console.log("Rode de novo para tentar as que falharam.");
