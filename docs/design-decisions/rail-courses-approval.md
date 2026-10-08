# Rails — percursos longos para fora da arena

**Status:** PROTOTIPADO (Rail Course Lab, 0.55.0); **formato, entradas e números NÃO APROVADOS**. O jogo continua com os rails curtos da 0.53.0 até o owner escolher um percurso. Nada do lab está lido por `src/` além do módulo puro `src/arena/rails/RailCourse.ts` (gerador e medidas), que o jogo ainda não usa.
**Data:** 2026-10-08
**Lab:** `prototypes/rail-course-lab/` (página `/prototypes/rail-course-lab/`).

## 1. O que o owner pediu

Depois de jogar os rails da 0.53.0 (dois arcos curtos de 38 m **dentro** da arena):

> "por que os trilhos estão dentro da arena? pq eles são tão pequenos? é para eles terem entradas que levam para fora da arena e depois trazem o bey de volta pra arena, além disso por que são apenas retos? é pra serem bem largos (não em tamanho mas em trajeto)"
> "na verdade, eu acho que vai precisar de um protótipo para eles, não só implementar"

Ou seja: o rail é um **percurso longo e curvo** (não um arco curto nem reto), com **entradas** que levam o Bey **para fora da arena** e o **trazem de volta**. "Largo" = trajeto extenso, não rail grosso.

## 2. O que o lab propõe (PROPOSTAS de Claude, não decisões)

Um percurso tem **duas entradas dentro da parede**, uma em cada ponta (padrão 0,8 do raio do piso, 1,6 m de altura). Do portão ele sai radialmente, **passa por cima da parede** (altura de fora 5 m, acima de qualquer parede do jogo), faz um trecho longo **fora da arena** e volta pelo outro portão. A rota é a mesma nos dois sentidos, então **qualquer portão é entrada**.

| Ideia | Formato | Comprimento* | Passeio* |
|---|---|---|---|
| A — Volta larga | arco largo de 130° a 1,55× o raio | ~167 m | ~6,0 s |
| B — Ondas | arco de 150° que serpenteia para dentro e fora (3 ondas) | ~205 m | ~7,2 s |
| C — Volta completa | 320° em torno da arena, 1 rail | ~355 m | ~11,9 s |
| D — Montanha-russa | arco de 160° com ondas e subidas e descidas | ~196 m | ~6,9 s |

*Com o stage no tamanho padrão e a velocidade do rail da 0.53.0 (8 → 32 m/s). O lab mostra os valores exatos e deixa mudar tudo (posição do portão, quanto contorna, distância de fora, ondas, alturas, quantos rails).

**Regra proposta para pular fora da arena:** pular **dentro** da parede lança o Bey de volta à arena (como hoje); pular **fora** da arena faz o Bey **voltar pelo mesmo caminho** até o portão por onde entrou (resposta 2 do owner: "o caminho de ida e de volta são os mesmos"). Sem isso, um pulo fora da arena jogaria o Bey no vazio.

## 3. O que o jogo precisará quando o owner escolher (não feito)

1. **Entrada só pelos portões** (hoje o Bey agarra o rail em qualquer ponto); a direção do passeio vem do portão usado.
2. **Colisão com a arena desligada no trilho** (o corpo atravessa a parede) e **ring-out ignorado** enquanto estiver no trilho; a saída devolve o Bey sempre para dentro.
3. **A regra de voltar** ao pular fora da arena (acima).
4. **AI**: o `RailPilot` passa a mirar os portões e só pula para sair dentro da parede.
5. **Câmera**: o Bey passa vários segundos fora da arena (a câmera de combate precisa acompanhá-lo ou cortar), **HUD** e áudio.
6. **Visual final** (o lab usa um tubo e anéis provisórios) e o **conjunto de rails por stage** (hoje os três stages compartilham o layout porque o stage não está no `MatchConfig`).

## 4. Perguntas em aberto para o owner

- Qual ideia (A–D) ou combinação? Quantos rails por stage? O mesmo percurso nos três stages ou um por stage?
- O tempo de passeio (6–12 s, intocável e fora da arena) é o que se quer, ou os rails devem ser mais curtos/rápidos?
- A regra "pulou fora da arena → volta pelo mesmo caminho" é a desejada?
- Os portões ficam mais perto ou mais longe da parede (hoje a 0,8 do raio)?
