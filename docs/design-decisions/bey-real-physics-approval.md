# Bey Real — física realista, movimento automático e os quatro botões (protótipo)

**Status:** PROTOTIPADO no lab (1ª rodada) e **INTEGRADO NO JOGO como modo opcional desde a 0.59.0** (o owner pediu: 2026-10-09, "todos estes sliders no pré jogo … o preset atual é o base"; ver §14). O modo é desligado por padrão e o jogo clássico não muda. Os números finais e o que ainda falta ligar (§14.5) continuam em aberto.
**Data:** 2026-10-08
**Lab:** `prototypes/bey-real-physics-concepts/` (página `/prototypes/bey-real-physics-concepts/`). Arquivo único para abrir sem servidor: `lab-bey-real-v1.html` (Three.js vem do jsdelivr).
**Documentos irmãos:** [`bey-flow-fx-approval.md`](bey-flow-fx-approval.md) (o pedido original e o histórico), [`flow-fx-effects.md`](flow-fx-effects.md) (os efeitos visuais, que o lab reaproveita).

> O lab existe para julgar o **jeito de jogar**, não para decidir números. Todos os valores são propostas de Claude; onde o jogo já tem regra (Dash, Giratório, Esquiva), a proposta **é o número do próprio jogo**.

---

## 1. O que o owner pediu (2026-10-08)

Com capturas de quatro jogos de Beyblade (estádio amarelo claro, estádio de gelo, Metal Fight, Burst Rivals) e depois ("vamos apenas seguir com as mudanças de física agora, prepare o protótipo"):

1. **Física muito mais realista** (os Beys das referências se comportam como piões de verdade).
2. **Controle mínimo do movimento: ~30% de influência**, o resto automático; os Beys **se redirecionam imediatamente ao atacar**.
3. **Modo de jogo alternativo e selecionável, só de gameplay**, com câmera própria (o modo atual continua como está).
4. O jogador controla manualmente só: **carregar e soltar (Dash Attack)**, **ataque giratório**, **pulo** e **esquiva (dash)**.
5. Os efeitos visuais valem à parte, em qualquer modo (já entregues em 0.54.0).

## 2. O que o lab é (e o que não é)

- **É:** uma simulação determinística em vista de cima (`src/sim/RealSim.ts`, pura, sem Three.js), desenhada na **arena do jogo** (arte aprovada, chão em funil, neblina), com os Beys e os **efeitos do Fluxo do Bey** (poeira em volume, vento, argolas, sombra, texto de quadrinho). Jogável: setas, Z, X, C.
- **Não é:** o mundo Rapier do jogo. Não lê nada de `src/` além das constantes de ação (`AttackTuning`, `DodgeTuning`) e do perfil do chão; nada em `src/` o lê. Não decide balanceamento.
- **Por que assim:** mexer na física do jogo muda o replay e o hash de estado; antes de pagar esse custo, o owner precisa sentir se a ideia é boa. Se for, a integração vira PRs pequenos (seção 11).

## 3. Os quatro pilares do modelo

### 3.1 Física realista (velocidade é estado)
A velocidade do Bey é **estado**; o que o move é:

| Força / efeito | Como é no lab | Slider |
|---|---|---|
| **Cuba** | gravidade ao longo da inclinação do funil do jogo: `a = −r̂ · bowlPull · slope(r)` (o perfil `bowl-b`, profundidade 7 m) | `bowlPull` |
| **Atrito da ponta e arrasto** | `a = −v̂ · tipFriction · (1 + 2·cansaço) − v · drag`; o atrito sobe quando o giro cai | `tipFrictionMps2`, `dragPerS` |
| **Precessão** | o giro curva a trajetória: a velocidade gira `precession · spin · dir` rad/s (o sentido do giro é o sentido natural da órbita) | `precessionRadPerS` |
| **Balanço** | abaixo de `wobbleSpin` (ou Quebrado/Estabilidade baixa) um empurrão lateral senoidal cresce com o cansaço | `wobbleSpin`, `wobbleAccelMps2` |
| **Giro (Stamina)** | só cai: perda parada + por velocidade + por esforço de direção + por impacto/raspão/parede + custo das ações; **spin-out** em 2% | `spinDecayPerS`, `spinMoveLossPerM`, `spinSteerLoss`, `hitSpinLoss`, `rubSpinLoss`, `wallSpinLoss` |
| **Aderência** | a direção depende do giro (`grip = clamp(spin/0,25)`); Quebrado ×0,3; recuperação ×0,3 | (fixo) |
| **Colisão entre Beys** | impulso normal com quique que **sobe com o giro** (`restitutionLow→High`); depois **atrito tangencial das bordas** (`rimFriction`) | ver 3.4 |
| **Parede** | quique `wallRestitution`, arranhão tangencial, custo de giro e Estabilidade; só passa quem a ultrapassa **no ar** (acima de `wallHeightM`) | `wallRestitution`, `wallHeightM` |

### 3.2 Movimento automático (o piloto automático)
Uma função pura (`RealSim.autopilot`) devolve para onde o Bey **quer** ir (vetor de comprimento ≤ 1):

- **órbita** no sentido do giro (tangente em volta do centro);
- **correção radial** para um raio-alvo que respira (`orbitRadiusFrac` da arena, ±20%);
- **contenção**: acima de 82% do raio da arena empurra para dentro;
- **perseguição** ao oponente (`pursuit`), mais forte se o oponente está cansado, que **some de perto** (< 1,8 m) para dois Beys não ficarem grudados.

A direção é um **controle limitado**: `a = clamp((v_desejada − v) · 3/s, forçaDeDireção · aderência)`, com `v_desejada = intenção · cruzeiro · (0,5 + 0,5·√spin)`. Um Bey cansado ou Quebrado dirige mal; dirigir custa giro.

### 3.3 O jogador só influencia (≈30%)
`intenção = automático·(1−w) + seta·w`, com `w = influence · |seta|` (as setas viram um vetor no mundo pelo eixo "para cima da tela" da câmera). **Sem seta, o automático dirige sozinho** (100%); com seta, o jogador assume `influence` da direção (padrão 0,30; "Mais controle" 0,65; "Só automático" 0). A IA nunca lê seta: só o piloto automático.

### 3.4 Colisão com atrito de borda e troca de giro
Em cada contato (alturas dentro do alcance vertical do jogo, 1 m): impulso normal `J_n = (1+e)·v_aprox/(1/mA+1/mB)`; depois a **velocidade relativa das bordas** (corpos + giros: `±spin·10 m/s`) gera um impulso de atrito `J_t = clamp(−v_rel/(1/mA+1/mB), ±μ·J_n)` que **arrasta os dois de lado** e **troca giro**. Resultado físico que o lab reproduz (e os testes pinam): **dois piões girando no mesmo sentido se raspam e perdem mais giro; em sentidos opostos "engrenam"**. O Dash tem **massa efetiva ×1,8** (`dashMassBoost`) e custa Estabilidade proporcional à carga e à velocidade de fechamento.

## 4. Os quatro botões (as regras do jogo, com o snap pedido)

| Botão | Regra no lab | Origem |
|---|---|---|
| **Z segurar e soltar = Dash** | carga 0,15–1,2 s; velocidade 10–18 m/s por 0,5 s; recarga 1,5 s; **vira para o oponente na hora (snap: até 40 rad/s por 0,08 s) e depois mira a 5 rad/s**; mira com um pequeno adiantamento; mantém 55% da velocidade ao acabar; **errar custa 0,6 s de recuperação** em que a direção fica ×0,3 | `AttackTuning` (0,12 s de toque; 10/18; 0,5; 5 rad/s; 0,6; 1,5) + **snap novo** |
| **Z toque (< 0,12 s) = Giratório** | 0,25 s ativo + 0,3 s de recuperação; **defensivo**: quem usa não sofre dano nem empurrão; quem toca é **lançado** (9 m/s + 7 m/s para cima) e perde 8 de Estabilidade; **pegar um Dash é COUNTER** (o Dash para, mantém 30% da velocidade) | `AttackTuning` |
| **X = Pulo** | impulso 7,5 m/s, gravidade 18 m/s²; **sem direção no ar** (`airControl` 0): o jogador escolhe só o momento; acima de 1 m ninguém acerta você (pular por cima de um Dash); pouso solta ondas, custa um pouco de Estabilidade | pedido do owner |
| **C = Esquiva** | impulso 12,6 m/s por 0,25 s, **invulnerável 0,5 s**, recarga 3 s, custo de giro 1%; sem seta vai **de lado em relação ao oponente**, para o lado com mais espaço; **Esquiva Perfeita** = apertada quando o ataque chega em ≤ 0,15 s: o atacante erra, você ganha o Dash de volta e a recarga da Esquiva cai para 40% | `DodgeTuning` |

## 5. A rodada
**Ring-out** (passou da parede no ar e ficou fora por 0,6 s), **spin-out** (giro em 2%), **KO** (Estabilidade 0 → Quebrado por 2,4 s; qualquer golpe depois é KO) e **tempo** (150 s: empate). Mesmos três resultados do jogo (`RoundState`). A Estabilidade volta 5/s depois de 1,5 s sem apanhar. Empate se os dois saem juntos.

## 6. A IA do oponente
Só decide **botões** (a direção é o piloto automático): arma um Dash de longe (carga sorteada), dá Giratório quando o oponente está colado, e **reage a um Dash que chega** (esquiva ou pulo ou Giratório) depois de um atraso humano de 0,12–0,57 s conforme `aiSkill`. Determinística (semente). Modos: **IA**, **Demo** (dois automáticos, para ver só a física), **Só o automático** (o oponente sem botões).

## 7. Câmera (comparação)
- **Alta e fixa** (padrão, a recomendada para o automático);
- **Do jogo** (imita a Arena Fighter, segue os dois);
- **Perseguição** (atrás do seu Bey): **contraria o fix 8 de `camera-approval.md`** (a câmera não fica permanentemente atrás do jogador) e está aqui só como comparação;
- **Livre** (órbita).
As setas são sempre relativas ao "para cima da tela" da câmera atual (a regra `screen` do jogo).

## 8. Valores (todos são sliders no lab)

**Controle do jogador**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `influence` | 0.3 | 0–1 | 0.05 | Influência do jogador no movimento (0 = só o automático, 1 = manual) |

**Piloto automático**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `steerAccelMps2` | 12 | 2–30 | 0.5 | Força de direção (m/s²) |
| `cruiseSpeedMps` | 8.5 | 3–14 | 0.5 | Velocidade de cruzeiro (m/s) |
| `pursuit` | 0.45 | 0–1 | 0.05 | Perseguição ao oponente (0–1) |
| `orbitRadiusFrac` | 0.5 | 0.2–0.8 | 0.05 | Raio da órbita (fração da arena) |

**Física: cuba, atrito, giro**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `bowlPull` | 20 | 0–40 | 1 | Puxão da cuba (x) |
| `dragPerS` | 0.1 | 0–1 | 0.01 | Arrasto viscoso (1/s) |
| `tipFrictionMps2` | 0.7 | 0–4 | 0.1 | Atrito da ponta (m/s²) |
| `precessionRadPerS` | 0.4 | 0–1.5 | 0.05 | Curvatura de precessão do giro (rad/s) |
| `spinDecayPerS` | 0.0035 | 0–0.02 | 0.0005 | Perda de giro parado (1/s) |
| `spinMoveLossPerM` | 0.00035 | 0–0.002 | 0.00005 | Perda de giro por velocidade |
| `spinSteerLoss` | 0.00025 | 0–0.002 | 0.00005 | Perda de giro por esforço de direção |
| `wobbleSpin` | 0.35 | 0.05–0.7 | 0.01 | Giro abaixo do qual o Bey balança (0–1) |
| `wobbleAccelMps2` | 3.5 | 0–10 | 0.1 | Força do balanço (m/s²) |
| `massSecond` | 1 | 0.5–2 | 0.05 | Massa do 2º Bey (x o 1º) |
| `sameSpin` | 0 | 0–1 | 1 | Giro no mesmo sentido (0 = opostos, 1 = iguais) |

**Colisão entre Beys e parede**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `restitutionLow` | 0.5 | 0.1–1 | 0.01 | Quique com giro baixo |
| `restitutionHigh` | 0.78 | 0.1–1 | 0.01 | Quique com giro alto |
| `rimFriction` | 0.4 | 0–1 | 0.01 | Atrito entre as bordas |
| `spinExchange` | 0.012 | 0–0.05 | 0.001 | Troca de giro no contato |
| `hitSpinLoss` | 0.0026 | 0–0.01 | 0.0002 | Giro perdido por impacto |
| `rubSpinLoss` | 0.0016 | 0–0.01 | 0.0002 | Giro perdido por raspão |
| `hitStability` | 0.6 | 0–3 | 0.05 | Estabilidade perdida por impacto |
| `wallRestitution` | 0.5 | 0–1 | 0.01 | Quique na parede |
| `wallSpinLoss` | 0.0016 | 0–0.01 | 0.0002 | Giro perdido na parede |

**Dash Attack (carregar e soltar)**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `dashMinSpeedMps` | 10 | 4–20 | 0.5 | Velocidade mínima (m/s) |
| `dashMaxSpeedMps` | 18 | 6–30 | 0.5 | Velocidade máxima (m/s) |
| `dashChargeMaxS` | 1.2 | 0.3–3 | 0.05 | Carga até o máximo (s) |
| `dashDurationS` | 0.5 | 0.2–1.2 | 0.05 | Duração (s) |
| `dashCooldownS` | 1.5 | 0.5–5 | 0.25 | Recarga (s) |
| `dashSnapRadPerS` | 40 | 0–80 | 1 | Virada imediata ao soltar (rad/s) |
| `dashSnapWindowS` | 0.08 | 0–0.3 | 0.01 | Janela da virada imediata (s) |
| `dashLockRadPerS` | 5 | 0–12 | 0.5 | Mira depois da virada (rad/s) |
| `dashMassBoost` | 1.8 | 1–4 | 0.1 | Massa efetiva no Dash (x) |
| `dashStabilityMin` | 10 | 0–50 | 1 | Estabilidade tirada, carga mínima |
| `dashStabilityMax` | 25 | 0–80 | 1 | Estabilidade tirada, carga máxima |
| `dashSpinCost` | 0.012 | 0–0.06 | 0.001 | Custo de giro |
| `dashWhiffRecoveryS` | 0.6 | 0–2 | 0.05 | Recuperação se errar (s) |

**Ataque giratório (toque)**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `circularRadiusM` | 1.2 | 0.6–3 | 0.05 | Alcance (m) |
| `circularDurationS` | 0.25 | 0.1–0.8 | 0.05 | Duração ativa (s) |
| `circularRecoveryS` | 0.3 | 0–1 | 0.05 | Recuperação (s) |
| `circularLaunchMps` | 9 | 0–20 | 0.5 | Lançamento horizontal (m/s) |
| `circularLaunchUpMps` | 7 | 0–14 | 0.5 | Lançamento para cima (m/s) |
| `circularKeepFraction` | 0.3 | 0–1 | 0.05 | Velocidade que um Dash capturado mantém |
| `circularStability` | 8 | 0–40 | 1 | Estabilidade tirada de quem toca |

**Esquiva**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `dodgeSpeedMps` | 12.6 | 4–24 | 0.5 | Velocidade (m/s) |
| `dodgeBurstS` | 0.25 | 0.1–0.6 | 0.01 | Duração do impulso (s) |
| `dodgeInvulnS` | 0.5 | 0.1–1 | 0.05 | Invulnerável por (s) |
| `dodgeCooldownS` | 3 | 0.5–6 | 0.25 | Recarga (s) |
| `dodgePerfectS` | 0.15 | 0.05–0.4 | 0.01 | Janela da esquiva perfeita (s) |
| `dodgeSpinCost` | 0.01 | 0–0.06 | 0.001 | Custo de giro |

**Pulo**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `jumpSpeedMps` | 7.5 | 3–14 | 0.5 | Impulso do pulo (m/s) |
| `gravityMps2` | 18 | 6–40 | 1 | Gravidade no ar (m/s²) |
| `airControl` | 0 | 0–1 | 0.05 | Controle no ar (0 = nenhum) |
| `jumpCooldownS` | 0.4 | 0–2 | 0.05 | Recarga do pulo (s) |

**Arena e regras**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `stageRadiusM` | 12 | 7–20 | 0.5 | Raio da arena de jogo (m) |
| `wallHeightM` | 1.25 | 0.3–3 | 0.1 | Altura da parede (m) |
| `ringOutDelayS` | 0.6 | 0–3 | 0.1 | Tempo fora da arena até perder (s) |
| `timeLimitS` | 150 | 0–300 | 10 | Limite de tempo (s, 0 = sem) |
| `stabilityRegenPerS` | 5 | 0–20 | 0.5 | Recuperação de Estabilidade (por s) |
| `brokenS` | 2.4 | 0.5–6 | 0.1 | Tempo Quebrado (s) |

**Oponente (IA)**

| Chave | Valor proposto | Faixa | Passo | O que é |
|---|---|---|---|---|
| `aiAggression` | 0.6 | 0–1 | 0.05 | Agressividade da IA (0–1) |
| `aiSkill` | 0.55 | 0–1 | 0.05 | Reação da IA (0–1) |

> `massSecond` e `sameSpin` valem na próxima rodada (a rodada nova nasce a cada 3,2 s depois de uma vitória, ou com **R**). Os presets: **Bey Real (proposta)**, **Mais controle**, **Só automático**, **Pesado e inercial**, **Selvagem**.

## 9. Calibração (proposta) e o que os testes garantem
Partidas **IA × IA** em lote (40 sementes, `aiAggression` 0,6, `aiSkill` 0,55, tempo real da simulação):

| | Proposta |
|---|---|
| Como terminam | ~**40% spin-out**, ~**35% KO**, ~**25% ring-out** |
| Duração | mediana ~33 s, p10 ~5 s, p90 ~54 s |
| Por partida | ~24 impactos, ~11 Dashes, ~6 Giratórios, ~1,6 Esquivas (0,7 perfeitas), ~0,6 Pulos, ~2 batidas na parede |
| Velocidade máxima | ~20 m/s (Dash cheio) |
| Cuidados | nenhum valor não finito; ninguém fora do limite sem ring-out |

Ajustes feitos nesta calibração (para o owner saber o que foi tocado): a perseguição **some de perto** (antes os Beys grudavam e gastavam o giro rasando um no outro); `hitStability` 0,9 → 0,6 (KOs rápidos demais); chance de Dash da IA reduzida; `wallHeightM` 1,25 (com 1,1 o ring-out era 50% das partidas, quase todos por Giratório perto da parede).

Testes (`tests/unit/beyRealPhysicsLab.test.ts`, 37): ajuste e valores do jogo; determinismo; 20 partidas finitas e dentro dos limites; órbita no sentido do giro; influência 0/30/100%; Dash (snap, carga, recarga, erro); Giratório (defensivo, lança, COUNTER); pulo (sem controle no ar, recarga, pular por cima); Esquiva (impulso, i-frames, perfeita e cedo demais); colisão (momento, massa, mesmo giro × giro oposto, atrito lateral, evento); parede e ring-out; spin-out, KO, tempo, nova rodada; IA.

## 10. Limites conhecidos do protótipo
- **Não é o Rapier do jogo:** as sensações (aderência, quique, atrito) precisam ser reavaliadas quando a integração existir.
- **Escala:** a arena de jogo do lab tem raio 12 m (o jogo tem 36 m, com o slider de tamanho do palco); a parede é invisível, o anel azul no chão marca a borda.
- **Verificado em renderização por software** (poucos quadros por segundo): o movimento ao vivo precisa ser sentido no navegador.
- Drift e momentum do jogo **não existem** neste modo do lab (não estavam na lista de botões).

## 11. Em aberto (nada disto está decidido)
1. **A sensação**: 30% de influência é pouco, bom ou muito? O Dash com snap acerta? O pulo sem direção é divertido? As rodadas duram o que você quer?
2. **O que acontece com drift e momentum** no modo (sugestão: desligar o drift; o momentum enche só pelo movimento automático).
3. **Nome do modo** ("Bey Real" é provisório) e **onde se escolhe** (Pregame, opção de partida).
4. **Câmera do modo**: alta e fixa (recomendada) ou perseguição (exige revogar o fix 8).
5. **Escala da arena** para o modo (o lab usa 12 m).
6. **BLOCK** continua sem regra no jogo (ver `bey-flow-fx-approval.md`).

## 12. Plano de integração (só depois da aprovação)
1. **Controlador de piloto automático** na camada de controladores (mesmo canal da IA, `ControllerActions.moveIntent`): `automático·(1−w) + seta·w`; replay já grava o `moveIntent`. Opção de Pregame independente do `controlScheme`.
2. **`physicsMode: 'arcade' | 'realistic'` em `MatchConfig`** (gravado no replay; replays antigos valem como arcade; hashes do arcade não mudam): atrito de ponta baixo, velocidade como estado, precessão e balanço de verdade, atrito de borda e troca de giro nas colisões, sliders no Debug Lab.
3. **Snap de redirecionamento do Dash** (janela 0,08 s + mira 5 rad/s) no `AttackController`.
4. **Pulo sem direção no ar** neste modo (`AIRBORNE_ACCELERATION_FACTOR → 0`).
5. **Câmera do modo** (depois da decisão).
Cada etapa é uma PR própria, com testes determinísticos e de replay.

## 13. Arquivos
| Arquivo | Conteúdo |
|---|---|
| `prototypes/bey-real-physics-concepts/index.html` | Página, HUD e CSS |
| `.../src/main.ts` | Ligação da UI: teclado, HUD, presets, painel de ajuste, anel da borda |
| `.../src/sim/RealSim.ts` | A simulação (pura): física, piloto automático, ações, rodada, IA |
| `.../src/tuning.ts` | Todos os valores, faixas, presets |
| `prototypes/bey-flow-fx-concepts/src/stage/FlowStage.ts` | Cena compartilhada (agora genérica na simulação; câmera de perseguição; notas) |
| `prototypes/bey-flow-fx-concepts/src/sim/FlowSim.ts` | `StageSim`, `StageNote`, `FlowBey.height` |
| `src/vfx/flow/FlowWind.ts` | `landing()` (coroas e poeira no pouso) |
| `tests/unit/beyRealPhysicsLab.test.ts` | Verificações do lab (não são testes de gameplay) |

## 14. Integração no jogo (0.59.0, pedido do owner em 2026-10-09)

O owner colou os números que afinou no lab (**é o preset Base**) e pediu: (1) câmera como opção — livre, a do modo e a original; (2) slider do controle do jogador sobre o automático; (3) todos os sliders no Pregame, cada um com a sua explicação, num bloco "avançadamente avançado", com presets; (4) saber o que o modo herda do jogo normal.

### 14.1 Onde fica e como se liga
- **Pregame › "Bey Real"** (abaixo de Advanced): chave **Jogar no modo Bey Real** (desligada por padrão), **Câmera** (3 botões), e o bloco **Avançadamente avançado** com os presets e os sliders por grupo. Cada slider mostra o valor, o "base" ao lado, o selo **Alterado** (clique volta ao base) e a **explicação própria sempre visível** embaixo. Os sliders ficam travados até a chave ser ligada.
- **Presets** (`REAL_PRESETS`): **Base (do dono)**, Proposta original (a do lab), Mais automático (influência 30%), Só botões (0%), Pesado e inercial, Selvagem. O preset ativo é derivado dos valores (vira "Personalizado" ao mexer).
- Os valores moram em `MatchSetup.real` (lembrados com o resto do Pregame; um save antigo sem o campo lê como desligado). Fonte única da lista: `src/bey/real/RealTuning.ts` (o lab e o jogo leem a mesma).

### 14.2 O que o motor faz (um caminho só: `MatchConfig`)
- `MatchConfig.real` (opcional; **ausente = jogo clássico, bit a bit**; gravado no replay, validado pelo formato) carrega o modelo de movimento. O resto do que os sliders mexem vira **regras que o jogo já tem** (`realMatchRules.ts`): raio da arena → tamanho do palco (15/36), parede, quique da parede, atraso de ring-out, limite de tempo, gravidade e altura do pulo (a altura vem de v²/2g), controle no ar, recarga do pulo/Dash/esquiva, distância da esquiva (velocidade/12,6) e força do giratório (velocidade/9). `gameSpeed` fica 1 (o lab rodava em tempo real) e o `funnelPull` clássico fica 0 (o modo tem o seu puxão de cuba).
- **Cuba equivalente:** o lab desenhava o funil do jogo (7 m de fundo sobre 36 m) numa arena pequena; num palco de 15 m a mesma inclinação à mesma distância do centro pede fundo `7·(15/36)^1,3 ≈ 2,25 m` (o perfil é h ∝ r^1,3). É esse o fundo do modo.
- **Piloto automático** (`AssistedController`, `RealAutopilot.ts`): envolve quem conduz o lado (teclado/controle ou IA). Ele continua decidindo os botões (Attack, Pulo, Esquiva — e o que a IA faz com eles); a direção é `automático·(1−w) + seta·w` com `w = influência × força da seta`. O lado da IA não tem seta: só o automático. Teclas de direção clássicas são limpas (não existe Drift nem giro de tanque); o resultado é um `moveIntent` comum, então a esquiva, o gravador e o replay não precisam saber de nada.
- **Movimento** (`RealMotion.ts`, ramo em `MovementController.applyPreStep`): a velocidade é o estado. Forças por tick: puxão da cuba (inclinação do chão sob o Bey), direção limitada pela aderência (cai com giro baixo; Quebrado = 30%), atrito de ponta (cresce com giro baixo) e arrasto, balanço de giro baixo/instável, precessão (o giro entorta o caminho; sentidos opostos nos dois Beys). Colisões continuam sendo do Rapier (a próxima tick parte da velocidade que o mundo deixou). Dash, Esquiva e rail seguem sobrepondo o movimento como sempre. Sem janela de "controle perdido".
- **Giro (Stamina):** substituído pelo consumo do modo (`StaminaSystem.realDrain`): fração do giro por segundo parado + por metro + por esforço de direção.
- **Câmeras** (`src/camera/real/`): *Original* = os diretores do jogo; *Bey Real* = alta, mostra a arena e os dois Beys, segue o meio da luta devagar, **abaixo da treliça de lâmpadas** das arenas (1,1 raio de altura, 1,15 atrás); *Livre* = arrastar gira, roda aproxima, duplo clique volta. **Câmera nunca move o Bey:** o referencial das setas continua o da arena (`camera-gameplay-separation.md`), qualquer que seja a câmera.
- Os sliders clássicos que o modo assume ficam **travados** com o modo ligado (tamanho do palco, fundo da cuba, parede, ring-out, tempo, gravidade, pulo, controle no ar, recargas, aceleração/velocidade/curva/retenção, momentum, perda de controle no contato…): um lugar para mudar cada valor e nenhum slider que não faz nada.

### 14.3 O que o modo herda do jogo normal (resposta ao item 4)
**Igual:** o mesmo mundo de física (Rapier), a arena e os palcos (com os rails opcionais), Clash, Estabilidade/Quebra/KO, ring-out, spin-out e tempo, Dash/Giratório/Esquiva/Pulo/Recuperação no Ar (controladores e recargas), dano por velocidade e dano de colisão, a IA de ataque/defesa (decide os botões), HUD, efeitos (incluindo os Flow FX), replays, o Pregame (Bey, oponente, rounds, seed, presets e regras de combate/knockback). **Muda:** o Bey é conduzido por piloto automático com a sua influência, a física é de pião (cuba, atrito, precessão, balanço), o giro é consumido pelo modelo do modo, sem Drift e (por padrão) sem controle no ar, e os sliders de movimento normais ficam travados.

### 14.4 Verificação
`tests/unit/beyRealGame.test.ts` (base = os números do dono, faixas, notas únicas por slider, presets, setup/lembrança, regras derivadas, travas, autopiloto, modelo de movimento, consumo de giro, controlador, câmeras), `tests/deterministic/beyRealMode.test.ts` (partida real: os dois Beys se movem sozinhos e ficam no palco, a influência segue a seta, determinismo, replay gravado→decodificado→reproduzido **verificado**, todos os presets, o jogo clássico intacto) e `tests/smoke/beyRealPregame.spec.ts` (o bloco no navegador e uma partida de verdade).

### 14.5 O que ainda NÃO está ligado (os sliders não aparecem no Pregame até estarem)
O Pregame só mostra o que o motor já usa (sem slider morto). Ainda do lab, a ligar nas próximas mudanças: **colisão** (quique baixo/alto, atrito de borda, troca de giro, giro/estabilidade por impacto, giro na parede), **Dash** (velocidades mínima/máxima, carga, duração, snap/mira, massa efetiva, dano, custo de giro, recuperação), **Giratório** (alcance, duração, recuperação, lançamento vertical, velocidade mantida, dano), **Esquiva** (duração do impulso, invulnerabilidade, janela perfeita, custo de giro), **física** (massa do 2º Bey, sentido do giro) e **regras/IA** (recuperação de Estabilidade, tempo Quebrado, agressividade e reação da IA). Hoje essas ações usam os números do próprio jogo.

### 14.6 Em aberto (decisão do owner)
Os rails ficam ligados por padrão (opção do Pregame, como no jogo normal) — no modo podem poluir a visão; o número final de cada slider; a poeira; o BLOCK; o nome do modo; drift/momentum (hoje: sem drift, momentum sem efeito na velocidade).
