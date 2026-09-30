# Auditoria de fidelidade: protótipos visuais × jogo real

**Data:** 2026-09-30 · pedida no passe de playtest pós-M11 ("PROTÓTIPOS VISUAIS — PASSO DE FIDELIDADE").

**Fontes:**
- `VISUAL_APPROVALS_MASTER.md` e os documentos de aprovação de cada lab;
- os próprios labs em `prototypes/`;
- o código atual em `src/`.

"Tecnicamente reproduzível" não é o mesmo que "design final aprovado". Esta auditoria separa as duas coisas.

## Classificação

- **A — explicitamente APROVADO:** pode ir para o jogo com fidelidade máxima ao lab.
- **B — aprovado como protótipo/playtest, ainda não final:** pode existir no jogo como opção de playtest, sem ser declarado final.
- **C — exploração / decisão aberta:** não escolher pelo dono.

| Lab / elemento | Classe | Base | No jogo hoje | Portável 1:1 já? |
|---|---|---|---|---|
| **VFX — direção C Híbrida** (faíscas da Mecânica + estrelas, shockwave, spark lines e trails da Anime; impact frame só no limiar) | **A** | master §5, `visual-prototypes-approval.md` §3 ("36 valores finais") | Só o de sempre: `SparkBurstVfx`, `LandingBurstVfx`, `SpeedTrail` e `SpeedLines` (placeholders do M4). **Neste passe:** skid marks e streak sparks do drift, do `fastMove` da Mecânica que a Híbrida usa. | **Sim.** Código Three.js em `prototypes/vfx-visual-concepts/src/languages/{mechanical,anime,hybrid}.ts` + `fx/`, valores no bloco `APPROVED`. É uma integração grande. |
| **VFX — Cel Cyclone** (wind burst) | **A** | master §5.3 | não | Sim (`hybrid.ts` → `windBurst`, estilo `cel`) |
| Conflito shake do VFX Lab × shake da câmera | **C** | `camera-approval.md` registra como ponto aberto | — | Não, porque precisa de decisão |
| VFX de pulo / ataque aéreo / air recovery | **C** | master §13.5: não prototipado | não | Não |
| Identidade de partículas e trails por Bey | **C** | master §13.6: não prototipado | não | Não |
| **Condição — Stamina / Stability / Quebrado A/B/C**, combináveis, com seleção nas Configurações | **A** | `condition-visual-approval.md` (49 valores) | não integrada | **Sim** (`prototypes/condition-visual-concepts`). É uma integração grande, com nova opção em Settings. |
| **Clash — direção C Overdrive + câmera B** | **A** | `clash-presentation-approval.md` | Câmera B sem órbita e barra de força do HUD, sim. **Visual Overdrive** (contato travado, speedlines, poeira de contato, resolução) **não**. | Sim (lab Clash Presentation) |
| **Câmera A/B/C** (43 valores × 3) | **A** | `camera-approval.md` | integrada (M11). O enquadramento over-the-shoulder deste passe foi pedido pelo dono, ver `docs/ai/m11-status.md`. | — |
| **Movimento A/B/C** | **B** | master §8: "aprovado em parte, não é tuning final" | integrado como opção de playtest (M11) | — |
| **Bey — anatomia de 4 peças** | **A** | master §3.1 | Não. O mesh do jogo é o placeholder procedural (`createBeyMesh.ts`, "NOT FINAL"). | Sim, a geometria (`prototypes/bey-visual-concepts/src/{parts,model}`) |
| **Bey — os 9 conceitos como roster** | **A** (owner override 2026-09-27) — **mas o lab ainda diz "Exploration only… not final models, materials"** | master §3.2 × aviso no `index.html` do lab | Não. O jogo tem 3 definições de gameplay (Attack / Defense / Stamina). | Geometria sim. Falta decidir o gameplay de cada um dos 9 (stats por Bey, não definidos). |
| Bey — nomes, paletas finais, refinamento de peças | **C** | master §3.3 | — | Não |
| **Arena — 3 direções visuais** (Foundry / Rift / Tournament) | **B** | master §4.2: "aprovadas como protótipos visuais"; o lab diz "Exploration only. Not final art." | Parcial: presets com cores e parede (M10-C). A arte do lab (rebites, treliça, fissuras, LEDs, reação ao Clash) não. **Neste passe:** cores de faísca de cada arena. | Sim, como opção de playtest. Não como arte final. |
| Arena — geometria do bowl 12 m / 3,2 m | **A** | master §4.1 | integrada como piso de playtest (M11 lane 4) | — |
| Arena inicial/default, puxão da inclinação, volume de ring-out, aberturas de parede | **C** | master §4.3 | — | Não |
| HUD de combate final | **C** | master §10 | HUD funcional (M10). O "DRIFT" deste passe é funcional e temporário. | Não |
| UI/menus final, intro/launch, post-FX (bloom, CA) | **C** | master §11 | — | Não |

## O que foi portado neste passe (e como)

Tudo aqui é classe A ou uma cor de arena da classe B:

- **Skid marks do drift**:
  - textura `softDot` do VFX Lab (mesmo gradiente) e decal plano com `polygonOffset`;
  - cor preta, vida de 2,5 s, opacidade cheia nos primeiros 60 %, como no `fastMove` da Mecânica (`skidMarks` 1).
  - **Diferenças medidas para o drift** (o lab não tem evento de drift):
    - um decal a cada 0,02 s (lab 0,035), para formar uma faixa contínua;
    - 0,36 m (lab 0,28);
    - opacidade 0,55 (lab 0,35).
- **Faíscas do drift**:
  - o `StreakSparks` do lab 1:1: segmentos quente → frio, gravidade 9,8, quique no chão 0,35, cauda 0,035 s;
  - taxa proporcional à velocidade de deslize lateral.
- **Cores de faísca por arena**: os `sparkColors` do Arena Lab.
  - Foundry `#ffe28a` → `#ff6a14`;
  - Rift `#d9ccff` → `#7f5cff`;
  - Tournament `#ffffff` → `#ffc94a`.

## O que pode ser portado 1:1 imediatamente (classe A), e não foi para não misturar com este passe

1. **VFX Híbrida C + Cel Cyclone com os 36 valores:**
   - cobre os 9 momentos aprovados: golpe, Dash carga/soltura, Circular/counter, Perfect Dodge, wind burst, Stability Break, landing, wall scrape e ring-out;
   - substitui os placeholders do M4;
   - **Precisa de uma decisão sua antes:** o conflito shake VFX × câmera.
2. **Condição A/B/C**, com a seleção nas Configurações, conforme a aprovação.
3. **Visual Overdrive do Clash** (direção C).

Cada item é uma integração grande. O pedido era apresentar isso antes de uma grande integração visual, então paro aqui e deixo a ordem para você.

## Depende de escolha sua

- Se os 9 Beys entram com a geometria do Bey Concept Lab mesmo com o aviso "Exploration only" do lab. O master diz que o roster de 9 está aprovado.
- Nesse caso, o gameplay de cada um (stats por Bey), nomes e paletas.
- Arte das arenas como opção de playtest, e qual é a arena default.
- O conflito shake VFX × câmera.
- HUD final, menus, intro/launch e post-FX.
