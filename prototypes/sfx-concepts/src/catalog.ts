// ============================================================
// SFX LAB — EVENT CATALOG (what can make a sound, and why)
// Phase 1 audit result: every event below has a real trigger in the
// current game code (the `source` field names it). Nothing here is a new
// mechanic invented to justify a sound. Events that are the same physical
// phenomenon at different strengths are ONE entry driven by a 0..1
// magnitude (e.g. every attack hit, light or heavy, is `hit`), instead of
// a pile of near-duplicate sounds.
//
// The mix rules live next to each event on purpose: in ChaosBey silence,
// priority, cooldowns and voice limits are part of the sound design (a
// frequent event must never turn into a wall of audio, and a big moment
// must always cut through). MixPolicy.ts enforces them.
// ============================================================

export type CategoryId = 'continuous' | 'impact' | 'attack' | 'defense' | 'resource' | 'clash' | 'round' | 'ui';

export interface Category {
  readonly id: CategoryId;
  readonly label: string;
  readonly hint: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 'continuous', label: 'Giro e atrito (contínuos)', hint: 'Loops que acompanham o estado: devem ficar baixos e sumir quando não dizem nada.' },
  { id: 'impact', label: 'Impactos e colisões', hint: 'Contato físico sem ataque formal; a força vem do impacto real.' },
  { id: 'attack', label: 'Ataques', hint: 'Circular, Dash (carga, carga máxima, disparo), acerto e Counter.' },
  { id: 'defense', label: 'Esquiva e mobilidade', hint: 'Dodge, golpe esquivado, Perfect Dodge e pulo.' },
  { id: 'resource', label: 'Recursos e alertas', hint: 'Estabilidade, Stamina e Attack Energy.' },
  { id: 'clash', label: 'Clash', hint: 'Início, tensão, mash de cada lado e resolução.' },
  { id: 'round', label: 'Rodada e resultado', hint: 'Início, Ring-Out, KO, vitória, derrota e empate.' },
  { id: 'ui', label: 'Interface', hint: 'Main Menu e navegação.' },
];

/** Where a sound is mixed. Each bus has its own volume (GDD 61: separate volume categories). */
export type BusId = 'loops' | 'gameplay' | 'moments' | 'ui';

export const BUSES: readonly { readonly id: BusId; readonly label: string }[] = [
  { id: 'gameplay', label: 'Combate' },
  { id: 'moments', label: 'Momentos (KO, Clash, Quebra…)' },
  { id: 'loops', label: 'Contínuos (giro, atrito)' },
  { id: 'ui', label: 'Interface' },
];

export interface MixRule {
  readonly bus: BusId;
  /** 0 (least important) … 10 (must always be heard). */
  readonly priority: number;
  /** Minimum time between two plays of this event for the same side (ms). */
  readonly cooldownMs: number;
  /** Maximum simultaneous voices of this event. */
  readonly maxVoices: number;
  /** Magnitudes below this are too small to be worth a sound. */
  readonly gate: number;
  /** Duck the continuous and lower-priority sounds while this plays. */
  readonly duck?: { readonly db: number; readonly ms: number };
}

export interface SfxEvent {
  readonly id: string;
  readonly category: CategoryId;
  readonly label: string;
  /** What fires it in the game today (plain Portuguese, for the owner). */
  readonly trigger: string;
  /** The code that produces the trigger (for engineers). */
  readonly source: string;
  /** Loops follow a live level instead of firing once. */
  readonly kind: 'oneShot' | 'loop';
  /** Plays per side (first/second): pans and cools down independently. */
  readonly perSide: boolean;
  /** Driven by a real 0..1 magnitude (impact force, landing intensity, charge…). */
  readonly scalesWithMagnitude: boolean;
  /** Magnitudes the Lab plays when auditioning (weak → strong). */
  readonly auditionMagnitudes: readonly number[];
  readonly mix: MixRule;
  /** Where "SEM SOM" might honestly be the better choice (owner decides). */
  readonly silenceNote?: string;
}

const LOW_TO_HIGH = [0.25, 0.6, 1] as const;
const ONE = [1] as const;

export const EVENTS: readonly SfxEvent[] = [
  // --- continuous -----------------------------------------------------
  {
    id: 'spinHum', category: 'continuous', label: 'Giro do Bey', kind: 'loop', perSide: true, scalesWithMagnitude: true,
    trigger: 'Sempre que o Bey gira; altura segue a rotação real (cai com a Stamina) e treme quando Quebrado. Cada arquétipo tem timbre próprio (GDD 32).',
    source: 'SpinSnapshot.spinRateRadPerSec, isBroken, BeyDefinition.id',
    auditionMagnitudes: [1, 0.55, 0.2], mix: { bus: 'loops', priority: 1, cooldownMs: 0, maxVoices: 2, gate: 0.05 },
    silenceNote: 'Loop mais arriscado de poluir: deve ficar bem baixo; SEM SOM é uma opção válida se o atrito já informar o movimento.',
  },
  {
    id: 'floorScrape', category: 'continuous', label: 'Atrito / derrapagem no piso', kind: 'loop', perSide: true, scalesWithMagnitude: true,
    trigger: 'Bey no chão em velocidade; sobe com a derrapagem (ângulo de deslize) e no Drift (GDD 61: scrape de piso).',
    source: 'MovementSnapshot.speedMps, slipAngleRad, grounded; DriftState.Drifting',
    auditionMagnitudes: [0.3, 0.7, 1], mix: { bus: 'loops', priority: 1, cooldownMs: 0, maxVoices: 2, gate: 0.08 },
  },
  {
    id: 'wallGrind', category: 'continuous', label: 'Raspar na parede', kind: 'loop', perSide: true, scalesWithMagnitude: true,
    trigger: 'Bey encostado na parede do estádio em movimento (GDD 61: scrape de parede).',
    source: 'posição ≥ raio do piso − raio do Bey, MovementSnapshot.speedMps',
    auditionMagnitudes: [0.4, 1], mix: { bus: 'loops', priority: 2, cooldownMs: 0, maxVoices: 2, gate: 0.08 },
  },
  // --- impact ----------------------------------------------------------
  {
    id: 'beyContact', category: 'impact', label: 'Colisão Bey × Bey (sem ataque)', kind: 'oneShot', perSide: false, scalesWithMagnitude: true,
    trigger: 'Contato físico forte entre os Beys fora de um golpe (GDD 38). Força do impacto real.',
    source: 'MovementSnapshot.impactDeltaSpeedMps com os Beys encostados; sem HitEvent no tick',
    auditionMagnitudes: LOW_TO_HIGH, mix: { bus: 'gameplay', priority: 3, cooldownMs: 90, maxVoices: 2, gate: 0.04 },
  },
  {
    id: 'wallImpact', category: 'impact', label: 'Quique na parede', kind: 'oneShot', perSide: true, scalesWithMagnitude: true,
    trigger: 'O Bey bate na parede/borda e muda de velocidade de repente.',
    source: 'ImpactEvents "wallImpact" (impactDeltaSpeedMps) perto da borda',
    auditionMagnitudes: LOW_TO_HIGH, mix: { bus: 'gameplay', priority: 4, cooldownMs: 110, maxVoices: 2, gate: 0.05 },
  },
  {
    id: 'landing', category: 'impact', label: 'Aterrissagem', kind: 'oneShot', perSide: true, scalesWithMagnitude: true,
    trigger: 'O Bey volta ao chão depois de pulo ou lançamento; força da queda.',
    source: 'BeySnapshot.justLanded, landingIntensity (DriftController)',
    auditionMagnitudes: LOW_TO_HIGH, mix: { bus: 'gameplay', priority: 3, cooldownMs: 150, maxVoices: 2, gate: 0.06 },
  },
  // --- attack ----------------------------------------------------------
  {
    id: 'circularStart', category: 'attack', label: 'Circular Attack (saída)', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'Toque curto de ataque: o Circular Attack começa.',
    source: 'AttackState → CircularActive',
    auditionMagnitudes: ONE, mix: { bus: 'gameplay', priority: 5, cooldownMs: 150, maxVoices: 2, gate: 0 },
  },
  {
    id: 'dashCharge', category: 'attack', label: 'Carregando Dash', kind: 'loop', perSide: true, scalesWithMagnitude: true,
    trigger: 'Segurar ataque: o Dash carrega; o som sobe com a carga e para ao soltar.',
    source: 'AttackState.ChargingDash, dashChargeFraction',
    auditionMagnitudes: [0, 0.5, 1], mix: { bus: 'loops', priority: 3, cooldownMs: 0, maxVoices: 2, gate: 0 },
  },
  {
    id: 'dashFull', category: 'attack', label: 'Dash com carga máxima', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'A carga do Dash chega ao máximo (DASH_MAX_CHARGE_S).',
    source: 'dashChargeFraction chega a 1',
    auditionMagnitudes: ONE, mix: { bus: 'gameplay', priority: 5, cooldownMs: 400, maxVoices: 2, gate: 0 },
    silenceNote: 'Se a carga contínua já deixar o pico claro, o aviso de carga máxima pode ser silêncio.',
  },
  {
    id: 'dashRelease', category: 'attack', label: 'Dash disparado', kind: 'oneShot', perSide: true, scalesWithMagnitude: true,
    trigger: 'Soltar o ataque (ou a energia acabar): o Dash sai; força pela carga.',
    source: 'AttackState → DashActive; dashChargeFraction',
    auditionMagnitudes: LOW_TO_HIGH, mix: { bus: 'gameplay', priority: 6, cooldownMs: 150, maxVoices: 2, gate: 0 },
  },
  {
    id: 'hit', category: 'attack', label: 'Acerto de ataque', kind: 'oneShot', perSide: false, scalesWithMagnitude: true,
    trigger: 'Um Circular ou Dash conecta. Leve → pesado pela força do knockback real (curva C aprovada).',
    source: 'MatchTickResult.hitEvents → ImpactEvents "hit" (knockbackMagnitude)',
    auditionMagnitudes: LOW_TO_HIGH, mix: { bus: 'gameplay', priority: 7, cooldownMs: 45, maxVoices: 3, gate: 0 },
  },
  {
    id: 'counter', category: 'attack', label: 'Counter (Circular pega Dash)', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'O Circular acerta um Dash ativo e lança o atacante para cima (GDD 23/107).',
    source: 'HitEvent.caughtOpponentDashing',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 8, cooldownMs: 200, maxVoices: 1, gate: 0, duck: { db: -7, ms: 450 } },
  },
  // --- defense ---------------------------------------------------------
  {
    id: 'dodge', category: 'defense', label: 'Dodge (saída)', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'O Bey entra na esquiva.',
    source: 'DodgeState → Dodging',
    auditionMagnitudes: ONE, mix: { bus: 'gameplay', priority: 4, cooldownMs: 150, maxVoices: 2, gate: 0 },
  },
  {
    id: 'dodged', category: 'defense', label: 'Golpe esquivado', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Um golpe que acertaria foi anulado pela esquiva (fora da janela perfeita; a perfeita toca o Perfect Dodge no lugar).',
    source: 'CombatEvent "dodged"',
    auditionMagnitudes: ONE, mix: { bus: 'gameplay', priority: 5, cooldownMs: 120, maxVoices: 1, gate: 0 },
    silenceNote: 'Quase sempre coincide com o som do Dodge; pode ser silêncio se ficar redundante.',
  },
  {
    id: 'perfectDodge', category: 'defense', label: 'Perfect Dodge', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Esquiva no último instante (só apresentação; sem bônus de gameplay). O jogo também reporta "dodged" no mesmo tick; o Lab toca só este, em vez de empilhar os dois.',
    source: 'CombatEvent "perfectDodge"',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 8, cooldownMs: 300, maxVoices: 1, gate: 0, duck: { db: -6, ms: 500 } },
  },
  {
    id: 'jump', category: 'defense', label: 'Pulo / hop', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'O Bey salta (Jump/Drift).',
    source: 'DriftState → Hopping',
    auditionMagnitudes: ONE, mix: { bus: 'gameplay', priority: 3, cooldownMs: 200, maxVoices: 2, gate: 0 },
  },
  // --- resource --------------------------------------------------------
  {
    id: 'stabilityBreak', category: 'resource', label: 'Stability Break (Quebrado)', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'A Estabilidade chega a zero: o Bey fica Quebrado.',
    source: 'CombatEvent "stabilityBreak"',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 9, cooldownMs: 500, maxVoices: 1, gate: 0, duck: { db: -8, ms: 700 } },
  },
  {
    id: 'stabilityRecover', category: 'resource', label: 'Sai do Quebrado', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'Sem apanhar por tempo suficiente, a Estabilidade volta ao piso e o Bey sai do Quebrado.',
    source: 'isBroken true → false (StabilitySystem)',
    auditionMagnitudes: ONE, mix: { bus: 'gameplay', priority: 5, cooldownMs: 500, maxVoices: 1, gate: 0 },
    silenceNote: 'Pode ser silêncio se o visual de recuperação bastar.',
  },
  {
    id: 'staminaLow', category: 'resource', label: 'Stamina crítica', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'A Stamina cruza 40%, onde começa a penalidade de aceleração e giro (uma vez por rodada).',
    source: 'staminaFraction < STAMINA_PENALTY_START_FRACTION',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 6, cooldownMs: 2000, maxVoices: 1, gate: 0 },
    silenceNote: 'Para o oponente talvez só faça sentido no lado do jogador.',
  },
  {
    id: 'energyEmpty', category: 'resource', label: 'Attack Energy acabou', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'A carga do Dash consome a energia até zero e o Dash sai à força.',
    source: 'attackEnergyFraction chega a 0 em ChargingDash',
    auditionMagnitudes: ONE, mix: { bus: 'gameplay', priority: 5, cooldownMs: 800, maxVoices: 1, gate: 0 },
    silenceNote: 'Pode ser silêncio para o oponente; útil principalmente no lado do jogador.',
  },
  // --- clash -----------------------------------------------------------
  {
    id: 'clashStart', category: 'clash', label: 'Início do Clash', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Dois ataques compatíveis na janela de 150 ms: começa o Clash (câmera B, sem órbita).',
    source: 'ClashState → Active (ClashPresentationTracker.clashStarted)',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 9, cooldownMs: 500, maxVoices: 1, gate: 0, duck: { db: -9, ms: 600 } },
  },
  {
    id: 'clashTension', category: 'clash', label: 'Tensão do Clash (contínuo)', kind: 'loop', perSide: false, scalesWithMagnitude: true,
    trigger: 'Durante os ~4 s do Clash; sobe com o progresso e com a vantagem.',
    source: 'ClashController elapsed / CLASH_TARGET_DURATION_S',
    auditionMagnitudes: [0, 0.5, 1], mix: { bus: 'loops', priority: 5, cooldownMs: 0, maxVoices: 1, gate: 0 },
  },
  {
    id: 'clashMash', category: 'clash', label: 'Mash no Clash', kind: 'oneShot', perSide: true, scalesWithMagnitude: true,
    trigger: 'Cada evento de mash (Z/X/C) de cada lado; o tom sobe com o progresso do Clash.',
    source: 'ClashPresentationTracker.mashInputEvents',
    auditionMagnitudes: [0.1, 0.5, 0.95], mix: { bus: 'gameplay', priority: 6, cooldownMs: 55, maxVoices: 4, gate: 0 },
  },
  {
    id: 'clashResolve', category: 'clash', label: 'Clash resolvido (vencedor)', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'O Clash termina com vencedor: clarão, knockback físico e o combate continua (sem pausa).',
    source: 'ClashResult outcome FirstWins/SecondWins',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 10, cooldownMs: 500, maxVoices: 1, gate: 0, duck: { db: -10, ms: 800 } },
  },
  {
    id: 'clashTie', category: 'clash', label: 'Clash empatado', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'O Clash termina empatado: repulsão simétrica.',
    source: 'ClashResult outcome Tie',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 10, cooldownMs: 500, maxVoices: 1, gate: 0, duck: { db: -10, ms: 800 } },
    silenceNote: 'O estilo visual de empate ainda está ABERTO; o som de empate também depende dessa decisão.',
  },
  // --- round -----------------------------------------------------------
  {
    id: 'roundStart', category: 'round', label: 'Início da rodada', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'A partida entra em Combat. (Launch/Countdown existem como estados, mas ainda sem tela.)',
    source: 'GameState → Combat (playMode)',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 7, cooldownMs: 1000, maxVoices: 1, gate: 0 },
  },
  {
    id: 'ringOut', category: 'round', label: 'Ring-Out', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'Um Bey sai do estádio.',
    source: 'CombatEvent "ringOut"',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 10, cooldownMs: 1000, maxVoices: 1, gate: 0, duck: { db: -12, ms: 1100 } },
  },
  {
    id: 'ko', category: 'round', label: 'KO', kind: 'oneShot', perSide: true, scalesWithMagnitude: false,
    trigger: 'Um Bey para de girar / é nocauteado.',
    source: 'CombatEvent "ko"',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 10, cooldownMs: 1000, maxVoices: 1, gate: 0, duck: { db: -12, ms: 1100 } },
  },
  {
    id: 'victory', category: 'round', label: 'Vitória (jogador)', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Fim da rodada a favor do jogador (o lado "first").',
    source: 'RoundOutcome FirstWinsByKo / FirstWinsByRingOut',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 9, cooldownMs: 1000, maxVoices: 1, gate: 0 },
    silenceNote: 'Música está adiada (GDD 61): isto é um stinger curto, não trilha.',
  },
  {
    id: 'defeat', category: 'round', label: 'Derrota (jogador)', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Fim da rodada contra o jogador.',
    source: 'RoundOutcome SecondWinsByKo / SecondWinsByRingOut',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 9, cooldownMs: 1000, maxVoices: 1, gate: 0 },
  },
  {
    id: 'draw', category: 'round', label: 'Empate da rodada', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Fim da rodada empatado.',
    source: 'RoundOutcome Draw',
    auditionMagnitudes: ONE, mix: { bus: 'moments', priority: 9, cooldownMs: 1000, maxVoices: 1, gate: 0 },
  },
  // --- ui ----------------------------------------------------------------
  {
    id: 'uiFocus', category: 'ui', label: 'Foco / mover seleção', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Passar por um botão do Main Menu (mouse ou teclado).',
    source: 'MainMenu: foco/hover das entradas',
    auditionMagnitudes: ONE, mix: { bus: 'ui', priority: 2, cooldownMs: 40, maxVoices: 2, gate: 0 },
    silenceNote: 'Menus longos com som em cada foco cansam; SEM SOM é comum aqui.',
  },
  {
    id: 'uiConfirm', category: 'ui', label: 'Confirmar', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'PLAY, DEBUG LAB, SELF TEST, abrir a seção Developer.',
    source: 'MainMenu: click das entradas',
    auditionMagnitudes: ONE, mix: { bus: 'ui', priority: 4, cooldownMs: 60, maxVoices: 2, gate: 0 },
  },
  {
    id: 'uiBack', category: 'ui', label: 'Voltar', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Back / Esc na seção Developer.',
    source: 'MainMenu: back, keydown Escape',
    auditionMagnitudes: ONE, mix: { bus: 'ui', priority: 3, cooldownMs: 60, maxVoices: 1, gate: 0 },
  },
  {
    id: 'uiError', category: 'ui', label: 'Erro / indisponível', kind: 'oneShot', perSide: false, scalesWithMagnitude: false,
    trigger: 'Ação recusada (ex.: modo desconhecido volta ao menu). Pouco usado hoje.',
    source: 'resolveAppMode → menu; futuras telas',
    auditionMagnitudes: ONE, mix: { bus: 'ui', priority: 4, cooldownMs: 200, maxVoices: 1, gate: 0 },
    silenceNote: 'Quase não existe erro de UI hoje; pode esperar as telas futuras.',
  },
];

export function eventById(id: string): SfxEvent {
  const event = EVENTS.find((e) => e.id === id);
  if (!event) throw new Error(`unknown SFX event: ${id}`);
  return event;
}

export function eventsInCategory(category: CategoryId): SfxEvent[] {
  return EVENTS.filter((e) => e.category === category);
}
