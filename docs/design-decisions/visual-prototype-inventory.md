# ChaosBey — Inventário completo dos protótipos visuais

**Data:** 26 de setembro de 2026  
**Status:** inventário canônico para preservação e integração futura  
**Escopo:** Bey Visual Lab, Arena Visual Lab, VFX Language Lab, Stamina & Stability Lab, Camera Lab, Bey Motion Lab e decisões visuais aprovadas

> **Atualização (27/09/2026):** o PR #17 foi mergeado, então Arena Lab, VFX Lab e os documentos de decisão já estão na `main`. O **Stamina & Stability Lab** (`prototypes/condition-visual-concepts/`) está aprovado (`docs/design-decisions/condition-visual-approval.md`) e entra na `main` pelo PR da branch `claude/sleepy-johnson-4i6io4`. As seções abaixo que ainda dizem "PR #17 ainda não mergeado" descrevem o estado de 26/09. O **Camera Lab** (`prototypes/camera-concepts/`) entra pelo mesmo PR. As três direções de câmera (A, B, C) foram **aprovadas sem alterações** como opções selecionáveis nas Configurações (`docs/design-decisions/camera-approval.md`); a câmera do jogo ainda não foi trocada.
>
> **Atualização (27/09/2026, Motion):** o **Bey Motion Lab** (`prototypes/bey-motion-concepts/`) entrou pela branch `claude/bey-motion-lab`. Suas três direções de movimento (A Stable Arcade, B Physical Hybrid, C Wild Mechanical) e a linguagem física geral foram **aprovadas como direções-base e como ferramenta**, mas os 33 valores numéricos atuais **não** foram aprovados como tuning final de produção — ver `docs/design-decisions/motion-approval.md` para a distinção exata (diferente da câmera, aqui não há confirmação de valores exatos). Movimento do jogo ainda não foi alterado.
>
> **Atualização (27/09/2026, decisões canônicas posteriores):** todos os **9 conceitos de Bey são selecionáveis/jogáveis**; a antiga pendência de escolher só 3 finais, um por arquétipo, está **SUPERSEDED**. O **Clash Presentation Lab** também deixou de ser uma lacuna: a direção **C — Overdrive + câmera B — Cinematic Hybrid** foi aprovada e está registrada em `docs/design-decisions/clash-presentation-approval.md`. O protótipo `prototypes/clash-presentation-concepts/` continua fora da `main` enquanto o PR histórico específico não for mergeado. Em qualquer conflito com snapshots antigos deste inventário, prevalece `docs/design-decisions/VISUAL_APPROVALS_MASTER.md`.

## 1. Resumo e onde está cada coisa

Todo o trabalho visual de **Arena** e **VFX** existe, está aprovado e tunado. O material original continua preservado na branch histórica `claude/tender-turing-3k7o8v` e foi portado para o PR #17, ainda não mergeado. A `main` continua sem ele até o merge do PR #17: por enquanto, ela recebeu apenas o laboratório de Beys. Portanto, quem audita somente a `main` pode concluir incorretamente que Arena e VFX “não existem”. A distinção central é:

> **prototipado + aprovado ≠ integrado no jogo**

| Onde | O que contém | Commits principais |
|---|---|---|
| `main` via PR #9 | Bey Visual Lab rodada 2 (4 peças) + rodada 1 arquivada | `621f85a`, `0e6d622` |
| `claude/tender-turing-3k7o8v` + PR #17 (ainda fora da `main`) | Arena Visual Lab, empacotador de artifacts, documento de decisões aprovadas | `7e06f4b`, `20ee932`, `f6359e0` |
| `claude/tender-turing-3k7o8v` + PR #17 (ainda fora da `main`) | VFX Language Lab (A, B, C Híbrida), wind burst, painel de tuning e configuração final | `5b4c7c5`, `89f8421`, `db97e20`, `22796b7`, `f73d657`, `2ad6909` |
| Somente na branch visual, **não deve ser canonizado** | `CLAUDE.md` com a regra de sessão `[Nifty]` | `d6245cf` |

**HEAD da branch visual:** `d6245cf`, 10 commits à frente da `main` no momento deste inventário. A branch ficou congelada para preservar as decisões. O trabalho visual nela é isolado em `prototypes/`, documentação e testes próprios; não altera gameplay, física, colliders ou stats.

O motivo de a `main` não mostrar esse material é histórico: o PR #9 mergeou a branch quando ela continha apenas o Bey Lab. A mesma branch continuou avançando depois com Arena → VFX → tuning → decisões, e esses commits posteriores não foram mergeados.

## 2. Legenda de status

- **APROVADO:** escolha do dono já registrada como decisão visual.
- **PROTOTIPADO, NÃO FINAL:** existe no laboratório, mas a escolha final ainda está aberta.
- **NÃO PROTOTIPADO:** nenhum laboratório construiu esse item ainda.
- **INTEGRADO NA MAIN:** roda dentro do jogo atual; quando indicado como placeholder, não representa a arte final aprovada.

## 3. Status por área

| Área | Status | Onde está |
|---|---|---|
| Anatomia de 4 peças dos Beys | **APROVADO** | `prototypes/bey-visual-concepts/` (também na `main`) |
| 9 conceitos de Bey | **APROVADOS — todos os 9 selecionáveis/jogáveis (owner override 27/09/2026)** | `prototypes/bey-visual-concepts/` · `docs/design-decisions/VISUAL_APPROVALS_MASTER.md` |
| Bey girando / em movimento real: linguagem física (momentum, tilt, wobble, grip/slip, precessão, tumble, bounce, ricochete) | **APROVADO** como direções-base A/B/C e ferramenta; valores numéricos de produção em aberto | `prototypes/bey-motion-concepts/` · `docs/design-decisions/motion-approval.md` |
| Spin readability dos 9 conceitos em velocidade de jogo | **PROTOTIPADO, achado registrado; nenhuma solução escolhida** | `prototypes/bey-motion-concepts/` · `docs/design-decisions/motion-approval.md` |
| Bowl com 3,2 m de profundidade e raio de 12 m | **APROVADO** | `prototypes/arena-visual-concepts/` |
| Perfis de concavidade A/B/C | **APROVADO** | `prototypes/arena-visual-concepts/` |
| Foundry Pit, Rift Crater e Tournament Stadium | **APROVADAS como direções válidas; arena inicial em aberto** | `prototypes/arena-visual-concepts/` |
| Cores de faísca e reação de luz de Clash por arena | **APROVADO** | `prototypes/arena-visual-concepts/` |
| Linguagem de VFX de combate C — Híbrida | **APROVADO** | `prototypes/vfx-visual-concepts/` |
| VFX de golpe, Dash, Circular, Perfect Dodge, Stability Break, aterrissagem, parede e ring-out | **APROVADO** | `prototypes/vfx-visual-concepts/` |
| Wind burst Cel Cyclone | **APROVADO e tunado** | `prototypes/vfx-visual-concepts/` |
| 36 valores finais de tuning | **APROVADO** | `prototypes/vfx-visual-concepts/src/tuning.ts` (`APPROVED`) |
| Condição do Bey: Stamina, Stability e Quebrado — 3 direções (Desgaste Mecânico, Aura de Espírito, Instrumento no Chão) | **APROVADO** como opções selecionáveis nas Configurações (1, 2 ou 3); 49 valores finais | `prototypes/condition-visual-concepts/` · `docs/design-decisions/condition-visual-approval.md` |
| Câmera de combate — 3 direções (A Arena Fighter, B Cinematic Hybrid, C Hyper Dynamic) com modos Combat Follow, High Speed, Close Combat, Knockback Follow, Clash, Ring-Out e Finisher | **APROVADO** sem alterações, como opções selecionáveis nas Configurações (uma por vez); 43 valores por direção; ainda não integrado | `prototypes/camera-concepts/` · `docs/design-decisions/camera-approval.md` |
| Clash completo entre os Beys — energia, pulsos, mash e resolução | **PROTOTIPADO E APROVADO na apresentação: C Overdrive + câmera B; protótipo ainda fora da `main`** | `docs/design-decisions/clash-presentation-approval.md` · branch/PR histórico do Clash |
| Bloom / aberração cromática | **DECISÃO VISUAL AINDA NÃO TOMADA; não prototipado** | — |
| Sparks, speed lines, trail, landing burst, shake, hitstop e FOV do jogo atual | **INTEGRADO NA MAIN, placeholder M4** | `src/vfx/`, `src/camera/` |
| Mesh procedural atual do Bey (`ring / upper / lower / tip`) | **INTEGRADO NA MAIN, placeholder M1/M6** | `src/bey/procedural-model/createBeyMesh.ts` |
| Arena plana com parede | **INTEGRADO NA MAIN, placeholder** | `src/arena/colliders/` |

# 4. Bey Visual Lab

A anatomia de 4 peças e o catálogo de 9 conceitos estão aprovados. **Todos os nove conceitos fazem parte do roster selecionável/jogável.** Nomes e paletas finais continuam em aberto onde ainda não houver decisão posterior. Esse é o único laboratório visual que também está na `main`.

## 4.1 Rodada 1 — arquivada

A rodada 1 contém nove conceitos rejeitados como direção geral porque a maioria lia visualmente como “um prato num palito”. **Defense C** foi a exceção e virou referência estrutural para a rodada 2. A rodada permanece arquivada em `prototypes/bey-visual-concepts-round1/` apenas como referência e fonte de peças.

## 4.2 Rodada 2 — anatomia de 4 peças aprovada

| # | Peça | Função | Referência de categoria |
|---:|---|---|---|
| 1 | **Top Layer** | Centro elevado com emblema, encaixado no Ring | Face Bolt + Energy Ring / Chip |
| 2 | **Ring** | Peça mais larga; impacto, identidade e silhueta | Fusion/Metal Wheel / Layer |
| 3 | **Disc** | Disco de peso, menor que o Ring e visível abaixo dele | Spin Track / Forge Disc |
| 4 | **Driver** | Carcaça + ponta longa e visível | Performance Tip / Driver / Bit |

As referências acima servem apenas como categorias. Nenhum nome, emblema ou silhueta real deve ser copiado.

### Regras aprovadas para a implementação

1. **Tamanhos:** Ring > Disc > topo do Driver; Disc ≤ 90% do diâmetro do Ring.
2. **Disc com lateral real:** visível de lado e na diagonal; no protótipo, ≥ 0,3 unidade em um Bey de diâmetro aproximado 6.
3. **Top Layer:** < 70% do diâmetro do Ring, encaixado no centro, usando Defense C como referência estrutural.
4. **Encaixes visíveis:** sulcos escuros rebaixados nas junções Ring/Disc e Disc/Driver.
5. **Driver:** carcaça convergindo para a ponta; ponta ≥ 25% da altura total no protótipo.
6. **Materiais por peça:** plástico pintado, metal, material escuro, uma peça translúcida e um detalhe emissivo pequeno.
7. **Separação visual/física:** o mesh visual não define o colisor.
8. **Spin visual:** as 4 peças giram juntas no grupo de spin visual; inclinação e wobble afetam o conjunto inteiro.

## 4.3 Catálogo dos 9 conceitos

Os códigos são provisórios e **não são nomes finais**.

| Código | Top Layer | Ring | Disc | Driver |
|---|---|---|---|---|
| **Attack A** | Coroa com gema e parafusos | 4 lobos de impacto com faces de metal | Disco metálico com 4 entalhes | Carcaça afunilada + borracha chata |
| **Attack B** | Hub facetado com chevron | 3 lâminas assimétricas inclinadas | Disco dentado + camada translúcida | Carcaça facetada + ponta hexagonal |
| **Attack C** | Domo pesado aparafusado | 2 blocos-martelo | Tambor metálico de 10 painéis | Carcaça tambor + domo de borracha |
| **Defense A** | Domo de aço com lente | 8 placas sobrepostas | Disco de aço de 2 camadas | Tigela + esfera protegida |
| **Defense B** | Hub hexagonal com pistões | 6 pods com braços de mola | Disco com “pneu” de borracha | Saia com amortecedores + ponta em coroa |
| **Defense C** | Torre octogonal de 3 níveis | 8 ameias com faces de metal | Disco octogonal com contrafortes | Carcaça escalonada + ponta segmentada |
| **Stamina A** | Tampa pequena | Volante, 5 raios curvos, 5 pesos | Disco vazado com esferas | Carcaça fina + ponta agulha |
| **Stamina B** | Lente de precisão | 3 anéis concêntricos | Disco de precisão em 3 degraus | Gaiola aberta + ponta com rolamento |
| **Stamina C** | Agulha alta em gota | Anel tri-lobado com 3 pesos | Disco em forma de lente | Carenagem com aletas + ponta ogival |

## 4.4 O que o laboratório permite fazer

- Vistas: topo (`T`), diagonal 3/4 (`D`, padrão), livre (`F`), lateral (`S`), por baixo (`B`) e órbita por arrasto.
- Explodir as 4 peças (`E`), checar silhueta preta (`K`), girar em turntable (`R`) e trocar conceito (`1–9`).
- Remixar: cada conceito usa slots `topLayer`, `ring`, `disc`, `driverBody` e `tip`, permitindo combinar peças sem remodelar tudo.

## 4.5 O que ainda falta nos Beys

- Definir nomes finais.
- Definir paletas finais; as atuais continuam temporárias por arquétipo quando não houver decisão posterior.

> **SUPERSEDED (27/09/2026):** a antiga pendência “escolher os 3 Beys finais, um por arquétipo” está encerrada. Os 9 conceitos são selecionáveis/jogáveis.
>
> **Atualização (27/09/2026):** ver os 9 conceitos girando em velocidade de jogo, com tilt, wobble e câmera de combate deixou de ser lacuna: o **Bey Motion Lab** (`prototypes/bey-motion-concepts/`, aba "Spin readability") cobre exatamente isso. Achado registrado em `docs/design-decisions/motion-approval.md` §11: na taxa atual do jogo (22 rad/s), Defense A/B/C e Stamina B podem apresentar ambiguidade visual de sentido de rotação. Nenhuma solução foi escolhida ainda.

# 5. Arena Visual Lab

A arena já possui laboratório e decisões aprovadas: bowl de **3,2 m** de profundidade, raio de **12 m**, três perfis de chão e três direções visuais completas. Ainda falta escolher qual será a arena inicial ou se as três serão presets visuais de pré-jogo.

Pasta: `prototypes/arena-visual-concepts/` — branch histórica + PR #17; ainda fora da `main`.

## 5.1 Geometria aprovada

- **Profundidade:** 3,2 m é a altura da borda acima do centro, com raio de 12 m; inclinação média em torno de 15°.
- O chão afunila para o centro, formando um bowl côncavo.
- **Parede:** cerca de 2 m acima da borda, medida a partir do rim e não do centro.
- Beys na escala do jogo: cerca de 1,3 m de diâmetro.
- A profundidade de 3,2 m foi escolhida usando o slider 0–4 m do laboratório.

## 5.2 Perfis de chão aprovados

Altura `h(r)` em metros, com `R = 12`.

| Arena | Perfil | Fórmula | h(3 m) | h(6 m) | h(9 m) | h(12 m) |
|---|---|---|---:|---:|---:|---:|
| **A — Foundry Pit** | Prato parabólico | `3.2 · (r/R)²` | 0,20 | 0,80 | 1,80 | 3,20 |
| **B — Rift Crater** | Funil, inclina quase até o centro | `3.2 · (r/R)^1.3` | 0,53 | 1,30 | 2,20 | 3,20 |
| **C — Tournament Stadium** | Platô central de 2,6 m, depois curva | `0` se `r ≤ 2,6`; senão `3.2 · ((r−2.6)/(R−2.6))^1.4` | 0,04 | 0,77 | 1,87 | 3,20 |

## 5.3 Três direções visuais aprovadas como válidas

| Aspecto | A — Foundry Pit | B — Rift Crater | C — Tournament Stadium |
|---|---|---|---|
| **Arquitetura** | Fosso industrial: painéis de aço, treliça circular, passarela | Cratera natural, fragmentos de rocha flutuando | Estádio indoor de e-sports, arquibancada, rig de luz |
| **Chão** | Aço escovado, soldas, rebites, faixa de perigo | Basalto escuro com fissuras violeta partindo de anel central | Polímero claro fosco, círculo central, metades tingidas por jogador, faixa vermelha na borda |
| **Borda** | 16 painéis rebitados, trilho com faixas de perigo | Rochas + barreira de energia translúcida animada | Policarbonato transparente, 24 postes, trilho de LED |
| **Iluminação** | 4 luminárias quentes, fill frio fraco, névoa | Luar frio + brilho violeta das fissuras | 8 spots neutros e fortes, fill uniforme |
| **Fundo** | Galpão quase preto na névoa | Céu noturno índigo, estrelas e fragmentos | Arquibancada com público, teto escuro |
| **Faíscas de impacto** | Laranja-amarelas | Violeta-ciano | Branco-amarelas |
| **Reação ao Clash** | Luminárias ficam brancas, faixas brilham | Fissuras e barreira viram magenta | LED pisca nas cores dos dois jogadores, flashes na plateia |

### Regras gerais aprovadas

- Faíscas usam as cores da arena e aparecem como pontos redondos de brilho.
- Cada arena tem sua própria reação de luz durante o Clash.
- Impacto contra a parede produz um clarão curto no ponto de contato.

## 5.4 Controles do laboratório

- Trocar arena (`1–3`) e os dois Beys da rodada 2.
- Câmeras: visão geral (`O`), câmera de jogo (`G`), topo (`T`) e livre (`F`).
- Demo de movimento (`M`), luz de Clash (`X`), impacto na parede (`I`) e slider de profundidade.
- O movimento demonstrado é coreografia visual, não física real.

## 5.5 O que continua em aberto na arena

- Arena inicial: uma das três ou as três como presets visuais no pré-jogo.
- Quanto a inclinação do bowl puxa os Beys para o centro no gameplay; isso afeta aceleração, drift, ring-out e IA e precisa de playtest.
- Onde fica o volume de ring-out com o chão côncavo e se a parede ganha aberturas.
- O jogo da `main` ainda usa chão plano; o colisor côncavo é a primeira etapa de integração futura.

# 6. VFX Language Lab

Os VFX de combate, incluindo os VFX de ataque, já foram prototipados e aprovados. A direção escolhida é **C — Híbrida**, combinação das linguagens **A — Mecânica** e **B — Anime**, com impact frame apenas em golpes fortes.

Pasta: `prototypes/vfx-visual-concepts/` — branch histórica + PR #17; ainda fora da `main`.

## 6.1 As três linguagens

- **A — Mecânica:** física e “pé no chão”. Faíscas metálicas com gravidade e bounce no bowl, estilhaços, poeira, marcas no chão, shake curto e hitstop curto. As cores seguem a paleta da arena.
- **B — Anime:** gráfica e exagerada. Impact frame negativo, estrelas de impacto, anéis de choque, linhas de faísca longas, linhas de foco, cortes coloridos e afterimages na cor do Bey, com hitstop mais longo e shake mais forte.
- **C — Híbrida — APROVADA:** contato e alta velocidade da A; golpe, Dash, speed lines, dodge, Stability Break, landing e ring-out da B; impact frame somente em `HIGH` (`magnitude ≥ 0,65`); wind burst em avanço brusco, especialmente Dash release e Dodge start.

A e B continuam disponíveis no laboratório apenas como referência.

## 6.2 Os 9 momentos do VFX Lab

Todo efeito possui intensidade leve, média e pesada e escala com a magnitude real do evento.

| Momento | A — Mecânica | B — Anime | C — Híbrida aprovada |
|---|---|---|---|
| **1. Colisão / golpe** | Chuva de faíscas tangencial, estilhaços, poeira, marca no chão, hitstop curto | Impact frame, estrelas, shockwave, spark lines longas, focus lines, hitstop longo | Faíscas/estilhaços/poeira da A + estrela, shockwave e focus lines da B; impact frame só no pesado |
| **2. Dash — carga + soltura** | Ponta raspa faíscas e poeira na carga; poeira e skid marks na soltura | Aura colorida se contrai na carga; focus lines, flash e energy trail na soltura | Aura da B na carga; Cel Cyclone + focus lines na soltura; faíscas da A em alta velocidade |
| **3. Circular Attack / counter** | Anel de poeira e faíscas girando, marca circular | Crescentes coloridos em volta do Bey + shockwave; counter lança com estrela | Cortes + shockwave da B + faíscas de contato da A |
| **4. Perfect Dodge** | Slow-mo curto, fantasmas cinzas, poeira | Slow-mo forte, tom azul, afterimages coloridos, focus lines | Wind burst no acionamento + slow-mo, tint e afterimages da B |
| **5. Wind burst / avanço** | Poeira levantada atrás do Bey | Shockwave plana + focus lines leves | Cel Cyclone |
| **6. Stability Break** | Parafusos/estilhaços, fumaça, raspagem de ponta | Impact frame, estilhaços coloridos, anel duplo, anéis de “tontura” | Estilhaços/anéis/tontura da B + sparks de raspagem da A |
| **7. Landing** | Anel de poeira, pedrinhas, marca de impacto, shake | Shockwave dupla, rachadura estilizada, poeira de desenho | Linguagem B |
| **8. Wall scrape** | Jato contínuo tipo esmerilhadeira + marcas | Spark lines longas com pequenas estrelas | Esmerilhadeira da A |
| **9. Ring-out** | Explosão de sparks e debris na crista da parede, nuvem de poeira | Impact frame, estrela grande e feixe colorido saindo da arena | Estrela, feixe e focus lines da B; impact frame só no pesado |

## 6.3 Controles do VFX Lab

- Momento: `1–9`.
- Intensidade: `Z` leve, `X` média, `C` pesada.
- Replay: `R`.
- Slow motion global: `S`.
- Órbita: arrastar.
- Visão: Híbrida (`H`, padrão), A, B, comparação B|C (`W`), comparação A|B (`V`), três ventos lado a lado (`Q`).
- Estilo de vento: Sonic Boom (`J`), Comet Wake (`K`), Cel Cyclone (`L`) e funil v1 (`U`).
- Painel de tuning: `P`.

## 6.4 Mapeamento para eventos reais do jogo

| Handler do laboratório | Evento/sistema do jogo |
|---|---|
| `hit` | Golpe resolvido e knockback |
| `dashCharge`, `dashRelease` | `AttackController` — carga e soltura do Dash |
| `circularSweep` | Circular Attack ativo |
| `perfectDodge`, `dodgeMove` | Sistema de Dodge; Perfect Dodge já detectado, recompensa ofensiva ainda é decisão separada |
| `stabilityBreak`, `wobble` | Stability Break e wobble |
| `landing` | Aterrissagem |
| `scrape` | Contato/raspagem contra a parede |
| `windBurst` | Dash release e início do Dodge |
| `ringOut` | Ring-out |

Na integração futura, a linguagem Híbrida substituirá os placeholders de `src/vfx/` e será dirigida por eventos reais. O VFX observa o resultado e não decide o gameplay.

# 7. Burst de vento — Cel Cyclone

O wind burst aprovado é o estilo **3 — Cel Cyclone**. Aparece na soltura do Dash e no acionamento do Dodge, sempre escalando com a magnitude.

| Opção | Descrição | Status |
|---|---|---|
| **v1 — Funil** | Funil curto, espetado e girando, com brilho aditivo | Referência (`U`) |
| **1 — Sonic Boom** | 3 anéis verticais serrilhados em sequência; aparência de cone de vapor | Referência |
| **2 — Comet Wake** | Rastro de vento rasgado preso ao caminho + espiral envolvendo o Bey | Referência |
| **3 — Cel Cyclone** | Anéis serrilhados, rastro rasgado, espiral, poeira cel-shaded e debris | **APROVADO** |

### Ajustes aprovados no Cel Cyclone

- Argolas mantidas e aproximadamente 15% maiores; apoiadas no chão e surgindo em sequência.
- Menos intensidade nas linhas: menos faixas, mais finas, mais suaves e espiral mais leve.
- Mantido o rastro rasgado preso ao caminho real do avanço.
- Poeira de desenho em três tons de cinza e estilhaços escuros.
- Branco/cinza dominam; a cor do Bey aparece apenas em traços finos.

# 8. Configuração final de tuning — 36 valores

Os 36 parâmetros foram definidos no painel do laboratório em 26/09/2026 e são a configuração final a portar quando o VFX aprovado for integrado. A fonte de verdade é `APPROVED` em `prototypes/vfx-visual-concepts/src/tuning.ts`.

Os valores abaixo são multiplicadores sobre a base dos efeitos, salvo quando a unidade é indicada.

| Grupo | Parâmetro | Valor | Leitura |
|---|---|---:|---|
| Global | Camera shake (`shake`) | 1,35 | 35% mais forte |
| Global | Hitstop (`hitstop`) | 1,20 | 20% mais longo |
| Global | Light flash (`flash`) | 1,25 | — |
| Global | Focus / speed lines (`focusLines`) | 1,05 | — |
| Global | Impact frame threshold (`impactFrameMin`) | 0,65 | Apenas golpes fortes; média 0,62 não ativa |
| Global | Impact frame length (`impactFrameLength`) | 0,60 | Flash rápido |
| Sparks A | `contactSparks` / `sparkSpeed` / `sparkLife` | 1 / 1 / 1 | Como a base |
| Sparks A | `chips` / `dust` / `scuffs` | 1 / 1 / 1 | Como a base |
| Sparks A | `speedSparks` / `skidMarks` | 1 / 1 | Como a base |
| Hit B | Impact star (`starSize`) | 0,90 | — |
| Hit B | Shockwave (`shockwave`) | 1,95 | Quase o dobro |
| Hit B | Spark lines (`sparkLines`) | 3,00 | Máximo atual do slider |
| Dash B | Charge aura (`chargeAura`) | 1,95 | Quase o dobro |
| Dash B | Trail width (`trailWidth`) | 0,55 | Rastro fino |
| Dash B | Trail length (`trailLife`) | 3,00 | Rastro longo; máximo atual |
| Perfect Dodge | Slow motion factor (`dodgeSlowFactor`) | 0,30 | 30% da velocidade normal |
| Perfect Dodge | Slow motion duration (`dodgeSlowSeconds`) | 0,45 s | — |
| Perfect Dodge | Blue tint (`dodgeTint`) | 0,12 | Sutil |
| Perfect Dodge | Afterimage opacity (`afterimageOpacity`) | 0,25 | Sutil |
| Wind | Ring count (`windRings`) | 1 | — |
| Wind | Ring size (`windRingSize`) | 0,65 | — |
| Wind | Ring duration (`windRingLife`) | 0,71 s | — |
| Wind | Ring drift (`windRingDrift`) | 2,25 | Argola “fica para trás” |
| Wind | Wind line amount (`windStreaks`) | 0,70 | — |
| Wind | Wind line width (`windStreakWidth`) | 0,15 | Bem fina |
| Wind | Wind line opacity (`windStreakOpacity`) | 0,60 | — |
| Wind | Wind line length (`windStreakLength`) | 3,00 | Longa; máximo atual |
| Wind | Spiral line count (`windSpiralLines`) | 3 | — |
| Wind | Spiral opacity (`windSpiralOpacity`) | 0,50 | — |
| Wind | Dust clouds (`windDust`) | 1,65 | — |
| Wind | Debris (`windDebris`) | 2,60 | — |

Três valores estão no máximo atual de seus sliders: `sparkLines`, `trailLife` e `windStreakLength`. Se futuramente houver desejo explícito de aumentar além disso, os limites do laboratório podem ser ampliados antes da integração.

### JSON exato das chaves de `Tuning`

```json
{
  "shake": 1.35,
  "hitstop": 1.2,
  "flash": 1.25,
  "focusLines": 1.05,
  "impactFrameMin": 0.65,
  "impactFrameLength": 0.6,
  "contactSparks": 1,
  "sparkSpeed": 1,
  "sparkLife": 1,
  "chips": 1,
  "dust": 1,
  "scuffs": 1,
  "speedSparks": 1,
  "skidMarks": 1,
  "starSize": 0.9,
  "shockwave": 1.95,
  "sparkLines": 3,
  "chargeAura": 1.95,
  "trailWidth": 0.55,
  "trailLife": 3,
  "dodgeSlowFactor": 0.3,
  "dodgeSlowSeconds": 0.45,
  "dodgeTint": 0.12,
  "afterimageOpacity": 0.25,
  "windRings": 1,
  "windRingSize": 0.65,
  "windRingLife": 0.71,
  "windRingDrift": 2.25,
  "windStreaks": 0.7,
  "windStreakWidth": 0.15,
  "windStreakOpacity": 0.6,
  "windStreakLength": 3,
  "windSpiralLines": 3,
  "windSpiralOpacity": 0.5,
  "windDust": 1.65,
  "windDebris": 2.6
}
```

# 9. Correção da auditoria baseada somente na `main`

Uma auditoria que leia apenas `main@47a6deb` vê corretamente o que **está integrado**, mas não enxerga o que já foi **prototipado e aprovado** fora daquele snapshot.

| Área | Leitura olhando só a `main` | Situação real |
|---|---|---|
| Bey girando / movimento real | Lacuna | **Fechada em 27/09/2026:** Bey Motion Lab prototipa a linguagem física (aprovada como direção) e a spin readability em velocidade de jogo (achado registrado, sem solução escolhida) |
| VFX de impacto | “Não existe” | Prototipado, aprovado e tunado na Híbrida |
| VFX de ataques | “Não existe” | Dash e Circular já prototipados e aprovados |
| Dash charge + release | “Não existe” | Aura 1,95×, trail fino/longo e Cel Cyclone no release |
| Circular Attack | “Não existe” | Cortes coloridos + shockwave + sparks de contato |
| Perfect Dodge | “Não existe” | Visual tunado: 0,3× por 0,45 s, tint 0,12, afterimages 0,25 |
| Stability Break | “Não existe” | Prototipado e aprovado |
| Landing | “Não existe” | Prototipado e aprovado |
| Wall scrape / skid | “Não existe” | Prototipado e aprovado |
| Ring-out | “Não existe” | VFX prototipado e aprovado; câmera dedicada aprovada no Camera Lab (ainda não integrada) |
| Wind burst Dash/Dodge | “Não existe” | Cel Cyclone aprovado e tunado |
| Arena | “Não existe” | Lab + decisões aprovadas: 3,2 m, 12 m, 3 perfis, 3 direções |
| Luz de Clash da arena | “Não existe” | Definida individualmente por arena |
| Clash completo entre Beys | “Não existe” | **Desatualizado:** Clash Presentation Lab aprovado em 27/09/2026 na direção C Overdrive + câmera B; protótipo ainda pode estar fora da `main` |
| Bloom / chromatic aberration | “Não existe” | **Correto como ausência:** não prototipado e nenhuma decisão foi tomada sobre usar ou não |

Dos laboratórios inicialmente sugeridos como novos, VFX de impacto, VFX de ataque, Arena, luz de Clash, Bey em movimento real e a apresentação completa do Clash já foram feitos. Entre as lacunas visuais reais ainda abertas estão **Combat HUD**, **VFX específico de pulo/ataque aéreo/air recovery**, **identidade individual de partículas/trails por Bey** e uma **decisão futura sobre pós-processamento** caso se deseje testar bloom/aberração cromática.

# 10. O que falta e ordem recomendada

## 10.1 Passo zero — canonizar o patrimônio visual

**Status histórico:** o PR #17 foi o veículo de canonização dos Arena/VFX Labs e das decisões aprovadas; este inventário fazia parte daquele processo. Trechos desta seção que descrevem o PR #17 como pendente são históricos e devem ser lidos à luz das atualizações do topo e do `VISUAL_APPROVALS_MASTER.md`.

Antes de criar novo laboratório, o trabalho visual aprovado deve ser preservado de forma canônica no repositório. A integração porta somente:

- `prototypes/arena-visual-concepts/`
- `prototypes/vfx-visual-concepts/`
- `prototypes/tools/build-artifact.mjs`
- `docs/design-decisions/visual-prototypes-approval.md`
- smoke tests específicos desses labs
- alterações mínimas de configuração/Vite necessárias para os labs
- este inventário (`docs/design-decisions/visual-prototype-inventory.md`)

**Não portar `CLAUDE.md`.** A tag `[Nifty]` é instrução de sessão/agente e não faz parte do design ou da arquitetura do ChaosBey.

A canonização acima **não autoriza** implementar essas decisões dentro de `src/`; ela apenas evita que o trabalho aprovado fique esquecido em uma branch antiga.

## 10.2 Protótipos/lacunas que ainda não estão fechados

1. **Combat HUD completo:** o HUD específico do Clash e os readouts dos labs não equivalem ao HUD final de combate.
2. **VFX de pulo, ataque aéreo e air recovery:** o VFX Lab cobre landing, mas não fecha esses três momentos como pacote próprio (GDD §§20, 21 e 25).
3. **Identidade individual de partículas e trails por Bey:** o trail genérico/tuning aprovado não define ainda uma identidade própria para cada um dos 9 Beys (GDD §§32 e 98).
4. **Pós-processamento:** bloom e aberração cromática **não são requisitos aprovados**. Antes de implementar, deve haver uma decisão visual explícita sobre se entram no estilo final; só depois faria sentido criar presets Low/Medium/High.

> **Clash Presentation deixou de faltar em 27/09/2026:** direção C Overdrive + câmera B aprovadas; ver `docs/design-decisions/clash-presentation-approval.md`. O fato de o protótipo poder continuar fora da `main` não o torna “não prototipado”.
>
> Bey em movimento real (9 conceitos em velocidade de jogo, tilt, wobble, câmera de combate) também deixou de faltar: coberto pelo Bey Motion Lab em 27/09/2026 (seção 1, tabela de status, e `docs/design-decisions/motion-approval.md`).

## 10.3 Decisões em aberto — somente o dono decide

- [ ] Nomes finais dos Beys.
- [ ] Arena inicial: uma das três ou todas como presets visuais.
- [ ] Quanto a inclinação do bowl influencia o movimento no gameplay; precisa de playtest.
- [ ] Volume de ring-out e eventuais aberturas na parede com chão côncavo.
- [ ] Paletas finais dos Beys.

> **SUPERSEDED:** não existe mais a decisão “quais 3 Beys finais”. Todos os 9 conceitos aprovados são selecionáveis/jogáveis.

# 11. Ordem futura de integração no jogo

Quando o jogo estiver estável para receber arte final, a ordem recomendada é:

1. **Arena côncava — física primeiro:** colisor gerado pelo mesmo perfil `h(r)`; fonte única em `src/arena/`; parede e ring-out recalculados a partir do rim; revisão de spawn, câmera e percepção da IA; self-tests de rampa e batches de IA.
2. **Visual da arena:** portar a direção escolhida para `src/arena/` e `src/vfx/`; reação de luz ligada ao Clash real; variantes de qualidade.
3. **Beys de 4 peças:** evoluir `createBeyMesh.ts` de `ring / upper / lower / tip` para `Top Layer / Ring / Disc / Driver`, sem mudar silenciosamente colisor, massa ou stats.
4. **VFX Híbrida:** substituir placeholders de `src/vfx/` pela linguagem C e converter os 36 multiplicadores aprovados em valores absolutos ligados aos eventos reais.

**Observação de regressão:** o M7 foi desenvolvido e testado com chão plano. Ao implementar a arena côncava, será necessário revisar percepção de borda, pathing/edge recovery e batches IA vs IA.

# 12. Onde ver

| Laboratório | Pasta | Estado atual |
|---|---|---|
| Bey Concept Lab — rodada 2 | `prototypes/bey-visual-concepts/` | `main` e branch visual |
| Bey rodada 1 — arquivo | `prototypes/bey-visual-concepts-round1/` | `main` e branch visual |
| Arena Concept Lab | `prototypes/arena-visual-concepts/` | canonizado no repositório; origem histórica PR #17 |
| VFX Language Lab | `prototypes/vfx-visual-concepts/` | canonizado no repositório; origem histórica PR #17 |
| Stamina & Stability Lab | `prototypes/condition-visual-concepts/` | aprovado; ver `condition-visual-approval.md` |
| Camera Lab | `prototypes/camera-concepts/` | aprovado, valores exatos; ver `camera-approval.md` |
| Bey Motion Lab | `prototypes/bey-motion-concepts/` | aprovado como direções A/B/C + ferramenta; valores numéricos ainda não finais |
| Clash Presentation Lab | `prototypes/clash-presentation-concepts/` | aprovado na direção C Overdrive + câmera B; protótipo permanece na branch/PR histórico do Clash até integração/canonização específica |

Documentos de decisões aprovados relacionados: `docs/design-decisions/VISUAL_APPROVALS_MASTER.md`, `docs/design-decisions/visual-prototypes-approval.md`, `docs/design-decisions/condition-visual-approval.md`, `docs/design-decisions/camera-approval.md`, `docs/design-decisions/motion-approval.md` e `docs/design-decisions/clash-presentation-approval.md`.

Para rodar localmente:

```bash
npm run dev
```

Depois abrir `/prototypes/<pasta>/` para os protótipos presentes no checkout atual.

Para gerar um artifact HTML:

```bash
node prototypes/tools/build-artifact.mjs <pasta-do-prototipo> <saida.html>
```

---

## Nota de governança

Este inventário serve para impedir que trabalho visual aprovado seja refeito por engano. Em qualquer conflito futuro:

1. primeiro verificar `docs/design-decisions/VISUAL_APPROVALS_MASTER.md` e o documento de decisões aprovado da área;
2. depois verificar o protótipo correspondente;
3. distinguir claramente **aprovado**, **prototipado** e **integrado**;
4. não fechar silenciosamente decisões que continuam em aberto;
5. tratar afirmações históricas explicitamente marcadas como `SUPERSEDED` como não vigentes.
