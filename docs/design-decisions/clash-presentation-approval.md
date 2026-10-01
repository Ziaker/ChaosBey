# Decisões aprovadas: apresentação do Clash

**Status:** APROVADO pelo dono do projeto.
**Data:** 2026-09-27
**Origem:** protótipo `prototypes/clash-presentation-concepts/` (Clash Presentation Lab), branch `claude/clash-presentation-lab`, PR #24, revisão 2 (commit `b8475b1`).
**Artifact revisado:** https://claude.ai/artifact/MpGJe6PLgVzuEZ5FERrxyg
**Escolha do dono:** **direção C — Overdrive**, com a **câmera B — Cinematic Hybrid**.
**Base no GDD:** 39 a 45 (Clash), 1.6 e 1.7 (protótipo visual antes da integração), 12 e 26 (câmera, hitstop e impacto), 48 a 50 (câmera), 158 (VFX observa, não decide), 167 (valores provisórios) e 170 (não reabrir perguntas fechadas).

Este documento registra **o que foi decidido** sobre a apresentação do Clash, para que nenhum agente reabra essas perguntas (GDD 170). A seção 7 separa o que **continua em aberto**. Nada aqui autoriza mudar regras do Clash, física, IA, colisores ou balanceamento. Também não inicia o M8.

> **Origem histórica:** este documento veio da branch `claude/clash-presentation-lab`. A presença deste arquivo na árvore canônica registra a aprovação mesmo que o protótipo executável ainda seja integrado por um PR separado.

---

## 1. Resumo da decisão

1. **Direção aprovada: C — Overdrive**, o teto de espetáculo entre as três. As direções A (Impacto Mecânico) e B (Confronto Anime) ficam como referência, **não** como opções do jogador.
2. **Câmera do Clash: B — Cinematic Hybrid** (preset aprovado em `camera-approval.md`), no lugar da câmera C que o lab sugeria junto com a direção C.
3. **O que foi aprovado é o comportamento visto na revisão 2 do lab.** Isso inclui os seis requisitos da revisão do dono (seção 3), que valem para qualquer direção, e os valores da direção C (seção 4).
4. **Nada foi integrado ainda.** `src/` permanece separado; a integração segue a seção 8 quando o dono pedir.

---

## 2. O que continua fixo (regras do Clash, não fazem parte desta decisão)

A apresentação roda **em cima** do pacote real `src/combat/clash/`, sem alterá-lo:

| Regra | Fonte |
|---|---|
| Janela de 150 ms entre golpes compatíveis | `ClashWindow.ts` |
| ~4 s de Active | `ClashTuning.ts` (`CLASH_TARGET_DURATION_S`) |
| Z/X/C no mesmo tick = um evento de mash | `ClashMash.ts` |
| `ClashPower = MashPerformance × StaminaFactor × VelocityFactor`, com caps | `ClashFormula.ts` |
| Cooldown de 10 s | `ClashTuning.ts` (`CLASH_COOLDOWN_S`) |
| Idle → Active → Cooldown | `ClashController.ts` |
| Knockback físico na resolução; repulsão simétrica no empate; ring-out só observado pela física | `Knockback.ts`, `ClashOrchestration`, `RingOut.ts` |

---

## 3. Comportamento aprovado, comum a qualquer direção (revisão 2)

**Princípio: mostrar, não contar.** Sem ler nenhum texto, dá para entender:
- que os Beys colidiram e estão travados um contra o outro;
- que os dois fazem força, com energia enorme;
- quem está ganhando (pelo HUD) e que isso pode virar;
- quem venceu, pela consequência física imediata, e que o combate continua.

### 3.1 Contato travado
- O Clash começa com os dois Beys **em contato real** dos colisores: centros a 1,3 m, ou seja, 2 × o raio de 0,65 m. As bordas se encontram.
- Durante o Active, os dois **se inclinam contra o ponto de contato**, pivotando na ponta, com:
  - um tremor de esforço;
  - um impulso extra a cada mash daquele lado (+0,45 × a inclinação base, que decai a 7/s);
  - um viés para quem está na frente (±35%).
- A inclinação é **só visual**: os corpos físicos não mudam.
- A pose de contato entra nos últimos 40% da aproximação e solta em 0,12 s depois da resolução.

### 3.2 Speedlines
- São linhas de foco em espaço de tela, convergindo no ponto de contato, com uma **zona livre em volta dos Beys**: meia distância entre eles na tela + 0,9 diâmetro de Bey.
- Crescem em 0,25 s depois do início do Clash e aumentam com o progresso: 60% → 100% da força da direção.
- Somem em 0,35 s depois da resolução.
- O lado que está vencendo **avança mais** em direção ao contato.
- São determinísticas: o desenho muda a cada 3 ticks.

### 3.3 Poeira de contato
- Poeira e fagulhas raspadas do piso **no ponto de contato**, jogadas principalmente **para os lados**, porque os dois giram um contra o outro.
- A emissão é contínua durante todo o Active e aumenta com o progresso e a cada mash.
- **Cores:** a poeira é tingida por arena (Foundry `#6b5a4a`, Rift `#6d6480`, Stadium `#b8c0cc`), e as fagulhas usam a cor de faísca já aprovada de cada arena.

### 3.4 Resolução sem pausa e sem texto
- **Nenhum banner:** nem vitória, derrota, empate ou ring-out.
- **Nenhum hitstop ou câmera lenta** a partir da resolução.
- O impacto (clarão, anéis, fagulhas, poeira) acontece **enquanto a física continua**: resolução → knockback → combate, sem beat parado.
- A câmera lenta de **entrada** e o hitstop curto **por mash** continuam, porque acontecem durante o Clash, não no resultado.

### 3.5 HUD de força
- É uma barra de cabo de guerra **entre os dois Beys**, posicionada pela projeção deles em tela, logo acima do ponto médio e mantida dentro do quadro.
- **Duas metades**, cada uma na **cor de brilho aprovada do modelo daquele Bey** (`palette.glow`, em `prototypes/bey-visual-concepts`). Cada metade fica do mesmo lado da tela que o seu Bey. O lado é decidido no início do Clash e mantido até o fim.
- **A proporção segue o ClashPower real ao vivo:**
  - `0,5 + 0,5 × vantagem × 4`, onde vantagem = (P1 − P2) / (P1 + P2), limitada a 4%–96%;
  - a barra segue a 8/s;
  - no impacto, pousa no resultado real.
- Sem texto e sem números. Não é o HUD final do jogo inteiro, só a apresentação do Clash.
- **Substitui completamente** a geometria giratória entre os Beys (arco, hélice e vórtice), que foi descartada.

### 3.6 Câmera durante o Clash
- A câmera **não orbita** durante o Clash. O `CameraDirector` usa `{ clashOrbit: false }`: o ângulo fica fixo, e a aproximação, a altura e o FOV do modo Clash continuam como aprovados.
- O HUD se adapta à câmera, e não o contrário.

### 3.7 Estádio com bowl
- As arenas aparecem com o **bowl aprovado de 3,2 m** e o perfil `h(r)` de cada uma (`visual-prototypes-approval.md` §2).
- Os Beys ficam **assentados na superfície**: elevados a `h(r)` e inclinados conforme o declive, com a ponta no chão.

---

## 4. Direção C — Overdrive: valores aprovados

Valores exatos de `prototypes/clash-presentation-concepts/src/presentation/directions.ts` (C):

| Grupo | Valor |
|---|---|
| Entrada | câmera lenta 0,3× por 0,5 s + flash de tela 100% na cor neutra `#ffe066` |
| Contato | inclinação 15°, tremor ±3,5° a 13 Hz |
| Speedlines | força 1,0; 110 linhas; tingidas pelas cores dos dois lados |
| Poeira | 230 partículas/s; tamanho 0,26 m; velocidade 4,2 m/s; 28% fagulhas |
| HUD | estilo "overdrive": barra 320 × 22 px, inclinada −18°, com brilho |
| Pulso de mash | estrela de impacto + anel (tamanho 1,6), hitstop de 0,07 s por evento |
| Resolução | clarão 100% na cor do vencedor; 4 anéis; 50 fagulhas; 100 partículas de poeira. **Sem pausa** |
| Reação de luz da arena | 100% no Active e no pico da resolução |

---

## 5. Câmera B — Cinematic Hybrid no Clash

- É o preset B **exatamente como aprovado** em `camera-approval.md` (43 valores), com a única diferença da seção 3.6: sem órbita durante o Clash.
- A direção C sugeria a câmera C (Hyper Dynamic). O dono escolheu a B.
- **O Clash sempre força a câmera B** (decisão do dono, 2026-09-28), qualquer que seja a câmera A, B ou C escolhida pelo jogador nas Configurações. Fora do Clash vale a câmera escolhida pelo jogador.

---

## 6. Ajustes de harness feitos no lab (não são valores do jogo)

- **Altura dos Beys:** no lab, eles ficam na altura em que cada colisor realmente repousa, medida uma vez. Antes flutuavam 0,33–0,42 m durante o Clash.
- **Cenário de ring-out:** perdedor a 4 m do centro e força sintética de 4× a força máxima do Dash. É só um cenário de demonstração: o jogo usa a força do golpe real.

---

## 7. O que continua em aberto

1. **Estilo de empate:** Espelho Partido, Sobrecarga Estática ou Nocaute Duplo. O padrão da direção C (Nocaute Duplo) **não** foi aprovado junto; nenhum dos três usa banner ou pausa.
2. ~~**Câmera do Clash × câmera do jogador.**~~ **RESOLVIDO (2026-09-28):** o Clash **sempre força a câmera B**, sem órbita, qualquer que seja a câmera escolhida pelo jogador (seção 5).
3. **Sobreposição na tela:** as câmeras aprovadas ficam atrás do jogador no eixo da luta, então os dois Beys se sobrepõem parcialmente durante o Clash. Um ajuste de enquadramento seria uma decisão de câmera.
4. ~~**Ganho ×4 da barra do HUD e cores finais.**~~ **NÃO está em aberto:** a fórmula `0,5 + 0,5 × vantagem × 4` e as metades em `palette.glow` fazem parte do comportamento aprovado da revisão 2 (seção 3.5). O valor do ganho só pode mudar como ajuste de playtest (GDD 167, item 9).
5. **Leitura do comeback:** em viradas muito tardias (últimos ~0,15 s), o HUD mostra a recuperação e a resolução completa a virada.
6. **Intensidade para jogadores sensíveis:** a C tem câmera lenta forte na entrada e hitstop de 0,07 s por mash. Uma variante reduzida (GDD 121) não foi definida.
7. **`pulse.shakeMeters` (0,22 na C)** está declarado na configuração, mas o lab não aplica. O shake do Clash vem do diretor de câmera. Falta decidir se a direção deve somar um shake próprio.
8. ~~**Bowl na física: o bowl é só visual, piso ainda plano.**~~ **RESOLVIDO (M11 lane 4):** o bowl virou colisor físico de verdade (heightfield côncavo do Rapier, `src/arena/colliders/createArenaColliders.ts`, mesmo perfil `h(r)` dos três bowls A/B/C em `src/arena/floor/ArenaFloorProfile.ts`), selecionável no Motion Lab/Pregame. A arena padrão (`DEFAULT_ARENA_FLOOR`) continua plana — isso não mudou, só a alegação de que o bowl físico "ainda não existe".
9. **Valores provisórios (GDD 167):** tudo na seção 4 pode ser ajustado em playtest.

---

## 8. Integração (quando o dono pedir)

Esta integração **não** está autorizada por este documento. Quando for:
1. Criar a camada de apresentação do Clash fora das regras, observando os eventos do `ClashController`/`ClashOrchestration` (GDD 158: VFX observa, não decide).
2. Portar:
   - a pose de contato (`contactPose.ts`);
   - as speedlines, a poeira e o HUD de força;
   - os valores da seção 4.
3. Aplicar `{ clashOrbit: false }` ao diretor de câmera integrado e forçar o preset B durante o Clash, independentemente da câmera escolhida pelo jogador.
4. Garantir que a resolução não pede hitstop ou câmera lenta.
5. Portar os testes do lab: contato, sem pausa, HUD seguindo o ClashPower.
