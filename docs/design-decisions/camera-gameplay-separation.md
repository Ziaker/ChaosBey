# Câmera × Gameplay — separação causal

**Estado:** OWNER OVERRIDE (2026-10-01). Esta é uma invariante, não uma pendência.

> **Camera is downstream presentation. It may observe gameplay; it may never mutate or causally influence gameplay.**

A câmera se acomoda ao Bey. O Bey **nunca** se acomoda à câmera — nem direta, nem indiretamente.

```
GAMEPLAY ──► CAMERA        (permitido: a câmera observa)
CAMERA   ──► GAMEPLAY      (PROIBIDO, por qualquer caminho)
```

A única exceção deliberada é o esquema de controle **`screen`**, selecionado pelo jogador: ele usa a orientação da tela no início de cada gesto. Essa exceção pertence ao mapeamento de input opt-in e não autoriza nenhum outro caminho câmera → gameplay.

## O que a câmera pode fazer

Qualquer coisa que mude **somente a própria câmera/apresentação**: orbitar, aproximar/afastar, mudar FOV, focus/look-at, shake, look-ahead, pullback, push-in, knockback follow, ring-out, offscreen rescue, trocar de lado, composição, enquadramento, cinematografia de Clash e de finalização.

"Rescue" resgata **o enquadramento**, não o Bey. "Follow" é **a câmera** seguir o Bey.

## O que nenhum desses mecanismos pode fazer

Mover, reposicionar, teletransportar, frear, acelerar, girar, aplicar impulso, corrigir posição, alterar trajetória/steering/heading/velocidade, modificar `moveIntent`/input, física, knockback, drift, jump, dodge ou qualquer variável de gameplay para ajudar composição ou enquadramento. Se o enquadramento está ruim, **mova a câmera**.

## Auditoria (2026-10-01): caminhos câmera → gameplay encontrados

| # | Caminho | Estado |
|---|---|---|
| 1 | `CameraRig` → `MatchSession.getLastCameraOutput().yawDeg` → `MatchRunner` → `DirectionalController.cameraYaw()` → `screenToWorld()` → `moveIntent` → `MovementController` → física do Bey | **REMOVIDO.** O bug original. A #79 só o escondia atrás de um latch (`gestureYaw`); o caminho causal continuava. |
| 2 | O mesmo callback em `DebugLabMode` | **REMOVIDO** |
| 3 | `cameraYawFromRight()` em `screenDirection.ts` (helper de input derivado da matriz da câmera) | **REMOVIDO** |
| 4 | `app/simulation` (`MatchStepper`, `Hitstop`) importava `src/camera/ImpactEvents`, `ImpactMagnitude` e `CameraTuning` (constantes de hitstop) | **REMOVIDO.** Lógica de gameplay vivia na pasta da câmera; movida para `src/app/simulation/{impact/,HitstopTuning.ts}`. A câmera agora importa de lá (observa gameplay). |
| 5 | Teste `inputCameraBoundary` aceitava a câmera chegando como `number` por callback, e o "twin camera independence" usava Classic (sem `DirectionalController`) | **CORRIGIDOS** — ver Guards e Testes |

Sem causa na câmera, verificados e limpos: `MovementController`, drift, jump, dodge, combate, AI, replay, arena, self-test, automation.

## Arquitetura depois

- **Controle:** `input/directional/ControlReference.ts` — o referencial das setas é responsabilidade de **input/gameplay** (arena fixa, bearing ao oponente, ou — só no esquema opt-in `screen` — um yaw lido uma vez por gesto). `DirectionalController` não aceita callback/número de câmera. `createPlayerControl()` é a fábrica única usada por PLAY, Debug Lab e testes.
- **Câmera:** `CameraObserver` (`CameraRig.ts`) — o que o `MatchSession` precisa de uma câmera. `MatchSession.create({ cameraRig })`: omitido = Camera Director real; `null` = sem câmera (render desligado). Saída da câmera alimenta `lastCameraOutput`; ela serve render/debug e, somente quando o jogador seleciona `screen`, a leitura confinada em `controlReferences.ts`.
- **Guard** (`tests/unit/inputCameraBoundary.test.ts`, AST): (1) camadas de gameplay não importam `src/camera/` nem recebem câmera disfarçada por callback/número; (2) a câmera só importa dependências de observação permitidas; (3) a saída da câmera só é lida pelos pontos de apresentação/debug e pela exceção confinada do `case 'screen'`; (4) dentro do `MatchSession`, rig/saída só são tocados pelos membros de câmera/render, e o tick da câmera só escreve `lastCameraOutput`.
- **Prova em runtime** (`tests/deterministic/cameraGameplaySeparation.test.ts`, sem retries): a mesma luta roda com câmera ausente / congelada / real / hostil e compara o estado de gameplay tick a tick. Para `opponent`, `arena` e `classic`, trocar a câmera não muda gameplay; `screen` é testado separadamente como a única exceção opt-in.

## Esquemas de controle (owner: "adiciona TODOS como opção", 2026-10-01)

Todos permanecem selecionáveis em Settings → Control.

| Esquema (`ControlScheme`) | Significado | Lê a câmera? |
|---|---|---|
| `opponent` (**default de instalação nova**) | ↑ em direção ao oponente, ↓ afasta, ←/→ circulam. Só depende das posições dos Beys. | Não |
| `classic` | Relativo ao Bey (kart): ←/→ giram, ↑/↓ aceleram/freiam no sentido do heading. | Não |
| `arena` | Direções fixas da arena: ↑ = −Z, → = +X. | Não |
| `screen` | ↑ = "para cima na tela" como a câmera estava ao começar a mover; travado até soltar. | **Sim — única exceção opt-in.** |

O pedido explícito do owner é que **todos os quatro existam como opções**. O default `opponent` é uma escolha de implementação para instalações novas, por ser camera-independent; não deve ser registrado como uma preferência de design escolhida pelo owner.

- O ponto único de configuração é `app/frontend/controlReferences.ts` (`controlSetupFor`), usado por PLAY, Debug Lab e testes. É o **único** arquivo permitido a ler a saída da câmera para controle, e essa leitura fica confinada ao `case 'screen'`.
- Os testes de separação provam independência da câmera para `opponent`, `arena` e `classic` e provam que `screen` é o único esquema em que a câmera muda o referencial de movimento.
- **Compatibilidade de saves:** o antigo `controlScheme: "directional"` significava o comportamento relativo à tela/câmera. Ele migra explicitamente para **`screen`**, preservando o comportamento já salvo. Saves sem campo de esquema e instalações novas usam `opponent`.

### Bug corrigido junto: espelhamento esquerda/direita

O mapeamento antigo usava `right = perpendicular(up)`, que correspondia ao lado errado para a convenção da tela. `right` agora é sempre o quarto de volta horário de `up` visto de cima (`right = (−up.z, up.x)`), testado para qualquer yaw de referência.

## Não resolver assim (proibido pelo owner)

Outro latch sobre `gestureYaw`; reduzir órbita; congelar/prender a câmera atrás do jogador; remover offscreen rescue; diminuir look-ahead/KnockbackFollow; mexer em física/steering/grip/velocidade; só atualizar comentário/teste para aceitar o comportamento.
