-- VibeGame Engine — schema Supabase
-- Rode isso no SQL Editor do seu projeto Supabase (uma vez).
--
-- Se seu projeto já existe com a versão anterior deste arquivo, tudo aqui
-- usa "if not exists" / "add column if not exists" / "or replace", então
-- é seguro colar o arquivo INTEIRO de novo no SQL Editor — ele só cria o
-- que ainda está faltando, sem apagar dado nenhum.

-- 1. Perfis: liga cada usuário (auth.users) a um cargo.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  role text not null default 'aluno' check (role in ('aluno', 'banca', 'admin')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

-- Função auxiliar que checa o cargo do usuário logado SEM reativar as
-- políticas de RLS de "profiles" durante a checagem (security definer
-- "pula" o RLS na consulta interna). Sem isso, uma política de "profiles"
-- que consulta "profiles" pra saber o cargo do usuário cria um ciclo
-- infinito e o Postgres recusa a consulta com "infinite recursion
-- detected in policy" — inclusive em SELECTs simples do próprio perfil.
create or replace function public.has_role(roles text[])
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = any(roles)
  );
$$;

drop policy if exists "usuário lê o próprio perfil" on profiles;
create policy "usuário lê o próprio perfil"
  on profiles for select
  using (auth.uid() = id);

drop policy if exists "banca e admin leem todos os perfis" on profiles;
create policy "banca e admin leem todos os perfis"
  on profiles for select
  using (public.has_role(array['banca', 'admin']));

-- NOVO (sistema de dupla): pra um aluno convidar o colega de dupla pelo
-- e-mail, ele precisa achar o perfil da outra pessoa primeiro — por isso
-- essa política abre a leitura de "profiles" pra qualquer usuário logado
-- (as políticas de RLS de uma mesma ação se somam com "OU", então isso só
-- amplia quem pode ler, nunca restringe as de cima). Continua exigindo
-- login; ninguém de fora consegue listar os perfis.
drop policy if exists "qualquer usuário logado pode localizar perfil pra dupla" on profiles;
create policy "qualquer usuário logado pode localizar perfil pra dupla"
  on profiles for select
  using (auth.uid() is not null);

drop policy if exists "usuário cria o próprio perfil no cadastro" on profiles;
create policy "usuário cria o próprio perfil no cadastro"
  on profiles for insert
  with check (auth.uid() = id);

drop policy if exists "admin atualiza qualquer perfil (ex: promover a banca)" on profiles;
create policy "admin atualiza qualquer perfil (ex: promover a banca)"
  on profiles for update
  using (public.has_role(array['admin']));

-- 2. Jogos: um jogo salvo por um aluno (ou por uma dupla — ver partner_id).
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

-- CORREÇÃO IMPORTANTE: o app (public/js/tabs/testTab.js, bancaTab.js,
-- adminTab.js) já lia/escrevia estas colunas, mas elas nunca tinham sido
-- criadas aqui — isso fazia TODO save (INSERT/UPDATE em `games`) falhar
-- silenciosamente contra o Postgres real ("column ... does not exist"),
-- e por tabela completa (sprites, mecânicas, histórico de chat e código)
-- não sobrevivia a um "Salvar" + recarregar a página. As linhas abaixo
-- adicionam exatamente o que faltava:
alter table games add column if not exists status text not null default 'rascunho';
alter table games add column if not exists game_code text;
alter table games add column if not exists chat_history jsonb default '[]';
alter table games add column if not exists updated_at timestamptz not null default now();
alter table games add column if not exists submitted_at timestamptz;

-- NOVO: fundo de fase (aba Perfil, "carregar um fundo para as fases") e
-- sistema de dupla (nome da equipe + segundo integrante).
alter table games add column if not exists background_image text;
alter table games add column if not exists team_name text;
alter table games add column if not exists partner_id uuid references auth.users (id) on delete set null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'games_status_check'
  ) then
    alter table games add constraint games_status_check check (status in ('rascunho', 'enviado'));
  end if;
end $$;

-- Mantém updated_at em dia mesmo se algum dia um UPDATE esquecer de
-- setá-lo na mão (o app já seta pelo lado do JS, isso é só um cinto de
-- segurança extra — importante porque a ordenação "mais recente primeiro"
-- em vários lugares do app depende de updated_at estar sempre correto).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists games_touch_updated_at on games;
create trigger games_touch_updated_at
  before update on games
  for each row execute function public.touch_updated_at();

alter table games enable row level security;

drop policy if exists "aluno gerencia os próprios jogos" on games;
create policy "aluno gerencia os próprios jogos"
  on games for all
  using (auth.uid() = user_id or auth.uid() = partner_id)
  with check (auth.uid() = user_id or auth.uid() = partner_id);

drop policy if exists "banca e admin leem todos os jogos" on games;
create policy "banca e admin leem todos os jogos"
  on games for select
  using (public.has_role(array['banca', 'admin']));

-- 3. Notas: avaliação de um jogo por um membro da banca.
--
-- ATUALIZAÇÃO: cada membro da banca agora avalia de 0 A 4 (antes era
-- 0 a 10) — só isso muda; a lógica de "uma nota por avaliador por jogo"
-- continua igual.
create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games (id) on delete cascade,
  banca_id uuid not null references auth.users (id) on delete cascade,
  nota numeric(4, 1) not null check (nota >= 0 and nota <= 4),
  comentario text,
  created_at timestamptz not null default now(),
  unique (game_id, banca_id)
);

do $$ begin
  alter table scores drop constraint if exists scores_nota_check;
  alter table scores add constraint scores_nota_check check (nota >= 0 and nota <= 4);
exception when others then
  null; -- se já tiver notas antigas > 4 de uma avaliação anterior, ajuste manualmente antes de reaplicar
end $$;

alter table scores enable row level security;

drop policy if exists "banca e admin criam e leem notas" on scores;
create policy "banca e admin criam e leem notas"
  on scores for all
  using (public.has_role(array['banca', 'admin']))
  with check (public.has_role(array['banca', 'admin']));

drop policy if exists "aluno vê as notas dos próprios jogos" on scores;
create policy "aluno vê as notas dos próprios jogos"
  on scores for select
  using (
    exists (
      select 1 from games g
      where g.id = scores.game_id and (g.user_id = auth.uid() or g.partner_id = auth.uid())
    )
  );

-- 4. NOVO — Lore: a história do mundo/personagens/inimigos/bosses/NPCs de
-- cada jogo. Fica em branco até o aluno escrever (ou pedir pra IA gerar
-- algo simples). `ai_generated` marca quando foi a IA que escreveu — o
-- app mostra um aviso pra banca nesse caso, deixando explícito que a
-- lore não foi feita pelo aluno.
create table if not exists lore (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null unique references games (id) on delete cascade,
  content text not null default '',
  ai_generated boolean not null default false,
  updated_at timestamptz not null default now()
);

drop trigger if exists lore_touch_updated_at on lore;
create trigger lore_touch_updated_at
  before update on lore
  for each row execute function public.touch_updated_at();

alter table lore enable row level security;

drop policy if exists "aluno gerencia a lore dos próprios jogos" on lore;
create policy "aluno gerencia a lore dos próprios jogos"
  on lore for all
  using (
    exists (
      select 1 from games g
      where g.id = lore.game_id and (g.user_id = auth.uid() or g.partner_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from games g
      where g.id = lore.game_id and (g.user_id = auth.uid() or g.partner_id = auth.uid())
    )
  );

drop policy if exists "banca e admin leem a lore de qualquer jogo" on lore;
create policy "banca e admin leem a lore de qualquer jogo"
  on lore for select
  using (public.has_role(array['banca', 'admin']));

-- 5. NOVO — Perfil (de uso): quanto tempo cada aluno já usou a engine e
-- qual é o jogo atual dele — mostrado na aba "Perfil". É uma tabela
-- separada de `profiles` (que é só o cargo de login) de propósito, pra
-- não misturar autenticação com estatística de uso. Também guarda qual
-- foi a última versão do "update log" que a pessoa já viu (item 3).
create table if not exists perfil (
  id uuid primary key references auth.users (id) on delete cascade,
  total_seconds integer not null default 0,
  current_game_id uuid references games (id) on delete set null,
  last_seen_update_version text,
  updated_at timestamptz not null default now()
);

drop trigger if exists perfil_touch_updated_at on perfil;
create trigger perfil_touch_updated_at
  before update on perfil
  for each row execute function public.touch_updated_at();

alter table perfil enable row level security;

drop policy if exists "usuário gerencia o próprio perfil de uso" on perfil;
create policy "usuário gerencia o próprio perfil de uso"
  on perfil for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "banca e admin leem o perfil de uso de qualquer aluno" on perfil;
create policy "banca e admin leem o perfil de uso de qualquer aluno"
  on perfil for select
  using (public.has_role(array['banca', 'admin']));

-- 6. NOVO — Update log: o que muda em cada atualização da engine. Na
-- PRIMEIRA vez que alguém entra depois de uma atualização (comparando com
-- `perfil.last_seen_update_version`), o app mostra essa tabela num modal.
create table if not exists update_logs (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  content text not null, -- markdown simples (linhas com "- " viram lista)
  created_at timestamptz not null default now()
);

alter table update_logs enable row level security;

drop policy if exists "qualquer usuário logado lê os updates" on update_logs;
create policy "qualquer usuário logado lê os updates"
  on update_logs for select
  using (auth.uid() is not null);

drop policy if exists "admin cria updates" on update_logs;
create policy "admin cria updates"
  on update_logs for all
  using (public.has_role(array['admin']))
  with check (public.has_role(array['admin']));

-- Registro desta própria atualização (id fixo "v2" — troque/adicione uma
-- linha nova a cada atualização futura, com uma versão nova).
insert into update_logs (version, title, content)
values (
  'v2',
  '🚀 Grande atualização da VibeGame Engine',
  '- **Salvamentos corrigidos**: agora TUDO do seu jogo (sprites, mecânicas, histórico de chat e código) é salvo e recarregado direitinho.
- **Aba Perfil**: veja quanto tempo já usou a engine, qual é o jogo atual, mude o nome do jogo e carregue um fundo pras fases.
- **Aba Lore**: escreva a história do seu mundo, personagens, inimigos, bosses e NPCs. Se deixar em branco, a IA pode gerar uma versão simples — mas isso fica marcado pra banca.
- **Nota da banca**: agora cada avaliador dá de 0 a 4 pontos (antes era 0 a 10).
- **Sistema de dupla**: dá pra fazer o jogo em dupla — os dois editam sprites, mecânicas e conversam com a mesma IA no mesmo projeto. Antes de enviar pra avaliação, é obrigatório informar o nome da dupla.'
)
on conflict (version) do nothing;

-- v3: rework da aba Personagens (pixel art/animação) — chega DEPOIS da v2
-- acima, sem apagá-la; cada `insert ... on conflict do nothing` só
-- adiciona a sua própria versão, então quem já viu a v2 continua vendo
-- (e quem ainda não viu nenhuma vê as duas, na ordem, já que o modal
-- sempre mostra a mais recente e marca como vista).
insert into update_logs (version, title, content)
values (
  'v3',
  '🎨 Rework do sistema de Pixel Art',
  '- **Onion skin**: veja o frame anterior e o seguinte por baixo do frame atual pra animar sem precisar decorar a pose.
- **Espelhar** o frame desenhado na horizontal ou na vertical com um clique.
- **Refazer (redo)**: agora dá pra desfazer E refazer, não só desfazer.
- **Ferramentas de linha e retângulo**, com prévia ao vivo antes de soltar o clique — contornos retos sem precisar ir pixel a pixel.
- **Seleção**: marque uma área do desenho pra copiar, colar, recortar ou mover — inclusive entre frames diferentes.
- **Atalhos de teclado**: B/E/G/I/L/R/S trocam de ferramenta, Ctrl+Z/Y desfaz/refaz, Ctrl+C/V/X copia/cola/recorta, Delete apaga a seleção, ← → troca de frame.'
)
on conflict (version) do nothing;

-- Dica: para transformar um usuário em "banca" ou "admin" depois do
-- cadastro, rode manualmente (uma vez, com o e-mail da pessoa):
--   update profiles set role = 'banca' where email = 'avaliador@escola.com';
