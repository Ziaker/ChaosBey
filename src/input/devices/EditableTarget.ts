// ============================================================
// EDITABLE TARGET CHECK
// Whether a keyboard event is aimed at a text/number field the user is
// typing into (e.g. the F4 settings panel's inputs). Gameplay keys typed
// there must reach the field, not steer the Bey — KeyboardController uses
// this to skip them. DOM-independent (duck-typed on tagName /
// isContentEditable) so it is unit-testable in the node test runner.
// ============================================================

const EDITABLE_TAG_NAMES: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === 'string' && EDITABLE_TAG_NAMES.has(element.tagName.toUpperCase());
}
