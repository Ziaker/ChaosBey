# Câmera × Gameplay — separação causal

**Estado:** OWNER OVERRIDE (2026-10-01). Esta é uma invariante, não uma pendência.

> **Camera is downstream presentation. It may observe gameplay; it may never mutate or causally influence gameplay.**

A câmera se acomoda ao Bey. O Bey **nunca** se acomoda à câmera — nem direta, nem indiretamente.

```
GAMEPLAY ──► CAMERA        (permitido: a câmera observa)
CAMERA   ──► GAMEPLAY      (PROIBIDO, por qualquer caminho)
```

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

Sem causa na câmera, verificados e limpos: `MovementController`, drift, jump, dodge, combate, AI, replay, arena, self-test, automation (nenhuma menção a câmera em código).

## Arquitetura depois

- **Controle:** `input/directional/ControlReference.ts` — o referencial das setas é responsabilidade de **input/gameplay**. `DirectionalController` não aceita nenhum callback/número de câmera. `createPlayerControl()` é a fábrica única usada por PLAY, Debug Lab e testes.
- **Câmera:** `CameraObserver` (`CameraRig.ts`) — o que o `MatchSession` precisa de uma câmera. `MatchSession.create({ cameraRig })`: omitido = Camera Director real; `null` = sem câmera (render desligado). Saída da câmera só alimenta `lastCameraOutput`, lida por `renderFrame()` e pelos readouts de debug.
- **Guard** (`tests/unit/inputCameraBoundary.test.ts`, AST): (1) camadas de gameplay não importam `src/camera/` nem mencionam "camera" em código; (2) a câmera só importa de si mesma + o tipo `ImpactEvent` e o enum `AttackState` (nada que ela possa mutar); (3) a saída da câmera só é lida por `MatchSession.renderFrame` e pelo overlay/inspector de debug; (4) dentro do `MatchSession`, rig/saída só são tocados pelos membros de câmera/render, e o tick da câmera só escreve `lastCameraOutput`.
- **Prova em runtime** (`tests/deterministic/cameraGameplaySeparation.test.ts`, sem retries): mesma luta com câmera ausente / congelada / real (presets A/B/C, efeitos, aspect, overview) / hostil (teleporta eye/focus, FOV 5°–145°, shake enorme, tenta mutar o frame) ⇒ estado de gameplay idêntico em **todo tick** (ações, `moveIntent`, snapshot completo por Bey, eventos, knockback, aceleração, posição, velocidades linear/angular, rotação, heading, hash canônico). Cobre zero input, input real complexo (Directional **e** Classic pelo mesmo controller do PLAY), offscreen rescue, knockback follow, crossing/side switch, settings e render desligado.

## ⚠️ DECISÃO PENDENTE DO OWNER — referencial das setas (Directional)

A invariante acima **não** está pendente. O que está pendente é **qual referencial de gameplay** o modo Directional (padrão) usa, agora que a câmera não pode ser um:

| Opção | Efeito | Observação |
|---|---|---|
| **Arena fixa** (interino, o que está no código) | ↑ = +Z, → = +X, sempre | É o mapeamento que o owner já aprovou em "Fix 5". Com a câmera orbitando livremente, "para cima" nas setas pode não ser "para cima" na tela. A câmera é quem deve compensar, não o controle. |
| **Relativo ao Bey** | ↑ ao longo do heading, ←/→ giram | É o Classic. Sem eixo de mundo para desalinhar da tela. |
| Outro referencial de gameplay (ex.: linha jogador→oponente) | — | **Só com decisão explícita do owner.** Nenhum foi implementado. |

O ponto de encaixe é único: `ControlReference` + `createPlayerControl`. Nenhuma opção envolve a câmera. Até o owner decidir, o código usa **arena fixa**.

## Não resolver assim (proibido pelo owner)

Outro latch sobre `gestureYaw`; reduzir órbita; congelar/prender a câmera atrás do jogador; remover offscreen rescue; diminuir look-ahead/KnockbackFollow; mexer em física/steering/grip/velocidade; só atualizar comentário/teste para aceitar o comportamento.
