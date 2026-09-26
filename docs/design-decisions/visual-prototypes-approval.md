# Decisões visuais aprovadas: Beys e Arena

**Status:** APROVADO pelo dono do projeto. **Implementar só depois que o jogo estiver estável.**
**Data:** 2026-09-26
**Origem:** protótipos visuais `prototypes/bey-visual-concepts/` (rodada 2) e `prototypes/arena-visual-concepts/`.
**Base no GDD:** seções 1.6 (aprovação visual), 33 e 96–97 (modelos dos Beys), 35–36 (arena) e 98 (perguntas de arena).

Este documento registra **o que já foi decidido**, para que nenhum agente reabra essas perguntas (GDD 170). Ele também separa claramente **o que continua em aberto** (seção 4). Nada aqui autoriza mudar gameplay, física, colisores ou balanceamento sem as etapas da seção 5.

---

## 1. Beys: anatomia de 4 peças (APROVADA)

Todo ChaosBey é construído com **4 peças**, de cima para baixo:

| # | Peça | Função | Referência de categoria (Beyblade) |
|---|---|---|---|
| 1 | **Top Layer** | Centro elevado com emblema, encaixado no Ring | Face Bolt + Energy Ring (Metal Fight) / Chip (Burst) |
| 2 | **Ring** | Peça mais larga: impacto, identidade e silhueta | Fusion/Metal Wheel (Metal Fight) / Layer (Burst) |
| 3 | **Disc** | Disco de peso, **menor que o Ring** e visível abaixo dele | Spin Track (Metal Fight) / Forge Disc (Burst) |
| 4 | **Driver** | Carcaça + ponta longa e visível | Performance Tip (Metal Fight) / Driver (Burst) / Bit (X) |

Os nomes da coluna "Referência" servem só como categoria. Nenhum nome, emblema ou silhueta de produto real deve ser copiado (GDD 134).

### Regras que toda implementação deve respeitar
1. **Tamanhos:** Ring > Disc > topo do Driver. O Disc deve ficar visivelmente menor que o Ring (no protótipo, ≤ 90% do diâmetro).
2. **Disc com lateral real:** altura suficiente para aparecer de lado e na diagonal (no protótipo, ≥ 0,3 unidade num Bey de Ø ~6).
3. **Top Layer:** menor que o Ring (< 70% do diâmetro), encaixado no centro do Ring, como a torre do conceito Defense C.
4. **Encaixes visíveis:** um sulco escuro rebaixado nas junções Ring/Disc e Disc/Driver.
5. **Driver:** carcaça que converge para a ponta, com a ponta claramente visível de lado e na diagonal (no protótipo, a ponta tem ≥ 25% da altura total).
6. **Materiais por peça:** plástico pintado + metal + material escuro + uma peça translúcida + um detalhe emissivo pequeno e de baixa intensidade. Nada de cor única chapada.
7. **Modelo visual separado do colisor** (GDD 104): o mesh das 4 peças não define a colisão.
8. **Spin visual** (GDD 83): as 4 peças giram juntas no grupo de spin visual. Inclinação e wobble afetam o conjunto inteiro.

### Os 9 conceitos da rodada 2 (catálogo aprovado)
Estes são os conceitos disponíveis para a escolha final. Os códigos são provisórios e **não são nomes**. Definição completa em `prototypes/bey-visual-concepts/src/concepts/conceptDefinitions.ts`.

| Código | Top Layer | Ring | Disc | Driver |
|---|---|---|---|---|
| Attack A | Coroa com gema e parafusos | 4 lobos de impacto com faces de metal | Disco metálico com 4 entalhes | Carcaça afunilada + ponta de borracha chata |
| Attack B | Hub facetado com chevron | 3 lâminas assimétricas inclinadas | Disco dentado + camada translúcida | Carcaça facetada + ponta hexagonal |
| Attack C | Domo pesado aparafusado | 2 blocos-martelo | Tambor metálico de 10 painéis | Carcaça tambor + domo de borracha |
| Defense A | Domo de aço com lente | 8 placas sobrepostas | Disco de aço de 2 camadas | Tigela + esfera protegida |
| Defense B | Hub hexagonal com pistões | 6 pods com braços de mola | Disco com "pneu" de borracha | Saia com amortecedores + ponta em coroa |
| Defense C | Torre octogonal de 3 níveis | 8 ameias com faces de metal | Disco octogonal com contrafortes | Carcaça escalonada + ponta segmentada |
| Stamina A | Tampa pequena | Aro de volante, 5 raios curvos, 5 pesos | Disco vazado com esferas | Carcaça fina + ponta agulha |
| Stamina B | Lente de precisão | 3 anéis concêntricos | Disco de precisão em 3 degraus | Gaiola aberta + ponta com rolamento |
| Stamina C | Agulha alta em gota | Anel tri-lobado com 3 pesos | Disco em forma de lente | Carenagem com aletas + ponta ogival |

A rodada 1 continua arquivada em `prototypes/bey-visual-concepts-round1/`, só como referência. Ela **não** é a direção aprovada.

---

## 2. Arena: profundidade e perfil (APROVADOS)

### 2.1 Profundidade do bowl: **3,2 m** em todas as arenas
- **3,2 m** é a altura da borda (rim) acima do centro da arena, com raio de 12 m. A inclinação média fica em torno de 15°.
- Vale para **todas** as direções de arena.
- O chão **afunila para o centro** (côncavo), como previsto no GDD 35 ("floor can be concave; central region can be lower; slope affects movement").

### 2.2 Perfis de chão (um por direção)
| Direção | Perfil | Fórmula no protótipo (r em m, R = 12) |
|---|---|---|
| A — Foundry Pit | Prato parabólico: centro suave, inclinação crescente até a parede | `h(r) = 3.2 · (r/R)²` |
| B — Rift Crater | Funil: inclina quase até o centro | `h(r) = 3.2 · (r/R)^1.3` |
| C — Tournament Stadium | Platô central plano de 2,6 m e depois curva | `h(r) = 0` se r ≤ 2.6; senão `3.2 · ((r−2.6)/(R−2.6))^1.4` |

### 2.3 Dimensões mantidas
- Raio do chão: **12 m** (`src/arena/colliders/ArenaTuning.ts`).
- Parede: cerca de **2 m acima da borda**. Como a borda agora fica 3,2 m acima do centro, a parede precisa ser medida a partir do rim, não do centro.
- Beys na escala do jogo: cerca de 1,3 m de diâmetro.

---

## 3. Arena: as 3 direções visuais (APROVADAS como válidas)

As três foram aprovadas. Detalhes e parâmetros estão em `prototypes/arena-visual-concepts/src/arenas/*.ts`, com o tuning no topo de cada arquivo.

| | A — Foundry Pit | B — Rift Crater | C — Tournament Stadium |
|---|---|---|---|
| **Arquitetura** | Fosso industrial: painéis de aço, treliça circular, passarela | Cratera natural, fragmentos de rocha flutuando | Estádio indoor de e-sports, arquibancada e rig de luz |
| **Chão** | Placas de aço escovado, soldas, rebites, faixa de perigo antes da parede | Basalto escuro com fissuras violeta brilhantes a partir de um anel central | Polímero claro fosco, círculo central, metades dos jogadores levemente tingidas, faixa vermelha na borda |
| **Borda** | 16 painéis de aço rebitados, trilho com faixas de perigo | Borda de rochas + barreira de energia translúcida animada | Parede de policarbonato transparente, 24 postes metálicos, trilho de LED |
| **Iluminação** | 4 luminárias quentes no alto, fill frio fraco, névoa | Luar frio + brilho violeta das fissuras | Rig com 8 spots neutros e fortes, fill uniforme |
| **Fundo** | Galpão quase preto sumindo na névoa | Céu noturno índigo, estrelas, fragmentos à deriva | Arquibancada com público, teto escuro |
| **Impacto** | Faíscas laranja-amarelas | Faíscas violeta-ciano | Faíscas branco-amarelas |
| **Clash** | Luminárias ficam brancas, faixas de perigo brilham | Fissuras e barreira viram magenta | LED pisca nas cores dos 2 jogadores, flashes na plateia |

**Regras gerais aprovadas:**
- As faíscas usam as cores da arena e aparecem como pontos redondos de brilho.
- Cada arena tem uma reação de luz própria no Clash (GDD 35: "Clash can affect arena lighting").
- Um clarão de luz curto no ponto de impacto contra a parede.

---

## 3b. VFX de combate: direção HÍBRIDA (APROVADA em princípio)

**Origem:** `prototypes/vfx-visual-concepts/`. O dono gostou das duas linguagens (A Mecânica e B Anime) e pediu para misturá-las. A mistura é a linguagem **C — Híbrida** (`src/languages/hybrid.ts`).

| Momento | Fonte |
|---|---|
| Faíscas, estilhaços e poeira no **contato** (golpes, parede, desgaste) | **A — Mecânica** |
| Faíscas e marcas de derrapagem em **alta velocidade** | **A — Mecânica** |
| Efeito de golpe: estrelas de impacto, ondas de choque, linhas de faísca, linhas de foco | **B — Anime** |
| Dash (aura carregando, soltura, rastro), speed lines, Circular, Perfect Dodge, quebra de Stability, aterrissagem, ring-out | **B — Anime** |
| **Frame de impacto** (flash negativo) | Só em ataque **HIGH/pesado** (magnitude ≥ 0,9) |
| **Burst de vento (NOVO):** funil espetado e girando, como um mini-furacão de anime, atrás do Bey | Todo avanço brusco: **soltura do Dash** e **acionamento do dodge** |

Regras: todo efeito escala com a magnitude real do evento (GDD 51); VFX observa eventos e não decide resultados (GDD 158); tuning no topo dos arquivos.

**Burst de vento: APROVADO o estilo 3, Cel Cyclone** (`makeHybrid('cel')` em `prototypes/vfx-visual-concepts/src/languages/hybrid.ts`), com os ajustes do dono:
- **Argolas mantidas:** 2 anéis verticais com borda serrilhada, em cel sólido, apoiados no chão e surgindo em sequência. São **~15% maiores** que no protótipo inicial (`CEL_RING_SCALE`).
- **Linhas com menos intensidade:** menos faixas de rastro (60%), mais finas (80%) e mais suaves (opacidade 0,7), e a espiral mais leve (3 linhas, opacidade 0,6).
- **O resto como estava:** rastro rasgado preso ao caminho real do avanço, nuvens de poeira de desenho em 3 tons de cinza e estilhaços escuros. O branco e o cinza dominam, e a cor do Bey só aparece em traços finos.
- **Quando aparece:** na soltura do Dash e no acionamento do dodge. Tudo escala com a magnitude.

As outras opções (1 Sonic Boom, 2 Comet Wake e o funil v1) ficam no laboratório só como referência.

## 4. Continua em ABERTO (não decidir sem o dono)

1. **Quais 3 Beys finais**, um por arquétipo, entre os 9 conceitos. Também em aberto: se a versão final mistura peças de conceitos diferentes, o que o sistema de remix permite.
2. **Nomes finais** dos Beys (GDD 32, 171.1).
3. **Arena inicial:** o GDD 35 prevê *uma* arena inicial, e o GDD 36 diz para não criar vários temas polidos antes de ser pedido. Falta decidir entre:
   - (a) escolher **uma** das 3 direções como arena inicial, ou
   - (b) implementar as 3 como **presets visuais** selecionáveis no pré-jogo.
4. **Efeito da inclinação no gameplay:** quanto a gravidade no bowl puxa os Beys para o centro. Isso afeta aceleração, drift, ring-out e IA, e precisa de playtest e aprovação (GDD 167).
5. **Ring-out com bowl côncavo:** onde fica o volume de ring-out e se a parede passa a ter aberturas. O protótipo não mudou nenhuma regra.
6. **Paletas finais:** as cores dos protótipos são temporárias por arquétipo.

---

## 5. Como implementar (quando o jogo estiver estável)

Ordem sugerida. Cada etapa deve seguir o fluxo de conclusão do GDD 1.5 (typecheck, testes, build, self-test, console).

### 5.1 Arena côncava (física primeiro)
1. Trocar o chão plano por um **colisor côncavo** (heightfield ou trimesh do Rapier) gerado pelo mesmo perfil `h(r)` do visual. O perfil deve ter **uma única fonte de verdade** em `src/arena/`, com o tuning comentado no topo do arquivo (GDD 1.3 e 101).
2. Recalcular parede, altura da parede e volume de ring-out a partir do **rim** (y = 3,2 m), não de y = 0.
3. Revisar o spawn e o lançamento dos Beys, a câmera (enquadramento com o centro mais baixo) e a percepção da IA (bordas mais altas, rampas).
4. Rodar os self-tests de física do GDD 150 (aceleração, curva, parede, drift, wobble), adicionando cenários de rampa. Rodar batches de IA contra IA.
5. Expor no Debug Lab: a altura do chão sob o Bey, a normal do chão e a força de inclinação.

### 5.2 Visual da arena
6. Portar a direção escolhida (item 4.3) de `prototypes/arena-visual-concepts/src/arenas/` para `src/arena/` (visual) e `src/vfx/` (faíscas, clarão, reação ao Clash).
7. As luzes de Clash devem reagir ao **estado real** de Clash do jogo. O VFX observa eventos e não decide resultados (GDD 158).
8. Criar variantes de qualidade Low/Medium/High (GDD 55 e 89): sombras, quantidade de partículas, público instanciado.

### 5.3 Beys de 4 peças
9. Evoluir `src/bey/procedural-model/createBeyMesh.ts`, hoje com ring / upperBody / lowerBody / tip, para **Top Layer / Ring / Disc / Driver**, reaproveitando os builders de `prototypes/bey-visual-concepts/src/parts/`.
10. Ligar cada arquétipo em `src/bey/archetype/BeyArchetypes.ts` ao conceito escolhido (item 4.1), sem mudar colisor, massa ou stats. Qualquer mudança nisso é uma decisão separada.
11. Manter o âncora da ponta no fundo do colisor de cada Bey (regra que já existe em `createBeyMesh.ts`).

---

## 6. Onde ver

- **Protótipos no navegador (claude.ai Artifacts):**
  - Bey Concept Lab: https://claude.ai/artifact/LfWAbZkFMCQ3H4BeEoQMEZ
  - Arena Concept Lab: https://claude.ai/artifact/1V2P9MeEbJYGBJLVThYFQA
- **No repositório:** `prototypes/bey-visual-concepts/`, `prototypes/arena-visual-concepts/` e `prototypes/bey-visual-concepts-round1/` (arquivo).
- **Regenerar os links:** `node prototypes/tools/build-artifact.mjs <pasta-do-protótipo> <saida.html>`.
