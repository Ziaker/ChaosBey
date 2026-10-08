# Fluxo do Bey — efeitos contínuos, texto de combate e modo "Bey Real"

**Status:** PROTOTIPADO, **NÃO APROVADO**. O lab existe; o owner ainda precisa ajustar e aprovar. Nada disto está em `src/`.
**Data:** 2026-10-08
**Origem:** pedido do owner com capturas de jogos de Beyblade como referência (estádio amarelo claro, estádio de gelo, Metal Fight e Burst Rivals).
**Lab:** `prototypes/bey-flow-fx-concepts/` (página `/prototypes/bey-flow-fx-concepts/`).

> Este documento registra o **pedido do owner**, o que o lab já mostra e o que continua em aberto. Os valores do lab são **propostas iniciais de Claude**, não valores finais. Quem fecha a decisão é o owner, ajustando no lab ("Copiar valores") e dizendo qual estilo vale.

---

## 1. O que o owner pediu (decisões registradas)

1. **Efeitos visuais das quatro primeiras referências** (estádio amarelo claro): fita de vento ciano/branca que segue a trajetória real e curva em espiral, **borrão de giro** do disco, **eco fantasma** translúcido, **poeira/raspagem na ponta** e **inclinação do Bey na curva**. "Efeitos primeiro": é a primeira entrega.
2. **Texto de combate "HIT", "BLOCK" e "COUNTER", estilizado.** O estilo final **será definido por protótipos**: por isso o lab compara três candidatos (A Quadrinho, B Arcade, C Cinético) e nenhum está escolhido.
3. **Modo de jogo alternativo e selecionável (só de gameplay), junto com uma câmera própria.** O modo atual continua como está. No modo novo (nome provisório **"Bey Real"**):
   - física mais realista (o Bey se move por inércia, gravidade da cuba e atrito, com pouca influência do jogador);
   - controle de movimento **automático**, com o jogador influenciando só em parte (referência: ~30%);
   - o jogador controla **só os botões**: carregar e soltar (Dash Attack), ataque giratório (Circular), pulo e esquiva (dash);
   - câmera alta e fixa, como nas referências.
   **Este item ainda não foi prototipado nem implementado.** É decisão de gameplay/física e continua ASK FIRST até haver protótipo no Debug Lab.

## 2. O que o lab mostra hoje

Movimento **coreografado** (não é o jogo, nada em `src/` o lê): dois Beys que orbitam numa cuba parabólica, carregam e dão Dash um no outro, com colisões que disparam os textos em sequência.

| Efeito | Como é feito |
|---|---|
| Fita de vento | Faixa afunilada, sempre voltada para a câmera, presa à borda do disco, com núcleo branco e corpo ciano; fina andando, larga no Dash |
| Espiral | Dois fios finos em hélice em volta da fita |
| Borrão de giro | Casca com bandas concêntricas que some conforme o giro cai |
| Eco fantasma | Anéis translúcidos que ficam para trás no caminho |
| Poeira e faíscas | Partículas na ponta, ligadas à velocidade |
| Inclinação | O topo pende para dentro da curva, a partir da aceleração lateral |
| Texto de combate | HIT / BLOCK / COUNTER! em três estilos, projetados da posição do impacto |

A fita é amostrada a cada passo da simulação (não a cada quadro desenhado), então não fica angulosa com FPS baixo. O painel "Ajuste fino" expõe todos os valores (`src/tuning.ts`), com "Copiar valores" e "Voltar à proposta". Atalhos: `1`–`6` efeitos, `7`/`8`/`9` estilo do texto, `H`/`J`/`K` disparam HIT/BLOCK/COUNTER, `D` Dashes, `Espaço` pausa, `S` câmera lenta, `R` reinicia, `V` câmera, `P` painel.

## 3. Em aberto (nada disto está decidido)

- Estilo do texto de combate (A, B ou C), cores por tipo e duração.
- Valores finais de cada efeito. O lab foi verificado em renderização por software (poucos quadros por segundo); a sensação de movimento precisa ser avaliada ao vivo pelo owner.
- Se a fita/borrão/eco entram para todos os modos ou só para o "Bey Real".
- No "Bey Real": o que acontece com drift e momentum (não estavam na lista de botões), o nome do modo, a autoridade de movimento do jogador (referência 30%) e o snap de redirecionamento ao atacar.
- Câmera do modo: alta e fixa (recomendada) ou uma câmera atrás do Bey. Esta última **contradiz a decisão do fix 8** em `camera-approval.md` (a câmera não fica permanentemente atrás do jogador), então só entra se o owner pedir explicitamente.
- Outras ideias vistas nas referências e **não** pedidas, portanto fora do escopo: marcações neon no piso, botões de ação em tela / toque, tema de arena de gelo, pickups de energia.

## 4. Plano de integração (depois da aprovação)

1. **VFX** (só apresentação, qualquer modo): portar os efeitos aprovados para `src/vfx/`, lendo eventos e estado do jogo (GDD 158: VFX nunca decide resultado), com opção em Settings e respeito ao preset de qualidade / reduzir efeitos. O texto de combate entra no HUD (hoje só existe "COUNTER!").
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
| `src/fx/WindRibbon.ts` | Fita e fios em hélice |
| `src/fx/PointPool.ts` | Poeira e faíscas |
| `src/stage/FlowRig.ts` | Um Bey + todos os efeitos que andam com ele |
| `src/stage/FlowStage.ts` | Cena, câmera, estádio e ligação dos eventos |
| `src/ui/callouts.ts` | Os três estilos de texto e a camada de textos |
| `tests/unit/beyFlowFxLab.test.ts` | Verificações do lab (não são testes de gameplay) |
