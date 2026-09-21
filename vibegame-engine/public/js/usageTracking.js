// Item 2 (aba Perfil) — "quanto tempo utilizou a engine": conta o tempo
// que a aba fica aberta e ativa, e soma isso na tabela `perfil`
// (supabase/schema.sql). Não usa uma função de banco/RPC de propósito —
// esse projeto todo já é "fetch puro" sem infra a mais — então o cálculo
// é feito no cliente e mandado como incremento a cada flush. Isso pode
// perder um pouco de tempo se a aba fechar bem no meio de um intervalo,
// mas é inofensivo (é só uma estatística mostrada pro próprio aluno, não
// afeta nota nem avaliação), e o `visibilitychange`/`beforeunload` abaixo
// cobre a maioria dos casos de fechar a aba/trocar de app.
import { dbQuery } from "./supabaseClient.js";

const FLUSH_MS = 30000;

let userId = null;
let segmentStartedAt = null;
let flushTimer = null;

function elapsedSinceSegmentStart() {
  if (!segmentStartedAt) return 0;
  return Math.max(0, Math.round((Date.now() - segmentStartedAt) / 1000));
}

async function flush({ keepalive = false } = {}) {
  if (!userId) return;
  const delta = elapsedSinceSegmentStart();
  segmentStartedAt = Date.now(); // reinicia a contagem já aqui, mesmo se o PATCH falhar
  if (delta <= 0) return;
  try {
    const [row] = await dbQuery("perfil", { select: "total_seconds", id: `eq.${userId}` });
    const total = (row?.total_seconds || 0) + delta;
    if (row) {
      await dbQuery("perfil", { id: `eq.${userId}` }, { method: "PATCH", body: { total_seconds: total } });
    } else {
      // Corrida possível com updateLog.js criando a mesma linha ao mesmo
      // tempo (ambos rodam logo no primeiro login) — se o INSERT falhar
      // por chave duplicada, o UPDATE cobre o mesmo resultado.
      try {
        await dbQuery("perfil", {}, { method: "POST", body: { id: userId, total_seconds: total } });
      } catch {
        await dbQuery("perfil", { id: `eq.${userId}` }, { method: "PATCH", body: { total_seconds: total } });
      }
    }
  } catch {
    // offline momentâneo: o próximo flush tenta de novo com o delta acumulado a mais.
  }
}

function handleVisibility() {
  if (document.hidden) {
    flush();
  } else {
    segmentStartedAt = Date.now();
  }
}

export function startUsageTracking(uid) {
  userId = uid;
  segmentStartedAt = Date.now();
  flushTimer = setInterval(flush, FLUSH_MS);
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("beforeunload", () => flush());
}

export async function stopUsageTracking({ flush: doFlush = false } = {}) {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  document.removeEventListener("visibilitychange", handleVisibility);
  if (doFlush) await flush();
  userId = null;
  segmentStartedAt = null;
}

// Usado pela aba Perfil pra mostrar o total atualizado (soma o que já
// está salvo com o pedaço da sessão atual ainda não "flushado").
export async function getTotalSecondsForDisplay() {
  if (!userId) return 0;
  try {
    const [row] = await dbQuery("perfil", { select: "total_seconds", id: `eq.${userId}` });
    return (row?.total_seconds || 0) + elapsedSinceSegmentStart();
  } catch {
    return elapsedSinceSegmentStart();
  }
}

export function formatSeconds(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  const s = Math.floor(totalSeconds % 60);
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}
