# ChaosBey — Rail Grinding Future Update Preparation

**Status:** DIREÇÃO FUTURA APROVADA PELO OWNER · NÃO INTEGRADA  
**Decisão registrada:** 2026-10-07  
**Escopo deste documento:** preparar arquitetura, integração e critérios de validação para uma atualização futura. Este documento **não implementa** rail grinding e **não fecha** decisões de gameplay/visual ainda não dadas pelo owner.

---

## 1. Direção fechada pelo owner

A futura atualização deve adicionar um sistema de **rail grinding em todos os três stages**:

- **Foundry Pit**;
- **Rift Crater**;
- **Tournament Stadium**.

O comportamento desejado deve ser **fortemente inspirado no Grind / Quickmove de Dissidia Final Fantasy**, adaptado ao ChaosBey:

- servir como rota de deslocamento rápido pelo stage;
- permitir ao Bey **ganhar velocidade**;
- permitir **reposicionamento estratégico** durante a luta;
- continuar parecendo um objeto físico com momentum, giro, tilt/wobble e peso, e não um objeto teleportado sobre um trilho.

A referência Dissidia é de **função e feeling de traversal**, não licença para copiar assets, UI, animações, efeitos, áudio ou geometria proprietária.

---

## 2. Referência Dissidia — comportamento observado, NÃO automaticamente aprovado

A referência pesquisada de Dissidia descreve o Grind/Quickmove como traversal de stage que:

- segue uma rota predefinida;
- move o personagem rapidamente ao longo dessa rota;
- permite inverter o sentido;
- pode terminar no fim do caminho com saída para movimento livre;
- em Dissidia, pode ser interrompido por outras ações.

Esses pontos ajudam a explicar a referência do owner, mas **somente os objetivos da seção 1 estão fechados para ChaosBey**. Reversão, interrupções, controles, ataques e saída ainda precisam de decisão específica antes de implementação final.

---

## 3. Estado atual do projeto verificado antes deste plano

Base inspecionada em `main` no commit `a8c4dc4dda2a468a4f0bcae4f5da3077d338693c`.

Pontos de integração existentes:

- stages/presets: `src/arena/presets/ArenaPresets.ts`;
- colliders e tuning da arena: `src/arena/colliders/`;
- apresentação dos três stages: `src/arena/visual/{foundryPit,riftCrater,tournamentStadium}.ts`;
- movimento livre: `src/bey/movement/MovementController.ts` e `MovementTuning.ts`;
- presets de movimento físico: `src/bey/motion/MotionPresets.ts`;
- Camera Director: `src/camera/director/`;
- telemetry: `src/telemetry/events/TelemetryEvent.ts`;
- automação determinística: `src/automation/scripted-scenarios/`;
- decisões atuais: `docs/design-decisions/OWNER_DECISIONS_MASTER.md`.

Invariantes já existentes que o rail grinding deve respeitar:

- heading e velocity não são a mesma coisa;
- momentum não pode ser descartado por snap;
- a câmera observa gameplay e nunca move/corrige o Bey;
- tuning importante deve ficar centralizado/documentado;
- gameplay novo deve ser determinístico, telemetrado e testável;
- visual final novo exige aprovação do owner.

---

## 4. Contrato funcional mínimo para a futura implementação

Os itens abaixo são **requisitos de preparação derivados diretamente do objetivo aprovado**, sem fixar números ou controles.

### 4.1 Rail como traversal real de gameplay

O rail deve ser uma rota de gameplay do stage, não apenas decoração.

Cada stage deve poder declarar uma ou mais rotas de rail através de dados próprios, separando:

- geometria/rota usada pelo gameplay;
- representação visual;
- VFX/áudio;
- tuning de traversal.

A implementação deve permitir mudar layout e arte sem reescrever a lógica central do movimento.

### 4.2 Estado explícito

O sistema deve possuir um estado explícito de traversal equivalente a **RailGrinding**.

O nome/classe exatos podem mudar, mas o estado precisa ser observável para:

- gameplay;
- replay;
- telemetry;
- Debug Lab;
- AI;
- testes determinísticos.

Não esconder rail grinding como uma combinação de booleans espalhados no `MovementController`.

### 4.3 Ganho de velocidade

Rail grinding deve ter potencial real de **aumentar a velocidade do Bey** durante o percurso.

Ainda não está decidido:

- aceleração do rail;
- velocidade alvo;
- velocidade máxima;
- relação com Top Speed do Pregame;
- relação com `MotionPresets` A/B/C;
- se o ganho depende da velocidade de entrada;
- se existe perda/ganho por curva.

Portanto, a futura implementação deve expor esses fatores como tuning centralizado, sem valores mágicos.

### 4.4 Reposicionamento

O rail deve permitir atravessar o stage por uma rota suficientemente distinta do movimento livre para funcionar como ferramenta de reposicionamento.

O sistema deve ser capaz de devolver o Bey ao movimento livre com a velocidade ganha no rail sem um teleporte perceptível. A forma exata de misturar:

- tangente do rail;
- heading do Bey;
- velocity de entrada;
- velocity de saída;
- eventual impulso de saída

permanece aberta.

### 4.5 Continuidade física

Ao entrar/sair do rail:

- não deve haver snap visual grande ou teleporte;
- spin, tilt, wobble e leitura de massa do Bey devem continuar coerentes;
- o sistema de rail não deve zerar arbitrariamente momentum;
- qualquer correção de posição necessária para anexar ao rail deve ser curta, observável em debug e limitada por tuning.

A trajetória pode ficar constrangida à rota enquanto o grind está ativo, mas o resultado deve continuar comunicando um Bey físico.

---

## 5. Modelo de dados que a arquitetura deve suportar

Isto é um **contrato conceitual**, não uma API final.

### RailDefinition

Deve ser possível descrever, no mínimo:

- identificador estável;
- stage ao qual pertence;
- rota amostrável em posição + tangente;
- comprimento/progresso ao longo da rota;
- regiões/candidatos válidos de entrada;
- pontos/condições possíveis de saída;
- informação de sentido/direcionalidade;
- habilitado/desabilitado;
- metadados para Debug Lab e AI.

A implementação concreta da rota (spline, segmentos, outra representação) fica aberta até a fase de código.

### RailTraversalState

O runtime deve conseguir expor, no mínimo:

- `railId`;
- progresso ao longo da rota;
- sentido atual;
- velocidade atual no rail;
- velocidade de entrada;
- tempo no rail;
- motivo de entrada;
- motivo de saída/interrupção.

Esses campos são necessários para replay, telemetry e diagnóstico. Nomes exatos podem mudar.

---

## 6. Integração com os três stages

**Obrigatório:** os três stages devem receber rail grinding na atualização futura.

O layout não está decidido. Não inventar agora número, formato, altura, raio ou posição dos rails.

A infraestrutura deve suportar:

- layouts diferentes por stage;
- diferentes quantidades de rails;
- rails abertos ou fechados, se aprovados depois;
- adaptação ao tamanho configurável do stage;
- adaptação à geometria/bowl configurável quando necessário;
- Debug Lab capaz de desenhar a rota real usada pelo gameplay.

Não hard-code coordenadas que só funcionem no tamanho/default atual da arena se o stage puder ser escalado no Pregame.

---

## 7. Integração com movimento

O rail deve se integrar ao movimento aprovado sem substituí-lo.

### Durante rail grinding

A lógica de traversal do rail passa a ser dona do avanço longitudinal pela rota.

O movimento físico existente continua sendo fonte para:

- spin;
- tilt/lean;
- wobble;
- atitude;
- leitura de impacto/instabilidade quando aplicável.

### Entrada e saída

A entrada deve capturar estado suficiente para preservar continuidade de movimento.

A saída deve devolver controle ao movimento normal com estado coerente e sem depender da câmera.

### Motion A/B/C

A futura implementação deve funcionar com:

- A — Stable Arcade;
- B — Physical Hybrid;
- C — Wild Mechanical.

Não assumir que os três terão o mesmo feel no rail. A política exata de diferenças entre presets continua aberta.

---

## 8. Câmera

Invariante existente: **CAMERA -> GAMEPLAY é proibido**.

O rail grinding pode fornecer à câmera estado read-only como:

- `isRailGrinding`;
- velocidade;
- tangente;
- progresso;
- possível ponto futuro de trajetória.

A câmera pode usar isso para enquadramento, FOV, look-ahead ou contexto de HighSpeed **somente depois de decisão/aprovação de apresentação**.

A câmera nunca pode:

- mudar progresso no rail;
- acelerar/frear o Bey;
- escolher saída;
- corrigir trajetória do rail;
- decidir entrada;
- reposicionar o Bey para manter enquadramento.

Não criar automaticamente um novo modo de câmera `RailGrinding`. Primeiro verificar se `HighSpeed` + Camera Director atual já cobre o caso.

---

## 9. AI

A AI futura precisa enxergar rails como opção de navegação/reposicionamento, mas a política ainda não está fechada.

A arquitetura deve permitir à AI consultar:

- rails disponíveis;
- entradas alcançáveis;
- destino aproximado;
- custo/tempo estimado;
- risco de borda/ring-out;
- ganho potencial de velocidade.

**Guardrail de design:** evitar comportamento de loop onde a AI fica indo e voltando no mesmo rail indefinidamente em vez de lutar. A referência histórica de Dissidia tem relatos de AI abusando de rails dessa forma; ChaosBey deve ter teste/telemetry para detectar repetição excessiva.

Não definir ainda frequência, preferência por arquétipo ou thresholds.

---

## 10. Telemetry, replay e debug obrigatórios

Eventos conceituais que o sistema deve suportar:

- `railEnter`;
- `railExit`;
- `railReverse` se reversão for aprovada;
- `railInterrupted`;
- `railSpeedChanged` ou dados equivalentes amostrados.

Debug Lab deve conseguir exibir:

- rota do rail;
- zonas/candidatos de entrada;
- tangente no ponto atual;
- progresso;
- direção;
- velocidade de entrada/atual;
- velocidade prevista de saída;
- estado de anexação;
- razão de saída/interrupção.

Temporary debug visuals são permitidos; arte final não.

Replay deve registrar dados suficientes para reproduzir deterministicamente o mesmo rail, sentido, progresso e saída.

---

## 11. Testes mínimos da futura feature

Antes de declarar a feature completa, devem existir cenários determinísticos cobrindo pelo menos:

1. entrada válida em rail;
2. recusa de entrada inválida;
3. progressão determinística ao longo da rota;
4. ganho de velocidade;
5. saída e retorno ao movimento normal;
6. continuidade de velocity/heading sem NaN ou teleporte;
7. cada um dos três stages;
8. Motion A/B/C;
9. replay round-trip;
10. telemetry de entrada/saída;
11. câmera presente/ausente/hostil sem alterar gameplay;
12. stage size/funnel/configurações relevantes sem rail desalinhado;
13. AI capaz de usar rail sem loop infinito de ida/volta;
14. colisões/interrupções depois que suas regras forem aprovadas.

Os números de aceitação de velocidade/tempo/distância ficam pendentes até tuning/playtest.

---

## 12. Valores de tuning que devem existir quando a implementação começar

**Valores ainda não decididos. Não inventar defaults finais.**

O sistema provavelmente precisará de um bloco de tuning equivalente a:

- distância/volume de captura;
- tolerância angular de entrada;
- velocidade mínima de entrada, se houver;
- aceleração de grind;
- velocidade alvo/máxima;
- influência da velocidade de entrada;
- resposta a curvas;
- velocidade de reversão, se reversão existir;
- carry de velocidade na saída;
- blend tangente/heading na saída;
- impulso vertical de saída, se houver;
- tempo/cooldown de reattach;
- custo/dreno de Stamina, se houver;
- efeito em Stability, se houver;
- parâmetros de AI.

A lista serve para impedir magic numbers espalhados; não aprova nenhum desses comportamentos individualmente.

---

## 13. Decisões explicitamente abertas — ASK FIRST antes da implementação final

O owner **não decidiu ainda**:

1. como o Bey entra no rail: automático por proximidade, botão, combinação, contexto ou outro;
2. se existe prompt/indicador de rail;
3. se é possível inverter o sentido durante o grind;
4. como o jogador escolhe o sentido inicial;
5. como sair voluntariamente antes do fim;
6. se chegar ao fim lança o Bey, solta suavemente ou depende do rail;
7. se `Z`, `X` e `C` funcionam durante rail grinding;
8. se ataques podem começar/continuar no rail;
9. se dodge/jump/air recovery podem interromper o rail;
10. como funciona colisão entre dois Beys no mesmo rail;
11. se golpes/knockback removem o Bey do rail;
12. se Clash pode começar no rail;
13. custo/dreno de Stamina;
14. efeito de Stability/Quebrado sobre grind;
15. velocidade/aceleração/caps;
16. relação com o slider de Top Speed;
17. relação com Motion A/B/C;
18. quantidade e layout exato dos rails em cada stage;
19. comportamento com ring-out e rails próximos/fora da borda;
20. política de uso pela AI;
21. VFX;
22. áudio;
23. materiais/cores/formato visual dos rails em cada stage;
24. câmera específica para rail;
25. HUD/feedback ao jogador;
26. opção de habilitar/desabilitar rail em Pregame, caso exista.

Nenhum agente deve transformar a referência Dissidia em resposta automática para esses itens.

---

## 14. Sequência recomendada para a atualização futura

Esta ordem é de preparação técnica, não aprovação para executar agora.

1. **Fechar somente as decisões de controle/entrada/saída que bloqueiam gameplay.**
2. Criar um protótipo de rota com debug geometry, reutilizando um stage existente e a câmera/movimento aprovados.
3. Validar feel de captura, aceleração e saída com tuning exposto.
4. Definir layouts dos rails dos três stages.
5. Integrar gameplay nos três stages.
6. Integrar replay, telemetry, Debug Lab e self-tests.
7. Integrar AI com guard contra loops.
8. Passar pelo gate visual para rails/VFX/áudio.
9. Revalidar Camera Director em HighSpeed/rail sem criar causalidade câmera -> gameplay.
10. Rodar fluxo completo de typecheck, testes, build, self-tests e playtests antes de merge.

---

## 15. Fora de escopo desta preparação

Este documento **não**:

- adiciona rails ao jogo;
- altera colliders;
- altera o movimento;
- altera a câmera;
- altera VFX;
- altera AI;
- altera HUD;
- escolhe layout de rail;
- escolhe controles;
- escolhe valores de balance;
- aprova visuais.

Ele somente registra a direção futura aprovada e prepara um contrato verificável para a implementação posterior.
