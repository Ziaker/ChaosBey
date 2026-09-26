// ============================================================
// BEY VISUAL CONCEPTS — ENTRY POINT
// Standalone visual exploration page. Isolated from the game: it imports
// nothing from src/ and changes no gameplay, physics, collider or stat.
// ============================================================

import { CONCEPTS } from './concepts/conceptDefinitions';
import { ConceptLabUi } from './ui/ConceptLabUi';
import { ConceptViewer, type ViewMode } from './viewer/ConceptViewer';

const DEFAULT_CONCEPT_ID = 'attack-a';

function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Bey concept lab: missing #${id}`);
  return node as T;
}

const viewer = new ConceptViewer(requireElement<HTMLCanvasElement>('lab-canvas'), requireElement('stage'));

function select(id: string): void {
  const concept = CONCEPTS.find((c) => c.id === id) ?? CONCEPTS[0]!;
  const measurements = viewer.showConcept(concept);
  ui.showConcept(concept, measurements);
  history.replaceState(null, '', `#${concept.id}`);
}

function view(mode: ViewMode): void {
  viewer.setView(mode);
}

const ui = new ConceptLabUi(
  CONCEPTS,
  {
    select,
    view,
    toggleAutoRotate: () => {
      viewer.setAutoRotate(!viewer.isAutoRotating);
      ui.setAutoRotate(viewer.isAutoRotating);
    },
    toggleSilhouette: () => {
      viewer.setSilhouette(!viewer.isSilhouette);
      ui.setSilhouette(viewer.isSilhouette);
    },
    toggleExplode: () => {
      viewer.setExploded(!viewer.isExploded);
      ui.setExploded(viewer.isExploded);
    },
  },
  requireElement('concept-picker'),
  requireElement('concept-info'),
  requireElement('view-toolbar'),
);

viewer.onModeChange((mode) => ui.setViewMode(mode));
ui.setViewMode(viewer.viewMode);
ui.setAutoRotate(viewer.isAutoRotating);
ui.setSilhouette(viewer.isSilhouette);
select(location.hash.slice(1) || DEFAULT_CONCEPT_ID);

// Automation hook for screenshot/smoke scripts (not a gameplay API).
Object.assign(window, {
  __beyConceptLab: {
    ids: CONCEPTS.map((c) => c.id),
    select,
    view,
    setAutoRotate: (on: boolean) => {
      viewer.setAutoRotate(on);
      ui.setAutoRotate(on);
    },
    setSilhouette: (on: boolean) => {
      viewer.setSilhouette(on);
      ui.setSilhouette(on);
    },
    setExploded: (on: boolean) => {
      viewer.setExploded(on);
      ui.setExploded(on);
    },
    state: () => ({
      settled: viewer.isSettled,
      mode: viewer.viewMode,
      autoRotate: viewer.isAutoRotating,
      silhouette: viewer.isSilhouette,
      exploded: viewer.isExploded,
      cameraDistance: viewer.camera.position.distanceTo(viewer.controls.target),
      cameraHeight: viewer.camera.position.y,
      measurements: viewer.measurements,
    }),
  },
});
