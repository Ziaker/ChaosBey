# Fluxo do Bey — efeitos contínuos, texto de combate e modo "Bey Real"

**Status:** PROTOTIPADO (5ª rodada), **NÃO APROVADO**. Decidido: o texto no estilo A como opção nas Configurações; ficam o borrão de giro, a inclinação, os riscos de vento e as argolas. A **poeira anime** foi refeita na 5ª rodada como **volume 3D de verdade** (as rodadas 2–4 eram imagens planas, rejeitadas como "papel") e espera o julgamento do owner. Nada disto está em `src/`.
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

**Feedback da terceira rodada do lab (2026-10-08) — decisões fechadas:**
- **As três ideias de poeira (rolo, bolhas, lascas) foram rejeitadas:** "TODAS péssimas, nem parecem que estão no jogo, parecem enfiadas por cima, e as imagens de exemplo vc nem levou em conta".
- Causas reconhecidas: (1) as formas eram invenção minha (círculos agrupados com contorno azul-escuro, bolhas, pétalas), e não a linguagem das folhas (silhuetas brancas lisas, **sem contorno**, gomos recortados de tamanhos muito diferentes, línguas recortadas, caudas varridas, coroa de espinhos); (2) os efeitos eram adesivos opacos que apareciam e sumiam sobre um chão bege inventado, fora da cena do jogo.
- **Correção (4ª rodada, depois substituída pela 5ª):** a poeira era desenhada a partir dessa linguagem como recortes planos que dissolviam por erosão e o lab roda na **cena do jogo** (arena real, chão em funil de 7 m, neblina, câmera de jogo). Mantidos sem mudança: borrão de giro, inclinação, riscos de vento, argolas do Dash.

**Feedback da quarta rodada do lab (2026-10-08) — decisões fechadas:**
- A **coroa com onda (Q)** é aceitável, mas a poeira também tem que seguir a **orientação do Bey**, como as argolas e coroas de impacto.
- **Voltam as argolas/coroas no contato dos Dashes** ("eu não pedi pra tirar"): eu as havia removido ao reescrever o impacto. Restauradas: argolas serrilhadas nascidas no meio do contato, de frente para a direção do ataque e correndo para trás, as duas coroas no chão e a estrela chata.
- **As nuvens ainda eram "papel"**: imagens por cima do jogo. Têm que ter **profundidade e volume dentro do jogo, como os Beys**. Resposta: a poeira passou a ser geometria (5ª rodada, seção 2).
- **Sombra pequena sob os Beys:** só um círculo preto, que não prejudique o desempenho.
- **Configurações de opacidade da nuvem** e um **slider de opacidade ao longo da vida** ("reduzindo até zero o quão rápido a nuvem fica transparente").

## 2. O que o lab mostra hoje (quinta rodada)

Movimento **coreografado** (não é o jogo, nada em `src/` o lê): dois Beys que orbitam numa cuba parabólica, carregam e dão Dash um no outro, com colisões que disparam os textos em sequência.

| Efeito | Como é feito |
|---|---|
| Borrão de giro | Casca com bandas concêntricas que some conforme o giro cai |
| Inclinação | O topo pende para dentro da curva, a partir da aceleração lateral |
| Poeira anime (3 ideias) | Volume 3D, ver abaixo. Atrás da ponta (na direção do Bey), mais no Dash; e nas explosões do Dash e dos golpes |
| Vento: riscos | Riscos rasgados brancos/cinza que acompanham a trajetória (`wakeStreakFx` + `tornStreak` do Cel Cyclone) |
| Argolas e coroas | No Dash: anéis serrilhados (`jaggedRingFx`) nascidos no meio do Bey, de frente para a direção do disparo, correndo para trás. No contato de um golpe: os mesmos anéis (de frente para a direção do ataque), duas coroas serrilhadas no piso e a estrela chata |
| Sombra | Disco preto pequeno e achatado sob a ponta (um desenho só, sem shadow map), com opacidade e tamanho ajustáveis (tecla `6`) |
| Texto de combate | HIT / BLOCK / COUNTER! no estilo A (quadrinho), projetado da posição do impacto |

**A poeira anime** (`fx/dustVolume.ts`, `fx/AnimeDust.ts`): é **geometria dentro da cena**, não imagem. Cada nuvem é um monte de esferas e elipsoides alongados (as correntes de bolhas da terceira folha), em **tom de desenho de três degraus** (`MeshToonMaterial` com `gradientMap`), desenhada num único `InstancedMesh` (uma chamada de desenho). Recebe a luz e a neblina da arena, **entra no teste de profundidade**: o Bey passa na frente de uma nuvem e atrás de outra, e a nuvem afunda no chão. A opacidade é por nuvem, em alpha picotado (`alphaHash`, com escrita de profundidade), então centenas de blocos sobrepostos continuam ordenados. Morre **encolhendo**: os blocos pequenos e as agulhas somem primeiro, como nas folhas. Uma só linguagem, três composições (teclas Q, W, E), todas servindo à trilha atrás da ponta e às explosões do Dash e dos golpes:

| Composição | Trilha | Dash e golpe |
|---|---|---|
| Q · Onda com cauda | Ondas de blocos rentes ao chão, com caudas varridas, escorrem atrás do Bey | Ondas rolam para fora (para trás no Dash) |
| W · Coroa de respingo | Pequenas coroas de espinhos deitadas no chão atrás da ponta, na inclinação do funil | Três coroas deitadas empilhadas |
| E · Nuvem de explosão | Montes de nuvem atrás do Bey | Monte de explosão com agulhas |

**Direção:** tudo segue a orientação do Bey (`headX/headZ` na coreografia: a direção do Dash enquanto ele dispara; senão a da velocidade), igual às argolas; a explosão de um golpe sai ao longo da direção do ataque. Explosões que apontam para a câmera encolhem, para a poeira nunca esconder a luta.

**Sliders (painel "Ajuste fino", grupo Poeira anime):** *Opacidade da nuvem* (0,1–1); *Opacidade ao longo da vida* (0 = só some no fim … 1 = começa a sumir desde o início; sempre chega a zero no fim da vida); *Quanto os blocos encolhem* (0–1); mais taxa, tamanho, vida e reforço no Dash. Grupo *Sombra no chão*: opacidade e tamanho. Os tamanhos de poeira baixaram (0,7 → 0,55 m; explosão 1,3 → 1,0 m) porque um monte em volume ocupa mais que a imagem plana.

**A cena** é a do jogo: a arte aprovada das arenas (`arenaArtFor`, teclas Z/X/C: Foundry Pit, Rift Crater, Tournament Stadium) no chão em funil de 7 m do jogo (`src/arena/floor`), com a neblina e o tone mapping dela. Câmeras (V): "do jogo" (baixa e próxima, como a Arena Fighter, mantendo os dois Beys no quadro), alta e fixa, livre.

Reaproveita as peças aprovadas de `src/vfx/hybrid/fx` (`FxLayer`, `wakeStreakFx`, `jaggedRingFx`, `flatFx`, `burstFx`, texturas `jaggedRing`/`tornStreak`/`impactStar`); só a poeira é nova (`fx/dustVolume.ts`, `fx/AnimeDust.ts`). O painel "Ajuste fino" expõe todos os valores (`src/tuning.ts`). Atalhos: `1`–`6` efeitos, `Q`/`W`/`E` composição da poeira, `Z`/`X`/`C` arena, `7`/`8`/`9` estilo do texto, `H`/`J`/`K` disparam HIT/BLOCK/COUNTER, `G` dispara as argolas do Dash na direção do outro Bey, `D` Dashes, `Espaço` pausa, `S` câmera lenta, `R` reinicia, `V` câmera (jogo, alta, livre), `P` painel.

## 3. Em aberto (nada disto está decidido)

- **Se a poeira em volume da 5ª rodada acerta** (qual composição Q/W/E, ou uma mistura) e os valores finais de poeira, sombra, vento e argolas. O alpha picotado do `alphaHash` pode mostrar granulado nas bordas que somem; se incomodar, trocamos por outra técnica de transparência. O lab foi verificado em renderização por software (poucos quadros por segundo); a sensação de movimento precisa ser avaliada ao vivo.
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
| `src/fx/dustVolume.ts` | A poeira como volume: blocos (esferas e elipsoides) por semente, `InstancedMesh` toon com opacidade por instância, opacidade ao longo da vida e encolhimento |
| `src/fx/AnimeDust.ts` | As três composições (onda, coroa, nuvem): o que nasce e onde, seguindo a direção do Bey |
| `src/fx/AnimeWind.ts` | Riscos de vento, argolas e coroas de impacto; entrega a poeira ao `AnimeDust` |
| `src/stage/FlowRig.ts` | Um Bey + borrão, inclinação e sombra |
| `src/stage/FlowStage.ts` | Cena do jogo (arena real, chão em funil, neblina), três câmeras, `FxLayer` do jogo e ligação dos eventos |
| `src/ui/callouts.ts` | Os três estilos de texto e a camada de textos |
| `tests/unit/beyFlowFxLab.test.ts` | Verificações do lab (não são testes de gameplay) |
