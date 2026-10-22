// Gravação da lore (tabela `lore`, uma linha por jogo) num lugar só — usada
// pela aba Lore (botão Salvar) e pela aba Testar (todo "Salvar"/"Enviar" do
// jogo leva a lore junto).
//
// Antes eram dois passos (SELECT pra ver se existia, depois PATCH ou POST).
// O PATCH ia com "return=minimal": quando o RLS bloqueava a gravação (ex.:
// jogo ainda não estava no banco, ou a linha era de outro projeto), o
// Postgres atualizava 0 linhas SEM erro e o app mostrava "Lore salva" mesmo
// sem ter salvo nada. Agora é um upsert único que devolve a linha gravada —
// se não voltar nada, o erro aparece pro aluno em vez de sumir em silêncio.
import { dbQuery } from "./supabaseClient.js";

export async function persistLore(gameId, content, aiGenerated) {
  const rows = await dbQuery("lore", { on_conflict: "game_id" }, {
    method: "POST",
    body: { game_id: gameId, content, ai_generated: aiGenerated, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=representation",
  });
  if (!rows?.length) {
    throw new Error("A lore não foi gravada (o banco recusou). Salve o jogo na aba Testar e tente de novo.");
  }
  return rows[0];
}
