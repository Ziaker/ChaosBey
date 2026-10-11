// ============================================================
// BEY REAL — TUNING (the one list of the mode's sliders)
// The alternative "Bey Real" mode (docs/design-decisions/bey-real-physics-approval.md): the Bey moves by itself like a real
// top — the bowl pulls it, the tip rubs, the spin bends its path — and the player only takes a share of the steering and
// presses four buttons. This file is data and pure helpers (no DOM, no Three.js, no Rapier): the Pregame's "Bey Real" block,
// its presets, the lab prototype (prototypes/bey-real-physics-concepts) and the tests all read the same list.
//
// BASE = the owner's own tuned numbers (2026-10-09, "esse preset atual … é pra ser o base"), not Claude's proposal — moved onto
// the physics-only motion and made five times faster in 0.64.0 (owner, 2026-10-10: "os beys estão só sendo controlados por uma IA
// … além de estarem MUITO lentos … 5 VEZES MAIS RÁPIDOS"). Five times the speed in the same stage is five times every speed
// and rate and 25 times every acceleration (the same paths, run five times as fast); what a hit costs per m/s is a fifth, so a
// fight costs what it cost. Timers the player plays against (charge, cooldowns, windows, round time) are unchanged.
// Units: the label names the unit; the note says what a higher value does.
//
// `live` marks a value the match already uses. The Pregame only shows live values, so no slider is dead; the rest are the
// lab's and are wired in the next changes (the approval doc lists them).
// ============================================================

export type RealParamGroup = 'control' | 'auto' | 'physics' | 'collision' | 'dash' | 'circular' | 'dodge' | 'jump' | 'rules' | 'ai';

export interface RealParams {
  // --- Control ---
  influence: number;
  // --- Automatic motion (the tip and the bowl) ---
  steerAccelMps2: number;
  cruiseSpeedMps: number;
  orbitRadiusFrac: number;
  cruiseMinShare: number;
  // --- Physics ---
  bowlPull: number;
  dragPerS: number;
  tipFrictionMps2: number;
  crossGripPerS: number;
  precessionRadPerS: number;
  spinDecayPerS: number;
  spinMoveLossPerM: number;
  spinSteerLoss: number;
  wobbleSpin: number;
  wobbleAccelMps2: number;
  massSecond: number;
  sameSpin: number;
  // --- Collisions ---
  restitutionLow: number;
  restitutionHigh: number;
  rimFriction: number;
  spinExchange: number;
  hitSpinLoss: number;
  rubSpinLoss: number;
  hitStability: number;
  wallRestitution: number;
  wallSpinLoss: number;
  // --- Dash Attack ---
  dashMinSpeedMps: number;
  dashMaxSpeedMps: number;
  dashChargeMaxS: number;
  dashDurationS: number;
  dashCooldownS: number;
  dashSnapRadPerS: number;
  dashSnapWindowS: number;
  dashLockRadPerS: number;
  dashMassBoost: number;
  dashStabilityMin: number;
  dashStabilityMax: number;
  dashSpinCost: number;
  dashWhiffRecoveryS: number;
  // --- Circular Attack ---
  circularRadiusM: number;
  circularDurationS: number;
  circularRecoveryS: number;
  circularLaunchMps: number;
  circularLaunchUpMps: number;
  circularKeepFraction: number;
  circularStability: number;
  // --- Dodge ---
  dodgeSpeedMps: number;
  dodgeBurstS: number;
  dodgeInvulnS: number;
  dodgeCooldownS: number;
  dodgePerfectS: number;
  dodgeSpinCost: number;
  // --- Jump ---
  jumpSpeedMps: number;
  gravityMps2: number;
  airControl: number;
  jumpCooldownS: number;
  // --- Rules ---
  stageRadiusM: number;
  bowlDepthScale: number;
  wallHeightM: number;
  ringOutDelayS: number;
  timeLimitS: number;
  gameSpeed: number;
  stabilityRegenPerS: number;
  brokenS: number;
  // --- AI ---
  aiAggression: number;
  aiSkill: number;
}

export type RealParamKey = keyof RealParams;

export interface RealParamSpec {
  readonly key: RealParamKey;
  readonly group: RealParamGroup;
  readonly label: string;
  /** What the value does and what a higher one feels like (shown under the slider in the Pregame). */
  readonly note: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The value text, e.g. `${v.toFixed(1)} m/s`. */
  readonly format: (value: number) => string;
  /** True once a match reads this value (see the header). */
  readonly live: boolean;
}

export const REAL_GROUP_TITLES: Readonly<Record<RealParamGroup, string>> = {
  control: 'Controle do jogador',
  auto: 'Movimento automático (ponta e cuba)',
  physics: 'Física: cuba, atrito, giro',
  collision: 'Colisão entre Beys e parede',
  dash: 'Dash Attack (carregar e soltar)',
  circular: 'Ataque giratório (toque)',
  dodge: 'Esquiva',
  jump: 'Pulo',
  rules: 'Arena e regras',
  ai: 'Oponente (IA)',
};

export const REAL_GROUP_ORDER: readonly RealParamGroup[] = ['control', 'auto', 'physics', 'collision', 'dash', 'circular', 'dodge', 'jump', 'rules', 'ai'];

const fix = (digits: number, unit: string) => (v: number): string => `${v.toFixed(digits)}${unit}`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const x2 = (v: number): string => `×${v.toFixed(2)}`;

/** The owner's tuned numbers: the base preset (and the defaults of a "Bey Real" match). */
export const REAL_BASE_PARAMS: Readonly<RealParams> = Object.freeze({
  influence: 0.75,
  steerAccelMps2: 1000,
  cruiseSpeedMps: 90,
  orbitRadiusFrac: 0.8,
  cruiseMinShare: 0.75,
  bowlPull: 1,
  dragPerS: 0.2,
  tipFrictionMps2: 17.5,
  crossGripPerS: 1.5,
  precessionRadPerS: 1.5,
  spinDecayPerS: 0.007,
  spinMoveLossPerM: 0.00007,
  spinSteerLoss: 0.00001,
  wobbleSpin: 0.35,
  wobbleAccelMps2: 250,
  massSecond: 1,
  sameSpin: 0,
  restitutionLow: 0.7,
  restitutionHigh: 0.92,
  rimFriction: 0.4,
  spinExchange: 0.00048,
  hitSpinLoss: 0.00016,
  rubSpinLoss: 0.000064,
  hitStability: 0.024,
  wallRestitution: 0.9,
  wallSpinLoss: 0.000064,
  dashMinSpeedMps: 50,
  dashMaxSpeedMps: 130,
  dashChargeMaxS: 1.6,
  dashDurationS: 0.3,
  dashCooldownS: 1.5,
  dashSnapRadPerS: 40,
  dashSnapWindowS: 0.08,
  dashLockRadPerS: 25,
  dashMassBoost: 1.8,
  dashStabilityMin: 10,
  dashStabilityMax: 25,
  dashSpinCost: 0.012,
  dashWhiffRecoveryS: 1.6,
  circularRadiusM: 1.55,
  circularDurationS: 0.35,
  circularRecoveryS: 0.95,
  circularLaunchMps: 45,
  circularLaunchUpMps: 7,
  circularKeepFraction: 0.65,
  circularStability: 12,
  dodgeSpeedMps: 60,
  dodgeBurstS: 0.17,
  dodgeInvulnS: 0.5,
  dodgeCooldownS: 3,
  dodgePerfectS: 0.2,
  dodgeSpinCost: 0.01,
  jumpSpeedMps: 10.5,
  gravityMps2: 31,
  airControl: 0,
  jumpCooldownS: 0.4,
  stageRadiusM: 15,
  bowlDepthScale: 1,
  wallHeightM: 1.6,
  gameSpeed: 1,
  ringOutDelayS: 0.6,
  timeLimitS: 150,
  stabilityRegenPerS: 5,
  brokenS: 2.4,
  aiAggression: 1,
  aiSkill: 0.85,
});

/** Every value of the mode, in the order the Pregame shows them. */
export const REAL_PARAM_SPEC: readonly RealParamSpec[] = [
  // ---- control ----
  { key: 'influence', group: 'control', live: true, min: 0, max: 1, step: 0.05, format: pct, label: 'Influência do jogador no movimento',
    note: 'O quanto a sua seta inclina o pião: uma força na direção da seta, limitada pela aderência da ponta — ela entorta o caminho, nunca substitui o embalo. 0% = só a física move o Bey (você só aperta os botões). Sem seta apertada, só a física.' },
  // ---- automatic motion: the tip and the bowl ----
  { key: 'cruiseSpeedMps', group: 'auto', live: true, min: 10, max: 150, step: 1, format: fix(0, ' m/s'), label: 'Velocidade de rolagem da ponta',
    note: 'A velocidade com que o Bey cruza o fundo da cuba quando o giro está cheio: o giro alimenta o movimento até essa energia, e a cuba faz o resto (rápido no fundo, devagar lá em cima). Ninguém escolhe a direção. 90 = cinco vezes a velocidade antiga (18).' },
  { key: 'steerAccelMps2', group: 'auto', live: true, min: 10, max: 2500, step: 10, format: fix(0, ' m/s²'), label: 'Aderência da ponta',
    note: 'A força máxima que o atrito da ponta faz: quão rápido o giro repõe o embalo perdido e quão forte a sua seta inclina o Bey. Mais = a ponta "pega" logo; menos = o Bey escorrega longe com o embalo de cada batida. Cai com o giro baixo e com o Bey quebrado.' },
  { key: 'orbitRadiusFrac', group: 'auto', live: true, min: 0.2, max: 0.95, step: 0.05, format: pct, label: 'Até onde sobe a rampa',
    note: 'Até que fração do raio da arena um Bey que cruza o fundo na velocidade de rolagem sobe a rampa antes de parar e voltar: é a física que calibra a força da cuba. Menos = cuba forte, idas e vindas curtas pelo meio; mais = sobe quase até a parede antes de voltar.' },
  { key: 'cruiseMinShare', group: 'auto', live: true, min: 0, max: 1, step: 0.05, format: pct, label: 'Rolagem que sobra com giro baixo',
    note: 'Quanto da velocidade de rolagem a ponta ainda dá quando o giro está acabando. 100% = mesmo pique até o fim; 0% = vai parando junto com o giro.' },
  // ---- physics ----
  { key: 'bowlPull', group: 'physics', live: true, min: 0, max: 3, step: 0.05, format: x2, label: 'Puxão da cuba',
    note: 'A gravidade ao longo da inclinação da arena. ×1 = a que faz um Bey na velocidade de rolagem subir até "Até onde sobe a rampa". Mais = sobe menos e volta mais rápido para o meio; 0 = ninguém é puxado (os Beys vão para a parede).' },
  { key: 'dragPerS', group: 'physics', live: true, min: 0, max: 3, step: 0.05, format: fix(2, ' /s'), label: 'Arrasto viscoso',
    note: 'Resistência proporcional à velocidade: freia mais quando está rápido. Mais = o embalo de uma batida some rápido; menos = desliza longe.' },
  { key: 'tipFrictionMps2', group: 'physics', live: true, min: 0, max: 100, step: 0.1, format: fix(1, ' m/s²'), label: 'Atrito da ponta',
    note: 'Frenagem constante da ponta no chão, que cresce quando o giro está baixo. Mais = o Bey perde o embalo rápido; 0 = nunca perde velocidade por atrito.' },
  { key: 'crossGripPerS', group: 'physics', live: true, min: 0, max: 6, step: 0.1, format: fix(1, ' /s'), label: 'Mordida de través da ponta',
    note: 'A ponta, inclinada pela rampa, desliza livre para cima e para baixo da cuba mas morde quando o Bey escorrega de lado (em volta da arena). Mais = o Bey vai e volta pelo centro como um pêndulo; 0 = ele mantém o giro em volta da arena e anda em círculos.' },
  { key: 'precessionRadPerS', group: 'physics', live: true, min: 0, max: 8, step: 0.1, format: fix(1, ' rad/s'), label: 'Curvatura de precessão do giro',
    note: 'O giro entorta o caminho do Bey sempre para o mesmo lado (o lado em que o pião gira). Mais = trajetórias bem curvas e órbitas mais fechadas; 0 = anda em linha reta onde o chão é plano.' },
  { key: 'spinDecayPerS', group: 'physics', live: true, min: 0, max: 0.02, step: 0.0005, format: (v) => `${(v * 100).toFixed(2)}% /s`, label: 'Perda de giro parado',
    note: 'Quanto do giro (a Stamina) o Bey perde por segundo só por estar girando. Mais = partidas mais curtas e Spin-Out frequente; 0 = o giro nunca acaba sozinho.' },
  { key: 'spinMoveLossPerM', group: 'physics', live: true, min: 0, max: 0.0005, step: 0.00001, format: (v) => `${(v * 100).toFixed(4)}% /m`, label: 'Perda de giro por distância',
    note: 'Giro perdido a cada metro percorrido: correr cansa. Mais = quem roda rápido perde o giro antes.' },
  { key: 'spinSteerLoss', group: 'physics', live: true, min: 0, max: 0.0003, step: 0.000002, format: (v) => v.toFixed(6), label: 'Perda de giro pelo trabalho da ponta',
    note: 'Giro perdido quando a ponta faz força (recuperar a rolagem, a sua seta inclinando o Bey). Mais = segurar a seta e as batidas cansam o Bey.' },
  { key: 'wobbleSpin', group: 'physics', live: true, min: 0.05, max: 0.7, step: 0.01, format: pct, label: 'Giro abaixo do qual o Bey balança',
    note: 'Quando o giro cai abaixo deste valor o Bey começa a cambalear. Mais = começa a balançar cedo; menos = firme até quase parar.' },
  { key: 'wobbleAccelMps2', group: 'physics', live: true, min: 0, max: 400, step: 5, format: fix(0, ' m/s²'), label: 'Força do balanço',
    note: 'O quanto o balanço empurra o Bey para os lados quando o giro está baixo (ou ele está quebrado). Mais = fim de partida errático; 0 = sem balanço.' },
  { key: 'massSecond', group: 'physics', live: true, min: 0.5, max: 2, step: 0.05, format: x2, label: 'Massa do 2º Bey',
    note: 'A massa do oponente em relação à sua, nas batidas corpo a corpo. Mais = ele joga você mais longe e você quase não o move.' },
  { key: 'sameSpin', group: 'physics', live: true, min: 0, max: 1, step: 1, format: (v) => (v >= 0.5 ? 'iguais' : 'opostos'), label: 'Sentido do giro dos dois',
    note: 'Opostos: os Beys se engrenam e se empurram. Iguais: as bordas se raspam e roubam giro um do outro.' },
  // ---- collision ----
  { key: 'restitutionLow', group: 'collision', live: true, min: 0.1, max: 1, step: 0.01, format: fix(2, ''), label: 'Quique com giro baixo',
    note: 'O quanto os Beys quicam um do outro quando o giro está baixo. Mais = rebatem mais.' },
  { key: 'restitutionHigh', group: 'collision', live: true, min: 0.1, max: 1, step: 0.01, format: fix(2, ''), label: 'Quique com giro alto',
    note: 'O quanto quicam com o giro cheio. Mais = batidas explosivas no começo da partida.' },
  { key: 'rimFriction', group: 'collision', live: true, min: 0, max: 1, step: 0.01, format: fix(2, ''), label: 'Atrito entre as bordas',
    note: 'Atrito no ponto de contato: transforma a batida em desvio lateral e troca de giro. Mais = batidas rasantes desviam e roubam mais.' },
  { key: 'spinExchange', group: 'collision', live: true, min: 0, max: 0.02, step: 0.00008, format: fix(5, ''), label: 'Troca de giro no contato',
    note: 'Quanto giro passa de um Bey para o outro no atrito. Mais = quem gira mais rouba do outro.' },
  { key: 'hitSpinLoss', group: 'collision', live: true, min: 0, max: 0.005, step: 0.00002, format: fix(5, ''), label: 'Giro perdido por impacto',
    note: 'Giro que os dois perdem em uma batida forte. Mais = cada batida encurta a partida.' },
  { key: 'rubSpinLoss', group: 'collision', live: true, min: 0, max: 0.002, step: 0.000008, format: fix(6, ''), label: 'Giro perdido por raspão',
    note: 'Giro perdido em um encostão leve.' },
  { key: 'hitStability', group: 'collision', live: true, min: 0, max: 0.8, step: 0.004, format: fix(3, ''), label: 'Estabilidade perdida por impacto',
    note: 'Estabilidade perdida por m/s de cada impacto (batida entre os corpos ou na parede). Mais = o Bey quebra mais fácil e fica vulnerável ao KO. Com os Beys cinco vezes mais rápidos as batidas são cinco vezes mais fortes e mais frequentes, por isso o valor é 1/25 do antigo.' },
  { key: 'wallRestitution', group: 'collision', live: true, min: 0, max: 1, step: 0.01, format: fix(2, ''), label: 'Quique na parede',
    note: 'Quanto o Bey volta ao bater na parede. Mais = a parede devolve o Bey para o meio; 0 = ele gruda e desliza.' },
  { key: 'wallSpinLoss', group: 'collision', live: true, min: 0, max: 0.002, step: 0.000008, format: fix(6, ''), label: 'Giro perdido na parede',
    note: 'Giro perdido a cada batida na parede.' },
  // ---- dash ----
  { key: 'dashMinSpeedMps', group: 'dash', live: true, min: 10, max: 100, step: 1, format: fix(0, ' m/s'), label: 'Velocidade mínima',
    note: 'Velocidade de um Dash sem carga.' },
  { key: 'dashMaxSpeedMps', group: 'dash', live: true, min: 30, max: 160, step: 1, format: fix(0, ' m/s'), label: 'Velocidade máxima',
    note: 'Velocidade de um Dash com carga cheia.' },
  { key: 'dashChargeMaxS', group: 'dash', live: true, min: 0.3, max: 3, step: 0.05, format: fix(2, ' s'), label: 'Carga até o máximo',
    note: 'Quanto tempo segurando o botão para carregar tudo. Menos = Dash cheio quase instantâneo.' },
  { key: 'dashDurationS', group: 'dash', live: true, min: 0.1, max: 1.2, step: 0.05, format: fix(2, ' s'), label: 'Duração',
    note: 'Quanto tempo o Dash dura. Mais = alcança de mais longe.' },
  { key: 'dashCooldownS', group: 'dash', live: true, min: 0.5, max: 5, step: 0.25, format: fix(2, ' s'), label: 'Recarga do Dash',
    note: 'Tempo, depois de um Dash, até poder carregar o próximo (vale para você e para a IA). Mais = Dashes mais raros e pensados.' },
  { key: 'dashSnapRadPerS', group: 'dash', live: true, min: 0, max: 80, step: 1, format: fix(0, ' rad/s'), label: 'Virada imediata ao soltar',
    note: 'A rapidez com que o Dash gira na direção do oponente logo ao soltar.' },
  { key: 'dashSnapWindowS', group: 'dash', live: true, min: 0, max: 0.3, step: 0.01, format: fix(2, ' s'), label: 'Janela da virada imediata',
    note: 'Por quanto tempo vale a virada rápida.' },
  { key: 'dashLockRadPerS', group: 'dash', live: true, min: 0, max: 60, step: 1, format: fix(0, ' rad/s'), label: 'Mira depois da virada',
    note: 'O quanto o Dash ainda persegue o oponente depois da virada. Mais = difícil de desviar.' },
  { key: 'dashMassBoost', group: 'dash', live: true, min: 1, max: 4, step: 0.1, format: x2, label: 'Massa efetiva no Dash',
    note: 'O Dash bate como se pesasse mais: multiplica a força do arremesso do Dash (1,8 = o arremesso normal do jogo). Mais = joga o oponente bem mais longe.' },
  { key: 'dashStabilityMin', group: 'dash', live: true, min: 0, max: 50, step: 1, format: fix(0, ''), label: 'Estabilidade tirada, carga mínima',
    note: 'Dano de Estabilidade de um Dash sem carga.' },
  { key: 'dashStabilityMax', group: 'dash', live: true, min: 0, max: 80, step: 1, format: fix(0, ''), label: 'Estabilidade tirada, carga máxima',
    note: 'Dano de Estabilidade de um Dash carregado.' },
  { key: 'dashSpinCost', group: 'dash', live: true, min: 0, max: 0.06, step: 0.001, format: fix(3, ''), label: 'Custo de giro',
    note: 'Giro gasto a cada Dash.' },
  { key: 'dashWhiffRecoveryS', group: 'dash', live: true, min: 0, max: 2, step: 0.05, format: fix(2, ' s'), label: 'Recuperação se errar',
    note: 'Tempo vulnerável depois de um Dash que não acertou.' },
  // ---- circular ----
  { key: 'circularRadiusM', group: 'circular', live: true, min: 0.6, max: 3, step: 0.05, format: fix(2, ' m'), label: 'Alcance',
    note: 'O raio do ataque giratório.' },
  { key: 'circularDurationS', group: 'circular', live: true, min: 0.1, max: 0.8, step: 0.05, format: fix(2, ' s'), label: 'Duração ativa',
    note: 'Quanto tempo o giratório fica ativo.' },
  { key: 'circularRecoveryS', group: 'circular', live: true, min: 0, max: 1, step: 0.05, format: fix(2, ' s'), label: 'Recuperação',
    note: 'Tempo parado depois do giratório.' },
  { key: 'circularLaunchMps', group: 'circular', live: true, min: 0, max: 100, step: 1, format: fix(0, ' m/s'), label: 'Lançamento horizontal',
    note: 'A velocidade com que o giratório joga para longe quem o toca. Mais = defesa que arremessa para fora da arena.' },
  { key: 'circularLaunchUpMps', group: 'circular', live: true, min: 0, max: 14, step: 0.5, format: fix(1, ' m/s'), label: 'Lançamento para cima',
    note: 'A velocidade para cima com que o giratório arremessa quem o toca (não acompanha o lançamento horizontal: a gravidade não ficou cinco vezes mais forte). Mais = o oponente sobe mais e demora a cair; acima da parede, ring-out.' },
  { key: 'circularKeepFraction', group: 'circular', live: true, min: 0, max: 1, step: 0.05, format: pct, label: 'Velocidade que um Dash capturado mantém',
    note: 'Quanto da velocidade um Dash mantém ao ser pego por um giratório.' },
  { key: 'circularStability', group: 'circular', live: true, min: 0, max: 40, step: 1, format: fix(0, ''), label: 'Estabilidade tirada de quem toca',
    note: 'Dano de Estabilidade em quem encosta no giratório.' },
  // ---- dodge ----
  { key: 'dodgeSpeedMps', group: 'dodge', live: true, min: 10, max: 120, step: 1, format: fix(0, ' m/s'), label: 'Velocidade da esquiva',
    note: 'A velocidade do impulso da esquiva. Mais = a esquiva percorre mais distância.' },
  { key: 'dodgeBurstS', group: 'dodge', live: true, min: 0.1, max: 0.6, step: 0.01, format: fix(2, ' s'), label: 'Duração do impulso',
    note: 'Por quanto tempo o impulso da esquiva substitui o seu movimento. Mais = a esquiva anda mais longe (velocidade × duração).' },
  { key: 'dodgeInvulnS', group: 'dodge', live: true, min: 0.1, max: 1, step: 0.05, format: fix(2, ' s'), label: 'Invulnerável por',
    note: 'Quanto tempo você fica invulnerável e atravessa o oponente depois de esquivar. Mais = esquiva mais segura, mas o resto do tempo você já está se movendo de novo.' },
  { key: 'dodgeCooldownS', group: 'dodge', live: true, min: 0.5, max: 6, step: 0.25, format: fix(2, ' s'), label: 'Recarga da esquiva',
    note: 'Tempo entre duas esquivas. Mais = cada esquiva precisa ser guardada para o momento certo.' },
  { key: 'dodgePerfectS', group: 'dodge', live: true, min: 0.05, max: 0.4, step: 0.01, format: fix(2, ' s'), label: 'Janela da esquiva perfeita',
    note: 'A tolerância de tempo para esquivar no último instante.' },
  { key: 'dodgeSpinCost', group: 'dodge', live: true, min: 0, max: 0.06, step: 0.001, format: fix(3, ''), label: 'Custo de giro da esquiva',
    note: 'Giro gasto a cada esquiva.' },
  // ---- jump ----
  { key: 'jumpSpeedMps', group: 'jump', live: true, min: 3, max: 14, step: 0.5, format: fix(1, ' m/s'), label: 'Impulso do pulo',
    note: 'A velocidade de saída do pulo completo (com a gravidade define a altura: v²/2g). Mais = pulo mais alto e mais longo no ar.' },
  { key: 'gravityMps2', group: 'jump', live: true, min: 6, max: 40, step: 1, format: fix(0, ' m/s²'), label: 'Gravidade no ar',
    note: 'A gravidade de tudo que está no ar (pulo, arremessos). Mais = voos curtos e pesados; menos = voos flutuantes.' },
  { key: 'airControl', group: 'jump', live: true, min: 0, max: 1, step: 0.05, format: pct, label: 'Controle no ar',
    note: 'Quanto você ainda conduz o Bey no ar. 0 = nenhum: você escolhe só o momento do pulo, não a direção.' },
  { key: 'jumpCooldownS', group: 'jump', live: true, min: 0, max: 2, step: 0.05, format: fix(2, ' s'), label: 'Recarga do pulo',
    note: 'Tempo depois de um pulo até poder pular de novo.' },
  // ---- rules ----
  { key: 'stageRadiusM', group: 'rules', live: true, min: 7, max: 40, step: 0.5, format: fix(1, ' m'), label: 'Raio da arena de jogo',
    note: 'O tamanho da arena (a de Bey Real é bem menor que a normal, de 36 m). Mais = mais espaço para orbitar e menos encontros; menos = luta apertada. A cuba acompanha o tamanho.' },
  { key: 'bowlDepthScale', group: 'rules', live: true, min: 0, max: 3, step: 0.05, format: x2, label: 'Profundidade da cuba (funil)',
    note: '×1 = a cuba que acompanha o tamanho da arena (a inclinação que você afinou). Mais = a arena afunda mais no meio e a borda fica bem mais alta; 0 = chão plano. Quem puxa o Bey para o centro continua sendo o "Puxão da cuba".' },
  { key: 'wallHeightM', group: 'rules', live: true, min: 0.3, max: 10, step: 0.1, format: fix(1, ' m'), label: 'Altura da parede',
    note: 'Parede baixa deixa um Bey lançado voar para fora (ring-out); parede alta o mantém dentro.' },
  { key: 'ringOutDelayS', group: 'rules', live: true, min: 0, max: 3, step: 0.1, format: fix(1, ' s'), label: 'Tempo fora da arena até perder',
    note: 'Quanto tempo o Bey precisa ficar fora para o ring-out contar (se voltar antes, zera). 0 = instantâneo.' },
  { key: 'timeLimitS', group: 'rules', live: true, min: 0, max: 300, step: 10, format: (v) => (v === 0 ? 'sem limite' : `${v.toFixed(0)} s`), label: 'Limite de tempo',
    note: 'Quando acaba o tempo sem vencedor, o round é empate. 0 = sem limite.' },
  { key: 'gameSpeed', group: 'rules', live: true, min: 0.5, max: 2, step: 0.05, format: x2, label: 'Velocidade do jogo',
    note: 'A partida inteira roda nesta velocidade: movimento, ataques, gravidade e efeitos. ×1 = tempo real (como o laboratório).' },
  { key: 'stabilityRegenPerS', group: 'rules', live: true, min: 0, max: 20, step: 0.5, format: fix(1, ' /s'), label: 'Recuperação de Estabilidade',
    note: 'A rapidez com que o Bey se recompõe depois de apanhar.' },
  { key: 'brokenS', group: 'rules', live: true, min: 0.5, max: 6, step: 0.1, format: fix(1, ' s'), label: 'Tempo Quebrado',
    note: 'Quanto tempo o Bey fica Quebrado (vulnerável ao KO) depois de perder toda a Estabilidade.' },
  // ---- ai ----
  { key: 'aiAggression', group: 'ai', live: true, min: 0, max: 1, step: 0.05, format: pct, label: 'Agressividade da IA',
    note: 'Substitui, no modo, a agressividade do estilo da IA escolhido no Pregame: a frequência com que o oponente parte para o ataque. 100% = ataca sempre que pode.' },
  { key: 'aiSkill', group: 'ai', live: true, min: 0, max: 1, step: 0.05, format: pct, label: 'Reação da IA',
    note: 'Substitui, no modo, a reação, os erros e a esquiva do nível de dificuldade da IA escolhido no Pregame: quão rápido e limpo o oponente reage. Nunca é perfeito.' },
];

export function realSpecOf(key: RealParamKey): RealParamSpec {
  return REAL_PARAM_SPEC.find((s) => s.key === key)!;
}

export function liveRealSpecs(): readonly RealParamSpec[] {
  return REAL_PARAM_SPEC.filter((s) => s.live);
}

/** A set of values with every number clamped into its slider's range (anything missing or not finite = the base). */
export function sanitizeRealParams(values: Partial<Record<RealParamKey, unknown>> | null | undefined): RealParams {
  const out: RealParams = { ...REAL_BASE_PARAMS };
  if (!values || typeof values !== 'object') return out;
  for (const spec of REAL_PARAM_SPEC) {
    const v = values[spec.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
  }
  return out;
}

export interface RealPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Overrides on the base preset; anything not listed is the owner's number. */
  readonly values: Partial<RealParams>;
}

/** The base preset is the owner's own tuning; the others are variations of it. */
export const REAL_PRESETS: readonly RealPreset[] = [
  { id: 'base', label: 'Base (do dono)', description: 'Os seus números, na física pura e cinco vezes mais rápidos: a cuba e a ponta movem o Bey, a sua seta inclina 75% e você aperta os botões.', values: {} },
  { id: 'slow', label: 'Velocidade antiga (×1)', description: 'A mesma física pura na velocidade de antes (cinco vezes mais lenta): para comparar.', values: {
    cruiseSpeedMps: 18, steerAccelMps2: 40, dragPerS: 0.1, tipFrictionMps2: 0.7, precessionRadPerS: 0.9, spinMoveLossPerM: 0.00035, spinSteerLoss: 0.00025, wobbleAccelMps2: 10,
    spinExchange: 0.012, hitSpinLoss: 0.004, rubSpinLoss: 0.0016, hitStability: 0.6, wallSpinLoss: 0.0016,
    dashMinSpeedMps: 10, dashMaxSpeedMps: 30, dashDurationS: 0.8, dashLockRadPerS: 5, circularLaunchMps: 9, dodgeSpeedMps: 22 } },
  { id: 'automatic', label: 'Mais automático', description: 'Influência de 30%: a física faz quase tudo e a sua seta só dá um toque.', values: { influence: 0.3 } },
  { id: 'buttons', label: 'Só botões', description: 'Influência 0: você só aperta Dash, Giratório, Pulo e Esquiva. O Bey vai aonde a cuba e a ponta o levam.', values: { influence: 0 } },
  { id: 'heavy', label: 'Pesado e inercial', description: 'Metade da velocidade, ponta que pega devagar e giro que dura mais: batalhas pesadas, com muito embalo.', values: { cruiseSpeedMps: 45, steerAccelMps2: 300, bowlPull: 1.3, spinDecayPerS: 0.0035, wobbleAccelMps2: 125 } },
  { id: 'wild', label: 'Selvagem', description: 'Mais rápido ainda, precessão forte, balanço alto e giro que acaba rápido: partidas curtas e caóticas.', values: { cruiseSpeedMps: 120, precessionRadPerS: 6.5, wobbleAccelMps2: 400, spinDecayPerS: 0.012 } },
];

export function realPresetValues(id: string): RealParams {
  const preset = REAL_PRESETS.find((p) => p.id === id) ?? REAL_PRESETS[0]!;
  return sanitizeRealParams({ ...REAL_BASE_PARAMS, ...preset.values });
}

/** The preset whose values equal these (compared on the live values only), or null for a custom mix. */
export function matchingRealPreset(params: RealParams): string | null {
  for (const preset of REAL_PRESETS) {
    const values = realPresetValues(preset.id);
    if (liveRealSpecs().every((s) => Math.round(values[s.key] * 1e6) === Math.round(params[s.key] * 1e6))) return preset.id;
  }
  return null;
}

// ---------------- what the engine reads ----------------

/**
 * What a Bey Real match carries in its config (MatchConfig.real): every value of the mode, as the sliders hold them. The systems
 * read the part they own (the motion model, the lean, the attacks, the dodge, the stability, the contacts); what already has
 * a rule in the match (stage size, gravity, cooldowns…) also reaches it through that rule (realMatchRules.ts).
 */
export type RealModeConfig = Readonly<RealParams>;

export function realModeConfigOf(params: RealParams): RealModeConfig {
  return { ...params };
}
