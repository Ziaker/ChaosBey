# Fluxo do Bey — documento detalhado dos efeitos visuais

**Status:** INTEGRADO no jogo (0.54.0) como **apresentação**, com todos os valores em sliders nas Configurações; **os valores finais e a composição da poeira ainda não foram aprovados pelo owner** (os padrões são os números do próprio owner no painel de ajuste do lab, 2026-10-08).
**Data:** 2026-10-08
**Documento irmão:** [`bey-flow-fx-approval.md`](bey-flow-fx-approval.md) — o pedido do owner, o histórico das rodadas e o que continua em aberto. **Este documento é a especificação do que existe:** o que cada efeito é, como é feito, o que o dispara, de que direção ele nasce, cada valor (padrão, faixa, unidade, efeito) e onde fica o código.
**Escopo:** só **efeitos visuais** (apresentação). A física realista e o novo gameplay ("Bey Real") serão especificados em outro documento, depois; a seção 12 reserva o lugar.

> Regra que vale para tudo aqui (GDD 89 / `PlayerSettings.ts`): nenhum desses efeitos lê ou muda o que um tick fixo calcula, o replay ou o hash de estado. Eles **observam** (eventos de apresentação, estado de apresentação, a pose dos visuais) e **desenham**. A única coisa que escrevem fora das próprias malhas é a atitude do grupo visual do Bey (a inclinação, seção 5), que a sincronização com a física reescreve no quadro seguinte.

---

## 1. Visão geral

| # | Efeito | O que o jogador vê | Onde nasce | Liga/desliga |
|---|---|---|---|---|
| 1 | **Borrão de giro** | O Bey em giro rápido vira bandas concêntricas borradas, que somem conforme o giro cai | Já existia (camada física aprovada das condições, `ConditionRig`); o slider multiplica a força dela | `blurStrength` (0 = sem borrão) |
| 2 | **Inclinação na curva** | O Bey pende para dentro da curva | `FlowFxSystem` | `leanMaxDeg` (0 = sem) |
| 3 | **Sombra** | Disco preto pequeno e achatado sob a ponta | `FlowFxSystem` | `shadowOpacity` (0 = sem) |
| 4 | **Poeira anime em volume** | Montes de nuvem de desenho, em 3D, atrás do Bey e nas explosões | `FlowWind` + `AnimeDust` + `dustVolume` | `dustRate` e as explosões, pelo `intensity` |
| 5 | **Vento: riscos rasgados** | Riscos brancos/cinza atrás de um Bey rápido | `FlowWind` (peças aprovadas do Cel Cyclone) | `windRate` (0 = sem) |
| 6 | **Argolas de choque** | Anéis serrilhados que nascem no meio do Bey (Dash) ou do contato (golpe) e correm para trás | `FlowWind` (`jaggedRingFx`) | `crownCount` (0 = sem) |
| 7 | **Coroas no chão e estrela** | No golpe: duas coroas serrilhadas deitadas no piso e uma estrela chata | `FlowWind` (`flatFx`, `burstFx`) | `intensity` (0 = tudo desligado) |
| 8 | **Palavras de quadrinho** | "HIT" e "COUNTER!" em gibi, sobre o ponto do golpe | `ComicWords` | `comicWords` (Ligado/Desligado) |

A linguagem visual vem das folhas de referência do owner: silhuetas brancas lisas, **sem contorno**, um segundo tom cinza suave, gomos recortados de tamanhos muito diferentes, línguas e caudas varridas, coroa de espinhos; e do Cel Cyclone já aprovado (`src/vfx/hybrid/fx`).

---

## 2. Arquitetura

```
PlayerSettings.flowFx ──(Settings: sliders)──► MatchRunner.setPresentation ──► MatchSession.setFlowFx
        │                                                                          │
        └─ saved in localStorage (chaosbey.settings.player.v2)                     ├─► FlowFxSystem.setSettings  (live)
                                                                                   └─► ConditionVisualsSystem.setBlurScale (live)

Match tick ──► PresentationHub (events + state) ──► FlowFxSystem.onEvents / update
                                                     ├─ FlowWind ──► FxLayer (rings, crowns, star, streaks)  [src/vfx/hybrid/fx]
                                                     │            └─► AnimeDust ──► DustVolume (one InstancedMesh)
                                                     ├─ ComicWords (DOM overlay, z-index 950)
                                                     ├─ shadow discs (2 meshes)
                                                     └─ lean (writes the visual group's attitude)
```

| Peça | Arquivo | Papel |
|---|---|---|
| Valores, faixas, grupos, validação | `src/vfx/flow/flowFxTuning.ts` | `FlowFxValues`, `FLOW_FX_DEFAULT_VALUES`, `FLOW_FX_SPEC`, `sanitizeFlowFxSettings`, `withFlowFxValue` |
| Sistema de apresentação | `src/vfx/flow/FlowFxSystem.ts` | Liga eventos e estado do jogo aos efeitos; inclinação e sombra |
| Vento, argolas, coroas, estrela, poeira de trilha | `src/vfx/flow/FlowWind.ts` | Compartilhado com o lab; recebe uma `FlowBeyPose` e um `FlowFloor` |
| Composições da poeira | `src/vfx/flow/AnimeDust.ts` | Onda (Q), coroa (W), nuvem (E): o que nasce e onde |
| Poeira em volume | `src/vfx/flow/dustVolume.ts` | Blocos por semente, `InstancedMesh` toon, opacidade por instância |
| Palavras | `src/vfx/flow/ComicWords.ts` | Camada DOM, estilo A |
| Blur (multiplicador) | `src/vfx/condition/conditionRig.ts` (`blurScale`), `ConditionVisualsSystem.setBlurScale` | O slider fala com o borrão aprovado |
| Ligação | `src/app/session/MatchSession.ts` (`flowFx`, `setFlowFx`, `getFlowFx`) · `src/app/frontend/MatchRunner.ts` · `src/app/frontend/quality.ts` · `src/app/frontend/PlayFlow.ts` | Opções iniciais e aplicação ao vivo |
| Configurações | `src/config/settings/PlayerSettings.ts` · `src/app/frontend/SettingsScreen.ts` | Campo `flowFx`; seção **Visual effects** |
| Lab | `prototypes/bey-flow-fx-concepts/` | Usa os **mesmos** módulos de `src/vfx/flow`; só a coreografia (`FlowSim`) e a página são dele |

**Quando o sistema existe:** é anexado ao hub **com a flag `hybridVfx`** (a do pacote Hybrid VFX + Cel Cyclone, ligada no jogo normal). Não há flag nova: `?pfx=` sem `hybridVfx` o desliga, como desliga o Hybrid. **Ordem no hub:** é anexado **antes** do `ConditionVisualsSystem`, porque a inclinação mexe na atitude do grupo visual e o rig das condições copia essa atitude a cada quadro (assim o borrão e as auras acompanham a inclinação).

**Escala:** todo tamanho em metros dos sliders vale para o Bey do lab (diâmetro 1,3 m) e é multiplicado por `effectScaleOf(gameplay, vfx)` = tamanho do Bey na partida × o "tamanho dos efeitos" do Pregame. Afetados: `dustSizeM`, `windLengthM`, `windWidthM`, `crownSizeM`, `burstSizeM`; a altura do meio do corpo (onde nascem as argolas) vale `raio do collider × 0,55/0,65`.

**Hitstop:** durante o congelamento do golpe, os efeitos seguem a 35% da velocidade (a mesma taxa do Hybrid VFX), em vez de congelar junto.

---

## 3. Direção: de onde cada efeito aponta

Pedido do owner (2ª e 4ª rodadas): **tudo que corre atrás do Bey segue a orientação do Bey**, e as argolas nascem **do meio do Bey, no ângulo para onde ele é disparado**. Regras no código:

| O quê | Direção usada | Como é obtida |
|---|---|---|
| Trilha de poeira e riscos de vento | **Rumo do Bey** (`headX/headZ`): enquanto dá Dash, a velocidade se > 2 m/s, senão o rumo ao oponente; fora do Dash, a direção da velocidade (mantida enquanto quase parado, limiar 0,3 m/s) | `FlowFxSystem.updatePose` |
| Argolas de um **Dash** | Para o **oponente** (o Dash do jogo mira o oponente, `AttackController.dashHeadingRad`), correndo para trás; nascem no meio do corpo | `FlowWind.dashStart` com `dashDirX/Z` |
| Leque de poeira do Dash | Atrás do Bey, num leque de ±0,7 rad | `AnimeDust.burst` com direção oposta |
| Argolas, coroas, estrela e poeira de um **golpe** | **Ao longo do ataque:** do atacante para o defendido | `FlowFxSystem.onEvents` (`attackerSide` → `defenderSide`) |
| Posição do golpe | Ponto médio dos dois Beys | idem |

Nada usa um vetor não relacionado (a velocidade antiga de órbita foi a causa do bug de argolas da 2ª rodada).

---

## 4. Borrão de giro

- **O que é:** a casca de bandas concêntricas da camada física aprovada (`conditionRig.ts`, GDD 83), desenhada só enquanto o sistema de condições está ligado.
- **O que mudou:** um multiplicador `blurScale` (campo público do rig, `ConditionVisualsSystem.setBlurScale`): `opacidade = min(0,95, 0,62 × T.blur × blurScale × smoothstep(rps, fade×0,6, fade×1,6))`.
- **Slider:** `blurStrength`, padrão **1,35** (número do owner; a aprovação original era 1). `0` apaga a casca. `intensity = 0` também apaga.
- **Não portado:** `blurFadeSpin` (o giro em que o borrão some, 0,2 no lab). No jogo o corte é em rps (`blurFadeRps = 6`: o borrão sobe entre 3,6 e 9,6 rps), que na escala 0–18 rps do jogo é praticamente o mesmo 0,2 do lab; fica o valor aprovado.

## 5. Inclinação na curva

- **O que é:** o topo do Bey pende para dentro da curva, em proporção à aceleração lateral.
- **Como é feito:** a cada quadro o sistema lê a pose do grupo visual, estima a **velocidade** (suavizada, só quando a pose se moveu de verdade: não mede quadros sem passo de física novo) e a **aceleração**; `aEsquerda = ax·fz − az·fx` (para a esquerda do rumo); `alvo = −leanMaxDeg × clamp(aEsquerda / leanAccelRefMps2, −1, 1)`; `lean += (alvo − lean) × (1 − e^(−leanSmooth·dt))`.
- **Aplicação:** rotação `lean` em torno do **eixo do rumo** (horizontal), **pivotando na ponta**: `ponta = posição − up × meiaAlturaDoCollider`; a posição do grupo é recalculada para a ponta ficar onde a física a pôs. A física reescreve a pose no quadro seguinte, então nada acumula.
- **Não inclina:** no ar (`airborne`), tombando (`tumbling`), quebrado (`broken`), abaixo de 0,5 m/s, e os Beys derrotados.
- **Sliders:** `leanMaxDeg` (padrão 26°; 0 desliga), `leanAccelRefMps2` (13 m/s²), `leanSmooth` (9 /s).

## 6. Sombra

- **O que é:** um disco preto (`CircleGeometry` de 24 segmentos, `MeshBasicMaterial` preto, sem mapa de sombra, sem luz) por Bey: 1 chamada de desenho cada.
- **Posição:** sob a ponta, na altura do chão em (x, z) + 3 cm; deitado na inclinação do funil (a normal do piso sai da inclinação radial do perfil do chão).
- **Tamanho:** `diâmetro do collider × 1,1 × shadowScale`; cresce até +25% quando o Bey sobe.
- **Pulo:** a opacidade cai linearmente até 0 a 3 m de altura (a sombra continua no chão).
- **Sliders:** `shadowOpacity` (padrão 0,5; 0 desliga), `shadowScale` (0,9×).
- **Custo:** desprezível; é por isso que não é uma sombra de verdade. Some com o Bey derrotado.

---

## 7. Poeira anime em volume

### 7.1 O que é e por que é assim
As rodadas 2 a 4 desenharam a poeira como **imagens** (adesivos, depois recortes) e o owner as chamou de **"papel": imagens postas por cima, não coisas dentro do jogo como os Beys**. Desde a 5ª rodada a poeira é **geometria na cena**: cada nuvem é um monte de **esferas e elipsoides alongados** (as correntes de bolhas da 3ª folha de referência).

### 7.2 Como é desenhada (`dustVolume.ts`)
- **Um só `InstancedMesh`** (uma chamada de desenho para todas as nuvens): icosaedro de detalhe 2 (~320 triângulos por bloco), capacidade de 2.600 blocos (os mais velhos saem primeiro se estourar).
- **Material:** `MeshToonMaterial` branco com `gradientMap` de 3 degraus (0,6 / 0,86 / 1), emissivo 0,28 (mantém o branco legível nas arenas escuras). Recebe a **luz e a neblina da arena**.
- **Profundidade:** testa e escreve profundidade: o Bey passa na frente de uma nuvem e atrás de outra; a nuvem afunda no chão.
- **Opacidade:** por nuvem, via atributo de instância `instanceOpacity` multiplicado no alpha antes do `alphaHash` (alpha picotado estocástico, que mantém a ordem correta mesmo com centenas de blocos sobrepostos). Efeito colateral conhecido: borda granulada nas nuvens que somem.
- **Física visual:** arrasto de 1,5 /s, sobe 0,35 m/s (as coroas não sobem), cresce nos primeiros 28% da vida (`growFrom` 0,55; 0,4 nas coroas).

### 7.3 Como morre: três regras, os sliders que o owner pediu
Para uma nuvem com vida normalizada `k` (0 → 1):

1. **Opacidade** (`dustOpacity`): `α(k) = dustOpacity × (1 − t)`, com `t = clamp((k − (1 − dustFade)) / dustFade, 0, 1)`.
2. **Opacidade ao longo da vida** (`dustFade`): onde a queda começa. **0 = só no fim da vida; 1 = desde o primeiro instante.** Sempre chega a **zero** ao fim. Padrão **0,95** (o owner: quase desde o início, "reduzindo até zero").
3. **Encolhimento** (`dustShrink`): cada bloco começa a encolher entre 35% e 70% da vida (os pequenos e as agulhas primeiro, a ordem vem do tamanho) e chega a `1 − dustShrink` do tamanho; `1` = some por inteiro. Padrão 0,5.

### 7.4 As três composições (escolha em Settings → Dust style)
O owner ainda não escolheu. O padrão é **Q**, a que ele chamou de "aceitável" ("a coroa com onda").

| | Q · Onda com cauda (padrão) | W · Coroa de respingo | E · Nuvem de explosão |
|---|---|---|---|
| **Trilha** | Ondas rentes ao chão, com caudas varridas, escorrem atrás do Bey | Pequenas coroas de espinhos deitadas no chão, atrás da ponta | Montes de nuvem atrás do Bey |
| **Dash** | Leque de ondas para trás | Três coroas empilhadas | Monte de explosão com agulhas |
| **Golpe** | Ondas rolam para fora, em volta do contato | Três coroas | Monte de explosão com agulhas |
| **Blocos** | bell de 9 blocos + 3 de topo + 5 caudas finas | anel de 15–18 bolas + 24–28 espinhos | monte (7–9 base, 3–4 segundo andar, 1–2 de destaque, 2–3 satélites) + 9–11 agulhas |

As coroas deitam na inclinação do funil (a normal do piso) e não sobem. Uma explosão que aponta para a câmera **encolhe** (até 25% quando aponta direto; começa a 90° da câmera e é mínima a ~53°), para a poeira nunca esconder a luta.

### 7.5 Emissão
- **Trilha** (por quadro, por Bey): `dustRate × intensity × speedK × (1 + dustDashBoost no Dash)` emissões/s, com `speedK = smoothstep(2, 10 m/s)`; nada abaixo de 2 m/s.
- **Tamanho de cada emissão:** `dustSizeM × U(0,7; 1,2) × (0,6 + 0,5·speedK + 0,15·dashBoost) × escala do Bey` (× 1,3–1,9 de altura na onda/nuvem). **Vida:** `dustLifeS × U(0,8; 1,15)`.
- **Dash:** uma explosão de 6 emissões no leque; **golpe:** 6 a 12 emissões (por magnitude) em volta do contato; tamanho `burstSizeM × (0,8 + 0,5·m) × intensity`.

### 7.6 Sliders (grupo Anime dust)
`dustOpacity` (padrão 1), `dustFade` (0,95), `dustShrink` (0,5), `dustRate` (4 /s; 0 = sem poeira de trilha), `dustSizeM` (0,4 m), `dustLifeS` (0,3 s), `dustDashBoost` (2,5×). Mais `burstSizeM` no grupo de impacto e a escolha da composição.

---

## 8. Vento: riscos rasgados
- **O que é:** riscos finos brancos e cinza-azulados (50/50) atrás de um Bey rápido: `wakeStreakFx` + `tornStreak` (peças aprovadas do Cel Cyclone), em material cel sem contorno.
- **Emissão:** `windRate × intensity × speedK × (1 + 0,5 × dashBoost)` /s, a partir de pontos na seção do corpo do Bey (disco achatado, sem passar do chão), seguindo o rumo.
- **Cada risco:** largura `windWidthM × U(0,5; 1,1)`, comprimento mínimo `windLengthM × 0,6`, ultrapassagem `windLengthM × U(0,5; 1)`, vida `windLifeS ± 15%`.
- **Sliders:** `windRate` (30 /s; 0 desliga), `windLengthM` (1,1 m), `windWidthM` (0,25 m), `windLifeS` (0,25 s).

## 9. Argolas de choque, coroas e estrela
- **Argolas** (`jaggedRingFx`, textura `jaggedRing`): `crownCount` anéis serrilhados, escalonados 0,05 s, vida 0,42 s, nascendo em tamanho 0,6 e crescendo até `crownSizeM × intensity × (1 − 0,18·n)`, deriva para trás de `0,6 + 0,5·n` m. **Nascem do meio do corpo** (altura `raio × 0,55/0,65` acima do chão), de frente para a direção do Dash ou do golpe, e correm para trás.
  - No **Dash:** uma vez, na borda para o estado `DashActive`.
  - No **golpe:** no contato, de frente para o ataque (**voltaram na 5ª rodada**: o owner reclamou da remoção).
- **Coroas no chão** (`flatFx`, só no golpe): 2 anéis serrilhados deitados no piso, 3 cm acima, acompanhando a curvatura do funil (`conform`), tamanho `crownSizeM × intensity × (0,7 + 0,6·m) × (1 − 0,3·n)`, vida 0,55 s × (1 − 0,2·n).
- **Estrela** (`burstFx`, só no golpe): estrela chata de 10 pontas a 1 m do chão, vida 0,25 s, tamanho até `burstSizeM × 0,9 × (0,8 + 0,5·m)`.
- **Sliders:** `crownCount` (2; 0 = sem argolas, ficam coroas e estrela), `crownSizeM` (6,1 m), `burstSizeM` (1,4 m), `intensity` (1; 0 desliga tudo).

## 10. Palavras de quadrinho
- **O que é:** o estilo **A (Quadrinho)**, escolhido pelo owner: explosão de gibi (24 pontas) atrás de letras itálicas grossas com contorno de 7 px, sombra dura, aparece com um balanço ("pop") e sobe um pouco. **HIT** (amarelo/laranja) e **COUNTER!** (rosa/amarelo).
- **Quando:** `hitResolved`. **COUNTER!** é um Circular que pega um Dash (`hitboxKind === 'circular' && caughtOpponentDashing`) e **só enquanto "Counter hit burst" (Game feel) estiver ligado**; senão aparece HIT. O "COUNTER!" simples do HUD cede o lugar enquanto as palavras de quadrinho estão ligadas.
- **BLOCK não é disparado:** o jogo não tem regra de bloqueio. Definir o que é BLOCK está **em aberto** (ASK FIRST; sugestão registrada em `bey-flow-fx-approval.md`).
- **Desenho:** camada DOM `position: fixed`, `z-index 950` (sobre o canvas e a sobreposição de tela, sob o HUD), no máximo 6 palavras vivas, projetada de 1,6 m acima do contato. Respeita `prefers-reduced-motion` (animação 40% mais curta).
- **Sliders:** `calloutScale` (0,55×; cresce com a magnitude: `× (0,8 + 0,5·m)`), `calloutLifeS` (0,55 s), e a chave Ligado/Desligado `comicWords`.

---

## 11. Configurações: o que o jogador vê

**Settings → Visual effects** (teclado: ↑/↓ muda de linha, ←/→ mexe no slider; mouse arrasta):

1. **Dust style** (Wave with a tail / Splash crown / Blast cloud) e **Comic words** (On/Off).
2. Sliders por grupo: Spin blur · Lean in the curve · Shadow under the Bey · Anime dust · Wind streaks · Rings, crowns and impact star · Comic words.
3. **Reset visual effects** (volta aos números do owner). **Reset to defaults** da tela também restaura.

Salvos em `localStorage` (`chaosbey.settings.player.v2`, campo `flowFx`); uma configuração salva sem o campo (jogadores antigos) começa nos números do owner; cada valor inválido volta ao padrão e cada valor fora da faixa é recortado. Aplicam-se **ao vivo**, inclusive a partir do menu de Pausa.

### Tabela completa (padrão = números do owner, 2026-10-08)

| Chave | Grupo | Padrão | Faixa | Passo | Unidade | Efeito |
|---|---|---|---|---|---|---|
| `intensity` | Impacto | 1 | 0–2 | 0,05 | × | Multiplica argolas, poeira de trilha, vento e explosões; `0` desliga toda a camada (menos o borrão aprovado) |
| `blurStrength` | Borrão | 1,35 | 0–1,5 | 0,05 | × | × a força do borrão aprovado |
| `leanMaxDeg` | Inclinação | 26 | 0–40 | 1 | ° | Inclinação máxima; 0 desliga |
| `leanAccelRefMps2` | Inclinação | 13 | 4–40 | 1 | m/s² | Aceleração lateral que dá a inclinação máxima |
| `leanSmooth` | Inclinação | 9 | 2–30 | 1 | 1/s | Suavização |
| `shadowOpacity` | Sombra | 0,5 | 0–1 | 0,05 | | Opacidade; 0 desliga |
| `shadowScale` | Sombra | 0,9 | 0,5–2 | 0,05 | × | Tamanho relativo ao Bey |
| `dustOpacity` | Poeira | 1 | 0,1–1 | 0,05 | | Opacidade inicial da nuvem |
| `dustFade` | Poeira | 0,95 | 0–1 | 0,05 | | Quão cedo a nuvem começa a sumir (0 = só no fim, 1 = desde o início) |
| `dustShrink` | Poeira | 0,5 | 0–1 | 0,05 | | Quanto os blocos encolhem até o fim |
| `dustRate` | Poeira | 4 | 0–40 | 1 | /s | Emissões por segundo na trilha; 0 = sem |
| `dustSizeM` | Poeira | 0,4 | 0,2–4 | 0,05 | m | Tamanho base |
| `dustLifeS` | Poeira | 0,3 | 0,2–2,5 | 0,05 | s | Vida |
| `dustDashBoost` | Poeira | 2,5 | 0–4 | 0,1 | × | Poeira extra durante o Dash |
| `windRate` | Vento | 30 | 0–40 | 1 | /s | Riscos por segundo; 0 = sem |
| `windLengthM` | Vento | 1,1 | 0,8–6 | 0,1 | m | Comprimento |
| `windWidthM` | Vento | 0,25 | 0,2–2 | 0,05 | m | Largura |
| `windLifeS` | Vento | 0,25 | 0,2–1,5 | 0,05 | s | Vida |
| `crownCount` | Impacto | 2 | 0–5 | 1 | | Argolas por Dash e por golpe; 0 = sem argolas |
| `crownSizeM` | Impacto | 6,1 | 1–9 | 0,1 | m | Tamanho de argolas e coroas |
| `burstSizeM` | Impacto | 1,4 | 1–7 | 0,1 | m | Tamanho da explosão de poeira e da estrela |
| `calloutScale` | Palavras | 0,55 | 0,5–2 | 0,05 | × | Tamanho |
| `calloutLifeS` | Palavras | 0,55 | 0,4–2 | 0,05 | s | Duração |
| `dustStyle` | (escolha) | `wave` | wave / crown / cloud | | | Composição da poeira |
| `comicWords` | (chave) | ligado | | | | Palavras de quadrinho |

> Os padrões de tamanho de poeira (0,4 m) e de explosão (1,4 m) são os do owner no painel do lab da 5ª rodada, em volume.

---

## 12. Custos, limites e o que não faz

- **Custo:** poeira = 1 chamada de desenho (≤ 2.600 blocos de ~320 triângulos; na prática dezenas a poucas centenas); sombras = 2; argolas/coroas/estrela/riscos usam o `FxLayer` próprio (pool com teto); palavras = DOM (≤ 6). Nenhum depende da qualidade gráfica ainda (**em aberto:** se *Low* deve reduzir/ desligar a poeira).
- **Não toca:** corpos, colliders, estatísticas, entradas, câmera, relógio de hitstop, replay, hash de estado. Os testes de neutralidade de apresentação (`presentationNeutrality`) continuam valendo.
- **Limites conhecidos:** alpha picotado nas bordas que somem; a inclinação usa a velocidade medida na pose desenhada (um quadro sem passo novo de física não a atualiza); BLOCK não existe; as três composições aguardam a escolha do owner.
- **Verificado em software GL** (poucos quadros por segundo); a sensação de movimento precisa ser avaliada ao vivo.

## 13. Testes
`tests/unit/flowFx.test.ts` (valores, validação, migração das Configurações, sistema, inclinação, sombra, palavras, limpeza) · `tests/unit/beyFlowFxLab.test.ts` (módulos compartilhados da poeira e do vento, coreografia do lab) · `tests/smoke/flowFxSettings.spec.ts` (sliders na tela, salvar/recarregar, sistema anexado em partida, slider aplicado ao vivo da Pausa).

## 14. Histórico resumido das rodadas (detalhe em `bey-flow-fx-approval.md`)
1. Primeira rodada do lab: ficam borrão, inclinação, poeira (anime), cai a fita/espiral/eco; texto estilo A como opção.
2. "Remova o 5"; poeira em 3 ideias; argolas do meio do Bey e na direção do disparo.
3. As 3 ideias rejeitadas ("parecem enfiadas por cima").
4. Recortes planos com erosão: "papel".
5. **Volume 3D**, direção pelo rumo do Bey, argolas/coroas/estrela restauradas no contato, sombra, sliders de opacidade. Números do owner viram o padrão.
6. **Integração ao jogo (0.54.0):** tudo acima como `FlowFxSystem` + sliders nas Configurações.

## 15. Reservado — física e gameplay do "Bey Real"
*Escrito em [`bey-real-physics-approval.md`](bey-real-physics-approval.md) (0.57.0): protótipo jogável de física realista, movimento automático com ~30% de influência do jogador e os botões de carregar/soltar, giratório, pulo e esquiva. Nada está integrado no jogo; continua ASK FIRST.*
