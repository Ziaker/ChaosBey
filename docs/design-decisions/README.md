# ChaosBey — Design Decision Index

Este diretório contém decisões de design que agentes **não devem reabrir** sem nova instrução explícita do owner.

## Ordem de leitura obrigatória para trabalho visual

1. **`VISUAL_APPROVALS_MASTER.md`** — estado canônico consolidado e regras de precedência.
2. Documento detalhado da área afetada.
3. `visual-prototype-inventory.md` apenas como inventário/histórico e para localizar labs; ele pode conter linhas antigas posteriormente superseded.

## Fontes por área

| Área | Documento |
|---|---|
| Estado consolidado de todos os protótipos visuais | `VISUAL_APPROVALS_MASTER.md` |
| Beys, Arena e VFX | `visual-prototypes-approval.md` |
| Stamina / Stability / Quebrado | `condition-visual-approval.md` |
| Camera Director e presets | `camera-approval.md` |
| Movimento / Motion Lab | `motion-approval.md` |
| Apresentação do Clash | `clash-presentation-approval.md` |
| Inventário/histórico de labs | `visual-prototype-inventory.md` |

## Precedência

- Uma decisão explícita mais recente do owner vence uma formulação antiga.
- Quando `VISUAL_APPROVALS_MASTER.md` marcar `OWNER OVERRIDE` ou `SUPERSEDED`, aquela correção prevalece sobre inventários/documentos históricos conflitantes.
- Para valores numéricos exatos, use o documento detalhado da área, salvo supersessão explícita.
- `PROTOTIPADO`, `APROVADO` e `INTEGRADO` são estados diferentes.
- UI/debug de um lab não é automaticamente UI final do jogo.

## Owner override vigente sobre o roster

**Os 9 conceitos de Bey aprovados são todos selecionáveis/jogáveis.**

Qualquer texto antigo dizendo para escolher apenas três finalistas está superseded nesse ponto. Os códigos/nomenclatura final e outras decisões independentes continuam regidos pelos documentos atuais.

## Regra de manutenção

Ao registrar uma nova decisão:

1. atualizar o documento detalhado da área;
2. atualizar o master se o resumo/status mudou;
3. marcar decisões antigas como superseded quando necessário;
4. atualizar o inventário;
5. preservar o histórico em vez de apagar contexto útil.
