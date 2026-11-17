-- =====================================================================
-- Migração nov/2026 — passo 1 (rodar no SQL Editor do Supabase)
-- Não apaga nada. Pode rodar mais de uma vez.
-- =====================================================================

-- Backup completo da tabela antes de mexer nos fundos
create table if not exists public.games_backup_20261116 as
select * from public.games;

-- Bucket público para os fundos das fases (aba Perfil)
insert into storage.buckets (id, name, public)
values ('game-backgrounds', 'game-backgrounds', true)
on conflict (id) do nothing;

-- Cada usuário só envia/troca/apaga arquivos dentro da própria pasta {user_id}/
drop policy if exists "usuario envia fundo" on storage.objects;
create policy "usuario envia fundo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'game-backgrounds'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "usuario troca fundo" on storage.objects;
create policy "usuario troca fundo" on storage.objects
  for update to authenticated
  using (bucket_id = 'game-backgrounds'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "usuario apaga fundo" on storage.objects;
create policy "usuario apaga fundo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'game-backgrounds'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Índices usados pelas listas (banca, admin, "último projeto" do aluno)
create index if not exists games_status_submitted_idx on public.games (status, submitted_at desc);
create index if not exists games_user_updated_idx     on public.games (user_id, updated_at desc);
create index if not exists games_partner_idx          on public.games (partner_id);
create index if not exists scores_game_idx            on public.scores (game_id);

select 'ok' as passo_1;
