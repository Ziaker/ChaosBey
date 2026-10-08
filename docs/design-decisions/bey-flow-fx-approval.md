# Fluxo do Bey — efeitos contínuos, texto de combate e modo "Bey Real"

**Status:** PROTOTIPADO (2ª rodada), **NÃO APROVADO**. Decidido: o texto no estilo A como opção nas Configurações; ficam o borrão de giro e a inclinação. Os valores de poeira e vento ainda são propostas. Nada disto está em `src/`.
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

## 2. O que o lab mostra hoje (segunda rodada)

Movimento **coreografado** (não é o jogo, nada em `src/` o lê): dois Beys que orbitam numa cuba parabólica, carregam e dão Dash um no outro, com colisões que disparam os textos em sequência.

| Efeito | Como é feito |
|---|---|
| Borrão de giro | Casca com bandas concêntricas que some conforme o giro cai |
| Inclinação | O topo pende para dentro da curva, a partir da aceleração lateral |
| Poeira anime | Nuvens de desenho (branco + sombra cinza, contorno fino de tinta, base reta) que rolam atrás da ponta; mais no Dash |
| Vento: riscos | Riscos rasgados brancos/cinza que acompanham a trajetória (`wakeStreakFx` + `tornStreak` do Cel Cyclone) |
| Vento: faixas | Crescentes cel (branco, sombra violeta, contorno) que giram em volta do Bey e somem com a velocidade/giro baixos |
| Coroas de impacto | No Dash: anéis serrilhados atrás do Bey (`jaggedRingFx`) e nuvens. Num golpe: coroa serrilhada no piso, explosão de nuvens e estrela |
| Texto de combate | HIT / BLOCK / COUNTER! no estilo A (quadrinho), projetado da posição do impacto |

Reaproveita as peças aprovadas de `src/vfx/hybrid/fx` (`FxLayer`, `spriteFx`, `wakeStreakFx`, `jaggedRingFx`, `flatFx`, `burstFx`, texturas `jaggedRing`/`tornStreak`/`impactStar`); só a nuvem branca e o crescente são novos (`fx/animeTextures.ts`). O painel "Ajuste fino" expõe todos os valores (`src/tuning.ts`). Atalhos: `1`–`6` efeitos, `7`/`8`/`9` estilo do texto, `H`/`J`/`K` disparam HIT/BLOCK/COUNTER, `D` Dashes, `Espaço` pausa, `S` câmera lenta, `R` reinicia, `V` câmera, `P` painel.

## 3. Em aberto (nada disto está decidido)

- **Valores finais** de poeira, vento, faixas e coroas (o owner ajusta no lab). O lab foi verificado em renderização por software (poucos quadros por segundo); a sensação de movimento precisa ser avaliada ao vivo.
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
| `src/fx/animeTextures.ts` | Nuvem branca de desenho e crescente de vento (formas puras + canvas) |
| `src/fx/AnimeWind.ts` | Poeira anime, riscos de vento, anéis e coroas de impacto |
| `src/stage/FlowRig.ts` | Um Bey + borrão, inclinação e faixas de vento que andam com ele |
| `src/stage/FlowStage.ts` | Cena, câmera, estádio, `FxLayer` do jogo e ligação dos eventos |
| `src/ui/callouts.ts` | Os três estilos de texto e a camada de textos |
| `tests/unit/beyFlowFxLab.test.ts` | Verificações do lab (não são testes de gameplay) |
