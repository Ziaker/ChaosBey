# ChaosBey — Design Decision Index

Este diretório contém decisões de design que agentes **não devem reabrir** sem nova instrução explícita do owner.

## Ordem de leitura obrigatória

1. **`OWNER_DECISIONS_MASTER.md`** — ledger mais recente de decisões fechadas, owner overrides e pendências reais. Ler primeiro.
2. **`VISUAL_APPROVALS_MASTER.md`** — estado consolidado dos protótipos e aprovações visuais.
3. Documento detalhado da área afetada.
4. `visual-prototype-inventory.md` apenas como inventário/histórico e para localizar labs; ele pode conter linhas antigas posteriormente superseded.
5. Status docs/código atual para distinguir `APROVADO`, `PROTOTIPADO` e `INTEGRADO`.

## Fontes por área

| Área | Documento |
|---|---|
| Ledger de decisões/overrides do owner | `OWNER_DECISIONS_MASTER.md` |
| Estado consolidado dos protótipos visuais | `VISUAL_APPROVALS_MASTER.md` |
| Beys, Arena e VFX | `visual-prototypes-approval.md` |
| Stamina / Stability / Quebrado | `condition-visual-approval.md` |
| Camera Director e presets / histórico do Camera Lab | `camera-approval.md` |
| Câmera × Gameplay (a câmera nunca move o Bey; quatro esquemas de controle; única exceção opt-in `screen`) | `camera-gameplay-separation.md` |
| Câmera de combate atual — azimute inercial, composição screen-space e escala da arena 36 m | `inertial-duel-camera.md` |
| Movimento / Motion Lab | `motion-approval.md` |
| Rail Grinding — direção futura e pendências | `../planning/RAIL_GRINDING_FUTURE_UPDATE.md` |
| Apresentação do Clash | `clash-presentation-approval.md` |
| Cores dos Beys (uma por Bey), barra de Clash e plano das 4 peças | `bey-colors-plan.md` |
| Pregame — overhaul visual/UX e presets oficiais de Advanced | `pregame-overhaul.md` |
| Launch System — A Timing Snap, launcher físico, ponto de entrada e início imediato no quique | `launch-system-approval.md` |
| Fluxo do Bey — borrão de giro, inclinação, poeira anime (3 ideias), vento, argolas, texto HIT/BLOCK/COUNTER (estilo A) e o modo alternativo "Bey Real" (prototipado, não aprovado) | `bey-flow-fx-approval.md` |
| Bey Real — física realista, movimento automático e os quatro botões (lab na 0.57.0; **modo do jogo desde a 0.59.0**, §14) | `bey-real-physics-approval.md` |
| Fluxo do Bey — **especificação detalhada dos efeitos** (integrados no jogo, sliders nas Configurações) | `flow-fx-effects.md` |
| Inventário/histórico de labs | `visual-prototype-inventory.md` |

## Precedência

- Uma decisão explícita mais recente do owner vence uma formulação antiga.
- `OWNER_DECISIONS_MASTER.md` registra as decisões/overrides mais recentes que precisam impedir reabertura de perguntas já respondidas.
- Quando `VISUAL_APPROVALS_MASTER.md` ou o ledger marcar `OWNER OVERRIDE` ou `SUPERSEDED`, aquela correção prevalece sobre inventários/documentos históricos conflitantes.
- Para valores numéricos exatos, use o documento detalhado da área, salvo supersessão explícita.
- Para o comportamento de yaw da câmera de combate no jogo, `inertial-duel-camera.md` supersede o axis-follow/automatic-orbit normal descrito no estado pós-fix-8 de `camera-approval.md`; os presets A/B/C e os contextos aprovados continuam válidos.
- `PROTOTIPADO`, `APROVADO` e `INTEGRADO` são estados diferentes.
- UI/debug de um lab não é automaticamente UI final do jogo.
- Uma lacuna em HUD/UI **não** autoriza reprototipar Arena, VFX, Camera, Motion, Condition ou Clash já aprovados.

## Owner override vigente sobre o roster

**Os 9 conceitos de Bey aprovados são todos selecionáveis/jogáveis.**

Qualquer texto antigo dizendo para escolher apenas três finalistas está superseded nesse ponto. Os códigos/nomenclatura final e outras decisões independentes continuam regidos pelos documentos atuais.

## Diretiva de escopo vigente — 2026-09-30

Antes de criar um novo Lab, identificar exatamente a lacuna que permanece aberta. Sistemas já aprovados devem ser **reutilizados**, não reconstruídos para comparação.

Em particular, qualquer trabalho futuro de Combat HUD deve tratar somente layout/estética/legibilidade do HUD geral enquanto isso continuar sem escolha final documentada. Ele não deve recriar câmera, arena, movimento, VFX, condição, Clash, física, recursos ou IA.

## Sobre as referências "GDD §N"

Todos os documentos deste diretório citam números de seção de um "GDD" (Game Design Document). Esse documento **não está neste repositório** — é fornecido por fora, diretamente para os agentes de desenvolvimento (ver `CLAUDE.md`, seção 3). Uma referência "GDD §N" não é, portanto, verificável só com o que está na `main`; trate-a como vinda de uma fonte externa que o dono/agente tem em mãos, não como um arquivo que falta encontrar aqui.

## Regra de manutenção

Ao registrar uma nova decisão:

1. atualizar o documento detalhado da área;
2. atualizar `OWNER_DECISIONS_MASTER.md` se o status/precedência mudar;
3. atualizar o master visual quando a mudança for visual;
4. marcar decisões antigas como superseded quando necessário;
5. atualizar o inventário;
6. preservar o histórico em vez de apagar contexto útil.

## Regra de processo (versão e README)

Toda mudança (jogo, regras, conteúdo ou ferramentas) **sempre** atualiza o número de versão (`package.json` + `package-lock.json`, o mesmo que aparece no canto do jogo) e o `README.md` (linha **Version** e **Latest changes**). Isso vale sem pedir autorização. Detalhes em `CLAUDE.md` §4; um teste (`tests/unit/versionSync.test.ts`) quebra se os números divergirem.
