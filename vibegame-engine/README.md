# VibeGame Engine

Estúdio web onde o aluno conversa com uma IA para criar jogos em HTML5/Canvas,
mas também edita cada aspecto do jogo manualmente — sem depender só da IA.
Feito para uma olimpíada de criação de jogos (projeto de extensão universitária).

## v2 — grande atualização

- **Salvamentos corrigidos**: o `supabase/schema.sql` estava sem várias
  colunas que o app já usava (`status`, `updated_at`, `submitted_at`,
  `game_code`, `chat_history`) — isso fazia todo `INSERT`/`UPDATE` em
  `games` falhar contra o Postgres, e por isso sprites/mecânicas/chat não
  sobreviviam a um "Salvar" + recarregar. **Se seu projeto Supabase já
  existe, cole o `schema.sql` inteiro de novo no SQL Editor** — todo
  comando usa `if not exists`/`or replace`, então só cria o que falta, sem
  apagar nada.
- **Aba Perfil**: tempo de uso da engine, jogo atual, renomear o jogo e
  carregar um fundo de fase (`window.VIBE_BACKGROUND`, que a IA agora usa
  como pano de fundo do jogo). É também onde se vincula o colega de dupla.
- **Aba Lore**: história do mundo/personagens/inimigos/bosses/NPCs, usada
  como contexto pra IA. Pode ser gerada (simples) por IA sob pedido — nesse
  caso fica marcada e a aba Avaliação avisa a banca que não foi o aluno
  quem escreveu.
- **Update log**: no primeiro login depois de uma atualização, aparece um
  modal com o que mudou (tabela `update_logs`).
- **Nota da banca**: de 0–10 para **0–4** por avaliador (`scores.nota`).
- **Sistema de dupla**: nome da dupla obrigatório antes de enviar pra
  avaliação; um colega pode ser vinculado pelo e-mail e passa a
  compartilhar o mesmo projeto (sprites, mecânicas, chat, lore). Como o
  cliente Supabase deste projeto é fetch puro (sem WebSocket/Realtime), a
  sincronização entre os dois é por polling a cada ~4s — não é
  instantâneo, mas os dois convergem pro mesmo estado sozinhos.

## O que mudou na reformulação anterior

- **Multi-abas**: IA (chat), Personagens (pixel art manual), Mecânicas (regras
  do jogo sem precisar de prompt), Testar (preview + download), e Avaliação
  (só para banca/admin).
- **Editor de pixel art de verdade**: canvas com pincel, borracha, balde de
  tinta, conta-gotas, paleta e grid de 16/24/32px. O que o aluno desenha vai
  para `window.VIBE_SPRITES` e a IA é instruída a usar exatamente essa arte
  em vez de inventar a dela. Quando a IA desenha sprites por conta própria
  (aluno ainda não desenhou nada), ela devolve a matriz de pixels usada num
  terceiro bloco (`SPRITES_DATA`) que a engine importa automaticamente para
  a galeria — o aluno pode abrir e editar à mão, e ao clicar em "Reiniciar"
  (sem precisar pedir de novo à IA) a edição já aparece, porque o jogo
  sempre lê de `SPR` em vez de guardar uma cópia própria.
- **Mecânicas configuráveis por formulário**: gravidade, força de pulo,
  velocidade, vidas, IA dos inimigos, condição de vitória, ambientação etc.
  vão para `window.VIBE_MECHANICS` e a IA deve respeitá-las.
- **IA reforçada** (`js/prompts.js`): técnica explícita de pixel art (matriz
  de pixels, outline, sombreamento, paleta por cenário), "juice" (partículas,
  screen shake, parallax), delta time, e o contrato de ler os globals acima.
- **Chave de IA saiu do navegador**: agora fica em uma variável de ambiente
  no servidor (`functions/ai-chat.js`, uma Netlify Function), nunca mais no
  `localStorage` do aluno.
- **Login com cargos** via Supabase Auth: `aluno`, `banca`, `admin`. Aluno
  cria e salva jogos; banca avalia; admin promove pessoas de cargo.

## Estrutura

```
vibegame-engine/
├── netlify.toml
├── functions/
│   └── ai-chat.js        → proxy seguro pra IA (chave fica só aqui)
├── supabase/
│   └── schema.sql         → tabelas + RLS (profiles, games, scores, lore, perfil, update_logs)
└── public/                 → tudo que o Netlify serve como site estático
    ├── index.html
    ├── css/style.css
    └── js/
        ├── config.js          → URL/chave anon do seu projeto Supabase
        ├── supabaseClient.js  → cliente Supabase leve (fetch puro)
        ├── auth.js            → tela de login/cadastro
        ├── state.js           → estado do projeto atual
        ├── prompts.js         → system prompt + templates de gênero
        ├── api.js             → chama a Netlify Function
        ├── codeGen.js         → injeta sprites/mecânicas/fundo no jogo final
        ├── ui.js               → helpers (abas, toasts, modal genérico)
        ├── team.js             → sistema de dupla (vincular colega + sync por polling)
        ├── usageTracking.js    → tempo de uso da engine (aba Perfil)
        ├── updateLog.js        → modal de novidades no primeiro login pós-atualização
        ├── pixelArt/canvasEngine.js  → motor do editor de pixel art
        └── tabs/
            ├── chatTab.js
            ├── pixelEditorTab.js
            ├── mechanicsTab.js
            ├── loreTab.js
            ├── perfilTab.js
            ├── testTab.js
            ├── bancaTab.js
            └── adminTab.js
```

## Como rodar localmente

Como `js/main.js` usa ES Modules, precisa servir por HTTP (não `file://`):

```bash
cd public
python3 -m http.server 8080
```

Só que sem a Netlify Function local o chat com a IA não vai funcionar. Para
testar tudo (incluindo a função serverless), use a CLI do Netlify:

```bash
npm install -g netlify-cli
netlify dev
```

## Deploy (passo a passo)

### 1. Crie o projeto no Supabase
1. Crie um projeto em [supabase.com](https://supabase.com).
2. Vá em **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e rode.
3. Vá em **Settings → API** e copie a **Project URL** e a **anon public key**.
4. Cole os dois valores em `public/js/config.js`.
5. (Opcional, recomendado) Em **Settings → API → environment**, anote
   também a URL e a anon key para usar como variáveis de ambiente no Netlify
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) — isso ativa a verificação de sessão
   na função serverless.

### 2. Pegue uma chave de IA (Gemini)
1. Crie uma chave em [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Guarde-a — ela vai *só* para uma variável de ambiente no Netlify, nunca
   para o código.

### 3. Deploy no Netlify
1. Suba esta pasta para um repositório no GitHub.
2. No Netlify: **Add new site → Import an existing project**, conecte o repo.
3. Build settings: publish directory `public`, functions directory
   `functions` (já vêm do `netlify.toml`, não precisa mexer).
4. Em **Site settings → Environment variables**, adicione:
   - `GEMINI_API_KEY` = sua chave do Gemini
   - `GEMINI_MODEL` = (opcional) para trocar o modelo sem editar código, ex. `gemini-3.6-flash`. Se não configurar, o padrão já é `gemini-3.6-flash`.
   - `GEMINI_FALLBACK_MODEL` = (opcional) modelo de reserva usado só quando o principal está sobrecarregado. Padrão: `gemini-3.5-flash-lite`. A Google tem descontinuado modelos da família 2.x sem muito aviso — se um dia aparecer erro de "modelo não disponível", é só trocar essa variável (ou o valor padrão no código) pro modelo atual.
   - `SUPABASE_URL` = URL do seu projeto (opcional, ativa checagem de sessão)
   - `SUPABASE_ANON_KEY` = anon key do seu projeto (opcional)
5. Deploy. Pronto — o site já sobe com login funcionando.

### 4. Promova as pessoas da banca
Por padrão todo mundo que se cadastra vira `aluno`. Para dar acesso de banca
aos 8 avaliadores, rode no SQL Editor do Supabase (depois que cada um se
cadastrar uma vez):

```sql
update profiles set role = 'banca' where email = 'avaliador1@escola.com';
```

Para se tornar `admin`, mesma ideia com `role = 'admin'`.

## Próximos passos sugeridos
- Exportar/importar sprites como PNG real (hoje já exporta `.png` via
  `toDataURL`, falta o botão de importar imagem existente pixel a pixel).
- Aba "Cenário" dedicada a tiles de fundo, separada de Mecânicas.
- Limite de chamadas à IA por aluno/dia (evitar estourar custo da chave).
- Painel do admin para listar/gerenciar todos os cargos pela própria UI
  (hoje isso é feito via SQL manual).
