# ChaosBey — Owner Decisions Master

**Status:** CANÔNICO — ledger de decisões fechadas do owner e regra de não reabrir perguntas já respondidas  
**Atualizado:** 2026-10-02  
**Precedência:** este arquivo registra decisões/overrides mais recentes e deve ser lido antes dos masters históricos. Quando houver conflito, a decisão explícita mais recente do owner e o documento detalhado mais recente da área prevalecem.

> **Diretiva do owner — 2026-09-30:** não reprototipar, rediscutir ou pedir nova aprovação para câmera, movimento, arena, VFX, condição ou Clash apenas porque outro sistema (por exemplo HUD/UI) ainda tenha uma pendência visual. Um novo lab deve testar somente a lacuna real que ainda estiver aberta e usar os sistemas já aprovados como base.

> **Regra de segurança:** “aprovado”, “integrado” e “prototipado” continuam sendo estados diferentes. Este ledger não inventa uma aprovação ausente. Quando um item estiver realmente aberto, ele aparece explicitamente na seção final.

---

## 1. Fontes e ordem de leitura

Para qualquer trabalho de design:

1. leia este `OWNER_DECISIONS_MASTER.md`;
2. leia `VISUAL_APPROVALS_MASTER.md` para o mapa visual consolidado;
3. leia o documento detalhado da área;
4. use `visual-prototype-inventory.md` apenas como inventário/histórico;
5. confira o código/README/status do milestone para saber se algo já foi integrado.

Documentos detalhados:

- `visual-prototypes-approval.md` — Beys, Arena e VFX;
- `condition-visual-approval.md` — Stamina / Stability / Quebrado;
- `camera-approval.md` — Camera Director / Camera Lab e histórico de playtests;
- `camera-gameplay-separation.md` — regra causal: câmera nunca move o Bey; quatro referenciais de controle;
- `inertial-duel-camera.md` — override de 2026-10-02 para yaw/composição da câmera de combate atual;
- `motion-approval.md` — movimento e Motion Lab;
- `clash-presentation-approval.md` — apresentação do Clash;
- `m10-status.md` / `m11-status.md` — integração de player flow e pós-M11.

---

# 2. Identidade geral do jogo — FECHADO

- jogo 3D em navegador desktop;
- Three.js + Rapier 3D + TypeScript + Vite;
- deploy via GitHub Pages;
- Player vs AI é o modo principal;
- não existe campanha/narrativa/progressão planejada agora;
- direção geral: anime estilizado;
- tom ambiental: escuro;
- intensidade geral alvo: **7/10**;
- velocidade geral de movimento/combate alvo: **7/10**;
- prioridade de público: acessibilidade casual;
- prioridade de design: equilibrar diversão, espetáculo e profundidade mecânica.

Não reabrir essas escolhas sem instrução explícita do owner.

---

# 3. Controles e linguagem de movimento — FECHADO NO CONCEITO

Controles-base:

- setas: movimento/direção;
- `Z`: ataque;
- `X`: hop / jump / drift;
- `C`: dodge;
- `Esc` / Start: pause.

Drift:

- linguagem inspirada em kart/Mario Kart, não strafe;
- toque em `X` faz o pequeno hop;
- segurar `X` com direção entra em drift/slip;
- soltar recupera grip gradualmente;
- momentum, heading e velocity não são a mesma coisa;
- não há mini-turbo aprovado por default.

Movimento físico obrigatório como linguagem:

- momentum;
- heading diferente de velocity;
- grip/slip e recuperação de grip;
- tilt/lean em alta velocidade;
- wobble;
- resposta tipo precessão;
- perturbação angular por impacto;
- knockback linear + angular;
- tumble/rodopio;
- floor bounce e wall bounce;
- ricochete;
- wall scrape;
- recuperação gradual ao prumo.

Os Beys devem parecer piões físicos: podem inclinar em alta velocidade, balançar, quicar, raspar, ricochetear e rodopiar após knockback sem virar discos deslizantes.

Direções do Motion Lab preservadas:

- A — Stable Arcade;
- B — Physical Hybrid;
- C — Wild Mechanical.

**Nota de precedência:** o `motion-approval.md` foi atualizado posteriormente para registrar a integração M11 das três direções no jogo, com seleção em Pregame e B como padrão. Textos históricos anteriores que diziam “não integrado” não devem ser tratados como estado atual de produção.

---

# 4. Beys — FECHADO NO QUE JÁ FOI APROVADO

## 4.1 Roster

**Todos os 9 conceitos aprovados são selecionáveis/jogáveis.**

- Attack A;
- Attack B;
- Attack C;
- Defense A;
- Defense B;
- Defense C;
- Stamina A;
- Stamina B;
- Stamina C.

Qualquer texto antigo dizendo “escolher somente 3 Beys finais” está **SUPERSEDED**.

## 4.2 Anatomia visual

Todo Bey usa quatro peças:

1. Top Layer;
2. Ring;
3. Disc;
4. Driver.

Regras já aprovadas:

- Ring > Disc > topo do Driver;
- Disc lateralmente legível;
- Top Layer menor e encaixada;
- sulcos/encaixes entre as peças;
- Driver convergindo para ponta longa e visível;
- combinação de plástico pintado, metal, material escuro, peça translúcida e pequeno detalhe emissivo;
- mesh visual separado do collider;
- as quatro peças giram juntas e recebem tilt/wobble como conjunto.

Não reduzir novamente o roster nem voltar à rodada 1 como direção final.

---

# 5. Arena — VISUAL APROVADO

Geometria visual histórica do lab:

- raio de referência original: **12 m**;
- bowl côncavo;
- borda aproximadamente **3,2 m acima do centro** no protótipo original;
- parede medida a partir do rim.

**Owner override de escala já integrado (2026-10-02 / arena scale pass):** o stage de jogo foi ampliado para **3×**, com raio de piso **36 m**, ring-out em **36,9 m** e centro do bowl default aproximadamente **2,5 m abaixo do rim**. Valores antigos de 12 m continuam úteis para o histórico/proporções do lab, mas não são o limite espacial do jogo atual nem da câmera.

Três direções visuais aprovadas:

- **A — Foundry Pit**;
- **B — Rift Crater**;
- **C — Tournament Stadium**.

As três têm linguagem própria de material, iluminação, faíscas e reação ao Clash.

Perfis de bowl aprovados visualmente:

- Foundry: parabólico;
- Rift: funil mais contínuo;
- Tournament: platô central + curva.

Não criar uma quarta “arena genérica” para substituir essas direções num lab de outro sistema.

O que a aprovação visual **não decide sozinha** está listado na seção de pendências reais.

---

# 6. VFX — APROVADO

Direção principal:

- **C — Híbrida**.

Ela combina contato/desgaste mecânico com leitura de impacto anime.

Momentos já cobertos/aprovados:

- colisão/golpe;
- Dash — carga e soltura;
- Circular Attack / counter;
- Perfect Dodge;
- wind burst / avanço;
- Stability Break;
- landing;
- wall scrape;
- ring-out.

Wind burst aprovado:

- **Cel Cyclone**.

O VFX Lab registra **36 valores finais de tuning**. Usar a configuração `APPROVED` como referência, sem refazer um VFX Lab genérico.

Regra funcional:

- VFX observa o gameplay e escala com magnitude real;
- VFX nunca decide resultado físico/combat.

---

# 7. Stamina / Stability / Quebrado — APROVADO

Camada física comum sempre ativa:

- giro visual desacelera com Stamina;
- wobble/precessão aumentam conforme a condição piora;
- impacto afeta leitura física;
- Quebrado tem leitura persistente;
- spin-out ocorre no fim da Stamina.

Três direções visuais aprovadas e combináveis:

- **A — Desgaste Mecânico**;
- **B — Aura de Espírito**;
- **C — Instrumento no Chão**.

Nas Configurações, o jogador pode deixar ligadas quaisquer **1, 2 ou 3** direções; pelo menos uma deve permanecer ativa. A camada física comum não é opcional.

Valores finais:

- **49 parâmetros aprovados** no documento de condição.

Decisões específicas fechadas:

- contorno vermelho da direção B desligado;
- coluna vermelha de luz da direção C removida;
- Stability Break pontual vem do VFX Híbrido;
- as camadas A/B/C mostram estado contínuo.

**Importante:** a direção C é diegética e não é o HUD de tela.

---

# 8. Câmera — APROVADA, COM OVERRIDE DE COMPOSIÇÃO EM 2026-10-02

Presets aprovados e preservados:

- **A — Arena Fighter**;
- **B — Cinematic Hybrid**;
- **C — Hyper Dynamic**.

O jogador usa uma câmera por vez. São presets do mesmo sistema de câmera.

Modos já prototipados/aprovados e preservados:

- CombatFollow;
- HighSpeed;
- CloseCombat;
- KnockbackFollow;
- Clash;
- RingOut;
- Finisher.

Cada preset mantém os **43 valores aprovados** no Camera Lab como base de FOV, shake, framing/contextos e transições.

Regra do Clash permanece:

- durante Clash, a câmera é **sempre B — Cinematic Hybrid**;
- o shot especial do Clash toma a apresentação;
- isso vale mesmo que o jogador tenha A ou C selecionada fora do Clash.

### Override mais recente — Inertial Duel Camera

O owner aprovou em 2026-10-02 a implementação de uma câmera de duelo inercial para corrigir o problema crônico de a câmera reorganizar o espaço quando os Beys se cruzam.

**Regra final de yaw normal de combate:**

- o eixo instantâneo jogador→oponente **não** é mais autoridade direta do yaw final;
- o rig mantém um **azimute de combate persistente**;
- enquanto ambos os Beys estiverem dentro de uma composição segura, yaw pode permanecer completamente estável;
- os Beys podem cruzar/trocar de lado na tela sem obrigar a câmera a girar junto;
- framing pressure é resolvido primeiro por foco, pull-back, FOV e pequena compensação vertical;
- yaw é último recurso, pela menor direção útil, com limite de velocidade **e aceleração angular**;
- Clash/Ring-Out/Finisher podem tomar o shot, mas o azimute normal fica congelado por baixo e retorna por blend;
- containment e antecipação de ring-out usam a escala real da arena 36 m.

**Precedência:** qualquer texto histórico que descreva “automatic orbit”, “side switching” ou o eixo jogador→oponente como autoridade contínua/final do yaw do rig de jogo está **SUPERSEDED** nessa parte. `camera-approval.md` continua sendo a referência do Camera Lab e dos presets/contextos; `inertial-duel-camera.md` é a referência do comportamento final de composição/yaw no jogo.

### Regra causal — câmera nunca move o Bey

Também permanece fechada a decisão de separação câmera×gameplay:

- `opponent`, `classic` e `arena` são independentes da câmera;
- `screen` é a única opção explicitamente camera-relative e captura a orientação no início do gesto;
- câmera observa gameplay; não escreve input, `moveIntent`, física, IA, drift ou simulação.

Não criar novas câmeras “de HUD” para reprototipar esses modos e não reintroduzir axis-follow contínuo sob outro nome.

---

# 9. Clash — APRESENTAÇÃO APROVADA

Direção aprovada:

- **C — Overdrive**;
- câmera **B — Cinematic Hybrid**.

Comportamento aprovado:

- contato visual travado entre os Beys durante Active;
- inclinação contra o ponto de contato;
- tremor/esforço e resposta visual ao mash;
- speedlines convergindo no contato com zona limpa ao redor dos Beys;
- poeira/fagulhas contínuas no contato, tingidas pela arena;
- barra de força entre os Beys;
- duas metades nas cores `palette.glow`;
- barra segue ClashPower real ao vivo;
- fórmula visual de ganho aprovada com ganho ×4;
- sem texto e sem números na barra;
- geometria/vórtice giratório entre os Beys foi descartada;
- resolução sem banner de vitória/derrota;
- resolução sem pausa, sem hitstop e sem slow motion disparados pelo resultado;
- knockback e combate continuam fisicamente após resolver.

Regras do Clash já existentes continuam separadas da apresentação, incluindo:

- janela de 150 ms para golpes compatíveis;
- Active em torno de 4 s;
- Z/X/C no mesmo tick contam como **um** evento de mash, não três;
- cooldown próprio;
- ClashPower usa performance de mash, Stamina e velocidade.

Não criar outro “Clash visual” dentro de HUD/UI.

---

# 10. HUD — O QUE JÁ ESTÁ DEFINIDO

O HUD de combate **deve comunicar**:

- Stamina;
- Stability;
- cooldown do Dash (linha CD; substituiu Attack Energy / recurso ofensivo — owner, 2026-10-02);
- cooldowns relevantes;
- feedback de lock-on do Dash;
- outros estados/recursos necessários à leitura do combate;
- informação de round/placar quando aplicável;
- perigo de ring-out pode ser comunicado.

Player name e portrait não são obrigatórios durante a luta.

Componentes que **não devem ser confundidos com o HUD geral**:

- Instrumento no Chão da Condition C é diegético;
- barra do Clash é específica do Clash e já está aprovada;
- minimapas, sliders, timelines e readouts dos Labs são debug/instrumentação.

## Decisão do owner — 2026-10-02: NÃO existe Combat HUD Lab

O Combat HUD Lab **não precisa existir** (owner, repetido várias vezes). A PR #64 foi fechada.

- não criar, reabrir, atualizar nem propor um Combat HUD Lab;
- não pedir ao owner uma escolha "HUD A/B/C" — essa escolha **não está pendente**;
- o HUD do jogo é o `CombatHud` existente; mudanças nele seguem pedidos diretos do owner, não um Lab.

## Diretiva de escopo para qualquer trabalho futuro de HUD (histórica; ver decisão acima)

Um Combat HUD Lab, caso ainda seja necessário, deve testar **somente** a lacuna de layout/estética/legibilidade do HUD de tela.

Ele **não deve**:

- recriar câmera;
- inventar nova arena;
- reprototipar Motion;
- reprototipar VFX;
- reprototipar Condition;
- reprototipar Clash;
- alterar física;
- alterar regras de recursos;
- alterar IA.

O HUD deve ser colocado sobre os sistemas reais/aprovados.

---

# 11. UI / fluxo do jogador — FUNÇÃO DEFINIDA, TEMA VISUAL FINAL SEPARADO

Fluxo funcional existente/definido inclui:

- Main Menu;
- Character Select;
- Pregame Setup;
- combate/rounds;
- Pause;
- Results;
- Settings;
- Developer / Debug separado do fluxo normal.

Pregame é a tela para selecionar/configurar opções de partida que foram autorizadas para exposição; Debug Lab fica responsável por tuning profundo.

A existência funcional dessas telas não transforma automaticamente a aparência provisória atual em tema visual final aprovado.

---

# 12. Regra de precedência sobre documentos antigos

As seguintes formulações antigas não devem ser lidas literalmente quando entrarem em conflito com decisões posteriores:

- “3 Beys finais” → **SUPERSEDED: são 9 selecionáveis**;
- “Bey visual ainda não definido” → anatomia de 4 peças e os 9 conceitos já foram aprovados;
- “Arena/VFX/Condition/Camera/Clash não existem” → **SUPERSEDED**;
- “RingOut/Finisher/Clash camera ainda precisam de lab” → **SUPERSEDED**;
- “Clash presentation completa ainda falta” → **SUPERSEDED**;
- “Motion não integrado” → usar o estado posterior do `motion-approval.md` / M11;
- “VFX detalhado de ataques é totalmente aberto” → o pacote Híbrido aprovado cobre os momentos listados na seção 6;
- “Condition C é o HUD final” → falso: é elemento diegético;
- “uma pendência de HUD autoriza reprototipar todo o combate” → falso;
- “12 m é a escala espacial atual da arena” → **SUPERSEDED para implementação atual: o stage de jogo é 3× / 36 m**;
- “o rig final deve perseguir continuamente o eixo jogador→oponente / fazer automatic orbit para provar que está ativo” → **SUPERSEDED pela Inertial Duel Camera de 2026-10-02**.

---

# 12.1 Correções de gameplay e apresentação — owner, 2026-10-02

Pedido do owner de 2026-10-02 ("correções de gameplay e apresentação"), executado em lotes, um PR por lote. Cada override abaixo vale a partir do lote indicado. Valores **PROVISÓRIOS** não têm número do owner: ficam marcados no código, expostos como slider no Pregame (gameplay) e podem mudar sem nova pergunta de design.

| Item | Decisão / override | Valor | Lote / versão |
|---|---|---|---|
| 17 — Ring-out | O ring-out só conta depois que o Bey fica fora do raio continuamente pelo **Ring-out delay**; voltar para dentro zera o contador. 0 = regra antiga (instantânea). Um Bey que caiu da arena (mais de 1 m abaixo da superfície do chão sob ele — a borda, além do chão) conta como fora em qualquer raio: sem isso, com o delay, um Bey jogado por cima da parede podia voltar por baixo do bowl e o round nunca terminava. `MatchConfig.ringOutDelayS`, determinístico, no replay e no hash (schema 2). | **1,5 s PROVISÓRIO**; slider Pregame 0–3 s, passo 0,25 | Lote 1 / 0.17.0 |
| 8a — Perfect Dodge | `dodged` / `perfectDodge` são reportados **uma vez por esquiva e por ataque** (antes: a cada tick de sobreposição). Consequência de jogo: o hitstop do Perfect Dodge também acontece uma vez só (antes repetia). A anulação do golpe continua em todo tick. | — | Lote 1 / 0.17.0 |
| 18 — Efeitos no chão | Ondas de impacto, aura de carga, rachaduras, marcas de arrasto e de ponta acompanham a curvatura real do chão (bowl), em vez de um plano reto enterrado. Só apresentação; colliders intactos. | — | Lote 1 / 0.17.0 |
| 4 — Speedlines do Clash | O overlay limpa o canvas inteiro em qualquer zoom do navegador (antes ficavam rastros com `devicePixelRatio` < 1). | — | Lote 1 / 0.17.0 |
| 1/2/19 — Dash | O Dash **não** é limitado por recurso: Attack Energy foi removida do jogo. Há um **cooldown** entre Dashes (jogador e IA), que começa quando o Dash termina (acerto ou erro); segurar Z durante o cooldown espera e carrega quando fica pronto. HUD: a linha ATK virou **CD** (esvazia ao usar, enche no cooldown, cheia = pronto); a linha DASH continua mostrando a carga. O Dash só gasta Stamina pelo dreno normal de movimento. Todo Dash solta vento + poeira (Cel Cyclone) com intensidade mínima Light (0,3) do protótipo. | **Dash cooldown 1,5 s PROVISÓRIO**; slider Pregame 0,5–5 s, passo 0,25 | Lote 2 / 0.18.0 |
| 5/9/11 — Momentum e colisões | Novo recurso **momentum** (0..1) por Bey: sobe com movimento rápido e sustentado sem curva brusca (> 50% do teto atual), cai ao frear, curva fechada, parar, levar hit ou bater em parede. Teto de velocidade = max × (1 + momentum × ganho). **Colisão de corpo** sem ataque: o mais lento leva dano de Stability ∝ diferença de velocidade + knockback, o mais rápido perde momentum; empate = dano mínimo simétrico; i-frames de dodge e Circular ativo são imunes. Evento `collisionResolved` com magnitude ∝ dano. HUD: linha fina de momentum. IA se compromete mais (aproximação, Dash) com momentum alto; as aproximações retas é que o constroem (um bônus para circular e construir causou impasse entre IAs pacientes e foi descartado). | **Ganho +100%, enchimento 4 s, decaimento 2 s** (números do owner); **dano de colisão ×1 = Circular a 10 m/s** e **perda de momentum 50%** PROVISÓRIOS; sliders Pregame | Lote 3 / 0.19.0 |
| 6 — Pulo | **Um X = um voo**: aterrissar do próprio pulo/hop não quica (o quique de chão relançava até 13 cm — o "pula duas vezes"); quedas e knockback seguem quicando. **Drift sem ângulo oculto**: X + esquerda/direita (ou diagonal) com o Bey em movimento (≥ 2 m/s ao apertar X) = drift; X sozinho ou parado = pulo (dica de controles atualizada). Pressão de X no ar (pulo, drift, quique) fica guardada e é usada na aterrissagem (PR #76). Velocidade de lançamento derivada do ápice com a gravidade real. Consequências: com 2,5 m um pulo cheio perto da borda passa a parede de 2 m; um toque de 1 tick sobe 0,24 m (era 0,20 m) pela regra aprovada de impulso único. | **Full jump height 2,5 m PROVISÓRIO** (1–5 m); **Short hop height** padrão o anterior (0,05–0,5 m); sliders Pregame | Lote 4 / 0.20.0 |

# 13. PENDÊNCIAS REAIS — NÃO INVENTAR NEM REABRIR O RESTO

Somente estes tipos de itens continuam legitimamente abertos quando não houver decisão posterior mais específica:

## 13.1 HUD

- ~~tratamento visual/layout final do HUD geral de combate via Lab A/B/C~~ **SUPERSEDED (owner, 2026-10-02):** não existe Combat HUD Lab nem escolha A/B/C pendente; o HUD é o `CombatHud` existente (seção 10).

Isto é uma pendência estreita de UI/legibilidade, não uma licença para reprototipar os sistemas da luta.

## 13.2 UI visual

- tema visual final de Main Menu / Character Select / Pregame / Pause / Results / Settings, se ainda não houver documento posterior de aprovação.

## 13.3 Intro / Launch

- apresentação final de Intro / Countdown / Launch;
- mecânica final do minigame de launch continua separada.

## 13.4 Câmera — integrações específicas ainda registradas como abertas

A arquitetura de yaw/composição inercial **não está aberta**. Permanecem apenas integrações independentes onde não houver override posterior:

- preset default para jogador novo, se não houver override posterior;
- interação entre FOV configurável e preset;
- integração de shake do VFX com shake do Camera Director;
- tratamento dedicado de Perfect Dodge;
- Intro;
- slow motion de momentos decisivos;
- feed de RingOut/Finisher após freeze do round;
- aspect ratio / spectator framing AI-vs-AI.

## 13.5 Arena — gameplay, não aparência

- força real da inclinação/gravidade do bowl (quanto ela deve puxar o Bey para o centro, afetar drift/ring-out/IA — isso é tuning/feel, não a integração em si);
- posição final do volume de ring-out;
- aberturas finais de parede;
- arena inicial/default, se não houver override posterior;
- ~~integração física do bowl quando ainda diferente da apresentação visual~~ **RESOLVIDO (M11 lane 4):** o colisor físico (heightfield do Rapier) já usa o mesmo perfil `h(r)` da apresentação visual para os três bowls — ver `src/arena/colliders/createArenaColliders.ts`. Não há mais divergência física × visual a integrar.

## 13.6 Clash

- estilo final de empate;
- sobreposição dos Beys no enquadramento;
- variante reduzida para jogadores sensíveis;
- eventual shake próprio do pulso além do Camera Director;
- ~~integração física real do bowl~~ **RESOLVIDO (M11 lane 4), mesmo item da seção 13.5.**

## 13.7 Outros

- identidade individual de partículas/trails por Bey;
- pacote específico de pulo / ataque aéreo / air recovery onde o VFX aprovado não cobrir o comportamento pretendido;
- bloom/chromatic aberration e Post-FX final, se o owner decidir usar;
- nomes finais/paletas onde ainda estiverem explicitamente provisórios;
- balance numérico de gameplay que os documentos tratem como tuning/playtest, não arte aprovada.

---

# 14. Regra obrigatória para agentes

Antes de perguntar qualquer decisão ao owner:

1. procurar neste arquivo;
2. procurar no `VISUAL_APPROVALS_MASTER.md`;
3. abrir o documento detalhado da área;
4. verificar o estado atual do código e dos status docs;
5. perguntar **somente** se o ponto permanecer realmente aberto.

Nunca transformar:

- “não integrado” em “não aprovado”;
- “UI provisória do lab” em “HUD final”;
- “um sistema aberto” em permissão para refazer sistemas já fechados;
- “o lab mostrou” em “o owner aprovou” sem evidência;
- um snapshot histórico em fonte de verdade quando existe um owner override posterior.

Quando uma nova decisão do owner for tomada, registrar data, escopo, efeito sobre decisões anteriores e marcar explicitamente qualquer item superseded.
