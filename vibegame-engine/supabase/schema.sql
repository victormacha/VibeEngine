-- VibeGame Engine — schema Supabase
-- Rode isso no SQL Editor do seu projeto Supabase (uma vez).

-- 1. Perfis: liga cada usuário (auth.users) a um cargo.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  role text not null default 'aluno' check (role in ('aluno', 'banca', 'admin')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "usuário lê o próprio perfil"
  on profiles for select
  using (auth.uid() = id);

create policy "banca e admin leem todos os perfis"
  on profiles for select
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('banca', 'admin'))
  );

create policy "usuário cria o próprio perfil no cadastro"
  on profiles for insert
  with check (auth.uid() = id);

create policy "admin atualiza qualquer perfil (ex: promover a banca)"
  on profiles for update
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- 2. Jogos: um jogo salvo por um aluno.
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  genre text,
  html_code text not null,
  sprites jsonb default '{}',
  mechanics jsonb default '{}',
  created_at timestamptz not null default now()
);

alter table games enable row level security;

create policy "aluno gerencia os próprios jogos"
  on games for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "banca e admin leem todos os jogos"
  on games for select
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('banca', 'admin'))
  );

-- 3. Notas: avaliação de um jogo por um membro da banca.
create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games (id) on delete cascade,
  banca_id uuid not null references auth.users (id) on delete cascade,
  nota numeric(4, 1) not null check (nota >= 0 and nota <= 10),
  comentario text,
  created_at timestamptz not null default now(),
  unique (game_id, banca_id)
);

alter table scores enable row level security;

create policy "banca e admin criam e leem notas"
  on scores for all
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('banca', 'admin'))
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('banca', 'admin'))
  );

create policy "aluno vê as notas dos próprios jogos"
  on scores for select
  using (
    exists (select 1 from games g where g.id = scores.game_id and g.user_id = auth.uid())
  );

-- Dica: para transformar um usuário em "banca" ou "admin" depois do
-- cadastro, rode manualmente (uma vez, com o e-mail da pessoa):
--   update profiles set role = 'banca' where email = 'avaliador@escola.com';
