# Handoff — PR #81 "Camera/gameplay causal separation"

Escrito em 2026-10-02 (~14:00 UTC) pelo agente que implementou a PR, a pedido do proprietário, que está sem cota e **proibiu** continuar implementando, mergear, rebasear/mesclar a `main` e rodar mais smoke antes deste documento.

**Legenda de confiança** (usada em todo o documento):

- **[VERIFICADO]** — conferido por comando/API no momento da escrita (comando indicado ou óbvio).
- **[RELATO]** — aconteceu nesta sessão, mas não é reproduzível a partir do repositório (logs efêmeros, saída vista uma vez). Trate como informação, não como prova.
- **[RECOMENDAÇÃO]** — opinião do agente. Não é decisão do proprietário.
- **[NÃO VERIFICADO]** — suposição ou lacuna conhecida.

> **Regra de ouro do proprietário para esta PR: NÃO MERGEAR.** O `CLAUDE.md` do repositório pré-autoriza merge quando o gate verde está satisfeito; **para esta PR o proprietário revogou isso explicitamente** (ver §12). Não marcar como *ready* sem autorização.

---

## 1. ESTADO ATUAL EXATO

### 1.1 PR e branch [VERIFICADO]

| Item | Valor |
|---|---|
| PR | https://github.com/Ziaker/ChaosBey/pull/81 — **aberta, DRAFT**, não mergeada |
| Branch | `claude/camera-moving-player-u5wrem` (nome reutilizado: a PR #79 anterior, já mergeada, usou o mesmo nome) |
| HEAD da branch (local e `origin`) | `1ccc60097aebafd57cb8ac4779a3ff752d84562d` |
| Base original usada (merge-base) | `e7823b1140eeaca335815c84ac1558f166a42e85` (`main` em 2026-10-01 17:08 -03, "Fix dropped JumpDrift press with a jump input buffer (#77)") |
| `base.sha` que a API do GitHub reporta na PR | `73c04abaf34fca072658735d4ecbceb64ce8bd61` (commit de `main` de 2026-10-01 17:27 -03; **é ancestral da `main` atual**; já estava à frente da base da branch quando a PR foi aberta) |
| `main` atual conhecida | `781d71da85c32ca9ce2bdb0e6eee701f0d5b526e` — "Merge pull request #83: Arena scale pass (3x stage, 2.5 m central basin) — v0.12.0" (2026-10-02 10:11 -03). `package.json` da main: `0.12.0`. A branch está em `0.11.0`. |
| Divergência | `git rev-list --left-right --count HEAD...origin/main` ⇒ **2 à frente, 33 atrás** da `main` atual |
| Arquivos alterados na `main` desde o merge-base | 116 |
| Arquivos alterados pela branch desde o merge-base | 46 (`+1535 / −908`) |
| Mergeabilidade segundo o GitHub | `mergeable_state: "dirty"` (**conflitos**) |
| Conflitos (dry-run local, sem tocar na árvore de trabalho) | **3 arquivos** com conflito textual: `src/app/frontend/MatchRunner.ts`, `src/app/session/MatchSession.ts`, `tests/unit/settingsAndGamepad.test.ts` (detalhes em §8) |
| Árvore de trabalho | limpa (`git status --short` vazio ao escrever, antes deste documento) |

Comando do dry-run (não muda nada além de criar objetos no banco do git):
`git fetch origin main && git merge-tree --write-tree --name-only HEAD origin/main`

### 1.2 Commits na branch (a partir da `main` de base) [VERIFICADO]

| SHA | Propósito |
|---|---|
| `65531b8b772ea885540af11977cee029640fd803` | **Separação causal câmera→gameplay.** Remove o caminho `câmera → input`. Cria `ControlReference`, `createPlayerControl`, `CameraObserver`; move ImpactEvents/ImpactMagnitude/hitstop para fora de `src/camera/`; guard AST; suíte `cameraGameplaySeparation`; docs. |
| `1ccc60097aebafd57cb8ac4779a3ff752d84562d` | **Quatro esquemas de controle selecionáveis**; corrige **bug de espelhamento** esquerda/direita; novo default `opponent`; `controlReferences.ts`; tela de Settings com 4 opções; testes/docs atualizados. |

Contexto anterior (já na `main`, **não** faz parte desta PR): a PR #79 (merge `f08e29664337d06919fd6050ffe3026bd38e52f1`, commit de conteúdo `105fd1c69332e1b95b89f4977d8bd4adcb8005c2`) congelou o yaw da câmera por gesto (`gestureYaw`). Isso **não** satisfez o requisito (ver §2). A PR #81 remove esse mecanismo.

O commit que adiciona **este** documento vem depois de `1ccc600` (SHA informado na resposta final da sessão).

### 1.3 O que JÁ foi alterado (resumo; lista completa no §1.4)

- Dependência câmera→input removida (nenhum callback/número de câmera chega a `src/input/`).
- Lógica de simulação (ImpactEvents, ImpactMagnitude, hitstop tuning) tirada de `src/camera/`.
- `MatchSession` aceita `cameraRig?: CameraObserver | null`.
- Quatro esquemas de controle em Settings; migração/fallback de saves antigos (implícito, ver §5).
- Bug do espelhamento corrigido em `screenToWorld`.
- Guard AST + suíte de independência em runtime.
- Documentação de decisão e limpeza de documentação antiga.

### 1.4 Arquivos alterados (46) [VERIFICADO: `git diff --name-status -M e7823b1 HEAD`]

```
M docs/ai/m11-status.md
M docs/design-decisions/OWNER_DECISIONS_MASTER.md
M docs/design-decisions/README.md
A docs/design-decisions/camera-gameplay-separation.md
M prototypes/camera-concepts/src/fight/RealSimSource.ts        (só caminhos de import)
M src/app/frontend/MatchRunner.ts
M src/app/frontend/SettingsScreen.ts
A src/app/frontend/controlReferences.ts                         (ÚNICO arquivo autorizado a ler a câmera para controle)
M src/app/session/MatchSession.ts
M src/app/simulation/Hitstop.ts
A src/app/simulation/HitstopTuning.ts                           (era src/camera/CameraTuning.ts)
M src/app/simulation/MatchStepper.ts
R src/camera/ImpactEvents.ts    -> src/app/simulation/impact/ImpactEvents.ts
R src/camera/ImpactMagnitude.ts -> src/app/simulation/impact/ImpactMagnitude.ts
D src/camera/CameraTuning.ts
M src/camera/director/CameraDirector.ts                         (só comentário)
M src/camera/director/CameraRig.ts                              (tipo CameraObserver + comentários)
M src/camera/director/sessionCamera.ts                          (caminho de import)
M src/config/settings/PlayerSettings.ts
M src/debug/inspectors/buildInspection.ts                       (rótulos/comentários)
M src/debug/lab/DebugLabMode.ts
M src/debug/overlay/DebugOverlay.ts                             (comentário)
M src/debug/overlay/buildOverlayState.ts                        (rótulo do esquema)
A src/input/directional/ControlReference.ts
M src/input/directional/DirectionalController.ts
A src/input/directional/createPlayerControl.ts
M src/input/directional/screenDirection.ts
M src/vfx/{LandingBurstVfx,SparkBurstVfx,SpeedTrailVfx,VfxManager,VfxRouting}.ts   (só caminho de import)
A tests/deterministic/cameraGameplaySeparation.test.ts
D tests/deterministic/directionalCameraRelativeIntegration.test.ts
D tests/deterministic/twinSimulationCameraIndependence.test.ts
M tests/deterministic/{hitstop,impactEvents,impactMagnitude,vfxRouting}.test.ts   (caminhos de import / rename de constante)
M tests/deterministic/playerControlSchemeScenarios.test.ts      (comentários)
M tests/deterministic/replayV2.test.ts
M tests/smoke/playerDirectionalControl.spec.ts
M tests/smoke/settingsPauseGamepad.spec.ts                      (comentário)
M tests/unit/directionalInput.test.ts
M tests/unit/inputCameraBoundary.test.ts                        (reescrito: guard AST)
M tests/unit/settingsAndGamepad.test.ts                         (default 'opponent')
```

### 1.5 O que AINDA NÃO foi feito

- Reconciliação com a `main` atual (nenhum merge/rebase feito — proibido até agora).
- Verificação de CI para o HEAD atual (sem workflow; ver §7).
- Smoke completo no HEAD (26 de 28 arquivos rodaram, 2 não — ver §6).
- Nada foi validado **contra a main atual** (typecheck/testes/build/smoke foram todos na base antiga `e7823b1`).
- O corpo da PR #81 ainda diz "smoke completo: em execução local" e "CI: pendente" — **está desatualizado** (a execução foi interrompida; ver §6). Atualizar antes de qualquer revisão.
- Decisão do proprietário sobre o **esquema padrão** e sobre a **migração** de saves antigos (§5, §12).
- Nada de física, balanceamento, arena, VFX, câmera de apresentação foi alterado de propósito (só movimentação de arquivos/comentários na câmera).

---

## 2. OBJETIVO ORIGINAL DESTA CORREÇÃO

Requisito do proprietário (texto exato, regra absoluta):

> **Camera is downstream presentation. It may observe gameplay; it may never mutate or causally influence gameplay.**

A câmera se acomoda ao Bey; o Bey **nunca** se acomoda à câmera — direta **nem indiretamente**. A câmera pode ser tão dinâmica quanto o Camera Lab exige (orbitar, FOV, shake, look-ahead, pullback, push-in, knockback follow, offscreen rescue, side switch, cinematografia de Clash/finalização). **Nada disso** pode mover, frear, acelerar, girar, reposicionar, teleportar, empurrar um Bey, nem alterar input/`moveIntent`/física/knockback/drift/jump/dodge.

### 2.1 O bug original

Sintoma relatado pelo proprietário: o Bey se movia/virava "sozinho" por causa da câmera; "quem pediu pra câmera mover o jogador… só o jogador deve mover o jogador".

Causa: o esquema Directional era *camera-relative*. Cadeia causal que existia na `main` antes desta PR:

```
CameraDirector/CameraRig  (tick dentro de MatchSession.tickCameraAndVfx)
  → MatchSession.getLastCameraOutput().yawDeg
  → MatchRunner / DebugLabMode          (cameraYaw: () => number)
  → DirectionalController.sampleActions → screenToWorld(screen, cameraYawRad)
  → ControllerActions.moveIntent
  → MovementController
  → física do Bey (rapier)
```

Com a câmera automática orbitando e uma tecla segurada, o `moveIntent` rodava junto com o yaw da câmera ⇒ a trajetória curvava sem input.

### 2.2 Por que a PR #79 não bastou

A #79 só congelou o yaw uma vez por gesto (`gestureYaw`). O dado de câmera continuava entrando no cálculo de `moveIntent` (só deixou de ser atualizado a cada tick). O proprietário rejeitou isso: "isso precisa ser corrigido na arquitetura, não com outro latch". Também apontou que `inputCameraBoundary.test.ts` só proibia `import` de `src/camera/` e permitia a câmera chegar como `number` por callback, e que o teste "twin camera independence" usava Classic (sem `DirectionalController`), logo não provava nada sobre o esquema padrão.

---

## 3. ARQUITETURA ATUAL IMPLEMENTADA [VERIFICADO no código do HEAD `1ccc600`]

### 3.1 `src/input/directional/ControlReference.ts`
Interface do referencial das setas, **de propriedade de input/gameplay**:

```ts
interface ControlReference { kind: 'world'|'opponent'|'latched'; yawRad(gestureActive: boolean): number }
```
- `WORLD_CONTROL_REFERENCE`: yaw = π ⇒ "para cima" = −Z, "direita" = +X (arena fixa).
- `createOpponentReference(ends)`: yaw = `atan2(dx, dz)` do vetor jogador→oponente; mantém o último bearing se os Beys se sobrepõem ou `ends()` é `null`. Depende só de **posições de gameplay**.
- `createLatchedReference(read)`: lê `read()` uma vez ao início do gesto e mantém até soltar tudo. Genérico (sem a palavra "camera" em `src/input/`). **Só o esquema `screen` o usa.**

### 3.2 `DirectionalController.ts`
- Embrulha o controller do dispositivo (teclado+gamepad). **Não aceita mais** `cameraYaw`; só `{ reference?, stick? }`.
- A cada tick: monta o vetor de direção (stick vence digital), chama `reference.yawRad(gestureActive)`, resolve `moveIntent = screenToWorld(dir, yaw)`, remove as 4 ações de movimento do `held`.
- `setReference()` (troca viva de esquema), `setEnabled(false)` = Classic (passa as ações cruas), `getReferenceKind()` (debug), `getDebug()` → `{screen, world, referenceYawRad}`.

### 3.3 `screenDirection.ts`
- `screenToWorld(dir, referenceYawRad)`: `up = fromYaw(yaw)`, **`right = (−up.z, up.x)`** (quarto de volta **horário** visto de cima). **Bug corrigido**: antes `right = perpendicular(up)` = `(up.z, −up.x)`, que é o lado **esquerdo** de `up` (imagem espelhada). Teste: `cross(up,right)=+1` para qualquer yaw.
- `cameraYawFromRight()` **removido** (era um helper do input derivado da matriz da câmera).

### 3.4 `createPlayerControl.ts`
Fábrica única: `createPlayerControl(device, { directional, reference?, stick? })`. Usada por **PLAY (MatchRunner), Debug Lab e testes** — para que um teste que passa seja o controller real do jogador, não um substituto.

### 3.5 `src/app/frontend/controlReferences.ts` (camada de composição)
`controlSetupFor(scheme, { session: () => MatchSession|null, playerSide? })` → `{ directional: boolean, reference }`:

| scheme | directional | reference |
|---|---|---|
| `classic` | false | (ignorado) |
| `arena` | true | `WORLD_CONTROL_REFERENCE` |
| `opponent` | true | `createOpponentReference` (lê `session.getBey(...).body.translation()`) |
| `screen` | true | `createLatchedReference(() => ((cameraYawDeg + 180)·π)/180)` — **lê `session.getLastCameraOutput()`** |

**É o único arquivo do repositório autorizado a ler a saída da câmera para controle**, e só no `case 'screen'` (último `case`). O guard AST impõe isso (§3.9).

### 3.6 Separação câmera ⇄ gameplay em `MatchSession`
- `MatchSessionOptions.cameraRig?: CameraObserver | null` — omitido = Camera Director real; `null` = **sem câmera (render desligado)**.
- `CameraObserver = Pick<CameraRig, 'tick'|'setPreset'|'getPreset'|'setAspect'>` (em `CameraRig.ts`).
- `tickCameraAndVfx`: depois de `if (!this.cameraRig) return;` a única atribuição é `this.lastCameraOutput = {...}`. `lastCameraOutput` é lido só por `renderFrame()` e por readouts de debug.
- A câmera recebe um `FightFrame` montado a partir do estado de gameplay (copias de posição/velocidade; o array de `impactEvents` é compartilhado por referência com o VFX — ver §11).

### 3.7 Movimentação de código de simulação para fora da câmera
`ImpactEvents.ts`, `ImpactMagnitude.ts` e as constantes de hitstop (`CameraTuning.ts` ⇒ `HitstopTuning.ts`, constantes renomeadas `CAMERA_HITSTOP_*` → `HITSTOP_*`) viviam em `src/camera/` mas eram importadas por `app/simulation/{MatchStepper,Hitstop}`. Movidos para `src/app/simulation/` ⇒ **nenhum módulo de gameplay importa de `src/camera/`**. A câmera importa de lá (observa gameplay). `src/vfx/*` e `prototypes/camera-concepts` só tiveram o caminho de import ajustado.

### 3.8 Texto/Settings
`PlayerSettings.ts`: `ControlScheme = 'opponent'|'classic'|'arena'|'screen'`, `DEFAULT_PLAYER_SETTINGS.controlScheme = 'opponent'`. `SettingsScreen.ts`: 4 rádios — "Toward opponent", "Classic", "Arena (fixed)", "Screen (reads camera)" — com nota e linha de controles por esquema.

### 3.9 Guards e testes de independência

**`tests/unit/inputCameraBoundary.test.ts`** (AST via `rolldown/parseAst`; o TypeScript 7 do projeto não expõe API de compilador em JS). Regras:
1. Camadas de gameplay (`input, bey, physics, combat, ai, drift, dodge, arena, replay, rng, self-test, automation, app/simulation`) não importam de `src/camera/` **e não contêm identificador/string com "camera" no código** (comentários ignorados). Garante que nem um `number` de câmera atravessa.
2. `src/camera/` só importa de si mesmo + `ImpactEvents` (tipo) + `AttackState` (enum) + `three`. Nada que a câmera possa mutar.
3. A saída da câmera (`getLastCameraOutput`/`lastCameraOutput`/`SessionCameraOutput`) só é lida por: `MatchSession.ts`, `debug/overlay/buildOverlayState.ts`, `debug/inspectors/buildInspection.ts` e a **exceção** `app/frontend/controlReferences.ts` (leitura única, dentro do último `case 'screen'`). `MatchRunner` e `DebugLabMode` não podem ler.
4. Dentro de `MatchSession`, `cameraRig`/`lastCameraOutput`/`initialCameraPreset` só nos membros `constructor, setCameraPreset, getCameraPreset, getLastCameraOutput, tickCameraAndVfx, renderFrame`; e após o guard `if (!this.cameraRig)` o tick só atribui `this.lastCameraOutput`.

**`tests/deterministic/cameraGameplaySeparation.test.ts`** (sem retries). Mesma luta, câmera `none` (`cameraRig:null`, sem `renderFrame`) / `static` (congelada) / `real` (Director real, com churn: troca de preset A/B/C, efeitos on/off, aspect 0.5/16:9/3/1, view overview) / `hostile` (eye/focus teleportando, FOV 5°–145°, shake enorme, side/yaw girando todo tick, **tenta mutar o frame**). Compara **todo tick**, byte a byte: ações, `moveIntent`, resultado completo do tick (snapshot por Bey), posição/vel linear/angular/rotação/heading, impulsos (knockback), aceleração e hash canônico. Também conta leituras de `getLastCameraOutput` durante `tick()` (deve ser 0). Blocos: A zero input (flat, bowl-b); B input real scriptado em `opponent`/`arena`/`classic` × flat/bowl-a/bowl-c + `arena` com ↑ segurado + `opponent` apontando para o oponente com câmera hostil + teste de que `screen` é o **único** esquema em que a câmera muda a trajetória; C offscreen rescue (sessão + nível do rig com frame congelado); D knockback follow; E crossing/side switch (teleports idênticos nos runs); F presets×efeitos×aspect×overview; G render desligado vs ligado. Usa `controlSetupFor` + `createPlayerControl` (mesma fábrica do PLAY). `document` é stubado (node não tem DOM; `renderFrame` cria textura de canvas).

Outros testes tocados: `directionalInput.test.ts` (reescrito: referências, right-handedness, opponent/latched, settings), `replayV2.test.ts` (usa `createPlayerControl`), `settingsAndGamepad.test.ts` (default), smoke `playerDirectionalControl.spec.ts` (testes reescritos/ajustados para os esquemas) e `settingsPauseGamepad.spec.ts` (só comentário).

### 3.10 Exceção deliberada
`screen` lê a câmera (uma vez por gesto). **Autorizada pelo proprietário** como opção opt-in (ver §4/§12). Nunca é o default. O teste "screen is the ONLY scheme where the camera matters" existe para a exceção não se espalhar.

Documentação de decisão: `docs/design-decisions/camera-gameplay-separation.md` (+ entrada em `OWNER_DECISIONS_MASTER.md` §3.1 e §13.7, índice em `design-decisions/README.md`, aviso de superseded em `docs/ai/m11-status.md`).

---

## 4. OS QUATRO ESQUEMAS DE CONTROLE

**Todos devem permanecer disponíveis.** O proprietário pediu TODOS como opções ("Adiciona TODOS como opção"). **A existência dos quatro esquemas NÃO é decisão pendente.**

| `ControlScheme` | Rótulo na UI | Significado | Lê a câmera? |
|---|---|---|---|
| `opponent` | Toward opponent | ↑ em direção ao oponente, ↓ se afasta, ←/→ circulam em volta. Só posições dos Beys. | Não |
| `classic` | Classic | Relativo ao Bey (kart): ←/→ giram, ↑/↓ aceleram/freiam no sentido do heading. `DirectionalController` desligado. | Não |
| `arena` | Arena (fixed) | ↑ = −Z, → = +X, sempre. | Não |
| `screen` | Screen (reads camera) | ↑ = "para cima na tela" como a câmera estava ao começar a mover; travado até soltar tudo. | **Sim** (única exceção opt-in) |

Observação sobre `screen`: a autorização é a **interpretação do agente** da resposta do proprietário a uma pergunta de múltipla escolha cujo texto dizia que essa opção quebra a regra "câmera nunca influencia" e "só se você abrir exceção explícita"; o proprietário respondeu "Adiciona TODOS como opção". [RECOMENDAÇÃO] Se houver dúvida, confirmar com o proprietário antes do merge.

---

## 5. PROBLEMA DO DEFAULT / MIGRAÇÃO

Fatos [VERIFICADO no código]:

- O default `controlScheme: 'opponent'` foi **escolhido pelo agente**, **não** por decisão explícita do proprietário. O agente o marcou como "escolha do agente, a confirmar" na PR e nos docs. Motivo dado pelo agente: a câmera enquadra o oponente, então ↑ quase sempre lê como "para frente".
- **Não existe código de migração explícito.** `sanitizePlayerSettings` faz `CONTROL_SCHEMES.find(c => c === input.controlScheme) ?? DEFAULT_PLAYER_SETTINGS.controlScheme`. Logo, um save antigo com `controlScheme: 'directional'` **cai no fallback = `opponent`**; um save sem o campo também; um save `classic` continua `classic`.
- O que `'directional'` significava na `main` anterior a esta PR (#79): camera-relative com yaw travado por gesto — **ou seja, funcionalmente é o que hoje se chama `screen`**. Portanto, para quem tinha `directional` salvo, o comportamento **muda** de "relativo à tela (lendo a câmera)" para "em direção ao oponente".
- Isso pode alterar o comportamento percebido pelo jogador. **Nenhuma decisão nova sobre default ou migração deve ser tomada silenciosamente.**

Alternativas tecnicamente possíveis (**sem escolher uma**):

1. Manter `opponent` como default e deixar `directional` cair nele (estado atual).
2. Default `opponent`, mas migrar explicitamente `directional` → `screen` (preserva o comportamento antigo; mantém a dependência da câmera para esses jogadores).
3. Migrar `directional` → `arena`.
4. Migrar `directional` → `classic`.
5. Default diferente de `opponent` (qualquer dos outros três; `screen` como default contraria "câmera nunca influencia").
6. Sem migração silenciosa: detectar `directional` legado e mostrar uma escolha/aviso único na primeira execução.
7. Migrar só saves legados e manter o default novo apenas para instalações novas.

Qualquer uma exige: atualizar `sanitizePlayerSettings`, `tests/unit/directionalInput.test.ts` (bloco "control scheme setting"), `tests/unit/settingsAndGamepad.test.ts`, e a seção de docs correspondente.

---

## 6. ESTADO DOS TESTES

> **O smoke completo NÃO está verde nem completo.** Não foi concluído em nenhuma tentativa.
> **Todos** os resultados abaixo são do HEAD `1ccc600` sobre a base **antiga** `e7823b1`. **Nenhum** foi rodado contra a `main` atual (`781d71d`).

### 6.1 Resumo por categoria

| Categoria | Item | Estado |
|---|---|---|
| Confirmado verde (na base antiga) | typecheck `npx tsc --noEmit -p .` | verde, rodado depois do último conteúdo de código e antes do commit `1ccc600` (a árvore não mudou entre a execução e o commit) [RELATO: saída "TSC_OK" vista na sessão] |
| Confirmado verde (na base antiga) | `npm test` (`vitest run`: unit+deterministic+replay) | **117 arquivos passando, 1 skipped; 1064 testes passando, 2 skipped** [RELATO] — na árvore equivalente a `1ccc600` |
| Confirmado verde (na base antiga) | build `npm run build` | verde em `1ccc600` (13:12 UTC de 10-02) [RELATO]; só warning de chunk grande |
| Confirmado verde (na base antiga) | smoke de controle/settings: `playerDirectionalControl` (4 testes) e `settingsPauseGamepad` (3) | passando, duas vezes em `1ccc600` [RELATO]; também reconfirmados na rodada A4 abaixo |
| Executado parcialmente | smoke completo | **26 de 28 arquivos de spec passaram (42 testes)**; ver §6.2. 2 arquivos não rodaram |
| Interrompido | smoke completo, 3 de 4 tentativas | por encerramento de processos em segundo plano / kill intencional (§6.2) |
| Não executado | `vfxVisualConcepts.spec.ts`, `webgl2Unavailable.spec.ts` | nunca rodaram em `1ccc600` |
| Não executado | qualquer coisa contra a `main` atual | nenhum |
| Apenas alegado em rodada anterior | "mutation checks" | ver §6.3 |
| Apenas alegado em rodada anterior | verificação no CI do GitHub do HEAD atual | não existe (§7) |

### 6.2 Tentativas do smoke completo

Comando-base (mesmo `playwright.config.ts` do projeto; Chromium pré-instalado no sandbox, por isso a variável de ambiente):
```
npm run build
CHAOSBEY_PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  npx playwright test -c tests/smoke/playwright.config.ts --reporter=line
```
(45 testes em 28 arquivos; `webServer` sobe `vite preview` na porta 4173.)

| # | Quando (UTC) | Build testado | O que aconteceu | Specs completados |
|---|---|---|---|---|
| A1 | 2026-10-01 ~22:40–23:00 | `65531b8` (**antes** de `1ccc600`) | Suíte inteira em segundo plano; chegou a `[15/45]`; **encerrada por mim com `pkill`** porque o build ficou obsoleto (e disputaria a porta 4173). Sem falhas vistas. **Inválida para o HEAD.** | ~14 testes, 0 falhas |
| A2 | 2026-10-01 ~23:01–23:06 | `1ccc600` | Suíte inteira em segundo plano; log parou em `[11/45]` (mtime 23:06); o processo **morreu** (sessão ficou ociosa). Nenhuma falha registrada. | 10 testes completos, 1 em andamento |
| A3 | 2026-10-02 13:12–13:16 | `1ccc600` | Um spec por vez, em segundo plano (`run-smoke.sh`); morreu após 5 arquivos. | 5 arquivos |
| A4 | 2026-10-02 13:44–13:51 | `1ccc600` | Um spec por vez, **em primeiro plano** (`run-chunk.sh`), até um limite de tempo de ~7 min por bloco. **Parou por limite de tempo, não por falha.** | +21 arquivos |

**Descoberta operacional importante** [RELATO]: neste sandbox, processos em **segundo plano morrem quando a sessão fica ociosa**. Para rodar o smoke, usar **primeiro plano em blocos ≤ ~9 min** (limite do Bash tool = 600 s) ou um runner externo.

### 6.3 Resultado por arquivo (A3 + A4, HEAD `1ccc600`) [RELATO — log efêmero; reproduza]

Todos passaram; **nenhuma falha, nenhum flaky, nenhum `NO-SUMMARY`**:

```
aiRuntime 2 · arenaVisualConcepts 1 · beyMotionConcepts 1 · beyVisualConcepts 1 · boot 1
bowlFloors 2 · browserDeterminism 1 · cameraConcepts 1 · cameraFraming 1 · cameraPresets 3
conditionVisualConcepts 1 · debugLab 3 · driftFeedback 2 · hudAndRounds 2 · inputFocusLoss 1
jumpInputBuffer 1 · mainMenu 2 · matchFlow 1 · menuKeyboardFocus 2 · motionDirections 2
playerDirectionalControl 4 · playerFlow 1 · repeatedMatchStability 1 · resultAutoContinue 1
selfTest 1 · settingsPauseGamepad 3
```
= 26 arquivos / 42 testes. **Não rodaram:** `vfxVisualConcepts`, `webgl2Unavailable` (os 3 testes restantes dos 45, inferido).

Onde estão os logs parciais: `/tmp/claude-0/-home-user-ChaosBey/6a55c345-a720-529c-8cd4-0758ebfccff4/scratchpad/` (`smoke-results.log`, `smoke-<spec>.log`, `smoke-full.log`, `run-chunk.sh`, `run-smoke.sh`). **Efêmero e fora do repositório** — pode não existir para o próximo agente. Esta seção é o registro.

### 6.4 "Mutation checks" [RELATO / reprodutível manualmente]
Feitos nesta sessão, revertidos depois, sem artefato gravado:
- M1 (reintroduzir o bug: `ControlReference` lendo o yaw da câmera via `globalThis`): **9** testes de `cameraGameplaySeparation` falharam.
- M2 (rescue empurrando um Bey com `applyImpulse`): **13** falharam.
- Guard: identificador de câmera em `DirectionalController`, leitura de `getLastCameraOutput` em `MatchRunner`, atribuição extra em `tickCameraAndVfx` ⇒ guard falhou nas três.
Reproduzir é recomendado depois de reconciliar com a `main` (§9 etapa F/I).

---

## 7. CI DO GITHUB [VERIFICADO via API ao escrever]

- Workflow: **"Build and Deploy"** (`.github/workflows/deploy.yml`). Gatilhos: `push` em `main`, `pull_request` (sem filtros), `workflow_dispatch`. Jobs: `build`, `smoke` (`needs: build`; roda `npm run test:smoke` completo com Playwright), `deploy`.
- Runs nesta branch (somente 2):
  - run `36919127799` (#235), PR #79 time — head `105fd1c69332e1b95b89f4977d8bd4adcb8005c2` — **success**.
  - run `36936636221` (#241) — head `65531b8b772ea885540af11977cee029640fd803` — **success**, 22:42:09→22:57:27 UTC de 10-01. [NÃO VERIFICADO] se o job `smoke` fez parte dessa run (só vi o check `build` enquanto rodava; a run durou ~15 min). Verificar com `actions_list list_workflow_jobs` na run 36936636221.
- **HEAD atual `1ccc60097aebafd57cb8ac4779a3ff752d84562d`: NENHUM workflow run e NENHUM check run** (`get_check_runs` → `total_count: 0`; `list_workflow_runs` filtrado pela branch → só os 2 acima), verdadeiro ao escrever.
- Motivo da ausência: **NÃO COMPROVADO.** Observações factuais, sem concluir:
  - O push de `1ccc600` ocorreu em 2026-10-01 ~23:00 UTC.
  - A PR está `mergeable_state: "dirty"` agora. [NÃO VERIFICADO] se já estava em conflito no momento do push (a `main` só recebeu a #83 em 2026-10-02 10:11 -03, **depois** do push; não datei quando os conflitos surgiram). Sabe-se que o GitHub, em geral, não dispara workflows de `pull_request` quando o merge de teste não pode ser criado, mas isso **não foi confirmado** para este caso.
  - Não tentei `workflow_dispatch`, nem commit vazio, nem reabrir a PR (commit vazio/reabrir é proibido pelas regras do ambiente).
- [RECOMENDAÇÃO] Depois de reconciliar com a `main` e dar push, o CI deve disparar sozinho; se não disparar, investigar antes de qualquer outra coisa.

---

## 8. RELAÇÃO COM A MAIN NOVA / ARENA 3×

- Commit que introduziu a arena 3×: **`781d71da85c32ca9ce2bdb0e6eee701f0d5b526e`** — merge da PR #83 "Arena scale pass (3x stage, 2.5 m central basin) — v0.12.0". A `main` também recebeu #84 (visual-condition), #85 (visual-hybrid-vfx), e vários fixes de smoke/seeds (33 commits ao todo à frente da branch; ex.: `4ecaab8` "driftFeedback robust…", `48240b1` "resultAutoContinue smoke…", `ed3e04d` "Re-pin seeds for the 144-cell floor; stub DOM canvas in render-independence test…", `462b15b` "Floor heightfield 288→144 cells").
- Por que a PR #81 precisa ser reconciliada: `mergeable_state: dirty` (3 conflitos textuais) + a base de todos os testes/builds da branch é anterior à arena 3×.
- Diff de `main` vs merge-base em áreas que a PR toca (`src/camera src/input src/app/session src/app/frontend src/app/simulation src/config`): `MatchRunner.ts` (poucas linhas), `SettingsScreen.ts (+28)`, `quality.ts`, **`MatchSession.ts (+159)`**, `MatchConfig.ts`, `PlayerSettings.ts (+22)`. **`src/camera/` e `src/input/` NÃO foram tocados pela main** (verificado por `git diff --stat`).

### 8.1 Conflitos textuais (dry-run `git merge-tree`) [VERIFICADO]
1. `src/app/frontend/MatchRunner.ts` — bloco de imports (~linhas 27–35): a PR troca o import de `DirectionalController` e adiciona `createPlayerControl`/`controlSetupFor`; a main adiciona `type ConditionLayerSetting` ao import de `PlayerSettings`. **Resolução natural: união** (manter os imports da PR e o `ConditionLayerSetting`).
2. `src/app/session/MatchSession.ts` — interface `MatchSessionOptions` (~93–108): a PR adiciona `cameraRig?: CameraObserver | null`; a main adiciona `presentationFeatures?` e `conditionLayers?`. **Resolução natural: manter os três campos.**
3. `tests/unit/settingsAndGamepad.test.ts` — expectativa de `DEFAULT_PLAYER_SETTINGS`: a PR espera `controlScheme: 'opponent'`; a main espera `controlScheme: 'directional'` **e** `conditionLayers: ['A']`. **Resolução: `controlScheme` conforme a decisão do §5 + `conditionLayers: ['A']`.**

Auto-mescláveis (merge automático, mas **revisar o resultado**): `OWNER_DECISIONS_MASTER.md`, `design-decisions/README.md`, `SettingsScreen.ts`, `PlayerSettings.ts`, `DebugLabMode.ts`.

### 8.2 Conflitos SEMÂNTICOS prováveis (não aparecem como conflito de texto) [NÃO VERIFICADO — checar depois do merge]
- **Guard AST (§3.9 item 4)**: a main adicionou +159 linhas em `MatchSession.ts` (presentation features/hybrid VFX/condition visuals). Se código novo tocou `cameraRig`/`lastCameraOutput` fora dos membros permitidos, ou adicionou atribuições em `tickCameraAndVfx` após o guard, o teste vai falhar — **isso é um sinal legítimo, não "consertar o teste"**: examine se a lógica nova é só apresentação e reposicione-a.
- **`cameraGameplaySeparation.test.ts`** usa coordenadas absolutas (teleports para `x=±8.5, z=8.5`, rim/bowl) e floors `flat/bowl-a/bowl-b/bowl-c`, e asserts de cobertura (rescue acontece, knockback acontece). Com **arena 3× / bacia de 2,5 m / malha 144 células** as coordenadas e a cobertura podem mudar (um rescue pode não disparar, etc.) — re-ancorar os cenários, **sem enfraquecer** as asserções de igualdade de gameplay.
- Smokes de Settings na main podem ainda procurar rádios/rótulos antigos ("Directional") ou `controlScheme: 'directional'`; `playerDirectionalControl.spec.ts` assume posições de Bey/oponente na arena antiga (`opponent` em `(7.5,7.5)` e `(−8,3)`).
- Existe na main um "render-independence test" (commit `ed3e04d`); examinar se sobrepõe `cameraGameplaySeparation` (G) — não remover nenhum dos dois sem entender.
- `RIG_DIRECTOR_OPTIONS.arena.containRadiusM = 10.5` (câmera) é fixo; a main **não** tocou `src/camera/`. Qualquer retuning de câmera para a arena 3× é **fora do escopo** desta PR.

### 8.3 Fora do escopo desta PR
Arena 3× e bacia de 2,5 m; piso/heightfield; jump input buffer; VFX híbrido; condition visuals/Stamina visuals; protótipo de Motion; balanceamento; retune de IA; ajuste de câmera de apresentação para a nova arena. A reconciliação **não pode** restaurar dependência causal câmera→gameplay para "resolver" nada.

---

## 9. PLANO EXATO PARA O PRÓXIMO AGENTE

> Pré-condição: o proprietário voltou a autorizar trabalho. **Não mergear.** Todos os comandos em `/home/user/ChaosBey`.

**A. Atualizar/fetch da main**
- `git fetch origin main claude/camera-moving-player-u5wrem && git log --oneline -3 origin/main`
- Esperado: `origin/main` ≥ `781d71d`; HEAD local `1ccc600…` (ou o commit do handoff por cima). Se a `main` andou, refaça o dry-run.
- Regressão: HEAD local ≠ `origin/<branch>` ⇒ pare e entenda.
- NÃO alterar: nada ainda.

**B. Examinar divergência**
- `git rev-list --left-right --count HEAD...origin/main` ; `git merge-tree --write-tree --name-only HEAD origin/main`
- Esperado: 3 conflitos textuais (§8.1); outros ⇒ investigar.
- NÃO alterar: não rebaseie (histórico compartilhado da PR); **prefira merge da main na branch** (regra do ambiente: nunca reescrever histórico de PR).

**C. Reconciliar com a main atual**
- `git merge origin/main` (merge commit; sem rebase/force-push).
- Arquivos: `MatchRunner.ts`, `MatchSession.ts`, `tests/unit/settingsAndGamepad.test.ts` + revisar os auto-mesclados.
- Esperado: conflitos só nos três.
- NÃO alterar: física, arena, VFX, câmera.

**D. Resolver conflitos preservando os invariantes (§10)**
- MatchRunner: união de imports. MatchSession: manter `cameraRig`, `presentationFeatures`, `conditionLayers`. Settings test: `conditionLayers: ['A']` + `controlScheme` conforme §5 (ver G).
- Regressão: qualquer linha que volte a ligar `getLastCameraOutput` a input/`MatchRunner`/`DebugLabMode`.
- NÃO alterar: os guards.

**E. Revisar o diff pós-reconciliação**
- `git diff origin/main...HEAD --stat` ; ler `git diff origin/main...HEAD -- src/app/session/MatchSession.ts src/app/frontend`.
- Esperado: diff da PR ≈ 46 arquivos (menos o que a main já tinha). Procurar código da main dentro de `tickCameraAndVfx`/`renderFrame` (§8.2).
- NÃO alterar: código de apresentação da main, a não ser para mantê-lo atrás do guard.

**F. Verificar os quatro esquemas**
- `opponent`, `classic`, `arena`, `screen` presentes: `grep -n "case '" src/app/frontend/controlReferences.ts` ; `grep -n "CONTROL_SCHEMES" src/config/settings/PlayerSettings.ts` ; abrir Settings no navegador.
- Esperado: 4 rádios, `screen` último `case`, único leitor de câmera.
- Regressão: `screen` vazando para outro `case` ou outro arquivo.
- NÃO alterar: semântica de nenhum esquema.

**G. Default / migração — SEM decidir sozinho**
- Levar o §5 ao proprietário (ou obter a decisão por escrito). Enquanto não decidir: **manter o comportamento atual** (default `opponent`, fallback implícito) e dizer explicitamente na PR que a decisão está pendente.
- Arquivos (quando decidido): `PlayerSettings.ts` (`sanitizePlayerSettings`), `tests/unit/directionalInput.test.ts`, `tests/unit/settingsAndGamepad.test.ts`, `SettingsScreen.ts`, docs.
- NÃO alterar: não migrar saves "porque parece melhor".

**H. Typecheck**
- `npx tsc --noEmit -p .` — esperado: sem saída. Regressão: erros em `MatchSession`/`SettingsScreen` por campos novos da main.

**I. Testes**
- `npx vitest run tests/unit/inputCameraBoundary.test.ts tests/unit/directionalInput.test.ts tests/deterministic/cameraGameplaySeparation.test.ts` primeiro (rápido, ~40 s), depois `npm test` (~100 s).
- Esperado: tudo verde (mais testes que 1064 por causa da main). Regressão: falha no guard ou na suíte de separação = sinal real; só ajuste cenários de **cobertura/coordenadas** (arena 3×), nunca as asserções de igualdade.
- Opcional (recomendado) refazer os mutation checks do §6.4 para provar que os guards ainda detectam.
- NÃO alterar: não pular, enfraquecer ou "quarentenar" teste.

**J. Build**
- `npm run build` — esperado: ok (warning de chunk grande é pré-existente). 

**K. Smoke completo**
- Rodar **em primeiro plano, em blocos ≤ 9 min** (processos em segundo plano morrem no sandbox): para cada `tests/smoke/*.spec.ts`: `CHAOSBEY_PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test -c tests/smoke/playwright.config.ts <nome>` e registrar o resumo por arquivo. São 28 arquivos / 45 testes; lembrar de `vfxVisualConcepts` e `webgl2Unavailable`.
- Alternativa: deixar o CI rodar o job `smoke` e ler o resultado (preferível — custa zero cota local).
- Esperado: 28/28 arquivos sem falhas. **Parcial ≠ verde.**
- NÃO alterar: não reexecutar o que já passou sem motivo.

**L. Validar console/browser/runtime**
- `npm run build && npx vite preview --port 4173` e abrir `/ChaosBey/?mode=play` e `?mode=debug-lab` em Chromium; segurar ↑ por 20 s com a câmera orbitando; trocar entre os 4 esquemas em Settings; checar erros de console. (Os specs `playerDirectionalControl` e `settingsPauseGamepad` cobrem parte disso.)
- Esperado: sem `pageerror`; troca de esquema ao vivo funciona (`MatchRunner.setControlScheme` → `setReference`+`setEnabled`).

**M. CI correspondente ao HEAD final**
- Após o push: `list_workflow_runs` filtrado pela branch e `get_check_runs` da PR; **o `head_sha` do run deve ser o HEAD final**. Se não aparecer run, investigar (não usar commit vazio nem reabrir a PR).
- Esperado: `build` e `smoke` verdes no HEAD final.

**N. Só então avaliar ready-for-review**
- Atualizar o corpo da PR (está desatualizado: §1.5) com o estado real; deixar **draft**; **pedir autorização do proprietário** para ready/merge. Não mergear.

---

## 10. INVARIANTES QUE NÃO PODEM SER QUEBRADOS (checklist)

- [ ] A câmera **nunca** altera gameplay.
- [ ] A câmera **nunca** altera física (nem impulso, posição, velocidade, heading, steering, freio).
- [ ] A câmera **nunca** altera `moveIntent` nem o input.
- [ ] Os esquemas `opponent`, `classic`, `arena` **não dependem da câmera** (nem por callback, nem por número).
- [ ] `screen` é a **única** exceção opt-in autorizada, confinada ao `case 'screen'` de `controlReferences.ts`, nunca o default.
- [ ] A câmera **pode observar** gameplay (frame/eventos de impacto/estado são entrada legítima da câmera).
- [ ] Os **quatro** esquemas permanecem disponíveis em Settings.
- [ ] Não restaurar o caminho causal removido (`cameraYaw`, `gestureYaw`, `CameraYawLatch`, `cameraYawFromRight`, leitura de câmera em `MatchRunner`/`DebugLabMode`).
- [ ] `right` = quarto de volta **horário** de `up` (nunca `perpendicular(up)`).
- [ ] `src/input/` e demais camadas de gameplay não mencionam "camera" no código.
- [ ] `src/camera/` só importa de si + `ImpactEvent` + `AttackState` + `three`.
- [ ] Não alterar física/balanceamento/IA sem autorização.
- [ ] Não alterar stage/arena além do estritamente necessário para compatibilidade com a main.
- [ ] A câmera continua tão dinâmica quanto o Camera Lab exige (não congelar, não prender atrás do jogador, não remover rescue/look-ahead/knockback follow).
- [ ] **Não mergear sem autorização do proprietário.** Não marcar ready sem autorização.

---

## 11. RISCOS E ARMADILHAS

- **Resolver conflito escolhendo a versão errada** (ex.: pegar o import antigo de `DirectionalController` da main e perder `createPlayerControl`; ou descartar `cameraRig`/`presentationFeatures` de um dos lados).
- **Reintroduzir leitura de câmera em gameplay** por conveniência (ex.: "só o yaw para um HUD de controle", "só um número"). O guard bloqueia por design; não afrouxe o guard.
- **`screen` vazando**: mover a leitura da câmera para fora do `case 'screen'`, ou usar `createLatchedReference` com fonte de câmera em outro esquema.
- **Migrar save antigo para comportamento diferente sem decisão** (§5). `directional` → `opponent` já muda o comportamento hoje.
- **Confiar em testes antigos depois de reconciliar a main**: tudo do §6 foi na base antiga.
- **Considerar smoke parcial como suficiente** (26/28 arquivos ≠ verde; e foi na base antiga).
- **Misturar correção da arena 3× com esta PR** (coordenadas dos testes, containRadius da câmera, etc.). Re-ancore só o necessário nos testes desta PR.
- **Alterar a câmera de apresentação para "resolver" controle** (a regra é o inverso).
- **`impactEvents` compartilhado**: o array de `ImpactEvent` que a câmera recebe é a mesma referência que o `VfxManager` usa. Uma câmera hostil poderia mutá-lo e afetar **VFX** (não gameplay; hitstop usa dados próprios do stepper). O teste hostil tenta mutar o frame. Se endurecer, copiar/congelar o array — fora do escopo mínimo.
- **TypeScript 7 não tem API de compilador em JS** (`import ts from 'typescript'` falha). O guard usa `rolldown/parseAst` (dependência transitiva do Vite/rolldown) — um upgrade do Vite pode quebrá-lo.
- **Processos em segundo plano morrem** no sandbox quando a sessão fica ociosa; `pkill -f` pode matar o próprio shell (matou uma vez).
- **Sem DOM no vitest (node)**: `renderFrame` precisa de `document`; o teste faz `vi.stubGlobal`.
- **O corpo da PR está desatualizado** (diz "smoke em execução").
- **`CLAUDE.md` pré-autoriza merge** — para esta PR o proprietário revogou. Não deixe o `CLAUDE.md` induzir um merge automático.
- **Nome de branch reutilizado** (a #79 já mergeada usou o mesmo): cuidado ao procurar por PR/branch.
- **Semântica nova inventada**: `opponent` é uma semântica nova de setas criada pelo agente; o proprietário já disse "não invente silenciosamente nova semântica". Está sinalizada como pendente.

---

## 12. DECISÕES DO PROPRIETÁRIO

### 12.1 Decisões EXPLÍCITAS do proprietário (somente estas)
1. **Requisito absoluto**: "Camera is downstream presentation. It may observe gameplay; it may never mutate or causally influence gameplay." A câmera se acomoda ao Bey; o Bey nunca à câmera; vale direta e indiretamente.
2. A correção deve ser **arquitetural, não outro latch**; **proibido** reduzir/congelar a câmera, remover rescue/look-ahead/KnockbackFollow, alterar física/steering/grip/velocidade para disfarçar, ou só mudar comentário/teste.
3. Fazer em **PR própria**, escopo exclusivo "CAMERA / GAMEPLAY CAUSAL SEPARATION" (sem jump buffer, arena, stage 3×, bowl 2,5 m, VFX, Stamina visuals, Motion, balanceamento, retune de IA).
4. **Não mergear automaticamente; não usar o `CLAUDE.md` como autorização de merge**; só após gate completo (typecheck, unit, deterministic, build, **smoke COMPLETO**, regressões novas, CI inteiro) **e revisão do proprietário**. "Testes locais verdes" não é "gate completo verde".
5. Testes obrigatórios A–G (zero input, input real pelo mesmo controller do PLAY, offscreen rescue, knockback follow, crossing/side switch, settings, render desligado), sem retries.
6. **Rejeição** da arena fixa como padrão provisório: "MAS EU NUNCA QUIS ISSO".
7. **"Adiciona TODOS como opção"**: oferecer os quatro esquemas como opções selecionáveis.
8. Mais recente: **NÃO continuar implementando; NÃO mergear; NÃO rebasear/mesclar a `main` ainda; NÃO gastar sessão no smoke completo**; criar este documento primeiro; **não marcar a PR como ready**.
(Não é decisão do proprietário, só contexto: a versão do jogo em `package.json` desta branch é `0.11.0`; a `main` atual é `0.12.0`.)

### 12.2 Ainda NÃO decidido
- **Qual esquema é o default.** `opponent` foi escolha do agente.
- **Como migrar saves legados com `controlScheme: 'directional'`** (§5).
- **Confirmação** de que a opção `screen` conta como a exceção formal à regra (o agente leu "Adiciona TODOS" como autorização; ver §4).
- Se `screen` e/ou `arena` ficam visíveis para todos os jogadores em Settings ou ficam marcados como "avançado/experimental".
- Qualquer retuning da câmera de apresentação para a arena 3× (fora desta PR).
- Quando/como tirar a PR de draft e mergear (só o proprietário decide).

---

## 13. COMANDOS DE VERIFICAÇÃO E ARQUIVOS-CHAVE

Comandos úteis:
```
git fetch origin main claude/camera-moving-player-u5wrem
git rev-list --left-right --count HEAD...origin/main
git merge-tree --write-tree --name-only HEAD origin/main      # dry-run, não muda a árvore
git diff --name-status -M $(git merge-base HEAD origin/main) HEAD
npx tsc --noEmit -p .
npx vitest run tests/unit/inputCameraBoundary.test.ts tests/unit/directionalInput.test.ts tests/deterministic/cameraGameplaySeparation.test.ts
npm test
npm run build
CHAOSBEY_PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  npx playwright test -c tests/smoke/playwright.config.ts playerDirectionalControl settingsPauseGamepad
grep -rnE "cameraYaw|gestureYaw|CameraYawLatch|cameraYawFromRight" src tests     # deve voltar vazio (exceto comentários/testes de smuggling)
```

Ler primeiro, nesta ordem:
1. `docs/design-decisions/camera-gameplay-separation.md` (invariante, auditoria, esquemas)
2. `src/input/directional/ControlReference.ts`, `DirectionalController.ts`, `createPlayerControl.ts`, `screenDirection.ts`
3. `src/app/frontend/controlReferences.ts` (única exceção) e `MatchRunner.ts` (`create`, `setControlScheme`)
4. `src/app/session/MatchSession.ts` (`cameraRig`, `tickCameraAndVfx`, `renderFrame`) e `src/camera/director/CameraRig.ts` (`CameraObserver`)
5. `tests/unit/inputCameraBoundary.test.ts` (guard) e `tests/deterministic/cameraGameplaySeparation.test.ts`
6. `src/config/settings/PlayerSettings.ts` (default/sanitize) e `src/app/frontend/SettingsScreen.ts`
7. `tests/smoke/playerDirectionalControl.spec.ts`
8. `CLAUDE.md` (lembrar da revogação do merge automático, §12) e `.github/workflows/deploy.yml`

---

## 14. ESTADO FINAL DO HANDOFF (resumo)

- **Onde estamos:** PR #81 aberta como **draft**, HEAD `1ccc60097aebafd57cb8ac4779a3ff752d84562d`, **2 à frente / 33 atrás** da `main` (`781d71da…`, arena 3× / v0.12.0); GitHub: `dirty` (3 conflitos textuais).
- **Comprovado (na base antiga):** typecheck, `npm test` (1064), build e 26/28 arquivos de smoke verdes; guard AST e suíte de independência passam; mutation checks pegaram o bug original [RELATO].
- **Não comprovado:** nada contra a main atual; smoke completo **não terminou** (2 arquivos nunca rodaram); **sem CI** para o HEAD atual (causa desconhecida).
- **Pendente (proprietário):** default dos esquemas e migração de saves `directional`; confirmação da exceção `screen`; ready/merge.
- **Os 4 esquemas ficam** (`opponent`, `classic`, `arena`, `screen`); `screen` é a única leitura de câmera, só em `controlReferences.ts`.
- **Não fazer:** merge, ready, restaurar câmera→gameplay, mexer em física/arena/câmera, migrar saves por conta própria.
- **Primeiro passo recomendado:** `git fetch` + dry-run `git merge-tree`, depois `git merge origin/main`, resolver os 3 conflitos (§8.1) preservando os invariantes, rodar o guard e `cameraGameplaySeparation` antes de qualquer outra coisa.
