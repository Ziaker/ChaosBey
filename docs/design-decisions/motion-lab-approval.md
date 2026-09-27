# Decisões de movimento aprovadas: Bey Motion Lab

**Status:** APROVADO pelo dono do projeto como **base** da linguagem de movimento. **Não integrar ao jogo sem as etapas da seção 7.**
**Data:** 2026-09-27
**Origem:** protótipo `prototypes/bey-motion-concepts/` (Bey Motion Lab, abas "Motion physics" e "Spin readability"), branch `claude/bey-motion-lab`.
**Base no GDD:** comportamento físico dos Beys (tilt, wobble, impulso angular, bounce, recuperação, grip, restituição) e a exigência de aprovação visual antes de finalizar movimento procedural significativo.

Este documento registra **o que já foi decidido** sobre como um ChaosBey se move, para que nenhum agente reabra essas perguntas. Ele também separa **o que continua em aberto** (seção 6). Nada aqui autoriza mudar física, movimento, knockback, colisores ou balanceamento do jogo principal sem as etapas da seção 7.

---

## 1. Objetivo (APROVADO)

O Bey deve ler como um **objeto mecânico giratório**, nunca como um disco rígido deslizando pelo chão. Para isso, o movimento combina:

- **heading ≠ velocity:** a direção para onde o Bey "aponta" pode diferir da direção para onde ele vai;
- **slip:** a ponta perde aderência lateral acima de um limiar e depois de impactos, e recupera aos poucos;
- **tilt / lean:** o Bey se inclina para dentro da aceleração e com a velocidade;
- **wobble:** oscilação visual limitada, com energia vinda dos impactos;
- **resposta tipo precessão:** um empurrão na inclinação vira um movimento circular, acoplado ao giro;
- **recuperação gradual:** o Bey volta ao prumo por uma mola amortecida, que só retoma a força total um tempo depois do impacto;
- **impactos com resposta angular:** transferência de velocidade linear para rotação do corpo (whirl) e para o giro;
- **tumble / rodopio:** acima de um limiar de impacto, inclinação grande e whirl forte, amortecidos;
- **floor bounce, wall bounce, ricochete e wall scrape;**
- **limites de estabilidade:** velocidade linear e angular com teto, para nunca virar instabilidade numérica.

## 2. Direção base: B — Physical Hybrid (APROVADA)

Das três direções do lab, a base aprovada é a **B — Physical Hybrid**:

- **Peso e inércia perceptíveis.**
- **Slip e tilt expressivos.**
- **Impactos transferem inclinação e giro.**
- **Recuperação física, porém controlada.**

Ela parte dos **valores de movimento atuais do jogo**: aceleração 14, velocidade máxima 11 m/s, giro de direção 2,6 rad/s, grip lateral 5,5, grip no ar 0,4, wobble de 6° a 7 Hz. Por isso é a evolução mais direta do que o jogo já faz.

As outras duas continuam como **referências de limite** para o ajuste fino:

| Preset | Papel depois da aprovação |
|---|---|
| **A — Stable Arcade** | Limite inferior: firme, legível, pouco tilt, wobble e tumble, recuperação rápida. |
| **B — Physical Hybrid** | **Base aprovada.** |
| **C — Wild Mechanical** | Limite superior: reações angulares fortes, tumble e ricochetes dramáticos. |

Os nomes A/B/C são **identificadores do protótipo**, não modos de jogo.

### 2.1 Valores da base B (ponto de partida, NÃO balanceamento final)

Estes são os valores do preset B em `prototypes/bey-motion-concepts/src/physics/params.ts`. Eles valem para o **modelo do lab**, não para o jogo. Na integração eles são o ponto de partida e serão reajustados dentro do motor real (Rapier), sempre comparando com o lab.

| Grupo | Parâmetro | Valor B | Unidade |
|---|---|---:|---|
| Drive | Aceleração | 14 | m/s² |
| Drive | Velocidade máxima | 11 | m/s |
| Drive | Taxa de giro de direção | 2,6 | rad/s |
| Grip / slip | Grip lateral | 5,5 | 1/s |
| Grip / slip | Grip longitudinal (arrasto rolando) | 0,6 | 1/s |
| Grip / slip | Limiar de slip | 2,5 | m/s de velocidade lateral |
| Grip / slip | Grip durante o slip | 0,35 | × |
| Grip / slip | Recuperação de grip | 3 | 1/s |
| Grip / slip | Grip no ar | 0,4 | 1/s |
| Tilt / lean | Inclinação para dentro da aceleração | 0,022 | rad por m/s² |
| Tilt / lean | Inclinação pela velocidade | 0,006 | rad por m/s |
| Tilt / lean | Tilt máximo normal | 35 | ° |
| Wobble | Amplitude | 6 | ° |
| Wobble | Frequência | 7 | Hz |
| Wobble | Energia por impacto | 0,12 | por m/s |
| Wobble | Decaimento | 1,2 | 1/s |
| Wobble | Resposta tipo precessão | 4 | — |
| Recuperação | Força de endireitar | 60 | 1/s² |
| Recuperação | Amortecimento | 7 | 1/s |
| Recuperação | Tempo de recuperação pós-impacto | 0,6 | s |
| Impactos | Restituição Bey-Bey | 0,55 | — |
| Impactos | Bounce no chão | 0,35 | — |
| Impactos | Bounce na parede | 0,5 | — |
| Impactos | Atrito / raspagem na parede | 1,2 | 1/s |
| Impactos | Impulso angular por impacto | 0,12 | rad/s por m/s |
| Impactos | Transferência linear → angular | 0,5 | — |
| Impactos | Força do knockback | 1 | × |
| Impactos | Elevação do knockback | 0,18 | fração |
| Impactos | Tumble por knockback | 0,6 | rad/s por m/s |
| Impactos | Limiar de tumble | 9 | m/s |
| Impactos | Amortecimento angular | 1,6 | 1/s |
| Limites | Velocidade linear máxima | 26 | m/s |
| Limites | Velocidade angular máxima | 30 | rad/s |

Qualquer ajuste feito no lab antes da integração deve ser registrado aqui com o JSON do botão **Copy JSON** (`{ preset, modified, params }`), trocando esta tabela.

### 2.2 Como a B se compara (medido no lab)

| Cenário | A | **B** | C |
|---|---|---|---|
| Drift: tempo com grip quebrado | 0 s | **1,2 s** | 2,7 s |
| Tumble (golpe de raspão forte): whirl máximo | 0,3 rad/s | **1,9 rad/s** | 12,5 rad/s |
| Impacto frontal na parede: tilt máximo | 10° | **13°** | 57° |
| Análogo do M7 ext-0 (lançamento de ~28 m/s) | não sai, mal sai do chão | **não sai: sobe 1,3 m e bate na parede de 2 m** | sai da arena em 0,5 s |

## 3. Regras que toda implementação deve respeitar (APROVADAS)

1. **Heading e velocity são grandezas separadas.** O impulso vai na direção do heading; o grip lateral é que aproxima a velocidade do heading.
2. **O slip é um estado.** Ele liga acima do limiar e desliga só bem abaixo dele (histerese), e o grip volta aos poucos.
3. **A inclinação é um vetor 2D** (direção + ângulo), movido por uma mola amortecida em direção a um alvo (aceleração + velocidade), com acoplamento tipo precessão escalado pelo giro.
4. **A recuperação é gradual.** Depois de um impacto a força de endireitar começa reduzida e volta ao valor total ao longo do tempo de recuperação.
5. **Todo impacto** (parede, chão, Bey-Bey, knockback) aplica o mesmo pacote:
   - chute na inclinação;
   - energia de wobble;
   - queda de grip;
   - transferência linear → angular.
   Acima do limiar, aplica também tumble.
6. **Acima da altura da parede, o Bey passa por cima.** Ele nunca quica numa parede que está abaixo dele. O ring-out acontece quando sai inteiro da arena.
7. **Wobble continua visual e limitado.** Ele não realimenta a física, como no jogo atual.
8. **Limites de estabilidade são obrigatórios.** São tetos numéricos, não gameplay.
9. **Determinismo.** Mesmos parâmetros e mesmas entradas produzem o mesmo resultado.

## 4. Câmera (fora deste documento)

A câmera **não** foi decidida aqui. No lab, "Combat" apenas reproduz a câmera atual do jogo como referência.

A sequência aprovada é: **Motion Lab → aprovação (este documento) → Camera Lab separado → aprovação → integração dos dois.** O Camera Lab usa o movimento aprovado aqui como referência.

## 5. Achados do M7 registrados (NÃO corrigidos no jogo ainda)

Os dois casos foram exportados da simulação real do jogo e ficam no lab como replays (`prototypes/bey-motion-concepts/src/replays/`):

| Caso | O que o jogo faz hoje | Situação |
|---|---|---|
| **ext-0** (attack vs attack) | O counter lança o Bey a ~28 m/s com 7,4 m/s para cima. Ele passa por cima da parede de 2 m e sai em 1,77 s. | Com a base B, o mesmo lançamento **não** sai da arena (sobe 1,3 m e bate na parede). Deve ser revisto na integração. |
| **ext-32** (attack vs defense) | O Bey Attack fica **preso no colisor da borda**, além do raio do chão (r ≈ 12,1 m), por 23,5 s. | Problema de colisão, não de linguagem de movimento. Corrigir na integração da física. O M7 citou o Defense; com a convenção de seed do exportador, é o Attack. |

## 6. Continua em ABERTO (não decidir sem o dono)

- [ ] **Ajuste fino da base B:** qualquer valor da tabela 2.1 pode mudar depois de testar no lab. Registrar com Copy JSON.
- [ ] **Tumble da B:** hoje é contido (whirl máximo 1,9 rad/s). Decidir se golpes fortes devem rodopiar mais, puxando para C nesse grupo.
- [ ] **Lançamentos acima da parede:** decidir se um counter muito forte pode causar ring-out por cima da parede (o jogo hoje permite; a base B não).
- [ ] **Leitura do giro (aba Spin readability):** a 22 rad/s e 60 fps, os três Defense e o Stamina B não deixam claro o sentido de giro. Opções em aberto:
  - outra velocidade de giro, por Bey ou ligada à Stamina;
  - spin blur;
  - acento assimétrico no Ring;
  - menos features, e maiores.
- [ ] **Estilo do wobble:** balanço num eixo (jogo atual) ou precessão.
- [ ] **Diferenças por arquétipo:** se Attack, Defense e Stamina terão variações da base (ex.: Defense com mais grip, Stamina com mais precessão).

## 7. Como integrar (só quando o dono pedir)

1. Reproduzir as regras da seção 3 na física do jogo (Rapier + controladores), usando a base B como ponto de partida.
2. Validar contra o lab: os mesmos cenários devem ter o mesmo caráter (drift, parede, ricochete, knockback, tumble, bounce, recuperação).
3. Corrigir o wedge na borda (ext-32) e rever o caso ext-0.
4. Rever a percepção de borda e a recuperação da IA (M7), que foi calibrada com o movimento atual. Rodar os batches de IA vs IA.
5. Adicionar testes de regressão para o comportamento aprovado.
6. Tudo em um PR próprio, com aprovação antes do merge.

## 8. Onde ver

- Lab publicado: https://claude.ai/artifact/RudDVud88A2Q1HZCmJ3W6d
- Código: `prototypes/bey-motion-concepts/` (ver o `README.md` da pasta).
- Rodar localmente: `npm run dev` e abrir `/prototypes/bey-motion-concepts/`.
- Testes do modelo: `tests/unit/BeyMotionLabModel.test.ts`.
- Smoke: `tests/smoke/beyMotionConcepts.spec.ts`.
- Atualizar os replays do jogo: `npx vitest run --config prototypes/bey-motion-concepts/scripts/vitest.export.config.ts`.
