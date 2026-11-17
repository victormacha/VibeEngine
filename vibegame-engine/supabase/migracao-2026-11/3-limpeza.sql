-- =====================================================================
-- Migração nov/2026 — passo 3 (só depois de testar o site novo)
-- =====================================================================

-- Conferência: deve dar 0
select count(*) as fundos_ainda_em_base64
from public.games
where background_image like 'data:%';

-- Tamanho da tabela agora (antes: ~52 MB)
select pg_size_pretty(pg_total_relation_size('public.games')) as tamanho_games;

-- Para o Postgres devolver o espaço, selecione SÓ a linha abaixo e clique em Run:
-- vacuum full public.games;

-- Uns dias depois, com tudo certo, pode apagar o backup:
-- drop table public.games_backup_20261116;
