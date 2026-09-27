# Decisões visuais aprovadas: Stamina, Stability e Quebrado

**Status:** APROVADO pelo dono do projeto.
**Data:** 2026-09-27
**Origem:** protótipo `prototypes/condition-visual-concepts/` (Stamina & Stability Lab), branch `claude/sleepy-johnson-4i6io4`.
**Configuração final:** salva pelo dono no próprio lab ("Salvar como final", 2026-09-27 01:21 UTC), com um ajuste feito depois: a coluna de luz vermelha da direção C foi removida.
**Base no GDD:** 1.6 (aprovação visual), 28–30 (Stability, Stability Break e Stamina), 34 e 83–84 (giro visual e wobble), 121 (redução de efeitos), 123 (degradação física por Stamina), 158 (VFX observa eventos), 167 (valores provisórios).

Este documento registra **o que já foi decidido** sobre como a condição de um Bey aparece na tela, para que nenhum agente reabra essas perguntas (GDD 170). A seção 8 separa o que **continua em aberto**. Nada aqui autoriza mudar regras de gameplay, física, colisores ou balanceamento.

> **Atenção, mesmo problema da branch visual anterior:** este protótipo e este documento estão só na branch `claude/sleepy-johnson-4i6io4`, **não na `main`**. Quem auditar só a `main` não vai encontrá-los. Eles devem ser canonizados junto com o trabalho da `claude/tender-turing-3k7o8v`.

---

## 1. Resumo da decisão

1. **As três direções foram aprovadas:** A — Desgaste Mecânico, B — Aura de Espírito e C — Instrumento no Chão.
2. **Elas vão para o jogo como opções nas Configurações.** O jogador escolhe quais ficam ligadas: **qualquer combinação de 1, 2 ou as 3**.
3. **A camada física comum fica sempre ligada.** Ela não é uma das opções (seção 2).
4. **Removido da C:** a coluna de luz vermelha que subia do Bey quebrado.
5. **Desligado na B:** o contorno vermelho de perigo (o dono deixou em 0).
6. **Valores:** os 49 parâmetros das seções 2 a 5, com o JSON exato na seção 10.

A explosão pontual do Stability Break já estava aprovada no VFX Language Lab (decisões visuais anteriores, §3b, linguagem Híbrida). Esta decisão cobre o resto: o **estado contínuo** antes da quebra, o **estado Quebrado persistente** depois dela e a **recuperação**. As duas coisas convivem. No instante da quebra toca a explosão do VFX aprovado, e a partir dali estas camadas mostram o estado Quebrado.

---

## 2. Camada física comum (sempre ligada)

É a degradação física que o GDD exige para qualquer escolha do jogador (GDD 30, 84 e 123: perder Stamina precisa aparecer no corpo do Bey, não só numa barra).

| O que acontece | Como aparece |
|---|---|
| Stamina caindo | O giro desacelera. Em alta rotação o Ring fica envolto num **invólucro de borrão** (tampa em cima, tampa embaixo e faixa na borda). Conforme o giro cai, o borrão some e as peças aparecem. |
| Stamina baixa | O bamboleio (wobble) e a precessão crescem, e a ponta desenha uma roseta. |
| Stability baixa | Bamboleio extra, e cada golpe tomba o Bey mais forte. |
| Quebrado | Inclinação fixa ("mancando") e engasgos periódicos no giro. |
| Stamina zerada | Spin-out: o bamboleio acelera e o Bey cai sobre a borda do Ring (ver o item aberto 8.3). |

As peças giram numa velocidade desenhada limitada, e o borrão carrega a sensação da velocidade real. Isso evita o efeito "roda de carroça" (aliasing) e segue a separação entre giro visual e orientação física do GDD 83.

| Parâmetro (chave) | Valor | Leitura |
|---|---:|---|
| Giro com Stamina cheia (`spinMaxRps`) | 18 voltas/s | velocidade percebida pelo borrão |
| Giro perto do fim (`spinMinRps`) | 1,2 voltas/s | |
| Quando o giro começa a cair (`spinCurve`) | 1,6 | >1 = a queda aparece mais tarde |
| Giro máximo desenhado das peças (`meshMaxRps`) | 3,5 voltas/s | acima disso só o borrão acelera |
| Invólucro de borrão (`blur`) | 1 | |
| Borrão some abaixo de (`blurFadeRps`) | 6 voltas/s | |
| Stamina em que o bamboleio começa (`wobbleStart`) | 0,55 | |
| Bamboleio com Stamina zerada (`wobbleMaxDeg`) | 16° | |
| Precessão (`precessionHz`) | 0,9 volta do eixo/s | acelera sozinha com Stamina baixa |
| Tremor fino do eixo (`nutation`) | 1 | |
| Deriva da ponta, roseta (`tipWander`) | 1 | |
| Bamboleio extra com Stability baixa (`stabilityWobble`) | 1 | |
| Tombo do golpe com Stability zerada (`hitTiltDeg`) | 26° | ver a nota abaixo |
| Tombo com Stability cheia (`hitTiltFull`) | 0,3 | fração do valor acima |
| Deslocamento do golpe (`knockback`) | 1 | ver a nota abaixo |
| Rapidez para reerguer (`recoverySpeed`) | 3 | |
| Inclinação fixa quando quebrado (`brokenLeanDeg`) | 11° | |
| Engasgos do giro quando quebrado (`brokenStutter`) | 0,5 | |
| Duração do spin-out (`spinOutSeconds`) | 3 s | |

**Nota importante sobre o que é visual e o que é gameplay.** No lab, o movimento é coreografia. No jogo, a física real (Rapier + `src/bey/*`) manda.
- **Puramente visuais, podem ser portados direto:** giro visual, borrão, nutação, roseta da ponta e engasgos. É a camada visual do GDD 83.
- **Referência da leitura visual, não números de gameplay:** tombo do golpe, deslocamento, rapidez para reerguer e inclinação quando quebrado. Knockback, ring-out e o quanto o Bey inclina por impacto continuam valores de gameplay provisórios (GDD 167), definidos por playtest em `src/combat/knockback` e `src/bey/*`. Se a física do jogo não produzir essa leitura, a diferença pode ser completada pela camada visual de wobble, sem mexer no resultado do combate.

---

## 3. Direção A — Desgaste Mecânico (aprovada)

**Ideia:** nada que não exista fisicamente. O Bey conta o próprio estado pelo movimento, pelo material e pelo contato com o chão. É a mesma família "mecânica" das faíscas, estilhaços e poeira já aprovados.

| Estado | O que aparece |
|---|---|
| Stamina | A ponta risca a roseta no chão (marca metálica clara), cada vez mais aberta. A borda do Ring começa a raspar e soltar faíscas. Fumaça leve no fim. |
| Stability | As 4 peças ficam frouxas e trepidam, as junções abrem, a pintura escurece, fica fosca e perde o verniz. Golpes soltam lascas. |
| Quebrado | A borda raspa sem parar (faíscas contínuas) e sai fumaça do Driver. A inclinação e os engasgos vêm da camada comum. |
| Recuperação | As peças voltam ao lugar com um "clique": um anel de poeira. |

| Parâmetro | Valor |
|---|---:|
| Marca da ponta no chão (`aTrail`) | 0,55 |
| Duração da marca (`aTrailSeconds`) | 3,6 s |
| Folga entre as 4 peças (`aRattle`) | 0,5 |
| Abertura das junções (`aSeamGap`) | 1,8 |
| Desgaste do material (`aWear`) | 1,65 |
| Faíscas de raspagem da borda (`aGrind`) | 2,35 |
| Fumaça quando quebrado (`aSmoke`) | 2,4 |
| Trepidação no golpe (`aShudder`) | 1 |
| Lascas soltas no golpe (`aDebris`) | 2,35 |

A folga e a abertura das junções dependem do modelo de 4 peças (Top Layer, Ring, Disc, Driver) aprovado nas decisões visuais anteriores (§1 e §5.3).

---

## 4. Direção B — Aura de Espírito (aprovada)

**Ideia:** o espírito de luta vira energia visível, na linguagem anime já aprovada. Usa a cor de brilho de cada Bey (`palette.glow`).

| Estado | O que aparece |
|---|---|
| Stamina | Uma aura em chamas sobe do Bey. Com a Stamina baixa ela encolhe, tremula e se desfaz em fiapos. Linhas de giro anime rodeiam o corpo, menos numerosas quando cansado. O brilho do Bey apaga junto. |
| Stability | Escudos hexagonais orbitam o Bey, um por fração da Stability. Ficam âmbar abaixo de 50% e vermelhos abaixo de 25%. Cada golpe estilhaça escudos, que voam e somem. |
| Quebrado | Nenhum escudo, estrelas de tontura acima do Bey, raios elétricos, e a aura vira brasa vermelha. **Sem contorno vermelho** (o dono deixou em 0). |
| Recuperação | Os escudos se refazem um a um, com um anel de luz branca no chão. |

| Parâmetro | Valor |
|---|---:|
| Altura da aura (`bAuraHeight`) | 0,4 |
| Intensidade da aura (`bAuraIntensity`) | 0,25 |
| Aura se desfaz com Stamina baixa (`bAuraBreakup`) | 1,5 |
| Linhas de giro (`bSpinLines`) | 1,3 |
| Escudos de Stability (`bShards`) | 6 |
| Tamanho dos escudos (`bShardSize`) | 1 |
| Velocidade de órbita dos escudos (`bShardOrbit`) | 0,9 |
| Contorno de perigo quando quebrado (`bDangerShell`) | **0 (desligado)** |
| Pulso do perigo (`bDangerHz`) | 2,2 Hz (sem efeito com o contorno desligado) |
| Estrelas de tontura quando quebrado (`bDazed`) | 1,6 |
| Raios elétricos quando quebrado (`bArcs`) | 1,85 |
| Brilho do Bey apaga com a Stamina (`bGlowDim`) | 0,8 |

---

## 5. Direção C — Instrumento no Chão (aprovada, sem a coluna de luz)

**Ideia:** o chão da arena projeta um instrumento sob cada Bey. É preciso, lê de qualquer câmera, usa forma além de cor (arco, segmentos, listras) e deixa o Bey limpo. É um elemento **dentro do mundo** (diegético), **não o HUD**. O HUD continua uma decisão separada e em aberto (GDD 60 e 171.9).

| Estado | O que aparece |
|---|---|
| Stamina | Arco externo com marcas a cada 10%, esvaziando no sentido horário a partir do lado oposto à câmera. Muda de branco para âmbar e depois para vermelho pulsando. Um marcador corre em volta a um quarto da rotação. O núcleo do Top Layer pulsa como um batimento que desacelera com a Stamina. |
| Stability | Anel interno de segmentos. O golpe apaga segmentos, que piscam antes de sumir. |
| Quebrado | O anel de segmentos vira listras de perigo (amarelo e preto) girando. **Sem coluna de luz vermelha** (removida pelo dono). |
| Recuperação | Os segmentos reacendem em sequência. |

O instrumento acompanha a curvatura do bowl: ele se alinha à normal do chão sob o Bey.

| Parâmetro | Valor |
|---|---:|
| Raio do anel (`cRadius`) | 1,15 |
| Espessura do anel (`cWidth`) | 0,95 |
| Opacidade do anel (`cOpacity`) | 0,6 |
| Segmentos de Stability (`cSegments`) | 10 |
| Stamina de alerta, âmbar (`cWarnAt`) | 0,35 (35%) |
| Stamina crítica, vermelho (`cCritAt`) | 0,23 (23%) |
| Marcador de rotação no anel (`cNotch`) | 0,85 |
| Pulso do núcleo (`cCorePulse`) | 1,25 |
| Giro das listras de perigo (`cHazardSpin`) | 1,15 |

A coluna de luz (`cBeam`) foi retirada do protótipo e desta configuração. Ela não deve ser implementada.

---

## 6. Seleção nas Configurações (novo requisito aprovado)

**Palavras do dono:** "todos os 3 como opções selecionáveis nas configurações, com a opção de escolher se quer os 3, 1 ou 2".

- **Onde:** na tela de Configurações (SETTINGS no menu principal, GDD 56).
- **O que:** três opções liga/desliga, uma por direção (A, B, C). Qualquer combinação é válida, desde que **pelo menos uma** fique ligada.
- **A camada física comum não é opção:** ela fica sempre ligada.
- **Natureza da preferência:** é apresentação, não regra. Não muda a simulação, não entra no `MatchConfig`, não participa do hash de replay e não afeta a IA (GDD 89, 101, 102 e 112). Pode aparecer no "Copy Debug Report" como informação de apresentação.
- **Persistência:** é uma configuração pequena, então vai para `localStorage` (GDD 78).
- **Acessibilidade (GDD 121):** a camada física comum e a obrigação de manter pelo menos uma direção ligada garantem que a leitura de Stamina e Stability nunca dependa de um efeito que o jogador desligou por completo.
- **Qualidade (GDD 55 e 89):** os presets Low/Medium/High podem reduzir partículas (faíscas, fumaça, lascas, fiapos da aura), mas nunca remover a informação: o arco, os segmentos, os escudos e a roseta continuam.
- **Debug Lab (GDD 1.2 e 70):** ligar/desligar cada camada e expor os 49 parâmetros.

---

## 7. Relação com as outras decisões

- **VFX Híbrida (§3b e §3c das decisões visuais anteriores):** a explosão pontual do Stability Break, as faíscas de contato e as marcas de derrapagem já aprovadas continuam valendo. As faíscas neutras de contato do lab são só placeholder; no jogo usa-se o VFX Híbrido aprovado. A roseta da direção A e as marcas de derrapagem aprovadas são marcas diferentes e convivem no chão.
- **Arena:** o lab usou o bowl aprovado de 3,2 m com chão neutro, sem antecipar a escolha entre Foundry Pit, Rift Crater e Tournament Stadium. Ver o item aberto 8.4.
- **Beys:** o lab testou com os 9 conceitos da rodada 2. A B usa a cor de brilho de cada Bey. A A escurece os materiais de cada Bey.
- **Regras de Stability e Stamina:** os números de dano, o atraso e a taxa de recuperação e o limite para sair de Quebrado (0,3 no lab) eram coreografia do protótipo. No jogo valem as regras de `src/bey/stability` e `src/bey/stamina`. As camadas só **observam** estado e eventos (GDD 158).

---

## 8. Continua em ABERTO (não decidir sem o dono)

1. **Padrão para um jogador novo:** quais direções vêm ligadas na primeira vez. O dono salvou o lab com as três ligadas, mas isso foi a escolha dele no lab, não um padrão declarado para o jogo.
2. **Meu Bey e oponente:** se a mesma escolha vale para os dois ou se há escolha separada.
3. **Stamina zero sem derrota por Stamina:** o spin-out visual só faz sentido quando o jogo declara a derrota por Stamina, que é uma regra configurável (GDD 12 e 30). Com essa regra desligada, falta decidir o que aparece quando a Stamina chega a zero.
4. **Contraste com a arena escolhida:** o arco branco da C sobre um chão claro (Tournament Stadium) e a aura da B sobre as fissuras violeta (Rift Crater) precisam de verificação visual quando a arena inicial for definida.
5. **Nomes das opções na tela de Configurações:** o GDD pede nomes em inglês para o jogador. Candidatos, sem aprovação: "Mechanical Wear", "Spirit Aura" e "Floor Gauge".

---

## 9. Como implementar (quando o dono pedir)

Ordem sugerida. Cada etapa segue o fluxo de conclusão do GDD 1.5: typecheck, testes, build, self-test e console.

1. **Entradas por Bey, somente leitura:** Stamina 0–1, Stability 0–1, Quebrado, estado de spin-out ou derrota, taxa de giro, e os eventos golpe (com a Stability anterior), quebra e recuperação. Tudo isso já existe nos sistemas e na telemetria. As camadas não recalculam nada.
2. **Um componente próprio em `src/vfx/`** (por exemplo `src/vfx/condition/`), com uma camada por direção e um arquivo de tuning com os 49 valores no topo e um comentário de origem apontando para este documento (GDD 1.3 e 101).
3. **Camada física comum:** giro visual, invólucro de borrão e wobble visual junto ao modelo do Bey (`src/bey/procedural-model` e `src/bey/spin`), respeitando o GDD 83.
4. **Portar do lab:** o código de `prototypes/condition-visual-concepts/src/languages/*.ts` é a referência. Os valores das seções 2 a 5 são **multiplicadores** sobre as constantes-base do topo de cada arquivo do lab (exceto onde há unidade). Converter para valores absolutos ao portar, como previsto para a VFX Híbrida.
5. **Configurações:** as três opções, a regra de "pelo menos uma", a persistência e a integração com os presets de qualidade (seção 6).
6. **Testes:** unitários (cada camada acompanha o estado), cenários de self-test ("Test Stability Break" e "Test Zero/Low Stamina" com cada combinação de camadas), smoke sem erros de console e medição de desempenho no preset Low.

---

## 10. Onde ver e valores exatos

- **Protótipo:** `prototypes/condition-visual-concepts/`, com README próprio. Rodar com `npm run dev` e abrir `/prototypes/condition-visual-concepts/`. Links diretos: `#a`, `#b`, `#c`, `#compare`, `#stamina`, `#stability`.
- **Artifact (privado, só o dono abre):** https://claude.ai/artifact/XrFZjTjDfGF5BzTFWaPmzT
- **Branch:** `claude/sleepy-johnson-4i6io4`. O protótipo entrou no commit `24e98c0`; esta decisão e a remoção da coluna vieram no commit seguinte.
- **Fonte da verdade no código do lab:** `APPROVED` em `prototypes/condition-visual-concepts/src/tuning.ts`.

Seleção aprovada no lab: as três direções ligadas juntas (`"layers": {"A": true, "B": true, "C": true}`).

JSON exato (as chaves de `Tuning`):

```json
{
  "spinMaxRps": 18,
  "spinMinRps": 1.2,
  "spinCurve": 1.6,
  "meshMaxRps": 3.5,
  "blur": 1,
  "blurFadeRps": 6,
  "wobbleStart": 0.55,
  "wobbleMaxDeg": 16,
  "precessionHz": 0.9,
  "nutation": 1,
  "tipWander": 1,
  "stabilityWobble": 1,
  "hitTiltDeg": 26,
  "hitTiltFull": 0.3,
  "knockback": 1,
  "recoverySpeed": 3,
  "brokenLeanDeg": 11,
  "brokenStutter": 0.5,
  "spinOutSeconds": 3,

  "aTrail": 0.55,
  "aTrailSeconds": 3.6,
  "aRattle": 0.5,
  "aSeamGap": 1.8,
  "aWear": 1.65,
  "aGrind": 2.35,
  "aSmoke": 2.4,
  "aShudder": 1,
  "aDebris": 2.35,

  "bAuraHeight": 0.4,
  "bAuraIntensity": 0.25,
  "bAuraBreakup": 1.5,
  "bSpinLines": 1.3,
  "bShards": 6,
  "bShardSize": 1,
  "bShardOrbit": 0.9,
  "bDangerShell": 0,
  "bDangerHz": 2.2,
  "bDazed": 1.6,
  "bArcs": 1.85,
  "bGlowDim": 0.8,

  "cRadius": 1.15,
  "cWidth": 0.95,
  "cOpacity": 0.6,
  "cSegments": 10,
  "cWarnAt": 0.35,
  "cCritAt": 0.23,
  "cNotch": 0.85,
  "cCorePulse": 1.25,
  "cHazardSpin": 1.15
}
```
