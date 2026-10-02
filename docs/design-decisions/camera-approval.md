# Decisões aprovadas: câmera de combate

**Status:** APROVADO pelo dono do projeto.
**Data:** 2026-09-27
**Origem:** protótipo `prototypes/camera-concepts/` (Camera Lab), branch `claude/sleepy-johnson-4i6io4`, PR #21.
**Configuração final:** os três presets **exatamente como o lab os apresentou**, sem nenhum ajuste do dono ("sem alterações por minha parte"). O armazenamento do botão "Salvar configurações" do artifact está vazio, o que confirma que nada foi editado. Os valores são os do commit `dd1d676`.
**Base no GDD:** 12 (FOV base, shake e efeitos de FOV configuráveis), 22 (câmera reage ao Perfect Dodge), 26 (hitstop e impacto de câmera), 39 (Clash com câmera cinematográfica, ~4 s), 48 a 50 (direção, comportamento e arquitetura da câmera), 69 e 70 (dados e controles de câmera no Debug Lab), 78 (preferências em `localStorage`), 101 (configuração centralizada), 112 (pré-jogo × debug), 121 (redução de efeitos), 140 (M4, câmera e game feel), 148 (definição de pronto visual), 158 (eventos), 167 (valores provisórios) e 170 (não reabrir perguntas fechadas).

Este documento registra **o que já foi decidido** sobre a câmera de combate, para que nenhum agente reabra essas perguntas (GDD 170). A seção 10 separa o que **continua em aberto**. Nada aqui autoriza mudar gameplay, física, IA, colisores ou balanceamento. Também não inicia o M8.

> **Onde está:** o protótipo e este documento entram na `main` pelo PR #21 (branch `claude/sleepy-johnson-4i6io4`). Até o merge, quem auditar só a `main` não vai encontrá-los.

---

## 1. Resumo da decisão

1. **As três direções foram aprovadas:** A — Arena Fighter, B — Cinematic Hybrid e C — Hyper Dynamic.
2. **Sem alterações.** Os valores aprovados são os 43 parâmetros de cada preset (seção 6, JSON exato na seção 12) e as constantes do diretor, compartilhadas pelas três (seção 2.9).
3. **Elas vão para o jogo como opção nas Configurações.** O jogador escolhe **uma das três**. Diferente das camadas de Stamina e Stability, que se somam, a câmera só pode seguir uma direção por vez.
4. **O que foi aprovado é o comportamento visto no lab:** um único diretor de câmera com sete modos e proteções de leitura (seção 2), rodando cada um dos três conjuntos de valores. As três opções são **três presets do mesmo diretor**, não três câmeras diferentes.
5. **Ajuste do dono após o playtest (M11):** no jogo, a câmera não segue o Bey o tempo todo e fica sempre dentro da arena (nunca além de 10,5 m do centro, nunca atrás da parede). Os 43 valores dos presets não mudaram. Detalhes em `docs/ai/m11-status.md`.
   - **Blend do Clash:** com o movimento do Motion Lab integrado, o blend do Clash para a B ficou suavizado e limitado (um blend completo leva ≥ 0,8 s). O olho do jogador podia estar a ~12 m do olho da B, e o blend cru varria 0,6 m num tick.
   - **Segundo playtest (fix 4):** a primeira versão ainda reorientava pelo eixo da luta depois de 60° e girou 127° em 3 s numa partida real, só com o oponente andando, com as setas mudando de sentido.
     - O ângulo agora é escolhido no início do round (atrás do jogador) e mantido.
     - A câmera continua dinâmica: acompanha a luta quando ela sai de uma zona de 1,5 m, com zoom, FOV, tremor, knockback, Clash, ring-out e finisher.
     - Para ficar dentro da arena, ela se aproxima e sobe; não gira.
   - **Terceiro playtest (fix 5): terceira pessoa por trás do Bey, over-the-shoulder.**
     - **Posição:** o olho fica atrás do Bey do jogador, na linha jogador → oponente, com ombro à direita. Por preset: A 5 m atrás e 2,4 m acima, B 4,2 m e 1,9 m, C 3,6 m e 1,5 m (`SHOULDER_RIGS` em `CameraRig.ts`).
     - **Giro:** segue essa linha na suavização e no limite de órbita de cada preset.
     - **Enquadramento:** o pitch caiu de 28–43° para 10–19°, e o jogador fica na metade de baixo da tela.
     - **O que não mudou:** FOV, tremor, contextos, Clash (B, sem órbita), ring-out e finisher.
     - Detalhes em `docs/ai/m11-status.md`.
   - **fix 6 e fix 7:** ajustes seguintes ainda dentro do mesmo modelo over-the-shoulder (travar o ângulo, depois só recuar/subir sem girar) — ver `docs/ai/m11-status.md` para o histórico completo. `SHOULDER_RIGS` e o tipo `ShoulderRig` **não existem mais no código**.
   - **Quarto playtest (fix 8, owner playtest, 2026-09) — ESTADO ATUAL, substitui fix 5/6/7 inteiramente:** o dono reverteu o over-the-shoulder. "A câmera não pode… ficar permanentemente atrás do jogador… Directional deve ser ARENA/WORLD-RELATIVE." A câmera volta a ser o diretor dinâmico, focado no oponente, de dois lutadores — exatamente o comportamento do Camera Lab (`framingBias`/`opponentWeight`, órbita automática, troca de lado, look-ahead, previsão de encontro, resgate de Bey fora do quadro, tudo incondicional, sem os desvios `if (!arena)` que o over-the-shoulder introduzia).
     - **O que continua específico do jogo:** só altura/distância, via `ARENA_CAMERA_RIGS` em `CameraRig.ts` (substituiu `SHOULDER_RIGS`): `minDistance`/`maxDistance`/`cameraHeight` por preset — A 5,8 m / 13 m / 2,4 m, B 5 m / 14 m / 1,9 m, C 4,3 m / 15 m / 1,5 m. Todo o resto de cada preset (FOV, velocidade de órbita, suavização, shake, contextos) é o valor aprovado do Camera Lab, sem alteração.
     - **Contenção na arena:** a opção `arena: { containRadiusM: 10.5 }` só puxa o olho pra dentro (nunca girando o ângulo) e mantém o guarda de piso dos bowls — não é mais um "travar o ângulo uma vez por round".
     - **Playtest de acompanhamento:** visibilidade do oponente nos cenários D/E e o pico de pitch de 51,4° (jogador contra a parede) foram medidos e corrigidos depois do fix 8 — ver "Owner playtest fix 8" em `docs/ai/m11-status.md` para a medição completa e os testes (`cameraRig.test.ts`, `cameraTwoFighterFraming.test.ts`).
6. **Integração (M11, lane 2; estado final após o fix 8):** o diretor e os três presets estão no jogo, em `src/camera/director/`, com a escolha A/B/C nas Configurações e o Clash forçando a B sem órbita. Os 43 parâmetros de cada preset não mudaram desde a seção 6; só `minDistance`/`maxDistance`/`cameraHeight` têm overrides de jogo (`ARENA_CAMERA_RIGS`, ver item 5 acima). As escolhas provisórias para os itens em aberto da seção 10 estão em `docs/ai/m11-status.md` e aguardam confirmação do dono.

---

## 2. O que as três têm em comum: o diretor de câmera

### 2.1 Direção do GDD respeitada (GDD 48 e 49)

As três seguem a mesma base e só mudam a intensidade:
- câmera de arena **focada no oponente**, **semi-over-the-shoulder**: atrás do jogador, deslocada para um ombro, olhando no eixo jogador → oponente;
- os dois Beys enquadrados sempre que possível;
- **FOV alto que abre com a velocidade**, com teto rígido de **120°**;
- **distância que se adapta à separação** entre os Beys;
- **órbita automática e contextual**, sem controle manual;
- posição que **varia com o contexto**, em vez de ficar sempre atrás do jogador;
- câmeras dedicadas para **Clash**, **Ring-Out** e **golpe final**;
- **shake** e **efeitos de FOV de impacto** parametrizados;
- espetáculo **nunca** à custa da leitura da luta.

### 2.2 Arquitetura (GDD 50 e 158)

- **Um único diretor decide a câmera.** Nenhum sistema de gameplay mexe direto na câmera do Three.js.
- **O gameplay só descreve o tick.** A cada tick fixo ele entrega um `FightFrame` com:
  - posição, velocidade, rapidez, "no ar", estado de ataque e "Quebrado" de cada Bey;
  - **intents** com magnitude 0–1 (golpe, impacto na parede, aterrissagem, Stability Break, KO, ring-out, início e fim do Clash, esquiva). A magnitude vem da curva `ImpactMagnitude` que o jogo já usa.
  - o estado do Clash (ativo e progresso) e o fim do round (KO ou ring-out, e de quem).
- **O diretor é lógica pura**, sem Three.js. Roda no **tick fixo de 60 Hz** e usa suavização exponencial (`1 − e^(−taxa·dt)`), então o comportamento não depende do FPS de renderização. A renderização só interpola entre ticks.
- **Os testes rodam o mesmo diretor** sem tela, sobre lutas reais da simulação.

### 2.3 Enquadramento base (CombatFollow)

- **Direção:** atrás do jogador, no eixo jogador → oponente, girada `lateralOffset` graus para um ombro.
  - Com `opponentWeight` < 1, a direção mistura o eixo com a direção de movimento do jogador (só acima de 3 m/s).
  - Com os Beys sobrepostos (a menos de 1,5 m), o eixo fica congelado, porque a direção vira ruído.
- **Ponto olhado:** um ponto na linha jogador → oponente definido por `framingBias` (0 = jogador, 0,5 = meio, 1 = oponente), mais o look-ahead (seção 2.5), elevado por `verticalOffset`.
- **Distância:** `minDistance + separationResponse × (separação − 3 m)`, limitada a `maxDistance`.
  - Uma **zona morta** (`distanceDeadband`) impede que pequenas mudanças de separação façam o zoom oscilar.
- **Altura:** `cameraHeight` na distância mínima, subindo 0,3 m por metro extra de distância.

### 2.4 Os sete modos

Os modos são **pesos de contexto** (0–1) que entram e saem com a velocidade `transitionSpeed`, sem cortes secos. O modo mostrado é o de **maior prioridade acima de 50%**, e ele fica pelo menos **0,25 s** antes de trocar, para o rótulo não piscar.

**Prioridade:** `Clash > RingOut > Finisher > KnockbackFollow > HighSpeed > CloseCombat > CombatFollow`

| Modo | Quando entra | O que a câmera faz |
|---|---|---|
| **CombatFollow** | Sempre é a base | Enquadramento da seção 2.3 |
| **HighSpeed** | Velocidade filtrada de 9 m/s (começa) a 15 m/s (cheio). Um Dash chega a ~18 m/s | Recua `highSpeedPullback` metros, sobe 0,6 m, e o FOV abre pela curva de velocidade (seção 2.7) |
| **CloseCombat** | Separação de 4,5 m (começa) a 2,2 m (cheio), reduzido em 70% se também estiver em alta velocidade | Aproxima `closePushIn` metros, abaixa um pouco (proporcional à órbita) e faz uma **deriva orbital automática** lenta (0,35 rad/s × `orbitStrength`, no máximo ~52°), para o combate colado não ficar estático |
| **KnockbackFollow** | Golpe, Stability Break, KO, ring-out ou fim de Clash acima do limiar de microimpacto, depois de `knockbackDelay` | O ponto olhado se inclina até 60% × `knockbackFollow` em direção ao Bey arremessado. A câmera recua até 1,5 m × `knockbackFollow`. Segura pelo menos 0,8 s e volta com `recoverySpeed` quando o Bey desacelera abaixo de 4 m/s. Em impactos grandes, gira até `impactReframe` graus × magnitude (máximo 40°) para mostrar a trajetória de lado |
| **Clash** | Enquanto o Clash estiver ativo (os Beys são tratados como parados, como no `main.ts`) | Câmera no ponto de confronto, a 2,4 m de altura. A distância vai de 0,8× a 0,6× `minDistance` conforme o progresso. Órbita contida (0,45 rad/s × (0,5 + `orbitStrength`) × (0,6 + progresso)). O FOV vai de `baseFov` − 4° a `baseFov` + 6° com o progresso. Troca de lado congelada |
| **RingOut** | Ring-out declarado, ou antecipação (peso 60%) quando um Bey no ar, a mais de 9 m do centro, se afasta a mais de 3 m/s | Fica do lado da arena, 8 m atrás e 3,5 m acima do Bey que voa, olhando um pouco à frente da trajetória, com FOV +8°. O resgate de Bey fora do quadro fica desligado: o foco é o Bey que sai |
| **Finisher** | 2 s depois de KO ou ring-out, e durante todo o fim de round por KO | Plano baixo e próximo do Bey atingido (5 m de distância, 1,6 m de altura), com FOV −10° |

### 2.5 Look-ahead e previsão de encontro

- **Look-ahead:** o ponto olhado se adianta na direção do movimento.
  - Usa a velocidade filtrada do jogador × `velocityLookAhead`, metade da velocidade do oponente e a aceleração × `accelLookAhead`, tudo × `lookAheadStrength`.
  - O adiantamento é limitado a 4 m.
- **Previsão de encontro:** se os dois vão passar a menos de 2,5 m um do outro em até 1,2 s, o enquadramento puxa para o ponto do encontro e abre um pouco (até 1,2 m × `encounterWeight`).
  - É o "enquadramento que prevê encontros rápidos". Fica desligado durante o Clash.

### 2.6 Troca de lado (ombro)

- A câmera troca de ombro quando o jogador se move de lado, na tela, a mais de 5,5 m/s durante **0,5 s seguidos**.
- Depois de uma troca, a próxima só pode acontecer passado `sideSwitchCooldown` segundos.
- Com o valor 60, a câmera **nunca** troca de lado (é o caso da direção A).
- Durante Clash, Ring-Out e Finisher, a troca de lado fica congelada.

### 2.7 FOV

- **Velocidade → FOV:** a velocidade filtrada é normalizada entre 3 m/s e 16 m/s.
  - `FOV = baseFov + (maxFov − baseFov) × fovSpeedStrength × normalizada^fovSpeedCurve`.
- **Resposta e trava:** o FOV persegue o alvo com `fovDamping` e nunca muda mais rápido que `fovMaxRate` graus por segundo, a trava contra FOV pulsando.
- **Soco de FOV no impacto:** um impacto soma magnitude × `impactFovPunch` graus, que somem a 6/s.
- **Acréscimos por contexto:** o Ring-Out soma 8°, o Finisher tira 10° e o resgate de Bey fora do quadro soma até 10°.
- **Teto e piso:** 120° absoluto (GDD 49) e 30° de mínimo.
- **Nota:** `maxFov` é o teto **da velocidade**. O soco de impacto, o Ring-Out e o resgate podem passar dele por instantes, sempre abaixo de 120°. Na medição, a C chegou a 102,8° com `maxFov` 100.

### 2.8 Shake

- **Impacto:** amplitude de magnitude × 0,35 m × `impactShake`, que some com `shakeDecay`.
- **Velocidade:** um tremor contínuo leve de 10 m/s a 16 m/s, até 0,05 m × `speedShake`.
- **Total:** a soma × `shakeIntensity`, com **limite rígido de 0,45 m**, oscilando a 17 Hz.
- **Microimpactos:** impactos abaixo de `microImpactThreshold` **nunca** mexem na câmera. Aterrissagens precisam do dobro desse limiar.

### 2.9 Proteções de leitura

Todas são ajustáveis e visíveis no painel de debug.

| Proteção | Como funciona | Valor |
|---|---|---|
| Filtro de velocidade | Passa-baixa na velocidade antes do FOV e do recuo, contra pulsação por ruído | `speedFilterHz` |
| Trava de variação do FOV | Graus por segundo | `fovMaxRate` |
| Zona morta da distância | Contra zoom oscilando | `distanceDeadband` |
| Trava de órbita (anti-enjoo) | A câmera nunca gira mais rápido que isso | `orbitSpeed` (°/s) |
| Intervalo entre trocas de lado | Mais 0,5 s de confirmação | `sideSwitchCooldown` |
| Limiar de microimpacto | Impactos pequenos não mexem na câmera | `microImpactThreshold` |
| Teto do shake | Nunca passa disso | 0,45 m |
| Altura mínima do chão | A câmera nunca entra no chão | `floorClearance` |
| Distância mínima de um Bey | A câmera nunca atravessa um Bey | `beyClearance` |
| Resgate de Bey fora do quadro | Se um Bey sai do quadro (margem de 4%), a câmera recua até 4 m, abre até 10° e puxa o alvo para ele. Sobe a 2,5/s e desce a 1,2/s. Desligado no Ring-Out | `offscreenRescue` |
| Estabilidade do rótulo do modo | Limiar de 50% e permanência de 0,25 s | — |

**Constantes do diretor (aprovadas junto, iguais para A, B e C):**

| Constante | Valor | Papel |
|---|---:|---|
| Teto de FOV | 120° | GDD 49 |
| FOV mínimo | 30° | |
| Velocidade em que o FOV começa e fica cheio | 3 → 16 m/s | curva velocidade → FOV |
| HighSpeed começa e fica cheio | 9 → 15 m/s | |
| CloseCombat começa e fica cheio | 4,5 → 2,2 m de separação | |
| Separação de referência | 3 m | a distância só cresce acima disso |
| Subida por metro de distância | 0,3 m | |
| Look-ahead máximo | 4 m | |
| Horizonte e raio da previsão de encontro | 1,2 s e 2,5 m | |
| Eixo congelado abaixo de | 1,5 m | Beys sobrepostos |
| Antecipação da órbita | 0,35 s, máximo de 0,7 rad (~40°) | a câmera acompanha a rotação da luta |
| Deriva no combate próximo | 0,35 rad/s, máximo de 0,9 rad (~52°) | × `orbitStrength` |
| Troca de lado | 5,5 m/s de lado por 0,5 s | |
| Ganho do knockback | magnitude 0,4 = follow cheio | |
| Recuo do knockback, permanência e "assentou" | 1,5 m, 0,8 s e 4 m/s | |
| Shake: referência de impacto, referência de velocidade e teto | 0,35 m, 0,05 m e 0,45 m | |
| Decaimento do soco de FOV | 6/s | |
| Clash: distância, altura e órbita-base | 0,8 → 0,6 × `minDistance`, 2,4 m e 0,45 rad/s | |
| Ring-Out: raio de vigia, velocidade para fora, recuo, altura e FOV extra | 9 m, 3 m/s, 8 m, 3,5 m e +8° | |
| Finisher: duração, distância, altura e FOV | 2 s, 5 m, 1,6 m e −10° | |
| Resgate: subida, descida, distância extra e FOV extra | 2,5/s, 1,2/s, 4 m e 10° | |
| Margem de "no quadro" | 4% | |
| Rótulo do modo: limiar e permanência | 50% e 0,25 s | |

---

## 3. Direção A — Arena Fighter (aprovada)

**Ideia:** leitura em primeiro lugar. É a câmera mais constante e previsível, próxima de um jogo de luta em arena. Os dois Beys ficam sempre enquadrados de forma parecida, e a câmera quase não chama atenção para si.

- **FOV:** de 58° a 74°, abrindo tarde e com suavidade (curva 1,4 guarda a abertura para as velocidades altas). Soco de impacto pequeno (3°).
- **Distância:** de 8,5 m a 15 m, com resposta lenta e zona morta larga (0,6 m). É a câmera que fica mais longe no combate próximo.
- **Altura:** 6 m, a visão mais alta das três.
- **Órbita:** contida (0,2), com trava de **40°/s**. A câmera acompanha a luta devagar.
- **Lado:** **nunca troca de ombro.** O ombro fica fixo em 14°.
- **Enquadramento:** o eixo fica sempre no oponente (peso 1), com look-ahead pequeno e sem aceleração.
- **Knockback:** acompanha de leve (0,3), **sem reenquadramento** no impacto.
- **Shake:** baixo (0,6), sem tremor de velocidade.
- **Proteções:** as mais conservadoras: 1,5 m do chão, 2,5 m dos Beys e ignora impactos abaixo de 0,25.

**Para quem:** quem quer ler cada troca com calma, jogadores novos e quem sente desconforto com câmera em movimento.

---

## 4. Direção B — Cinematic Hybrid (aprovada)

**Ideia:** o meio-termo premium. A câmera é viva e reage à luta, mas continua fácil de ler.

- **FOV:** de 62° a 88°, com abertura clara em velocidade (curva 1,1, quase linear) e soco de impacto médio (6°).
- **Distância:** de 7,2 m a 17 m, com recuo de 2,2 m em alta velocidade e aproximação de 1,8 m no combate próximo.
- **Altura:** 5 m.
- **Órbita:** contextual (0,6), com trava de **70°/s**.
- **Lado:** troca de ombro **rara**, com pelo menos 6 s entre trocas. O ombro fica em 20°.
- **Enquadramento:** o eixo mistura um pouco a direção do movimento (peso do oponente 0,85). O look-ahead é médio e a previsão de encontro, moderada.
- **Knockback:** acompanha (0,55), com **reenquadramento controlado** de até 8° × magnitude.
- **Shake:** médio (1,0), com um leve tremor de velocidade.

**Para quem:** é o equilíbrio entre "dramático" e "legível" que o GDD 48 descreve.

---

## 5. Direção C — Hyper Dynamic (aprovada)

**Ideia:** o limite dramático que o GDD permite. Sente-se a energia de anime e de ZZZ, mas sem perder o oponente.

- **FOV:** de 66° a 100°, abrindo cedo (curva 0,9) e rápido (até 110°/s), com soco de impacto forte (11°).
- **Distância:** de 6 m a 20 m, com variações grandes: recuo de 3,2 m em alta velocidade e aproximação de 2,6 m no combate próximo.
- **Altura:** 4 m, a visão mais baixa e próxima.
- **Órbita:** forte (1,0), com trava de **105°/s**.
- **Lado:** troca de ombro **junto com a ação**, com pelo menos 3 s entre trocas. O ombro fica em 28°.
- **Enquadramento:** o eixo mistura mais o movimento (peso do oponente 0,7). O look-ahead é forte, com aceleração, e a previsão de encontro é alta.
- **Knockback:** segue de perto (0,85), quase sem atraso (0,04 s). **Impactos grandes recompõem a cena**, girando até 20° × magnitude.
- **Shake:** alto (1,4), com tremor de velocidade, sempre abaixo do teto de 0,45 m.
- **Proteções:** mais permissivas, para a câmera chegar perto: 0,9 m do chão e 1,6 m dos Beys. Mesmo assim, o oponente ficou em quadro pelo menos 98,5% do tempo nos 12 cenários (seção 7).

**Para quem:** quem quer espetáculo máximo e já lê bem a luta.

---

## 6. Valores aprovados (43 parâmetros × 3 presets)

A faixa é a do slider no lab e, no jogo, a faixa segura do Debug Lab. Unidades estão na coluna do parâmetro. As taxas "por s" são suavizações exponenciais.

### FOV

| Parâmetro | Chave | Faixa | A | B | C | O que faz |
|---|---|---|---:|---:|---:|---|
| FOV base (°) | `baseFov` | 40–90 | 58 | 62 | 66 | FOV vertical parado. Configurável no pré-jogo pelo GDD. |
| FOV máximo (°, teto 120) | `maxFov` | 50–120 | 74 | 88 | 100 | Até onde a velocidade abre o FOV. O teto conceitual do GDD é 120°. |
| Força velocidade → FOV | `fovSpeedStrength` | 0–1 | 0,6 | 0,85 | 1 | 0 = FOV não muda com velocidade; 1 = chega ao máximo na velocidade de referência (16 m/s). |
| Curva velocidade → FOV (1 = linear) | `fovSpeedCurve` | 0,4–3 | 1,4 | 1,1 | 0,9 | >1 guarda a abertura para as velocidades altas; <1 abre cedo. |
| Resposta do FOV (por s) | `fovDamping` | 0,5–12 | 2,5 | 3,5 | 5 | Quão rápido o FOV persegue o alvo. |
| Variação máxima do FOV (°/s) | `fovMaxRate` | 5–200 | 35 | 60 | 110 | Trava contra FOV pulsando: limite de graus por segundo. |
| Soco de FOV no impacto (°) | `impactFovPunch` | 0–20 | 3 | 6 | 11 | Abertura rápida de FOV num impacto forte, proporcional à magnitude. |

### Distância e altura

| Parâmetro | Chave | Faixa | A | B | C | O que faz |
|---|---|---|---:|---:|---:|---|
| Distância mínima (m) | `minDistance` | 3–14 | 8,5 | 7,2 | 6 | Distância horizontal do olho ao alvo com os Beys juntos. |
| Distância máxima (m) | `maxDistance` | 8–30 | 15 | 17 | 20 | Limite de afastamento. |
| Resposta à separação (m por m) | `separationResponse` | 0–1,5 | 0,55 | 0,62 | 0,75 | Quanto a câmera recua por metro de separação acima de 3 m. |
| Zona morta da distância (m) | `distanceDeadband` | 0–2 | 0,6 | 0,4 | 0,25 | Trava contra zoom oscilando: o alvo de distância só muda quando a diferença passa disso. |
| Altura da câmera (m) | `cameraHeight` | 1,5–12 | 6 | 5 | 4 | Altura do olho acima do alvo na distância mínima (sobe um pouco com a distância). |
| Offset vertical do alvo (m) | `verticalOffset` | -1–3 | 0,4 | 0,5 | 0,6 | Eleva o ponto para onde a câmera olha. |

### Órbita e lado

| Parâmetro | Chave | Faixa | A | B | C | O que faz |
|---|---|---|---:|---:|---:|---|
| Offset lateral / ombro (°) | `lateralOffset` | 0–60 | 14 | 20 | 28 | Quanto a câmera sai de trás do jogador para um lado (o "semi" do semi-over-the-shoulder). |
| Força da órbita | `orbitStrength` | 0–1,5 | 0,2 | 0,6 | 1 | Quanto a câmera acompanha o movimento circular da luta (e deriva sozinha no combate próximo). |
| Velocidade máxima de órbita (°/s) | `orbitSpeed` | 10–240 | 40 | 70 | 105 | Trava anti-enjoo: a câmera nunca gira mais rápido que isso. |
| Suavização da órbita (por s) | `orbitDamping` | 0,5–12 | 2 | 3 | 4,5 | Quão rápido o ângulo da câmera persegue o alvo. |
| Intervalo mínimo entre trocas de lado (s, 60 = nunca) | `sideSwitchCooldown` | 1–60 | 60 (nunca) | 6 | 3 | Trava contra a câmera trocando de lado várias vezes em poucos segundos. |

### Suavização

| Parâmetro | Chave | Faixa | A | B | C | O que faz |
|---|---|---|---:|---:|---:|---|
| Suavização de posição (por s) | `positionDamping` | 0,5–15 | 4 | 5,5 | 7,5 | Quão rápido o olho alcança a posição desejada. Alto = chega junto; baixo = atrasa. |
| Suavização do alvo / rotação (por s) | `rotationDamping` | 0,5–20 | 5 | 7 | 10 | Quão rápido o ponto olhado alcança o alvo. |
| Velocidade de transição entre modos (por s) | `transitionSpeed` | 0,5–10 | 2 | 3 | 4,5 | Quão rápido um contexto (alta velocidade, perto, knockback, Clash...) entra e sai. |

### Enquadramento e look-ahead

| Parâmetro | Chave | Faixa | A | B | C | O que faz |
|---|---|---|---:|---:|---:|---|
| Viés do alvo (0 = jogador, 0,5 = meio, 1 = oponente) | `framingBias` | 0–1 | 0,5 | 0,55 | 0,6 | Onde fica o ponto olhado na linha jogador → oponente. |
| Peso do oponente na direção | `opponentWeight` | 0–1 | 1 | 0,85 | 0,7 | 1 = a câmera sempre alinha no eixo jogador → oponente (foco no oponente do GDD); menos = mistura com a direção de movimento do jogador. |
| Força do look-ahead | `lookAheadStrength` | 0–1,5 | 0,3 | 0,7 | 1 | Multiplicador geral do adiantamento na direção do movimento. |
| Look-ahead de velocidade (s à frente) | `velocityLookAhead` | 0–1,2 | 0,25 | 0,4 | 0,6 | Quantos segundos de movimento a câmera antecipa. |
| Look-ahead de aceleração (s²) | `accelLookAhead` | 0–0,2 | 0 | 0,03 | 0,06 | Antecipa mudanças de velocidade (arrancadas, Dash). |
| Previsão de encontro | `encounterWeight` | 0–1 | 0,3 | 0,6 | 0,9 | Quando os dois vão se cruzar em até 1,2 s, puxa o enquadramento para o ponto do encontro e abre um pouco. |

### Contextos

| Parâmetro | Chave | Faixa | A | B | C | O que faz |
|---|---|---|---:|---:|---:|---|
| Recuo em alta velocidade (m) | `highSpeedPullback` | 0–8 | 1,5 | 2,2 | 3,2 | Distância extra quando algum Bey passa de ~9–15 m/s. |
| Aproximação no combate próximo (m) | `closePushIn` | 0–4 | 1 | 1,8 | 2,6 | Quanto a câmera se aproxima com os Beys a menos de ~2–4 m. |
| Força do knockback follow | `knockbackFollow` | 0–1 | 0,3 | 0,55 | 0,85 | Quanto o enquadramento segue o Bey arremessado. |
| Atraso do knockback follow (s) | `knockbackDelay` | 0–0,5 | 0,12 | 0,08 | 0,04 | Espera antes de começar a seguir, para o impacto ser lido parado. |
| Recuperação após deslocamento cinemático (por s) | `recoverySpeed` | 0,3–6 | 1,5 | 2 | 2,5 | Quão rápido o knockback follow e os empurrões de impacto voltam ao normal. |
| Reenquadramento no impacto (°) | `impactReframe` | 0–40 | 0 | 8 | 20 | Giro de câmera num impacto grande para mostrar a trajetória de lado. |

### Shake

| Parâmetro | Chave | Faixa | A | B | C | O que faz |
|---|---|---|---:|---:|---:|---|
| Intensidade geral do shake | `shakeIntensity` | 0–2,5 | 0,6 | 1 | 1,4 | Multiplicador de todo tremor (acessibilidade, GDD 121). |
| Decaimento do shake (por s) | `shakeDecay` | 1–20 | 9 | 7 | 5,5 | Quão rápido o tremor de impacto some. |
| Contribuição da velocidade | `speedShake` | 0–2 | 0 | 0,3 | 0,7 | Tremor contínuo leve em alta velocidade. |
| Contribuição do impacto | `impactShake` | 0–2,5 | 0,6 | 1 | 1,4 | Tremor por impacto, proporcional à magnitude. |

### Proteções de leitura

| Parâmetro | Chave | Faixa | A | B | C | O que faz |
|---|---|---|---:|---:|---:|---|
| Filtro da velocidade (Hz) | `speedFilterHz` | 0,3–10 | 1,5 | 2,5 | 3,5 | Trava contra FOV/recuo pulsando por ruído: a velocidade usada passa por um passa-baixa. |
| Ignorar impactos abaixo de (magnitude 0–1) | `microImpactThreshold` | 0–0,6 | 0,25 | 0,18 | 0,12 | Trava contra reagir violentamente a microimpactos. |
| Altura mínima acima do chão (m) | `floorClearance` | 0,3–4 | 1,5 | 1,2 | 0,9 | A câmera nunca entra no chão. |
| Distância mínima de qualquer Bey (m) | `beyClearance` | 0,8–5 | 2,5 | 2 | 1,6 | A câmera nunca atravessa um Bey. |
| Resgate de Bey fora do quadro | `offscreenRescue` | 0–2 | 1 | 1 | 1 | Se um Bey sai do quadro, a câmera recua, abre o FOV e puxa o alvo até ele voltar. |

---

## 7. Medições nas lutas reais

Todos os números saem da simulação real do jogo (`tickMatch`, Rapier, IA real ou roteiro) em 16:9, com os presets aprovados. Eles são reproduzíveis: o mesmo cenário dá a mesma luta e a mesma câmera, tick por tick. O tempo depois do fim do round não entra nas porcentagens de "em quadro".

### 7.1 Os cenários

| Cenário | O que acontece | Contextos de câmera | Duração | Medido |
|---|---|---|---:|---|
| Normal Duel | IA contra IA do jogo, como uma luta de verdade: aproximações, Dash, Circular e recuos. | CombatFollow, CloseCombat, KnockbackFollow, HighSpeed | 24 s | vel. máx. 15,9 m/s; separação 1,1–13,1 m |
| Close Combat | Os dois girando colados, trocando Circular Attacks curtos. | CloseCombat, KnockbackFollow (leve) | 6,5 s | vel. máx. 7,6 m/s; separação 1,3–6,3 m |
| Far Separation | Oponente parado no fundo da arena; o jogador faz laços largos do outro lado. | CombatFollow (distância máxima) | 12 s | vel. máx. 4,5 m/s; separação 15,2–18,7 m |
| High Speed Pass | O jogador cruza a arena em velocidade máxima passando rente ao oponente, freia, volta e passa de novo. | HighSpeed, look-ahead, encontro previsto | 9 s | vel. máx. 13,5 m/s; separação 1,8–12,7 m |
| Opposite Direction Pass | Os dois aceleram de frente um para o outro e se cruzam em sentidos opostos, sem colidir. | HighSpeed, aproximação frontal, encontro previsto | 6 s | vel. máx. 13,2 m/s; separação 3,0–21,2 m |
| Dash Approach | O jogador carrega o Dash Attack e dispara contra o oponente parado; depois um segundo Dash curto. | HighSpeed (Dash), KnockbackFollow, aproximação frontal | 8 s | vel. máx. 17,2 m/s; separação 0,9–10,0 m |
| Heavy Knockback | Dash com carga máxima: o oponente é arremessado e bate na parede. | KnockbackFollow (forte), wall impact | 7 s | vel. máx. 19,7 m/s; separação 0,0–9,0 m |
| Wall Ricochet | O jogador bate em ângulo na parede em alta velocidade e ricocheteia. | wall impact, HighSpeed | 7 s | vel. máx. 13,1 m/s; separação 9,0–14,2 m |
| Ring-Out Chase | Abertura real da IA contra IA: o jogador é lançado por cima da parede aos 2,1 s e a câmera persegue a trajetória. | KnockbackFollow, RingOut, Finisher | 5,5 s | vel. máx. 15,5 m/s; separação 0,2–8,0 m; fim de round aos 2,1 s |
| Clash Setup | Os dois disparam o Dash ao mesmo tempo, um contra o outro, e entram em Clash. | Clash, KnockbackFollow depois do Clash | 10 s | vel. máx. 14,7 m/s; separação 1,0–10,0 m |
| High-Speed Orbit | O jogador circula o oponente em alta velocidade, sempre virando. | HighSpeed, órbita em alta velocidade | 9 s | vel. máx. 8,3 m/s; separação 2,0–8,8 m |
| Final Hit | Oponente já Quebrado (setup do Debug Lab); um Dash forte dá o KO e a câmera faz o enquadramento final. | Finisher, KnockbackFollow (forte) | 6 s | vel. máx. 18,6 m/s; separação 2,0–8,0 m; fim de round aos 1,8 s |

### 7.2 Leitura: oponente e jogador em quadro

Porcentagem do tempo de jogo com cada Bey dentro do quadro (margem de 2%), no formato oponente / jogador.

| Cenário | A | B | C |
|---|---:|---:|---:|
| Normal Duel | 100% / 100% | 100% / 100% | 100% / 100% |
| Close Combat | 100% / 100% | 100% / 100% | 98,5% / 100% (saída de 0,10 s) |
| Far Separation | 100% / 100% | 100% / 100% | 100% / 100% |
| High Speed Pass | 100% / 100% | 100% / 100% | 100% / 100% |
| Opposite Direction Pass | 100% / 96,9% | 100% / 100% | 100% / 100% |
| Dash Approach | 100% / 100% | 100% / 100% | 100% / 100% |
| Heavy Knockback | 100% / 100% | 100% / 100% | 100% / 100% |
| Wall Ricochet | 100% / 100% | 100% / 100% | 100% / 100% |
| Ring-Out Chase | 100% / 100% | 100% / 100% | 100% / 100% |
| Clash Setup | 100% / 100% | 100% / 100% | 100% / 100% |
| High-Speed Orbit | 100% / 100% | 100% / 100% | 100% / 100% |
| Final Hit | 100% / 100% | 100% / 100% | 100% / 100% |

**Resumo:**
- O oponente ficou em quadro **100%** do tempo em todos os cenários para A e B, e em 11 dos 12 para C. A exceção é o Close Combat da C, com 98,5% e uma saída de 0,10 s.
- O jogador ficou em quadro 100% do tempo em quase todos os casos. A exceção é a A no Opposite Direction Pass, com 96,9%.
- Nenhuma câmera entrou no chão, e nenhuma passou de 120°.

### 7.3 FOV: mínimo – máximo (média)

| Cenário | A | B | C |
|---|---:|---:|---:|
| Normal Duel | 57–66,3° (60,4°) | 61–81,9° (67,6°) | 64–102,1° (75,7°) |
| Close Combat | 58–61,9° (58,2°) | 62–72,0° (62,7°) | 66–86,0° (67,8°) |
| Far Separation | 58–58,2° (58,1°) | 62–63,0° (62,6°) | 66–68,9° (67,7°) |
| High Speed Pass | 58–66,6° (59,8°) | 62–83,4° (67,1°) | 66–102,6° (75,0°) |
| Opposite Direction Pass | 58–63,5° (59,6°) | 62–77,1° (65,5°) | 66–91,8° (72,1°) |
| Dash Approach | 58–65,1° (59,3°) | 62–81,6° (64,9°) | 66–99,6° (70,7°) |
| Heavy Knockback | 58–65,4° (59,5°) | 62–81,3° (65,4°) | 66–98,6° (71,5°) |
| Wall Ricochet | 58–65,6° (59,0°) | 62–81,7° (65,0°) | 66–100,8° (71,4°) |
| Ring-Out Chase | 58–68,4° (63,9°) | 62–78,3° (72,6°) | 66–94,9° (82,3°) |
| Clash Setup | 57–65,8° (59,1°) | 61–73,1° (63,5°) | 64–90,5° (68,2°) |
| High-Speed Orbit | 58–60,7° (60,1°) | 62–70,1° (68,7°) | 66–81,0° (78,6°) |
| Final Hit | 50–65,1° (55,1°) | 58–81,7° (63,2°) | 66–102,8° (72,3°) |

### 7.4 Movimento: giro máximo, trocas de lado e shake máximo

Giro máximo em °/s, medido em janelas de 0,25 s. O shake máximo está em metros.

| Cenário | A (giro · trocas · shake) | B (giro · trocas · shake) | C (giro · trocas · shake) |
|---|---:|---:|---:|
| Normal Duel | 40 · 0 · 0,11 | 70 · 1 · 0,32 | 105 · 1 · 0,45 |
| Close Combat | 40 · 0 · 0,11 | 70 · 0 · 0,31 | 105 · 0 · 0,45 |
| Far Separation | 10 · 0 · 0,00 | 69 · 0 · 0,00 | 105 · 0 · 0,00 |
| High Speed Pass | 40 · 0 · 0,11 | 70 · 1 · 0,32 | 105 · 1 · 0,45 |
| Opposite Direction Pass | 40 · 0 · 0,00 | 70 · 0 · 0,01 | 105 · 0 · 0,03 |
| Dash Approach | 6 · 0 · 0,10 | 16 · 0 · 0,29 | 27 · 0 · 0,45 |
| Heavy Knockback | 4 · 0 · 0,07 | 12 · 0 · 0,19 | 20 · 0 · 0,38 |
| Wall Ricochet | 40 · 0 · 0,11 | 70 · 1 · 0,32 | 105 · 1 · 0,45 |
| Ring-Out Chase | 40 · 0 · 0,10 | 70 · 0 · 0,28 | 105 · 0 · 0,45 |
| Clash Setup | 33 · 0 · 0,11 | 57 · 0 · 0,31 | 105 · 0 · 0,45 |
| High-Speed Orbit | 40 · 0 · 0,00 | 70 · 0 · 0,00 | 105 · 0 · 0,00 |
| Final Hit | 4 · 0 · 0,11 | 56 · 0 · 0,33 | 105 · 0 · 0,45 |

**Resumo:**
- Cada preset respeita a própria trava de giro: 40, 70 e 105 °/s.
- A B e a C trocaram de lado **no máximo uma vez** por cenário. A A nunca trocou.
- O shake da C bate no teto de 0,45 m nos impactos fortes. O da B fica perto de 0,3 m e o da A, perto de 0,1 m.

### 7.5 Tempo em cada modo (segundos, sem contar CombatFollow)

| Cenário | Modo | A | B | C |
|---|---|---:|---:|---:|
| Normal Duel | Clash | 4,1 | 4,1 | 4,1 |
| Normal Duel | KnockbackFollow | 1,0 | 1,0 | 0,9 |
| Normal Duel | HighSpeed | — | — | 0,3 |
| Normal Duel | CloseCombat | 8,6 | 8,4 | 9,0 |
| Close Combat | CloseCombat | 4,0 | 3,9 | 3,9 |
| High Speed Pass | HighSpeed | — | 0,6 | 0,8 |
| Opposite Direction Pass | HighSpeed | — | — | 0,3 |
| Dash Approach | KnockbackFollow | 0,3 | 0,6 | 0,7 |
| Dash Approach | HighSpeed | 0,6 | 0,7 | 0,6 |
| Dash Approach | CloseCombat | 4,9 | 4,7 | 4,8 |
| Heavy Knockback | KnockbackFollow | 1,2 | 1,1 | 1,1 |
| Heavy Knockback | HighSpeed | 0,4 | 0,4 | 0,4 |
| Heavy Knockback | CloseCombat | 3,1 | 3,3 | 3,5 |
| Ring-Out Chase | RingOut | 3,0 | 3,1 | 3,1 |
| Ring-Out Chase | HighSpeed | 0,5 | 0,6 | 0,6 |
| Ring-Out Chase | CloseCombat | 0,5 | 0,5 | 0,6 |
| Clash Setup | Clash | 4,1 | 4,1 | 4,1 |
| Clash Setup | KnockbackFollow | 1,0 | 1,0 | 0,9 |
| High-Speed Orbit | CloseCombat | 1,0 | 1,3 | 1,5 |
| Final Hit | Finisher | 3,7 | 3,8 | 3,8 |
| Final Hit | HighSpeed | — | 0,3 | 0,3 |

---

## 8. As opções nas Configurações do jogo

- **Uma opção "Camera" com três escolhas:** Arena Fighter, Cinematic Hybrid e Hyper Dynamic, uma de cada vez.
- **Natureza da preferência:** é apresentação, não regra.
  - Não muda a simulação, não entra no `MatchConfig`, não participa do hash de replay e não afeta a IA (GDD 89, 101, 102 e 112).
  - Pode aparecer no "Copy Debug Report" como informação de apresentação.
- **Persistência:** é uma configuração pequena, então vai para `localStorage` (GDD 78).
- **Outros controles de câmera exigidos pelo GDD.** Eles convivem com a escolha do preset:
  - **FOV base configurável no pré-jogo** (GDD 12 e 49);
  - **shake configurável** (GDD 12 e 121);
  - **efeitos de FOV de impacto configuráveis** (GDD 12).

  Como eles se combinam com o preset está em aberto (item 10.4).
- **Acessibilidade (GDD 121):** a escala de shake do jogador multiplica o `shakeIntensity` do preset. Nenhuma informação crítica depende do shake ou do soco de FOV.
- **Debug Lab (GDD 69, 70 e 112):**
  - mostrar o modo ativo, o FOV, o alvo, a distância, o shake, o estado cinematográfico e os modificadores ativos;
  - expor os 43 parâmetros e as constantes com as faixas da seção 6;
  - ligar e desligar os marcadores de debug (ponto seguido, ponto médio, look-ahead, vetores, encontro previsto).

  O jogador comum vê só a escolha do preset e os controles seguros acima.
- **Qualidade (GDD 89):** a câmera não tem custo de GPU relevante. Os presets Low, Medium e High não mudam a câmera.

---

## 9. Relação com as outras decisões

- **Câmera atual do jogo (já integrada — ver item 6 da seção 1 e a seção 11):** `CombatCameraController.ts` e `ClashCameraDirector.ts` (M4/M5, valores de engenharia provisórios) **não existem mais** — foram substituídos pelo diretor aprovado deste documento, em `src/camera/director/` (`CameraDirector.ts`, `CameraRig.ts`, `CameraParams.ts`). `src/camera/CameraTuning.ts` hoje só guarda o que ficou de fora do diretor (hitstop, `ImpactMagnitude`); seu próprio comentário de cabeçalho documenta essa substituição.
  - A **forma** aprovada em 2026-09-25 foi o perfil "C — Hybrid scalable": contato rotineiro sutil e momentos grandes cinematográficos, escalando com a magnitude.
  - O diretor aprovado mantém essa forma, pelo limiar de microimpacto e pela escala por magnitude, e **substituiu** o enquadramento dessas duas classes (feito, não mais um passo futuro).
  - `ImpactEvents.ts` e `ImpactMagnitude.ts` continuam em uso no jogo real, do mesmo jeito que no lab.
- **Hitstop (GDD 26; ×1,2 aprovado no VFX Lab):** hoje o hitstop é calculado dentro do `CombatCameraController`. O lab não tinha hitstop, para as três câmeras verem a mesma luta. Na integração, o hitstop continua como está, separado do diretor (item 10.6).
- **Shake global ×1,35 (decisões visuais, §3c):** conflita com o shake próprio de cada preset. Ver o item 10.5.
- **Perfect Dodge (GDD 22; câmera lenta de 0,3× por 0,45 s aprovada no VFX Lab):** o GDD pede que a câmera reaja forte ao Perfect Dodge. O lab **não tem** um modo PerfectDodge dedicado (item 10.7).
- **Modo Intro (GDD 50) e câmera lenta em momentos decisivos (GDD 49):** não foram prototipados (item 10.7).
- **Arena côncava (aprovada, já integrada — M11 lane 4):** o lab usou a arena plana; hoje os bowls A/B/C existem de verdade (colisor físico côncavo, não só visual — `src/arena/colliders/createArenaColliders.ts`, perfil `h(r)` em `src/arena/floor/ArenaFloorProfile.ts`), selecionáveis no Motion Lab/Pregame. A arena padrão (`DEFAULT_ARENA_FLOOR`) continua plana.
  - A proteção de piso do diretor já lê o perfil real do bowl: `CameraRig`/`CameraDirector` recebem um `floorHeightAt(x, z)` ("for the directors' floor guard (M11 bowls)") em vez de assumir y = 0 fixo.
  - Isso cobre o item 3 da seção 5.1 das decisões visuais; a vigia do Ring-Out (9 m do centro) não foi revista especificamente para os bowls e pode valer a pena confirmar numa partida real num bowl.
- **Stamina & Stability:** o medidor no chão da direção C e os sinais junto ao Bey ficam visíveis nas alturas de 4 m a 6 m. O Finisher, baixo, também mostra o Bey Quebrado. Isso deve ser verificado na integração.
- **Bey Motion Lab:** o diretor lê só o `FightFrame`. Quando o movimento do Motion Lab for aprovado, ele entra como outra fonte no Camera Lab, sem mudar o diretor nem os presets. As medições da seção 7 devem ser repetidas. Qualquer novo ajuste de valores precisa de aprovação do dono.
- **M8:** esta decisão não inicia o M8.

---

## 10. Continua em ABERTO (não decidir sem o dono)

1. **Padrão para um jogador novo:** qual das três vem selecionada na primeira vez. Pelo GDD 167, um padrão para o jogador não pode ser travado sem o dono.
   - *Recomendação, não decidida:* **B**, por ser o equilíbrio "dramático, mas legível" do GDD 48. A é a alternativa se a prioridade for a primeira experiência mais calma.
   - **Nota de implementação:** `PlayerSettings.ts` já usa `cameraPreset: 'B'` como padrão, citando esta recomendação no comentário. Ou seja, o código já segue a recomendação acima, mas isso não conta como a confirmação do dono que este item pede — continua em aberto nesse sentido.
2. **Troca no meio da partida:** se a opção pode mudar no menu de pausa durante uma luta ou só fora dela.
   - *Recomendação:* permitir, com transição suave. No lab, a troca é instantânea e não quebra nada, porque os três diretores rodam juntos.
3. **Nomes na tela de Configurações:** o GDD pede nomes em inglês para o jogador. Os candidatos são os do lab: "Arena Fighter", "Cinematic Hybrid" e "Hyper Dynamic". Falta confirmar, e decidir se cada opção terá uma descrição curta.
4. **FOV base do jogador × preset (GDD 12 e 49):** falta decidir como o FOV base escolhido pelo jogador se combina com o preset.
   - *Proposta:* o valor do jogador desloca `baseFov` e `maxFov` do preset juntos, preservando a faixa de abertura de cada direção, sempre abaixo de 120°.
   - Também falta definir a faixa segura para o jogador e o valor inicial.
5. **Shake global ×1,35 do VFX Lab × shake dos presets:** na câmera do jogo, existe só um shake.
   - *Recomendação:* usar os valores de shake dos presets **como vistos no Camera Lab**, sem somar o ×1,35. Esse multiplicador foi um ajuste relativo sobre a base provisória do VFX Lab, e somá-lo mudaria o que foi aprovado aqui.
   - Os outros valores globais do VFX (clarão, frame de impacto, hitstop) não mudam.
6. **Hitstop durante a câmera:** o jogo atual continua atualizando a câmera durante o hitstop (shake e soco de FOV decaem em tempo real).
   - *Recomendação:* manter isso com o diretor. Falta confirmar vendo no jogo.
7. **Modos não prototipados:** PerfectDodge (GDD 22 e 50), Intro (GDD 50) e câmera lenta em momentos decisivos (GDD 49). Cada um precisa de protótipo e aprovação próprios, nas três direções.
8. **Ring-Out e Finisher no jogo real:** o `main.ts` congela tudo no fim do round. O lab deixa a física correr 2,5 s **só para apresentação**, para a câmera ter uma trajetória para seguir.
   - Falta decidir como o jogo faz isso sem mudar o resultado já decidido. As opções são continuar a física só para o visual, ou fazer uma trajetória de apresentação.
9. **Proporção de tela:** o lab usa 16:9 com barras, e o jogo roda em tela cheia em qualquer proporção (GDD 131). O FOV do diretor é vertical.
   - Telas mais largas veem mais dos lados, sem problema.
   - Telas mais estreitas (retrato, alguns celulares) veem menos. *Proposta técnica:* nessas telas, preservar a cobertura horizontal de 16:9.
   - Falta validar nas plataformas do GDD 90.
10. **IA contra IA (modo espectador, GDD 162):** o diretor é centrado no "jogador". Falta decidir qual Bey ocupa esse papel quando nenhum dos dois é humano.
    - *Proposta:* o primeiro slot, igual ao lab.

---

## 11. Como implementar (quando o dono pedir)

**Status: já feito.** Os passos 1–3, 5 e 6 abaixo foram executados na integração M11 (ver item 6 da seção 1) e depois ajustados pelo fix 8 (seção 1, item 5). Mantido como registro de como foi feito e para o passo 8 (revalidar depois de mudanças na arena/movimento), que continua relevante a cada novo bowl ou ajuste de movimento.

Ordem sugerida (histórico). Cada etapa segue o fluxo de conclusão do GDD 1.5 (typecheck, testes, build, self-test e console) e a definição de pronto visual do GDD 148.

1. **Portar o diretor para `src/camera/director/`.**
   - Portar `CameraDirector`, `CameraParams` (os três presets, com um comentário de origem apontando para este documento, GDD 1.3 e 101), `frameMath` e `ReadabilityMeter` (para o debug e os testes).
   - O código de `prototypes/camera-concepts/src/director/` é a referência. Os valores já são absolutos: não há multiplicadores para converter.
2. **Adaptar o jogo para `FightFrame`, somente leitura, a cada tick fixo.**
   - Posição, velocidade, rapidez e "no ar" vêm dos corpos. O estado de ataque e o "Quebrado" vêm do combate e da Stability.
   - Os intents vêm do `buildImpactEventsForTick`, que o jogo já tem; o mapeamento pronto está em `prototypes/camera-concepts/src/fight/RealSimSource.ts`.
   - O Clash e o progresso vêm do `ClashOrchestration`, e o fim de round, do `RoundState`.
   - O diretor não recalcula nada do gameplay.
3. **Trocar a câmera no `main.ts`.**
   - A saída do diretor (olho, alvo, FOV e shake) substitui o `CombatCameraController` e o `ClashCameraDirector`.
   - O **hitstop** continua como está (item 10.6), num módulo próprio se precisar sair da classe antiga.
   - As constantes de enquadramento de `CameraTuning.ts` que o diretor substitui saem, com um comentário de onde foram parar.
4. **Fim de round:** implementar a solução escolhida no item 10.8 para o Ring-Out e o Finisher.
5. **Configurações:**
   - a opção A, B ou C;
   - a persistência em `localStorage`;
   - o FOV base e a escala de shake do jogador (itens 10.4 e 10.5);
   - a troca aplicada ao vivo, se o item 10.2 permitir.
6. **Debug Lab:** o painel de câmera da seção 8, com os marcadores do lab.
7. **Testes.**
   - Levar `tests/unit/cameraLab.test.ts` para o diretor do jogo: cada preset em cada cenário, com as mesmas garantias de leitura (oponente em quadro ≥ 90%, jogador ≥ 85%, nenhuma saída de 0,75 s, acima do chão, FOV ≤ 120°, giro abaixo da trava, sem enxurrada de trocas de lado).
   - Um cenário de self-test por modo.
   - Smoke do jogo com cada opção, sem erros no console.
8. **Revalidar depois do bowl e do Motion Lab:** repetir as medições da seção 7 quando a arena côncava ou o movimento aprovado entrarem.

---

## 12. Onde ver e valores exatos

- **Protótipo:** `prototypes/camera-concepts/`, com README próprio.
  - Rodar com `npm run dev` e abrir `/prototypes/camera-concepts/`.
  - Links diretos por cenário: `#normal-duel`, `#clash-setup`, `#ring-out-chase`, `#final-hit` etc.
  - Atalhos:
    - `Q` compara A | B | C;
    - `T` toca a sequência A→B→C;
    - `1` `2` `3` trocam a câmera;
    - `D`, `M` e `H` ligam e desligam o debug.
- **Artifact (privado, só o dono abre):** https://claude.ai/artifact/AFtUPBvMmBtqcsRh1VVUhe
- **Branch e PR:** `claude/sleepy-johnson-4i6io4`, PR #21. Os valores aprovados estão no commit `dd1d676`, e esta decisão vem no commit seguinte.
- **Fonte da verdade no código do lab:** `PRESETS` em `prototypes/camera-concepts/src/director/CameraParams.ts`. As constantes compartilhadas estão no topo de `prototypes/camera-concepts/src/director/CameraDirector.ts`.
- **Testes do lab:** `tests/unit/cameraLab.test.ts` (cenários reais, reprodutibilidade, leitura de cada preset em cada cenário e modos) e `tests/smoke/cameraConcepts.spec.ts`.

JSON exato (as chaves de `CameraParams`):

```json
{
  "A": {
    "baseFov": 58,
    "maxFov": 74,
    "fovSpeedStrength": 0.6,
    "fovSpeedCurve": 1.4,
    "fovDamping": 2.5,
    "fovMaxRate": 35,
    "impactFovPunch": 3,
    "minDistance": 8.5,
    "maxDistance": 15,
    "separationResponse": 0.55,
    "distanceDeadband": 0.6,
    "cameraHeight": 6,
    "verticalOffset": 0.4,
    "lateralOffset": 14,
    "orbitStrength": 0.2,
    "orbitSpeed": 40,
    "orbitDamping": 2,
    "sideSwitchCooldown": 60,
    "positionDamping": 4,
    "rotationDamping": 5,
    "transitionSpeed": 2,
    "framingBias": 0.5,
    "opponentWeight": 1,
    "lookAheadStrength": 0.3,
    "velocityLookAhead": 0.25,
    "accelLookAhead": 0,
    "encounterWeight": 0.3,
    "highSpeedPullback": 1.5,
    "closePushIn": 1,
    "knockbackFollow": 0.3,
    "knockbackDelay": 0.12,
    "recoverySpeed": 1.5,
    "impactReframe": 0,
    "shakeIntensity": 0.6,
    "shakeDecay": 9,
    "speedShake": 0,
    "impactShake": 0.6,
    "speedFilterHz": 1.5,
    "microImpactThreshold": 0.25,
    "floorClearance": 1.5,
    "beyClearance": 2.5,
    "offscreenRescue": 1
  },
  "B": {
    "baseFov": 62,
    "maxFov": 88,
    "fovSpeedStrength": 0.85,
    "fovSpeedCurve": 1.1,
    "fovDamping": 3.5,
    "fovMaxRate": 60,
    "impactFovPunch": 6,
    "minDistance": 7.2,
    "maxDistance": 17,
    "separationResponse": 0.62,
    "distanceDeadband": 0.4,
    "cameraHeight": 5,
    "verticalOffset": 0.5,
    "lateralOffset": 20,
    "orbitStrength": 0.6,
    "orbitSpeed": 70,
    "orbitDamping": 3,
    "sideSwitchCooldown": 6,
    "positionDamping": 5.5,
    "rotationDamping": 7,
    "transitionSpeed": 3,
    "framingBias": 0.55,
    "opponentWeight": 0.85,
    "lookAheadStrength": 0.7,
    "velocityLookAhead": 0.4,
    "accelLookAhead": 0.03,
    "encounterWeight": 0.6,
    "highSpeedPullback": 2.2,
    "closePushIn": 1.8,
    "knockbackFollow": 0.55,
    "knockbackDelay": 0.08,
    "recoverySpeed": 2,
    "impactReframe": 8,
    "shakeIntensity": 1,
    "shakeDecay": 7,
    "speedShake": 0.3,
    "impactShake": 1,
    "speedFilterHz": 2.5,
    "microImpactThreshold": 0.18,
    "floorClearance": 1.2,
    "beyClearance": 2,
    "offscreenRescue": 1
  },
  "C": {
    "baseFov": 66,
    "maxFov": 100,
    "fovSpeedStrength": 1,
    "fovSpeedCurve": 0.9,
    "fovDamping": 5,
    "fovMaxRate": 110,
    "impactFovPunch": 11,
    "minDistance": 6,
    "maxDistance": 20,
    "separationResponse": 0.75,
    "distanceDeadband": 0.25,
    "cameraHeight": 4,
    "verticalOffset": 0.6,
    "lateralOffset": 28,
    "orbitStrength": 1,
    "orbitSpeed": 105,
    "orbitDamping": 4.5,
    "sideSwitchCooldown": 3,
    "positionDamping": 7.5,
    "rotationDamping": 10,
    "transitionSpeed": 4.5,
    "framingBias": 0.6,
    "opponentWeight": 0.7,
    "lookAheadStrength": 1,
    "velocityLookAhead": 0.6,
    "accelLookAhead": 0.06,
    "encounterWeight": 0.9,
    "highSpeedPullback": 3.2,
    "closePushIn": 2.6,
    "knockbackFollow": 0.85,
    "knockbackDelay": 0.04,
    "recoverySpeed": 2.5,
    "impactReframe": 20,
    "shakeIntensity": 1.4,
    "shakeDecay": 5.5,
    "speedShake": 0.7,
    "impactShake": 1.4,
    "speedFilterHz": 3.5,
    "microImpactThreshold": 0.12,
    "floorClearance": 0.9,
    "beyClearance": 1.6,
    "offscreenRescue": 1
  }
}
```
