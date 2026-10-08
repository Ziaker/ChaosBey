# Fluxo do Bey — efeitos contínuos, texto de combate e modo "Bey Real"

**Status:** PROTOTIPADO (3ª rodada), **NÃO APROVADO**. Decidido: o texto no estilo A como opção nas Configurações; ficam o borrão de giro, a inclinação, os riscos de vento e as argolas. A **poeira anime** está em refação com três ideias para o owner escolher. Nada disto está em `src/`.
**Data:** 2026-10-08
**Origem:** pedido do owner com capturas de jogos de Beyblade como referência (estádio amarelo claro, estádio de gelo, Metal Fight e Burst Rivals).
**Lab:** `prototypes/bey-flow-fx-concepts/` (página `/prototypes/bey-flow-fx-concepts/`).

> Este documento registra o **pedido do owner**, o que o lab já mostra e o que continua em aberto. Os valores do lab são **propostas iniciais de Claude**, não valores finais. Quem fecha a decisão é o owner, ajustando no lab ("Copiar valores") e dizendo qual estilo vale.

---

## 1. O que o owner pediu e decidiu

**Pedido original (2026-10-08):**
1. Efeitos visuais de Beyblade vistos nas referências (estádio amarelo claro etc.), com **mais vento** e uma **poeira mais anime e épica**.
2. Texto de combate **HIT / BLOCK / COUNTER**, estilizado, com o estilo definido por protótipos.
3. **Modo de jogo alternativo e selecionável (só de gameplay), junto com uma câmera própria** ("Bey Real", nome provisório): física mais realista, movimento automático com pouca influência do jogador (referência ~30%), o jogador controla só os botões (carregar e soltar, ataque giratório, pulo e esquiva). **Ainda não prototipado nem implementado**; continua ASK FIRST até haver protótipo no Debug Lab.
4. Ordem: efeitos primeiro.

**Feedback da primeira rodada do lab (2026-10-08) — decisões fechadas:**
- **Ficam:** o **borrão de giro**, a **inclinação na curva** e o espaço da **poeira** (mas no estilo anime, ver abaixo).
- **Saem:** a fita de vento, a espiral e o eco fantasma. "Não têm nada a ver com o que almejo."
- **Poeira e faíscas "de verdade" não servem:** a poeira deve ser anime, mais épica, e o jogo deve ter **mais vento**. A linguagem visual é a das folhas de referência do owner (nuvens de desenho brancas de dois tons, faixas de vento curvas com miolo violeta, anéis e coroas de impacto, riscos rasgados) e a do Cel Cyclone já aprovado.
- **Texto de combate: estilo A (Quadrinho) escolhido.** A existência das palavras deve ser **uma opção nas Configurações** (como os demais "game feel": `counterFeedback`, `hitFlash`…). B e C ficam no lab só como histórico.
- **Valores do owner** (copiados do lab) viram a proposta inicial dos efeitos que ficaram: borrão (força 1,35; some em giro 0,2), inclinação (máx. 26°; 13 m/s²; suavização 9) e texto (tamanho 0,55; duração 0,55 s).

**Feedback da segunda rodada do lab (2026-10-08) — decisões fechadas:**
- **Saem as faixas em crescente ("o 5")**: "feitas de um jeito porco e malfeito".
- **Foco só na poeira anime** ("troque a textura, a animação, tudo nela e me dê 3 ideias"), mantendo o resto da cena e dos Beys. Entregue como três ideias comparáveis (seção 2). A escolha entre elas é do owner.
- **Argolas de impacto (Dash):** têm que **nascer do meio do Bey, não de cima**, e **sempre no ângulo para onde o Bey é disparado** (numa diagonal, as argolas nascem na diagonal e vão para trás). Corrigido: o ângulo vem da direção do disparo (o alvo), não da velocidade que o Bey tinha na órbita; e elas nascem na altura do corpo do Bey, sem a regra que as apoiava no chão.
- **Valores do owner** (copiados do lab) passam a ser a proposta inicial também para poeira (17/s, 0,7 m, 0,55 s, reforço 0,6), vento (30/s, 1,1 m, 0,25 m, 0,25 s) e impacto (2 argolas, 5,4 m, explosão 1,3 m).

## 2. O que o lab mostra hoje (terceira rodada)

Movimento **coreografado** (não é o jogo, nada em `src/` o lê): dois Beys que orbitam numa cuba parabólica, carregam e dão Dash um no outro, com colisões que disparam os textos em sequência.

| Efeito | Como é feito |
|---|---|
| Borrão de giro | Casca com bandas concêntricas que some conforme o giro cai |
| Inclinação | O topo pende para dentro da curva, a partir da aceleração lateral |
| Poeira anime (3 ideias) | Ver abaixo. Atrás da ponta, mais no Dash; e nas explosões do Dash e dos golpes |
| Vento: riscos | Riscos rasgados brancos/cinza que acompanham a trajetória (`wakeStreakFx` + `tornStreak` do Cel Cyclone) |
| Argolas e coroas | No Dash: anéis serrilhados (`jaggedRingFx`) nascidos no meio do Bey, de frente para a direção do disparo, correndo para trás. Num golpe: coroa serrilhada no piso e estrela |
| Texto de combate | HIT / BLOCK / COUNTER! no estilo A (quadrinho), projetado da posição do impacto |

**As três ideias de poeira anime** (`fx/AnimeDust.ts`; teclas Q, W, E; cada uma tem textura, forma e animação próprias, e cada uma serve à trilha e às explosões):

| Ideia | Textura e forma | Animação |
|---|---|---|
| 1 · Rolo de poeira | Onda de poeira de desenho (gomos brancos sobre base reta, sombra cinza, contorno de tinta, cauda rasgada com fiapos soltos) | Rente ao chão, esticada pelo caminho; cresce, "ferve" e sobe; nas explosões, ondas que rolam para fora |
| 2 · Bolhas desenhadas | Bolhas de desenho à mão (contorno de tinta, sombra violeta, brilho) em cachos | Inflam com esticar-e-achatar, estouram uma a uma, animadas "de dois em dois" quadros (12 fps) |
| 3 · Lascas em leque | Lâminas brancas curvas, pontudas nas duas pontas, sombra violeta | Lançadas para cima e para trás em leque, caem em arco, quicam no chão; nas explosões, coroa de lascas |

Reaproveita as peças aprovadas de `src/vfx/hybrid/fx` (`FxLayer`, `wakeStreakFx`, `jaggedRingFx`, `flatFx`, `burstFx`, texturas `jaggedRing`/`tornStreak`/`impactStar`); só a poeira é nova (`fx/animeTextures.ts`, `fx/AnimeDust.ts`). O painel "Ajuste fino" expõe todos os valores (`src/tuning.ts`). Atalhos: `1`–`5` efeitos, `Q`/`W`/`E` ideia de poeira, `7`/`8`/`9` estilo do texto, `H`/`J`/`K` disparam HIT/BLOCK/COUNTER, `G` dispara as argolas do Dash na direção do outro Bey, `D` Dashes, `Espaço` pausa, `S` câmera lenta, `R` reinicia, `V` câmera, `P` painel.

## 3. Em aberto (nada disto está decidido)

- **Qual das três ideias de poeira** (ou uma mistura) e os valores finais de poeira, vento e argolas (o owner ajusta no lab). O lab foi verificado em renderização por software (poucos quadros por segundo); a sensação de movimento precisa ser avaliada ao vivo.
- **Quando cada palavra aparece no jogo.** O jogo hoje só tem "COUNTER!" (Circular que pega um Dash). **BLOCK não existe como regra do jogo**: é preciso definir o que conta como bloqueio antes de integrar. HIT e COUNTER têm correspondência direta.
- Se a poeira, o vento e as coroas entram para todos os modos ou só para o "Bey Real"; e a relação com os efeitos do Cel Cyclone já integrados (não duplicar).
- No "Bey Real": o que acontece com drift e momentum (não estavam na lista de botões), o nome do modo, a autoridade de movimento do jogador (referência 30%) e o snap de redirecionamento ao atacar.
- Câmera do modo: alta e fixa (recomendada) ou uma câmera atrás do Bey. Esta última **contradiz a decisão do fix 8** em `camera-approval.md` (a câmera não fica permanentemente atrás do jogador), então só entra se o owner pedir explicitamente.
- Outras ideias vistas nas referências e **não** pedidas, portanto fora do escopo: marcações neon no piso, botões de ação em tela / toque, tema de arena de gelo, pickups de energia.

## 4. Plano de integração (depois da aprovação)

1. **VFX** (só apresentação): portar os efeitos aprovados para `src/vfx/`, lendo eventos e estado do jogo (GDD 158: VFX nunca decide resultado), com respeito ao preset de qualidade / reduzir efeitos. **Texto de combate:** estilo A no HUD, atrás de uma opção nas Configurações (hoje o HUD só tem "COUNTER!", sob `counterFeedback`), depois de definido o que é BLOCK.
2. **Modo "Bey Real" — controle:** um controlador de piloto automático na camada de controladores (mesmo canal da IA: `ControllerActions.moveIntent`), que mistura a intenção automática com o stick do jogador e repassa Ataque, Pulo e Esquiva sem mudança. Opção de pré-jogo, independente do `controlScheme`.
3. **Modo "Bey Real" — física:** `physicsMode` em `MatchConfig` (gravado no replay; replays antigos valem como "arcade"), com sliders no Debug Lab.
4. **Câmera** do modo, depois da decisão acima.

Cada etapa é uma PR própria, com testes determinísticos e de replay onde mexer na simulação.

## 5. Arquivos

| Arquivo | Conteúdo |
|---|---|
| `prototypes/bey-flow-fx-concepts/index.html` | Página, painéis e CSS dos três estilos de texto |
| `src/main.ts` | Ligação da UI, atalhos e painel de ajuste |
| `src/tuning.ts` | Todos os valores, faixas e a proposta inicial |
| `src/sim/FlowSim.ts` | Movimento coreografado (puro, sem Three.js) |
| `src/fx/animeTextures.ts` | Texturas da poeira: rolo, bolha e lasca (formas puras + canvas) |
| `src/fx/AnimeDust.ts` | As três ideias de poeira (rolo, bolhas, lascas) |
| `src/fx/AnimeWind.ts` | Riscos de vento, argolas e coroas de impacto; entrega a poeira ao `AnimeDust` |
| `src/stage/FlowRig.ts` | Um Bey + borrão e inclinação |
| `src/stage/FlowStage.ts` | Cena, câmera, estádio, `FxLayer` do jogo e ligação dos eventos |
| `src/ui/callouts.ts` | Os três estilos de texto e a camada de textos |
| `tests/unit/beyFlowFxLab.test.ts` | Verificações do lab (não são testes de gameplay) |
