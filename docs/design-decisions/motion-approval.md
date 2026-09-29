# Decisões aprovadas: movimento do Bey (Motion Lab)

**Status:** APROVADO em parte pelo dono do projeto — as três direções conceituais e a linguagem física, não os valores numéricos.
**Data:** 2026-09-27
**Origem:** protótipo `prototypes/bey-motion-concepts/` (Bey Motion Lab), branch `claude/bey-motion-lab`, commits `04bbce1` (spin readability, primeiro corte) e `53289b5` (seção de física de movimento: presets A/B/C, sliders, cenários, replays do jogo, debug).
**Artifact avaliado pelo dono:** https://claude.ai/artifact/RudDVud88A2Q1HZCmJ3W6d
**Base no GDD:** 15 (filosofia de movimento tipo kart), 16 (movimento realista de pião — requisito crítico), 17 (física translacional vs. rotacional), 18 (parâmetros de tuning de física), 82 (segurança de física), 83 (giro visual vs. giro físico), 84 (wobble físico), 85 (bounce e ricochete), 86 (movimento diagonal em alta velocidade), 87 (rotação por knockback), 88 (gameplay vs. realismo), 122 (visuais de debug para spin), 123 (relação spin/Stamina), 149 (definição de pronto para física), 150 (primeira suíte de self-test de física), 167 (valores provisórios) e 170 (não reabrir perguntas fechadas).

Este documento registra **o que já foi decidido** sobre o Motion Lab, para que nenhum agente reabra essas perguntas (GDD 170) nem trate silenciosamente os 33 sliders atuais como tuning final. A seção 13 separa com precisão o que **continua em aberto**. Nada aqui autoriza mudar gameplay, física de produção, colisores, IA ou balanceamento. Também não inicia o M8.

> **Diferença importante em relação ao `camera-approval.md`:** lá, o dono confirmou explicitamente os 43 valores exatos de cada preset como configuração final, sem alterações. Aqui, o dono aprovou as **ideias-base** das três direções de movimento e a **arquitetura do Motion Lab como ferramenta**, mas não confirmou os 33 valores atuais de cada preset como tuning final de produção. Ver a seção 2 e a seção 13.1.

> **Onde está:** o protótipo e este documento entram na `claude/epic-rubin-xuoo1d` por merge das branches `claude/bey-motion-lab` (Motion Lab) e `claude/sleepy-johnson-4i6io4` (Camera Lab, referenciado na seção 12). Até o merge para `main`, quem auditar só a `main` não vai encontrá-los.

---

## 1. Resumo da decisão

1. **As três direções de movimento foram aprovadas como direções-base válidas:** A — Stable Arcade, B — Physical Hybrid, C — Wild Mechanical. Devem ser preservadas.
2. **A linguagem física geral do Motion Lab foi aprovada.** Os comportamentos fundamentais que ela demonstra — momentum, diferença entre heading e velocity, grip/slip com recuperação de grip, tilt/lean, wobble, resposta tipo precessão, knockback linear e angular, tumble/rodopio, floor bounce, wall bounce, ricochete, wall scrape e recuperação gradual ao prumo — pertencem oficialmente à linguagem do jogo (GDD 16 e 17).
3. **A arquitetura do Motion Lab (modelo, os 33 sliders, os 14 cenários, o debug visual e a reprodução de lutas reais) está aprovada como ferramenta de desenvolvimento e comparação.** Não como conteúdo de produção.
4. **Os 33 valores atuais de cada preset NÃO são tuning final de produção**, a menos que o dono declare explicitamente que aprovou os valores numéricos exatos. Não há essa declaração registrada até o momento. Ver seção 13.1.
5. **Nenhuma das três direções vira automaticamente o default.** A escolha entre A, B, C ou uma mistura continua em aberto (seção 13.5).
6. **`ext-0` e `ext-32` continuam cenários de investigação**, não correções aprovadas (seção 10).
7. **Spin readability é um achado registrado, não uma decisão.** Nenhuma solução foi escolhida (seção 11).
8. **Nada foi integrado ainda.** `src/bey/movement/`, `src/bey/spin/`, `src/physics/`, colisores, knockback de produção, Camera Director e IA continuam intactos. A integração segue a seção 14 quando o dono pedir.
9. **Motion e Camera foram avaliados separadamente** e nenhum dos dois deve alterar silenciosamente o outro (seção 12).

---

## 2. Escopo exato da aprovação

Palavras do dono, preservadas por serem a fonte da distinção central deste documento:

> "As três são direções válidas de movimento para ChaosBey e devem ser preservadas. Porém, não interprete isso como aprovação automática de cada número atual dos 33 sliders como tuning final de produção, a menos que exista evidência explícita de que eu aprovei os valores numéricos exatos."

### APROVADO

- as três direções conceituais A/B/C;
- a linguagem física geral do Motion Lab;
- uso de momentum;
- diferença entre heading e velocity;
- grip e slip;
- tilt / lean;
- wobble;
- movimento tipo precessão (precession-like);
- perturbação angular (angular disturbance);
- knockback linear + angular;
- tumble / rodopio;
- floor bounce;
- wall bounce;
- ricochete;
- wall scrape;
- recuperação gradual ao prumo;
- spin visual legível como objetivo de design (o resultado atual está em aberto — seção 11);
- cenários reproduzíveis;
- debug visual;
- sliders/tuning como ferramenta de desenvolvimento.

### AINDA NÃO FINAL

- valores numéricos definitivos de produção;
- qual preset será o default;
- eventual mistura final entre A/B/C;
- tuning específico por Bey (Attack/Defense/Stamina podem herdar valores diferentes de um mesmo preset base — não decidido);
- correção definitiva de `ext-0`;
- correção definitiva de `ext-32`;
- integração com física de produção;
- integração com a câmera aprovada (`camera-approval.md`).

---

## 3. Princípios físicos aprovados

Os comportamentos abaixo, todos exigidos pelo GDD 16 e 17 e demonstrados no Motion Lab, são aprovados como linguagem do jogo — não como implementação final, mas como o **repertório físico** que qualquer implementação de movimento deve poder expressar:

| Princípio | GDD | Como o Lab demonstra |
|---|---|---|
| Momentum / heading ≠ velocity | 15, 16, 86 | Cenário `diagonal`: o Bey mantém a trajetória mesmo quando o heading muda bruscamente. |
| Grip / slip com histerese e recuperação | 16, 18, 128 | `lateralGrip`, `slipThreshold`, `slipGrip`, `gripRecovery`; cenário `drift`. |
| Tilt / lean para aceleração e velocidade | 16, 18, 86 | `leanStrength`, `speedTilt`, `maxTilt`; cenário `curve`. |
| Wobble limitado e amortecido | 16, 18, 84 | `wobbleAmplitude`, `wobbleFrequency`, `wobbleFromImpact`, `wobbleDecay`; nunca cresce sem limite (GDD 84 exige isso explicitamente). |
| Resposta tipo precessão (acoplamento giroscópico) | 16 | `precession`: um empurrão no tilt vira giro lateral, escalado pelo `spinRate`. |
| Recuperação gradual ao prumo (upright recovery) | 16, 82 | `uprightStrength`, `recoveryDamping`, `postImpactRecovery`: a mola de recuperação some no impacto e reaparece gradualmente, em vez de resetar instantaneamente. |
| Knockback com componente angular | 27, 87 | `impactAngularImpulse`, `linearToAngular`, `knockbackScale`, `knockbackLift`. |
| Tumble / rodopio acima de um limiar | 16, 87 | `tumbleStrength`, `tumbleThreshold`; cenário `tumble`. |
| Bounce de chão, parede e Bey-Bey | 16, 85 | `floorBounce`, `wallBounce`, `restitutionBey`; cenários `wall`, `ricochet`, `bounce`. |
| Ricochete e wall scrape | 37, 85 | `wallFriction`; cenários `ricochet`, `scrape`. |
| Segurança numérica | 82, 149 | `maxLinearSpeed`, `maxAngularSpeed` como clamps de segurança, não de gameplay; testados no self-test do Lab (seção 9). |

---

## 4. As três direções — A / B / C (aprovadas como direções, não como números finais)

### A — Stable Arcade
**Ideia:** firme e legível. Pouco tilt, wobble e tumble; grip e prumo voltam rápido.
Diferenças em relação a B: `turnRate` maior, `lateralGrip` e `gripRecovery` maiores, `slipThreshold` maior (escorrega menos), `maxTilt` menor (18° vs. 35°), `wobbleAmplitude` menor, `uprightStrength` e `recoveryDamping` muito maiores (recuperação quase imediata), `knockbackScale`/`tumbleStrength` menores.

### B — Physical Hybrid
**Ideia:** peso e inércia perceptíveis. Slip e tilt expressivos, impactos transferem spin e lean, recuperação física mas controlada.
**Ponto de partida:** os valores atuais de movimento do jogo (`accel` 14, `maxSpeed` 11 m/s, `turnRate` 2,6 rad/s, `lateralGrip` 5,5, `airGrip` 0,4, `wobbleAmplitude` 6°, `wobbleFrequency` 7 Hz — ver `src/bey/movement/MovementTuning.ts` e `src/bey/spin/SpinTuning.ts`). Por isso B funciona como o "meio" entre A e C.

### C — Wild Mechanical
**Ideia:** reações angulares fortes. Tilt, wobble, bounce e tumble grandes, ricochetes dramáticos — ainda travado para ficar numericamente estável.
Diferenças em relação a B: grip e `slipThreshold` menores (escorrega mais e mais fácil), `maxTilt` maior (48°), `wobbleAmplitude` maior (11°), `precession` maior, `uprightStrength`/`recoveryDamping` menores (recuperação mais lenta e visível), `restitutionBey`/`floorBounce`/`wallBounce` maiores, `knockbackScale`/`tumbleStrength` maiores, `angularDamping` menor (o rodopio dura mais).

**Nota de identificador:** os nomes A/B/C e "Stable Arcade" / "Physical Hybrid" / "Wild Mechanical" são identificadores do laboratório, não nomes de modos de jogo (mesma ressalva que o Camera Lab faz para seus próprios A/B/C).

---

## 5. Arquitetura do modelo do Motion Lab (aprovada como ferramenta)

- **Isolado:** `prototypes/bey-motion-concepts/` não importa nada de `src/` e não altera gameplay, física, colisor, stat ou balanceamento.
- **Modelo determinístico próprio** (`src/physics/model.ts`), com substeps fixos de 1/240 s e sem aleatoriedade: todo cenário reproduz exatamente o mesmo resultado.
- **Não é a física do jogo.** O jogo roda Rapier com seus próprios controllers; o Lab é um modelo escrito à mão para comparar linguagens de movimento antes de qualquer integração.
- **Por Bey, o modelo separa (GDD 17):**
  - **movimento planar:** posição, velocidade, heading, thrust ao longo do heading, grip/slip lateral com histerese;
  - **vertical:** gravidade, floor bounce, lift de knockback;
  - **atitude:** um vetor de tilt 2D (direção e magnitude da inclinação), alvo de lean, mola de recuperação amortecida que reaparece gradualmente após impacto, acoplamento giroscópico (`precession`);
  - **wobble:** energia limitada, alimentada por impacto, decaindo exponencialmente;
  - **whirl:** rotação do corpo inteiro ao redor do eixo vertical ("rodopio"), de impactos de raspão e knockbacks fortes, amortecida;
  - **contatos:** parede circular (bounce, friction/scrape), chão, Bey-Bey (restituição + transferência tangencial), knockbacks de ataque roteirizados.
- **Um moto de segurança:** `maxLinearSpeed` e `maxAngularSpeed` são clamps numéricos (GDD 82), não valores de gameplay.
- **Arena de referência do Lab:** raio de 12 m e parede de 2 m, copiados de `src/arena/colliders/ArenaTuning.ts` (arena plana atual, não o bowl côncavo aprovado nas decisões visuais). Raio do colisor do Bey: 0,65 m (arquétipo Attack do jogo).
- **Taxa de giro visual base do Lab:** 22 rad/s, o valor atual do jogo (`BASE_SPIN_RATE_RAD_S`, `src/bey/spin/SpinTuning.ts`).

---

## 6. Sliders / parâmetros existentes (33, com unidade e faixa)

Fonte: `PARAM_SPECS` em `prototypes/bey-motion-concepts/src/physics/params.ts`, commit `53289b5`. A coluna "jogo" é a referência ao valor atual de produção citada no próprio código do Lab, quando existe.

### Drive
| Parâmetro | Chave | Faixa | Unidade | Referência do jogo | O que faz |
|---|---|---:|---|---:|---|
| Acceleration | `accel` | 4–30 | m/s² | 14 | Empuxo ao longo do heading. |
| Top speed | `maxSpeed` | 5–20 | m/s | 11 | Velocidade em que o empuxo para de somar. |
| Turn rate | `turnRate` | 0.5–8 | rad/s | 2,6 | Quão rápido o heading segue a direção. |

### Grip / slip
| Parâmetro | Chave | Faixa | Unidade | Referência do jogo | O que faz |
|---|---|---:|---|---:|---|
| Lateral grip | `lateralGrip` | 0–20 | 1/s | 5,5 | Quão rápido a velocidade lateral é anulada. Baixo = escorrega, alto = nos trilhos. |
| Longitudinal grip | `longitudinalGrip` | 0–4 | 1/s | 0,6 | Arrasto de rolagem ao longo do heading, sem throttle. |
| Slip threshold | `slipThreshold` | 0.5–10 | m/s | — | Velocidade lateral acima da qual a ponta escorrega. |
| Grip while slipping | `slipGrip` | 0–1 | × | — | Multiplicador de grip lateral enquanto escorrega (e logo após um impacto). |
| Grip recovery | `gripRecovery` | 0.2–12 | 1/s | — | Quão rápido o grip volta após escorregar ou um impacto. |
| Airborne grip | `airGrip` | 0–3 | 1/s | 0,4 | Amortecimento lateral no ar. |

### Tilt / lean
| Parâmetro | Chave | Faixa | Unidade | Referência do jogo | O que faz |
|---|---|---:|---|---:|---|
| Lean into acceleration | `leanStrength` | 0–0.08 | rad por m/s² | — | Quanto o Bey inclina em curvas e mudanças de velocidade. |
| Speed-to-tilt | `speedTilt` | 0–0.03 | rad por m/s | — | Inclinação para frente vinda da velocidade de deslocamento. |
| Maximum tilt | `maxTilt` | 5–60 | ° | 35 | Trava do lean normal (tumbles podem superá-la). |

### Wobble / precession
| Parâmetro | Chave | Faixa | Unidade | Referência do jogo | O que faz |
|---|---|---:|---|---:|---|
| Wobble amplitude | `wobbleAmplitude` | 0–20 | ° | 6 | Amplitude do wobble na energia máxima. |
| Wobble frequency | `wobbleFrequency` | 1–20 | Hz | 7 | — |
| Wobble per impact | `wobbleFromImpact` | 0–0.4 | por m/s | 0,12 | Energia de wobble somada por m/s de impacto. |
| Wobble decay | `wobbleDecay` | 0.1–5 | 1/s | 1,2 | — |
| Precession-like response | `precession` | 0–12 | — | — | Acoplamento giroscópico: um empurrão no tilt vira giro lateral e circula (0 = balanço simples). |

### Recovery
| Parâmetro | Chave | Faixa | Unidade | Referência do jogo | O que faz |
|---|---|---:|---|---:|---|
| Upright recovery | `uprightStrength` | 5–200 | 1/s² | 9 (unidades diferentes) | Mola que puxa o tilt de volta ao alvo. |
| Recovery damping | `recoveryDamping` | 0.5–30 | 1/s | 2,4 | Amortece a oscilação do tilt. |
| Post-impact recovery time | `postImpactRecovery` | 0–3 | s | — | Depois de um impacto, a mola de prumo volta gradualmente nesse tempo. |

### Impacts / bounce
| Parâmetro | Chave | Faixa | Unidade | O que faz |
|---|---|---:|---|---|
| Bey-Bey restitution | `restitutionBey` | 0–1 | — | Elasticidade do contato Bey-Bey. |
| Floor bounce | `floorBounce` | 0–0.9 | — | Restituição vertical ao aterrissar. |
| Wall bounce | `wallBounce` | 0–1 | — | Restituição contra a parede. |
| Wall friction / scrape | `wallFriction` | 0–6 | 1/s | Velocidade perdida deslizando pela parede. |
| Impact angular impulse | `impactAngularImpulse` | 0–0.6 | rad/s por m/s | Chute de tilt por m/s de impacto. |
| Linear-to-angular transfer | `linearToAngular` | 0–2 | — | Velocidade de impacto de raspão convertida em giro e mudança de spin. |
| Knockback strength | `knockbackScale` | 0–2 | × | Multiplicador sobre o knockback roteirizado de ataque. |
| Knockback lift | `knockbackLift` | 0–0.6 | — | Fração do knockback enviada para cima (lançamentos). |
| Knockback tumble | `tumbleStrength` | 0–3 | rad/s por m/s | Giro/tumble a partir da velocidade de impacto acima do limiar. |
| Tumble threshold | `tumbleThreshold` | 2–20 | m/s | Velocidade de impacto abaixo da qual não há tumble. |
| Angular damping | `angularDamping` | 0.2–8 | 1/s | Quão rápido o giro/tumble se dissipa. |

### Stability limits
| Parâmetro | Chave | Faixa | Unidade | O que faz |
|---|---|---:|---|---|
| Max linear speed | `maxLinearSpeed` | 10–40 | m/s | Trava rígida (segurança numérica, não gameplay). |
| Max angular speed | `maxAngularSpeed` | 5–60 | rad/s | Trava rígida no giro do tilt e no whirl (segurança numérica). |

---

## 7. Cenários reproduzíveis (14, aprovados como ferramenta de comparação)

Fonte: `SCENARIOS` em `prototypes/bey-motion-concepts/src/physics/scenarios.ts`, commit `53289b5`. Todos são roteirizados (entradas + golpes com hora marcada) e determinísticos: o mesmo cenário com os mesmos parâmetros sempre reproduz o mesmo resultado (`R` reinicia).

| Cenário | id | O que testa |
|---|---|---|
| Straight acceleration | `straight` | Aceleração em linha reta do repouso, 1,4 s de throttle cheio, depois desliza. |
| High-speed curve | `curve` | Entra na velocidade máxima e segura uma curva forte à direita: lean na curva, grip vs. deslize. |
| Diagonal / heading vs velocity | `diagonal` | Corre reto e então muda o heading 50° enquanto acelera: a trajetória atrasa em relação à direção. |
| Drift / slip | `drift` | Na velocidade máxima, curva travada sem throttle por 0,7 s: a ponta escorrega e desliza, depois o grip volta. |
| Wall impact (head-on) | `wall` | De frente na parede a 9 m/s: bounce, chute de tilt, wobble, recuperação. |
| Ricochet (40°) | `ricochet` | Bate na parede a 40° e 10 m/s: ângulo de saída, transferência de spin/whirl do componente de raspão. |
| Wall scrape | `scrape` | Raspa a parede em ângulo raso enquanto vira para dentro dela: contato deslizante ao longo da borda. |
| Weak knockback | `knock-weak` | Um Bey a 6 m/s bate em um parado: empurrão leve, tilt e wobble pequenos. |
| Strong knockback | `knock-strong` | Golpe em velocidade de Dash (16 m/s) com knockback grande: lançamento, tilt, whirl, aterrissagem, recuperação. |
| Tumble (glancing strong hit) | `tumble` | Golpe forte fora do centro: a maior parte do impacto vira whirl e um lean grande — o "rodopio". |
| Floor bounce | `bounce` | Lançado para cima a 5 m/s enquanto desliza: arco aéreo, aterrissagem quica, chute de tilt na aterrissagem. |
| Wobble & recovery | `wobble` | Um único golpe moderado num Bey parado: observa o wobble, a circulação tipo precessão e o retorno ao prumo. |
| **M7 ext-0 analog** | `m7-ext0-analog` | Análogo do caso M7 `ext-0`: um Dash encontrado por um counter Circular perto da borda; o dasher é lançado de volta contra a parede. Ver seção 10.1. |
| **M7 ext-32 analog** | `m7-ext32-analog` | Análogo do caso M7 `ext-32`: um Bey empurrado contra a parede por um oponente que continua empurrando. Ver seção 10.2. |

---

## 8. Debug e telemetria visual (aprovados como ferramenta)

- **Setas:** velocidade (verde), heading (azul), direção de esterço (amarelo), eixo de spin (branco), normal de contato (vermelho, por 0,5 s após um contato).
- **Trilha (trail)** do percurso.
- **Tabela ao vivo por Bey:** velocidade, ângulo heading-vs-velocity; tilt, taxa de tilt, whirl, spin; wobble, grip (+ indicador de SLIP), torque de recuperação ao prumo; altura (+ indicador AIR); estado: TUMBLE, WALL, RING-OUT, e o estado de ataque do jogo nos replays.
- **Câmeras:** combate (referência), seguir Bey 1/2, topo, lateral, órbita livre. A câmera "Combat" reproduz a câmera de combate **atual** do jogo apenas como referência — a linguagem de câmera não é definida aqui; o Camera Lab (`camera-approval.md`) trata disso separadamente, depois que o movimento for aprovado.
- **Presets, sliders, cenários e replays** todos no mesmo painel, com sliders alterados do preset destacados e contados, "Reset to preset" e "Copy JSON" (grava `{ preset, modified, params }`, o registro a manter quando o dono aprovar uma combinação).
- **Timeline com scrub:** buscar reexecuta a simulação desde 0 e chega ao mesmo estado (determinismo).

---

## 9. Resultados de validação já existentes

### 9.1 Teste unitário determinístico
`tests/unit/BeyMotionLabModel.test.ts` roda cada um dos 14 cenários em cada um dos 3 presets e verifica:
- todo estado relevante (posição, velocidade, altura, tilt, tilt rate, whirl, spin, wobble, grip) é finito em todo instante;
- a velocidade nunca excede `maxLinearSpeed`, o whirl nunca excede `maxAngularSpeed`, e o tilt nunca excede o clamp de tumble (80°);
- o modelo é determinístico (mesma entrada → mesmo resultado);
- os presets estão ordenados de forma consistente com seus nomes (A mais contido que C nas métricas relevantes);
- o slip se recupera; a recuperação ao prumo funciona; o wall bounce e o ring-out se comportam como esperado.

### 9.2 Cenários análogos vs. presets (medido, do README do Lab)
| Cenário | A | B | C |
|---|---|---|---|
| M7 ext-0 analog (mesmo lançamento de ~28 m/s) | sem ring-out, mal sai do chão | sem ring-out: 1,3 m de altura, bate na parede de 2 m | **ring-out** aos 0,5 s (3,4 m de altura) |
| Drift: tempo com grip rompido | 0 s | 1,2 s | 2,7 s |
| Tumble: whirl de pico | 0,3 rad/s | 1,9 rad/s | 12,5 rad/s |
| Wall impact: tilt de pico | 10° | 13° | 57° |

Essas medições confirmam que os três presets divergem na direção que seus nomes prometem (A contido, C dramático), mas são **medições do protótipo**, não validação de balanceamento de produção.

---

## 10. Casos M7 reproduzidos (`ext-0` e `ext-32`)

**Registro explícito:** os dois casos abaixo são **cenários de avaliação de knockback/motion no Lab**, não correções aprovadas. Nenhuma mudança em `src/` foi feita para eles.

### 10.1 `ext-0` — counter perto da borda → ring-out
- **Knockback real observado no jogo:** força 37,6; o Bey 2 é lançado a aproximadamente **28 m/s**, com componente vertical de aproximadamente **7,4 m/s**.
- **Ring-out em aproximadamente 1,77 s** (tick 106), acima da parede de 2 m.
- Exportado do próprio jogo (`m7-ext-0.json`, via `scripts/replays.export.ts`, mesmo harness headless dos testes determinísticos) e reproduzido no Lab tick a tick com os mesmos overlays.
- **No análogo do Lab, com o mesmo lançamento de ~28 m/s:** apenas o preset **C sai da arena** (ring-out aos 0,5 s); o preset **B bate na parede** sem sair (1,3 m de altura); o preset A mal sai do chão.
- **Conclusão registrada:** isto é um cenário de avaliação de como cada preset de movimento reage a um knockback desse tamanho, não uma correção de knockback de produção aprovada. Se ~28 m/s de lançamento por um counter é aceitável para o jogo continua em aberto (seção 13.6).

### 10.2 `ext-32` — Bey preso na parede
- **Bey fisicamente preso além da borda por aproximadamente 23,5 s**, a partir de t ≈ 11,9 s, com r ≈ 12,1 m (além do raio de 12 m do chão), quase sem se mover: cunhado no colisor de parede da borda.
- Exportado do jogo (`m7-ext-32.json`) e reproduzido no Lab com os mesmos overlays.
- **O replay do Lab identificou o Bey preso como o Attack Bey**, usando a convenção de seed usada pelo Motion Lab. O relatório original do M7 havia nomeado o Bey de Defense; a diferença vem da convenção de seed do harness do Lab, não de uma nova investigação sobre qual arquétipo trava.
- **Classificação mantida:** problema de colisão / interação com a parede, não bug de IA.
- **Corrigido no M11 (lane 3):** a causa era o colisor da parede — os segmentos estavam girados `angle + π/2` em vez de `π/2 − angle`, deixando frestas em torno de ±45°/±135° (detalhes e evidência em `docs/ai/m11-status.md`). O `ext-0` (lançamento de ~28 m/s por counter) continua em aberto. O cenário análogo `m7-ext32-analog` no Lab mostra o comportamento de contato pretendido (parede como círculo limpo), para comparação com o replay real — ele não corrige o colisor do jogo.

---

## 11. Spin readability (achado registrado, não solução)

A aba "Spin readability" do Lab mede, para os 9 conceitos visuais de Bey (rodada 2, já aprovados em `visual-prototypes-approval.md`), em quais taxas de giro o olho consegue ler o sentido de rotação a 60 fps, dado o número de repetições visuais ("folds") de cada anel (efeito roda-de-carroça / aliasing).

**Espelha do jogo (`main@0b945f2`):** taxa de giro visual 22 rad/s (`SpinTuning.ts`), wobble ±6° a 7 Hz, tilt de referência 35°, câmera de combate atual (distância, FOV, posição).

Veredito computado a 22 rad/s (a taxa atual do jogo):

| Conceito | Fold do anel | Leitura a 22 rad/s |
|---|---:|---|
| Attack A | 4 | direção correta (forward) |
| Attack B | 1 (assimétrico) | giro verdadeiro |
| Attack C | 2 | direção correta (forward) |
| **Defense A** | 8 | **ambíguo** |
| **Defense B** | 6 | **ambíguo** |
| **Defense C** | 8 | **ambíguo** |
| Stamina A | 5 | direção correta (forward) |
| **Stamina B** | 6 (+ 48 dentes na borda) | **ambíguo** (dentes: parecem girar ao contrário) |
| Stamina C | 3 | direção correta (forward) |

**Achado registrado:** na taxa atual do jogo (22 rad/s), **os três conceitos de Defense e o Stamina B podem apresentar ambiguidade visual de sentido de rotação** (efeito roda-de-carroça). Nenhuma taxa única de giro lê de forma limpa para os 9 conceitos ao mesmo tempo.

**Isto não é uma decisão.** Nenhuma solução foi escolhida. As opções que o Lab levanta sem decidir são: aceitar a ambiguidade, motion blur/smear, um acento assimétrico em cada anel, ou menos features maiores por anel — todas em aberto (seção 13.7).

---

## 12. Relação com o Camera Lab

- **Motion e Camera foram avaliados separadamente.** O Camera Lab (`camera-approval.md`) já tem três presets de câmera aprovados **sem alterações** (A Arena Fighter, B Cinematic Hybrid, C Hyper Dynamic), com os 43 valores exatos de cada um.
- **Nenhum dos dois deve alterar silenciosamente o outro.** O diretor de câmera aprovado lê apenas o `FightFrame` (posição, velocidade, intents) — ele não depende dos parâmetros internos do modelo de movimento.
- O próprio README do Camera Lab já registra: *"Bey Motion Lab: quando o movimento do Motion Lab for aprovado, ele entra como outra fonte no Camera Lab, sem mudar o diretor nem os presets. As medições da câmera devem ser repetidas."* Este documento confirma essa mesma regra do lado do Motion Lab.
- **Depois que o movimento aprovado for integrado, os cenários e medições da câmera (seção 7 de `camera-approval.md`, incluindo leitura de quadro, FOV, giro e shake por cenário) precisam ser repetidos** com o movimento real, antes de qualquer novo ajuste de câmera ser aceito como válido.
- **Qualquer ajuste posterior de valores de movimento ou de câmera que altere o comportamento visual já aprovado precisa voltar para aprovação do dono** — nenhum dos dois documentos autoriza o outro a mudar silenciosamente.
- A câmera "Combat" do Motion Lab é apenas uma referência à câmera atual do jogo, não uma tentativa de reproduzir os presets aprovados do Camera Lab.

---

## 13. Continua em ABERTO (não decidir sem o dono)

1. **Valores numéricos de produção.** Os 33 valores atuais de cada preset (A/B/C) são valores de protótipo para comparação, não tuning final. O dono precisa aprovar explicitamente um conjunto de valores (ou uma mistura) antes de qualquer integração (GDD 167).
2. **Preset default, se houver um único.** Nenhuma recomendação foi registrada aqui; diferente do Camera Lab, ainda não há um "meio-termo" claramente indicado pelo dono para Motion.
3. **Mistura final entre A/B/C.** Diferente da câmera (que é uma escolha exclusiva entre três presets fixos), o dono pode querer misturar comportamentos de diferentes direções; o mecanismo de "Copy JSON" existe para registrar essa mistura quando ela for decidida.
4. **Tuning específico por Bey.** Se Attack/Defense/Stamina herdam o mesmo preset de movimento ou valores próprios (ex.: Defense com `uprightStrength` maior) não foi decidido.
5. **Correção definitiva de `ext-0`.** Se ~28 m/s de lançamento por um counter perto da borda é o comportamento pretendido de knockback, ou se o knockback de produção precisa ser ajustado, é uma decisão de balanceamento separada, pendente de playtest (GDD 167).
6. **Correção definitiva de `ext-32`.** O Bey preso na parede é um bug de colisão a corrigir na integração (colisor da borda), não um comportamento de movimento a aprovar aqui.
7. **Spin readability.** Nenhuma solução foi escolhida entre aceitar a ambiguidade, motion blur, acento assimétrico no anel ou menos features por anel; nem se a taxa de giro deve mudar, variar por Bey ou com a Stamina.
8. **Integração com a física de produção.** Como os 33 parâmetros do Lab mapeiam exatamente para `src/bey/movement/MovementTuning.ts`, `src/bey/spin/SpinTuning.ts` e o resto de `src/physics/` não foi decidido — o Lab usa um modelo próprio, não Rapier.
9. **Integração com a câmera aprovada.** Precisa ser revalidada depois que o movimento entrar (seção 12).
10. **Os 3 Beys finais por arquétipo e a arena inicial** continuam em aberto nas decisões visuais anteriores (`visual-prototypes-approval.md`) e não são resolvidos por este documento.

---

## 14. Plano de integração futura (quando o dono pedir — NÃO agora)

Esta seção é um plano de referência. **Nada aqui deve ser executado sem pedido explícito do dono.** Cada etapa segue o fluxo de conclusão do GDD 1.5 (typecheck, testes, build, self-test, console) e a definição de pronto para física do GDD 149.

1. **O dono escolhe ou mistura A/B/C** no Lab e usa "Copy JSON" para registrar o conjunto final de 33 valores (ou a mistura) como decisão explícita — só então a seção 13.1 se fecha.
2. **Mapear os 33 parâmetros do Lab para os tuning files de produção** (`src/bey/movement/MovementTuning.ts`, `src/bey/spin/SpinTuning.ts`, e onde mais fizer sentido em `src/physics/`), documentando a origem no comentário de topo de cada arquivo (GDD 1.3 e 101), apontando para este documento.
3. **Portar o repertório de comportamento** (grip/slip, tilt/lean, wobble, precessão, recuperação gradual, whirl/tumble, bounce/ricochete/scrape) para os controllers reais sobre Rapier — o modelo do Lab é a referência de comportamento, não código a copiar literalmente, já que o jogo usa física de corpo rígido real.
4. **Resolver `ext-32`** como correção de colisor da borda antes ou durante a integração, com um teste de regressão específico.
5. **Decidir e resolver `ext-0`** como ajuste de knockback de produção, com playtest, antes de travar o valor.
6. **Rodar a suíte de self-test de física do GDD 150** (aceleração reta, esterço em alta velocidade, curva diagonal, batida de parede, knockback forte, wobble, drift) contra a implementação integrada.
7. **Revalidar a câmera** repetindo as medições da seção 7 de `camera-approval.md` com o movimento real integrado, antes de aceitar qualquer novo ajuste de câmera.
8. **Só depois disso**, considerar iniciar qualquer trabalho de M8.

---

## 15. Onde ver e valores exatos

- **Protótipo:** `prototypes/bey-motion-concepts/`, com README próprio. Rodar com `npm run dev` e abrir `/prototypes/bey-motion-concepts/`.
- **Artifact avaliado (privado, só o dono abre):** https://claude.ai/artifact/RudDVud88A2Q1HZCmJ3W6d
- **Branch e commits:** `claude/bey-motion-lab`, commits `04bbce1` (spin readability) e `53289b5` (física de movimento).
- **Fonte de verdade no código do Lab:** `PRESETS` e `PARAM_SPECS` em `prototypes/bey-motion-concepts/src/physics/params.ts`; o modelo em `prototypes/bey-motion-concepts/src/physics/model.ts`; os cenários em `prototypes/bey-motion-concepts/src/physics/scenarios.ts`.
- **Replays do jogo:** `prototypes/bey-motion-concepts/src/replays/m7-ext-0.json` e `m7-ext-32.json`, gerados por `prototypes/bey-motion-concepts/scripts/replays.export.ts`. Para atualizar depois de uma mudança na física do jogo: `npx vitest run --config prototypes/bey-motion-concepts/scripts/vitest.export.config.ts`.
- **Testes do Lab:** `tests/unit/BeyMotionLabModel.test.ts` (estabilidade, determinismo, ordenação dos presets) e `tests/smoke/beyMotionConcepts.spec.ts` (as duas seções no navegador).
- **Documentos relacionados:** `docs/design-decisions/camera-approval.md` (câmera, seção 12 aqui), `docs/design-decisions/visual-prototypes-approval.md` e `docs/design-decisions/visual-prototype-inventory.md` (Beys e arena).

JSON exato dos três presets (as chaves de `PhysicsParams`, valores de protótipo — ver seção 13.1 antes de tratar como final):

```json
{
  "A": {
    "accel": 14, "maxSpeed": 11, "turnRate": 3.4,
    "lateralGrip": 9, "longitudinalGrip": 0.6, "slipThreshold": 5.5, "slipGrip": 0.6, "gripRecovery": 7, "airGrip": 0.4,
    "leanStrength": 0.01, "speedTilt": 0.002, "maxTilt": 18,
    "wobbleAmplitude": 3, "wobbleFrequency": 7, "wobbleFromImpact": 0.06, "wobbleDecay": 2.5, "precession": 1,
    "uprightStrength": 140, "recoveryDamping": 16, "postImpactRecovery": 0.15,
    "restitutionBey": 0.45, "floorBounce": 0.15, "wallBounce": 0.35, "wallFriction": 1.8, "impactAngularImpulse": 0.05, "linearToAngular": 0.2,
    "knockbackScale": 0.85, "knockbackLift": 0.06, "tumbleStrength": 0.15, "tumbleThreshold": 14, "angularDamping": 3.5,
    "maxLinearSpeed": 26, "maxAngularSpeed": 30
  },
  "B": {
    "accel": 14, "maxSpeed": 11, "turnRate": 2.6,
    "lateralGrip": 5.5, "longitudinalGrip": 0.6, "slipThreshold": 2.5, "slipGrip": 0.35, "gripRecovery": 3, "airGrip": 0.4,
    "leanStrength": 0.022, "speedTilt": 0.006, "maxTilt": 35,
    "wobbleAmplitude": 6, "wobbleFrequency": 7, "wobbleFromImpact": 0.12, "wobbleDecay": 1.2, "precession": 4,
    "uprightStrength": 60, "recoveryDamping": 7, "postImpactRecovery": 0.6,
    "restitutionBey": 0.55, "floorBounce": 0.35, "wallBounce": 0.5, "wallFriction": 1.2, "impactAngularImpulse": 0.12, "linearToAngular": 0.5,
    "knockbackScale": 1, "knockbackLift": 0.18, "tumbleStrength": 0.6, "tumbleThreshold": 9, "angularDamping": 1.6,
    "maxLinearSpeed": 26, "maxAngularSpeed": 30
  },
  "C": {
    "accel": 14, "maxSpeed": 11, "turnRate": 2.2,
    "lateralGrip": 3.2, "longitudinalGrip": 0.6, "slipThreshold": 2.2, "slipGrip": 0.18, "gripRecovery": 1.4, "airGrip": 0.4,
    "leanStrength": 0.04, "speedTilt": 0.012, "maxTilt": 48,
    "wobbleAmplitude": 11, "wobbleFrequency": 6, "wobbleFromImpact": 0.22, "wobbleDecay": 0.6, "precession": 8,
    "uprightStrength": 30, "recoveryDamping": 3.5, "postImpactRecovery": 1.4,
    "restitutionBey": 0.75, "floorBounce": 0.55, "wallBounce": 0.75, "wallFriction": 0.6, "impactAngularImpulse": 0.26, "linearToAngular": 1.1,
    "knockbackScale": 1.25, "knockbackLift": 0.32, "tumbleStrength": 1.4, "tumbleThreshold": 6, "angularDamping": 0.8,
    "maxLinearSpeed": 26, "maxAngularSpeed": 30
  }
}
```
