# Cores dos Beys — decisão do owner e plano das quatro peças

Origem: pedido do owner, 2026-10-07 ("mais variedade de cores nas outras versões dos Beys, não pode ter uma com a mesma cor da outra, mas deixe planejado a vontade de colorir as 4 peças de cada Bey; as cores também influenciam a cor da barra de Clash").

## O que está decidido e implementado (0.44.0)

1. **Cada um dos nove Beys tem a sua própria cor.** Nenhum Bey, nem a variante B ou C de uma família, repete a cor de outro. Antes: Attack A e C eram dois vermelhos, Stamina A e B dois verde-água e os três Defense eram azuis.
2. **Matiz por Bey** (cor principal → cor de UI / brilho):

   | Bey | Principal | Cor de UI (brilho) |
   |---|---|---|
   | Attack A | vermelho `#c4202b` | `#ff4d4d` |
   | Attack B | magenta `#d0229f` | `#ff52d8` |
   | Attack C | laranja `#f0801a` | `#ffa030` |
   | Defense A | azul `#2358c4` | `#4d8dff` |
   | Defense B | violeta `#7a3fd0` | `#a070ff` |
   | Defense C | ciano `#1fb5e0` | `#3fdcff` |
   | Stamina A | verde `#1fa85a` | `#3fe07a` |
   | Stamina B | lima `#8cc63a` | `#b8f04a` |
   | Stamina C | amarelo `#f2e03a` | `#ffe44a` |

   A família continua legível pela temperatura (Attack quente, Defense fria, Stamina verde/amarela). Teste de regressão: `tests/unit/beyColors.test.ts` (distância RGB mínima entre cores principais ≥ 80 e entre cores de UI ≥ 70).
3. **As cores mandam na barra de Clash.** Cada metade da barra, o cartão do HUD, as bolinhas de rounds, o card do Character Select e a luz do pedestal usam a cor de UI do Bey. Se os dois lados forem o mesmo Bey (espelho) ou cores tão próximas que não se distinguem (distância RGB < 60), o segundo lado usa a **segunda cor** do Bey (`palette.accent`).
4. **Um só lugar diz qual é a cor de um Bey:** `src/bey/visual/beyColors.ts` (`beyColorsFor`, `sideAccentsCss`). Todo consumidor pergunta ali.

As paletas continuam **provisórias** (VISUAL_APPROVALS_MASTER 3.3): o owner pode trocar qualquer valor; o teste só exige que continuem distintas.

## Plano (NÃO implementado): colorir as quatro peças separadamente

Vontade do owner: cada Bey ter as **quatro peças** (topo, anel, disco, driver) pintadas individualmente — por exemplo, anel vermelho sobre driver azul.

Hoje as quatro peças são pintadas a partir de uma única `ConceptPalette` por Bey (`src/bey/visual/model/materials.ts` monta um `MaterialKit`). Plano de implementação, por etapas:

1. **Dados** (já deixado pronto, sem uso): `ConceptDefinition.pieceColors?: PieceColorOverrides` (`src/bey/visual/model/types.ts`) — um override parcial de `ConceptPalette` por peça (`topLayer`, `ring`, `disc`, `driver`). `BEY_COLORED_PIECES` (`beyColors.ts`) lista as quatro peças na ordem do plano.
2. **Materiais:** `buildMaterialKit` passa a receber a peça e mesclar `palette` + `pieceColors[peça]`, criando um kit por peça (descartando todos juntos, como hoje). As peças do Lab (`parts/*.ts`) já pedem os materiais ao `PartContext`, então a mudança fica no montador (`assembleConcept.ts`).
3. **Cor do Bey para a UI:** `beyColorsFor` passa a derivar a cor de UI da **peça de impacto (o anel)** quando ela tiver override; sem override, continua o brilho da paleta. É assim que a barra de Clash seguirá a cor do anel.
4. **Seleção de cores pelo jogador (opcional, a decidir):** um editor por peça no Character Select, guardado em `localStorage` como as outras preferências. Cores escolhidas pelo jogador nunca entram no estado do jogo nem no replay (apresentação pura).
5. **Regra de distinção:** a regra "nenhum Bey repete a cor de outro" passa a valer para a **cor de UI derivada** (a que aparece na barra de Clash), e o fallback do espelho continua valendo.

Perguntas em aberto para o owner antes de implementar: as peças terão cores fixas por Bey ou escolhidas pelo jogador? A barra de Clash segue o anel, ou a peça dominante?
