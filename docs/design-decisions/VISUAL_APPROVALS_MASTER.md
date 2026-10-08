# ChaosBey — Canonical Visual Approvals Master

**Status:** CANÔNICO — fonte de entrada para qualquer auditoria de protótipos e aprovações visuais  
**Atualizado:** 2026-10-07 (owner aprovou Launch System A — Timing Snap; Pregame já aprovado)  
**Escopo:** Beys, Arena, VFX, condição (Stamina/Stability/Quebrado), câmera, movimento, Clash, Launch e lacunas visuais ainda não aprovadas.

> **Regra obrigatória para agentes:** antes de perguntar novamente ao owner sobre uma decisão visual, leia este arquivo e depois o documento detalhado apontado na seção correspondente. Uma decisão marcada como **APROVADA** aqui não deve ser reaberta sem uma nova instrução explícita do owner.

> **Regra de precedência:** quando um documento histórico contradizer este arquivo, vale a decisão mais recente registrada aqui. Para parâmetros exatos, o documento detalhado da área continua sendo a fonte de verdade, exceto quando este master marcar explicitamente um item como **SUPERSEDED / OWNER OVERRIDE**.

> **Estado de integração em 2026-10-02:** os pacotes aprovados de Bey 4 peças (#82), Condição A/B/C (#84), VFX Híbrido + Cel Cyclone (#85), Clash Overdrive (#86) e arte das três arenas (#87) estão **INTEGRADOS e LIGADOS no jogo normal desde a 0.16.0** (`newBeyVisuals`, `conditionVisuals`, `hybridVfx`, `clashPresentation`, `arenaVisuals`; `newHud` continua desligado). `?pfx=` explícito na URL é uma allowlist para isolar pacotes em debug (`?pfx=` vazio = tudo desligado). **Provisório, não escolha do owner:** cada arquétipo usa o conceito A da sua família, e a Condição começa só com A. O stage do jogo agora tem **36 m** (owner override de escala, #83); a arte das arenas foi ajustada a essa escala sem mudar a aprovação. Detalhes por pacote: `docs/planning/PROTOTYPE_INTEGRATION_MAP.md` §0. Não existe Combat HUD Lab nem escolha A/B/C pendente (owner, 2026-10-02; PR #64 fechada): o HUD é o `CombatHud` existente.

---

## 1. Como interpretar os status

- **APROVADO:** o owner já escolheu a direção/comportamento visual. Não perguntar de novo.
- **APROVADO COM VALORES FINAIS:** além da direção, os números do protótipo foram confirmados como configuração a portar.
- **APROVADO EM PARTE:** a linguagem/direção está aprovada, mas números ou escolha final ainda não.
- **PROTOTIPADO, NÃO FINAL:** existe um lab, mas ainda falta decisão do owner.
- **NÃO PROTOTIPADO / NÃO APROVADO:** nenhum lab atual fecha o item.
- **INTEGRADO:** já está no jogo de produção.
- **PROTOTIPADO/APROVADO ≠ INTEGRADO:** um lab aprovado pode continuar completamente fora de `src/`.

A existência de UI de debug, sliders ou readouts dentro de um lab **não** significa que aquela UI seja o HUD/UI final do jogo.

---

# 2. Resumo executivo

| Área | Estado canônico | Fonte detalhada |
|---|---|---|
| Anatomia dos Beys | **APROVADA** | `visual-prototypes-approval.md` |
| Roster dos Beys | **9 BEYS SELECIONÁVEIS — OWNER OVERRIDE 2026-09-27** | este arquivo + Bey Concept Lab |
| 9 conceitos de Bey | **APROVADOS** como designs jogáveis/selecionáveis | `visual-prototypes-approval.md` |
| Arena bowl 12 m / 3,2 m | **APROVADA** | `visual-prototypes-approval.md` |
| Foundry / Rift / Tournament | **3 direções visuais aprovadas** | `visual-prototypes-approval.md` |
| VFX principal | **C — Híbrida APROVADA** | `visual-prototypes-approval.md` |
| Cel Cyclone | **APROVADO** | `visual-prototypes-approval.md` |
| Tuning VFX | **36 valores finais aprovados** | `visual-prototypes-approval.md` / lab |
| VFX de pulo / ataque aéreo / air recovery | **AINDA NÃO PROTOTIPADOS/APROVADOS como pacote próprio** | GDD §§20, 21, 25 + este arquivo |
| Identidade de partículas/trails por Bey | **AINDA NÃO PROTOTIPADA/APROVADA** | GDD §§32, 98 + este arquivo |
| Condição Stamina/Stability/Quebrado | **A/B/C aprovadas, combináveis 1–3** | `condition-visual-approval.md` |
| Tuning de condição | **49 valores finais aprovados** | `condition-visual-approval.md` |
| Câmera de combate | **A/B/C aprovadas, uma por vez** | `camera-approval.md` |
| Tuning da câmera | **43 valores × 3 presets aprovados** | `camera-approval.md` |
| Movimento do Bey | **A/B/C e linguagem física aprovadas em parte** | `motion-approval.md` |
| 33 valores do Motion Lab | **NÃO são tuning final** | `motion-approval.md` |
| Clash Presentation | **C — Overdrive + câmera B aprovados** | `clash-presentation-approval.md` |
| HUD de combate completo | **AINDA NÃO APROVADO / lab dedicado pendente** | GDD + este arquivo |
| Pregame Setup UI | **DIREÇÃO VISUAL/UX APROVADA — ainda não integrada** | `pregame-overhaul.md` |
| Main Menu / Character Select / Pause / Results / Settings | **DIREÇÃO VISUAL FINAL AINDA ABERTA** | GDD + este arquivo |
| Launch System | **A — TIMING SNAP APROVADO; launcher físico + ponto de entrada + chegada simultânea; sem countdown pós-pouso; não integrado** | `launch-system-approval.md` |
| Fluxo do Bey — borrão de giro, inclinação, poeira anime (3 ideias), vento, argolas de impacto e texto HIT/BLOCK/COUNTER | **PROTOTIPADO, NÃO FINAL (owner, 2026-10-08): texto estilo A escolhido (opção nas Configurações); ficam borrão, inclinação, riscos de vento e argolas; poeira anime refeita como volume 3D na cena (5ª rodada: "as nuvens ainda são papel"), argolas/coroas de impacto restauradas, sombra sob os Beys e sliders de opacidade, para julgar. **INTEGRADO no jogo como apresentação com sliders nas Configurações (0.54.0, pedido do owner 2026-10-08; valores finais e composição da poeira ainda não aprovados; BLOCK e "Bey Real" não feitos)** | `prototypes/bey-flow-fx-concepts/` · `src/vfx/flow/` · `bey-flow-fx-approval.md` · `flow-fx-effects.md` |
| Bey Real — física realista, piloto automático com ~30% de influência, Dash/Giratório/Pulo/Esquiva manuais e câmera (gameplay, não visual) | **PROTOTIPADO, NÃO APROVADO (owner, 2026-10-08): lab jogável com simulação própria; nada integrado; câmera, nome, escala da arena e drift/momentum em aberto** | `prototypes/bey-real-physics-concepts/` · `bey-real-physics-approval.md` |
| Bloom / chromatic aberration | **NÃO PROTOTIPADOS / uso final não decidido** | inventário |

---

# 3. Beys — decisão canônica

## 3.1 Anatomia de quatro peças — APROVADA

Todo ChaosBey usa a linguagem estrutural:

1. **Top Layer** — centro elevado com emblema;
2. **Ring** — maior peça visual, responsável pela silhueta e impacto;
3. **Disc** — disco de peso menor que o Ring e visível lateralmente;
4. **Driver** — carcaça + ponta longa e claramente legível.

Regras aprovadas importantes:

- Ring > Disc > topo do Driver;
- Disc deve ser visualmente menor que o Ring e possuir lateral real;
- Top Layer é menor e encaixada no centro do Ring;
- junções Ring/Disc e Disc/Driver têm encaixes/sulcos visíveis;
- Driver converge para uma ponta longa visível;
- mistura de plástico pintado, metal, material escuro, peça translúcida e detalhe emissivo pequeno;
- mesh visual e collider continuam separados;
- as quatro peças giram juntas no grupo visual e recebem tilt/wobble como conjunto.

Fonte detalhada: `docs/design-decisions/visual-prototypes-approval.md`.

## 3.2 Os nove conceitos — TODOS fazem parte do roster selecionável

### OWNER OVERRIDE — 2026-09-27

**Os nove conceitos do catálogo não serão reduzidos a três finalistas. Os nove são opções de Bey selecionáveis/jogáveis.**

Roster:

- **Attack A** — low radial striker;
- **Attack B** — asymmetric directional slicer;
- **Attack C** — twin-hammer mass impactor;
- **Defense A** — overlapping scale shield;
- **Defense B** — segmented bumper array;
- **Defense C** — compact stepped fortress;
- **Stamina A** — open flywheel rim;
- **Stamina B** — concentric precision gyro;
- **Stamina C** — vertical aero glider.

### SUPERSEDED

Qualquer texto anterior dizendo:

- “escolher os 3 Beys finais”; ou
- “um Bey final por arquétipo”; ou
- “9 conceitos aprovados apenas como catálogo, 3 finais em aberto”

está **SUPERSEDED neste ponto específico**.

Não deve ser feita uma nova pergunta ao owner sobre reduzir o roster a três.

Os códigos A/B/C ainda podem ser identificadores provisórios; esta decisão não inventa nomes finais.

## 3.3 O que ainda pode permanecer aberto nos Beys

Esta decisão sobre o roster **não fecha automaticamente**:

- nomes finais de cada Bey;
- paletas finais, quando ainda tratadas como provisórias pelos documentos detalhados;
- eventual refinamento de peças individuais sem descaracterizar o conceito aprovado;
- solução final para ambiguidades de leitura do sentido de giro registradas no Motion Lab.

Não confundir essas pendências com a quantidade do roster: **a quantidade selecionável é nove**.

---

# 4. Arena — APROVADA visualmente, gameplay da inclinação separado

## 4.1 Geometria visual aprovada

- raio de referência: **12 m**;
- borda aproximadamente **3,2 m acima do centro**;
- bowl côncavo;
- parede medida a partir do rim;
- três perfis de chão aprovados no lab.

## 4.2 Três direções visuais aprovadas

### A — Foundry Pit

Direção industrial: aço, rebites, treliça, luz quente, faíscas laranja/amarelas e reação própria ao Clash.

### B — Rift Crater

Direção de cratera: basalto, fissuras violeta, céu noturno, fragmentos e faíscas violeta/ciano, com reação própria ao Clash.

### C — Tournament Stadium

Direção de estádio e-sports: piso claro, policarbonato, postes/LEDs, iluminação neutra e faíscas branco/amarelas, com reação própria ao Clash.

As três direções são válidas e aprovadas como protótipos visuais.

## 4.3 O que NÃO foi silenciosamente aprovado

A aprovação visual do bowl não decide automaticamente:

- quanto a gravidade/inclinação puxa os Beys para o centro;
- posição final do volume de ring-out;
- aberturas finais de parede;
- como a seleção de arena aparece no pregame.

**A escolha da arena inicial/default permanece ABERTA. Não existe owner override posterior registrado que escolha uma arena inicial final.**

Esses pontos têm impacto de gameplay e precisam seguir o fluxo próprio de playtest/aprovação.

Fonte: `docs/design-decisions/visual-prototypes-approval.md`.

---

# 5. VFX — direção Híbrida e tuning aprovados

## 5.1 Direção principal

A direção aprovada é **C — Híbrida**, combinando:

- contato, desgaste, faíscas físicas e alta velocidade da linguagem mecânica;
- impacto, shockwaves, focus lines, Dash, Circular Attack, Perfect Dodge, Stability Break, landing e ring-out da linguagem anime;
- impact frame apenas quando o impacto atinge o limiar aprovado;
- efeitos escalando com a magnitude real do evento;
- VFX observando o gameplay, nunca decidindo resultado.

## 5.2 Momentos já cobertos e aprovados

Não pedir um novo protótipo genérico para estes momentos sem uma razão nova:

1. colisão/golpe;
2. Dash — carga e soltura;
3. Circular Attack / counter;
4. Perfect Dodge;
5. wind burst / avanço;
6. Stability Break;
7. landing;
8. wall scrape;
9. ring-out.

## 5.3 Cel Cyclone

O wind burst aprovado é **Cel Cyclone**. As outras direções permanecem referência de laboratório, não a escolha final.

## 5.4 Valores finais

O lab registra **36 valores finais de tuning**, incluindo shake, hitstop, flash, focus lines, threshold/duração de impact frame, sparks, shockwave, trail, Perfect Dodge e parâmetros do Cel Cyclone.

A fonte exata continua sendo o bloco/objeto `APPROVED` do protótipo e a seção correspondente de `visual-prototypes-approval.md`.

### Importante

O multiplicador de shake do VFX Lab não deve ser somado cegamente ao shake do Camera Lab. `camera-approval.md` registra esse conflito como ponto de integração a resolver preservando o que foi visualmente aprovado.

---

# 6. Condição do Bey — Stamina / Stability / Quebrado

Fonte: `docs/design-decisions/condition-visual-approval.md`.

## 6.1 Três direções aprovadas

- **A — Desgaste Mecânico**;
- **B — Aura de Espírito**;
- **C — Instrumento no Chão**.

O jogador pode ligar **qualquer combinação de 1, 2 ou 3** dessas direções nas Configurações. Elas são apresentação, não regra de gameplay.

Uma camada física comum permanece ativa independentemente da combinação: desaceleração visual, wobble/precessão, reação ao impacto, estado quebrado e spin-out conforme especificado no documento detalhado.

## 6.2 Valores aprovados

O documento detalhado registra **49 parâmetros finais**.

Decisões específicas já fechadas incluem:

- contorno vermelho de perigo da direção B desligado;
- coluna vermelha de luz da direção C removida;
- a explosão pontual de Stability Break vem do VFX Híbrido; as direções de condição mostram o estado contínuo.

## 6.3 NÃO É O HUD FINAL

A direção C é explicitamente **diegética**, desenhada no chão/mundo. Ela **não substitui o HUD de combate de tela**.

Portanto, a existência deste lab não autoriza um agente a declarar o Combat HUD final como aprovado.

---

# 7. Câmera de combate — três presets aprovados com valores exatos

Fonte: `docs/design-decisions/camera-approval.md`.

## 7.1 Presets aprovados

- **A — Arena Fighter**;
- **B — Cinematic Hybrid**;
- **C — Hyper Dynamic**.

O jogador escolhe **uma câmera por vez** nas Configurações.

As três são presets do mesmo Camera Director, não três sistemas independentes.

## 7.2 Sete modos já prototipados/aprovados

- CombatFollow;
- HighSpeed;
- CloseCombat;
- KnockbackFollow;
- Clash;
- RingOut;
- Finisher.

Não listar RingOut, Finisher ou câmera de Clash como “nunca prototipados”.

## 7.3 Valores finais

Os **43 parâmetros de cada um dos três presets** foram aprovados exatamente como apresentados no Camera Lab.

O documento também registra constantes compartilhadas, limites de leitura, FOV, orbit, shake, offscreen rescue e medições reproduzíveis em cenários reais.

## 7.4 Pendências reais de câmera

Entre os itens ainda explicitamente não fechados no documento detalhado estão:

- preset padrão para jogador novo;
- como FOV configurável pelo jogador combina com o preset;
- integração do shake VFX × shake do Camera Director;
- modo dedicado de câmera para **Perfect Dodge**;
- **Intro**;
- tratamento de câmera lenta para momentos decisivos;
- alimentação visual de RingOut/Finisher quando o resultado do round já congelou a simulação;
- detalhes de aspect ratio e AI-vs-AI spectator framing.

Consultar a seção “Continua em aberto” de `camera-approval.md` antes de decidir qualquer um deles.

**Já decidido:** durante o Clash a câmera é sempre a **B — Cinematic Hybrid**, sem órbita, mesmo que o jogador tenha escolhido A ou C (§9 e `clash-presentation-approval.md` §5).

---

# 8. Movimento do Bey — aprovado em parte, NÃO confundir com tuning final

Fonte: `docs/design-decisions/motion-approval.md`.

## 8.1 Três direções-base aprovadas

- **A — Stable Arcade**;
- **B — Physical Hybrid**;
- **C — Wild Mechanical**.

As três devem ser preservadas como direções válidas de comparação.

## 8.2 Linguagem física aprovada

A linguagem oficial deve ser capaz de expressar:

- momentum;
- heading diferente da velocity;
- grip/slip e recuperação de grip;
- tilt/lean;
- wobble;
- precession-like response;
- perturbação angular;
- knockback linear + angular;
- tumble / rodopio;
- floor/wall bounce;
- ricochete;
- wall scrape;
- recuperação gradual ao prumo.

## 8.3 O que NÃO foi aprovado como final

Os **33 valores numéricos atuais dos sliders não são tuning final de produção**.

Também não está automaticamente fechado:

- preset default;
- eventual mistura final A/B/C;
- tuning específico por Bey;
- solução final dos cenários de investigação registrados;
- solução para ambiguidade de sentido de giro em alguns modelos.

Não transformar os números do Motion Lab em produção apenas porque as direções foram aprovadas.

---

# 9. Clash Presentation — aprovação posterior ao inventário antigo

Fonte canônica detalhada: `docs/design-decisions/clash-presentation-approval.md`.

O inventário de 26/09 dizia que a apresentação completa do Clash ainda não existia. Isso ficou **historicamente desatualizado** depois do Clash Presentation Lab de 27/09.

## 9.1 Direção aprovada

- **C — Overdrive**;
- com **câmera B — Cinematic Hybrid** no protótipo aprovado.

A, B do Clash Lab continuam apenas referências; não são opções de jogador por esta decisão.

## 9.2 Comportamentos aprovados

- Beys visualmente travados em contato durante Active;
- inclinação contra o ponto de contato, tremor e resposta visual ao mash;
- speedlines de tela convergindo no contato, preservando zona de leitura;
- poeira/fagulhas contínuas de contato, tingidas pela arena;
- resolução **sem banner, sem pausa de resultado, sem hitstop/câmera lenta disparados pela resolução**;
- física continua da resolução para knockback e combate;
- barra de força tipo cabo de guerra entre os Beys;
- barra segue o `ClashPower` real ao vivo;
- sem texto/números no HUD do Clash;
- geometria/vórtice giratório entre os Beys foi descartada;
- câmera não orbita durante o Clash;
- **o Clash sempre força a câmera B**, qualquer que seja a câmera A/B/C escolhida pelo jogador (owner, 2026-09-28);
- fórmula da barra `0,5 + 0,5 × vantagem × 4` e metades em `palette.glow` fazem parte do comportamento aprovado (ganho ajustável só por playtest, GDD 167);
- bowl visual aprovado usado na apresentação.

## 9.3 Valores da direção C

O documento detalhado registra os valores do Overdrive: entrada em slow motion, flash, tilt, tremor, speedlines, poeira, estilo/tamanho da barra, pulso de mash, hitstop por mash, resolução e reação de luz.

## 9.4 O que continua aberto no Clash

Não fechar silenciosamente:

- estilo final de empate;
- sobreposição dos Beys no enquadramento;
- variante reduzida para jogadores sensíveis;
- eventual shake próprio do pulso além do Camera Director;
- ~~integração física real do bowl~~ **RESOLVIDO (M11 lane 4):** o colisor físico do bowl já usa o mesmo perfil `h(r)` da apresentação visual (`src/arena/colliders/createArenaColliders.ts`).

> **Fechados em 2026-09-28 (não reabrir):** câmera do Clash (sempre B) e ganho ×4/cores da barra (parte da revisão 2 aprovada).

---

# 10. HUD — estado canônico

## 10.1 O HUD de combate completo AINDA NÃO está visualmente aprovado

O GDD exige comunicar claramente durante a luta, entre outras coisas:

- Stamina;
- Stability;
- cooldown do Dash (linha CD; substituiu Attack Energy / recurso ofensivo — owner, 2026-10-02);
- cooldowns relevantes;
- feedback de lock-on do Dash;
- outros recursos/estados de combate necessários.

Mas nenhum documento canônico atual registra um **Combat HUD Lab completo aprovado**.

### Não confundir com HUD final

- readouts e sliders dos labs são instrumentação de protótipo/debug;
- o Instrumento no Chão do Condition Lab é elemento diegético;
- a barra de força do Clash é **HUD específico do Clash**, não o HUD do combate inteiro;
- minimapas, labels e timelines dos labs são ferramentas de comparação.

Portanto, **Combat HUD continua sendo uma lacuna visual real** e deve passar por aprovação antes da implementação final.

---

# 11. UI, menus, intro e pós-processamento

## 11.1 UI / menus

### Pregame Setup — APROVADO pelo owner em 2026-10-07

A direção visual/UX do Pregame foi aprovada e está detalhada em `docs/design-decisions/pregame-overhaul.md`.

Resumo da aprovação:

- configuração objetiva e fácil de manipular;
- duas colunas no desktop: controles + resumo curto;
- Advanced dividido em Movement / Jump / Combat / Arena / Round / Visual;
- valores/defaults/modificações visíveis sem virar Debug Lab;
- presets oficiais Normal Original / Realistic / Epic / Smooth / Strategic e estado derivado Custom;
- cada preset oficial aplica sua configuração de Advanced e mostra uma descrição curta;
- Normal Original segue os defaults canônicos atuais;
- tuning numérico inicial dos quatro presets alternativos é provisório;
- sem apresentação cinematográfica, grandes previews 3D ou animação decorativa pesada.

**Estado:** aprovado para implementação, ainda não integrado por esta decisão documental.

### Outras telas — ainda abertas

Esta aprovação não decide o tratamento visual final de:

- Main Menu;
- Character Select;
- Pause;
- Results;
- Settings.

O GDD define funções e conteúdo dessas telas, mas isso não equivale a aprovação do tratamento visual final.

## 11.2 Launch System — APROVADO pelo owner em 2026-10-07

Fonte detalhada: `docs/design-decisions/launch-system-approval.md`.  
Protótipo aprovado: `prototypes/launch-system-concepts/index.html`.

Direção final:

- **A — Timing Snap**;
- Beys visivelmente montados em launchers físicos 3D antes do release;
- jogador escolhe o ponto de entrada/queda do próprio Bey;
- um toque de timing libera o launcher;
- preservar a animação aprovada dos **dois Beys chegando ao stage**;
- ao completar o primeiro contato/quique dos dois Beys na arena, **Combat começa imediatamente**;
- **sem 3 / 2 / 1 / GO após o pouso** e sem lockout equivalente;
- B/C são histórico de exploração, não opções finais.

A UI/readouts de debug do Lab não viram automaticamente HUD/balance final. O pacote está **APROVADO, AINDA NÃO INTEGRADO**.

## 11.3 Post-FX

**Bloom e chromatic aberration não têm decisão visual final/protótipo canônico aprovado.**

Não implementar como arte final por suposição. Se forem explorados, devem ter opções reduzidas/desligadas e respeitar legibilidade/performance.

---

# 12. O que já NÃO deve voltar para a lista de “protótipos faltando”

Salvo nova decisão do owner, não listar como completamente ausente:

- conceitos estruturais dos 9 Beys;
- anatomia de 4 peças;
- Arena Visual Lab;
- VFX de impacto;
- Dash VFX;
- Circular Attack VFX;
- Perfect Dodge VFX;
- Stability Break VFX;
- Landing VFX;
- Wall scrape VFX;
- Ring-out VFX;
- Cel Cyclone;
- condição visual de Stamina/Stability/Quebrado;
- câmera CombatFollow;
- HighSpeed camera;
- CloseCombat camera;
- KnockbackFollow camera;
- Clash camera;
- RingOut camera;
- Finisher camera;
- linguagem física geral demonstrada pelo Motion Lab;
- Clash Presentation completo na direção C Overdrive.
- Launch System A — Timing Snap com launcher físico, ponto de entrada, chegada dupla e início imediato no quique.

Um item pode estar **não integrado** e ainda assim estar totalmente prototipado/aprovado.

---

# 13. Protótipos/lacunas visuais que continuam legítimos

Com base nas decisões registradas, os grandes buracos visuais restantes incluem:

1. **Combat HUD Lab completo**;
2. **UI visual de Main Menu / Character Select / Pause / Results / Settings**; o Pregame foi aprovado separadamente em 2026-10-07;
3. **Camera treatment dedicado de Perfect Dodge / Intro / momentos decisivos**, conforme `camera-approval.md`;
4. **VFX específico de pulo, ataque aéreo e air recovery**, ainda não coberto pelo pacote aprovado do VFX Lab (GDD §§20, 21 e 25);
5. **identidade visual individual de partículas e trails por Bey**, para diferenciar os nove Beys sem confundir isso com o trail genérico/tuning já aprovado (GDD §§32 e 98);
6. **Post-FX**, somente se o owner decidir explorar bloom/chromatic aberration;
7. **integração/showcase final** combinando sistemas aprovados para validar legibilidade em conjunto.

**Launch não pertence mais a esta lista:** A — Timing Snap está aprovado. Um eventual Intro adicional antes dos launchers só existe se o owner pedir depois e nunca pode reintroduzir countdown/lockout após o pouso.

Movimento possui lab e linguagem aprovados, mas ainda requer tuning de produção/playtest; isso é diferente de “não ter protótipo”.

---

# 14. Fontes canônicas detalhadas

Leia este master primeiro e depois, conforme a área:

- `docs/design-decisions/visual-prototypes-approval.md` — Beys, Arena e VFX;
- `docs/design-decisions/condition-visual-approval.md` — Stamina / Stability / Quebrado;
- `docs/design-decisions/camera-approval.md` — Camera Director e presets;
- `docs/design-decisions/motion-approval.md` — linguagem e limites do Motion Lab;
- `docs/design-decisions/clash-presentation-approval.md` — apresentação do Clash;
- `docs/design-decisions/pregame-overhaul.md` — direção visual/UX aprovada do Pregame e presets oficiais;
- `docs/design-decisions/launch-system-approval.md` — direção final do Launch A Timing Snap e fluxo launcher → chegada → Combat;
- `docs/design-decisions/visual-prototype-inventory.md` — inventário/histórico; usar com cuidado quando uma linha tiver sido superseded por decisão posterior.

Protótipos correspondentes:

- `prototypes/bey-visual-concepts/`;
- `prototypes/bey-visual-concepts-round1/` — arquivo histórico, não direção final;
- `prototypes/arena-visual-concepts/`;
- `prototypes/vfx-visual-concepts/`;
- `prototypes/condition-visual-concepts/`;
- `prototypes/camera-concepts/`;
- `prototypes/bey-motion-concepts/`;
- `prototypes/clash-presentation-concepts/` quando/caso o PR específico seja canonizado na `main`.

---

# 15. Regra para futuras decisões

Quando o owner aprovar, rejeitar ou substituir uma decisão visual:

1. atualizar o documento detalhado da área;
2. atualizar este master se o status/resumo mudar;
3. marcar explicitamente qualquer decisão anterior como `SUPERSEDED` em vez de apagar silenciosamente o histórico;
4. atualizar o inventário;
5. nunca transformar “o lab mostrou” em “o owner aprovou” sem evidência explícita;
6. nunca transformar “aprovado visualmente” em “integrado no jogo” sem evidência de integração;
7. nunca reabrir uma decisão marcada APROVADA apenas porque outro documento mais antigo ainda contém a pergunta original.

## Owner override atualmente mais importante

**Todos os 9 Beys do catálogo aprovado são selecionáveis/jogáveis. A antiga pendência “escolher 3 finais” está encerrada e superseded.**
