import { describe, expect, it } from 'vitest';
import { isEditableEventTarget } from '../../src/input/devices/EditableTarget';

const target = (fields: { tagName?: string; isContentEditable?: boolean }) => fields as unknown as EventTarget;

describe('isEditableEventTarget', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT', 'input'])('treats <%s> as editable', (tagName) => {
    expect(isEditableEventTarget(target({ tagName }))).toBe(true);
  });

  it('treats a contenteditable element as editable', () => {
    expect(isEditableEventTarget(target({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  it.each(['BODY', 'CANVAS', 'BUTTON', 'DIV'])('does not treat <%s> as editable', (tagName) => {
    expect(isEditableEventTarget(target({ tagName, isContentEditable: false }))).toBe(false);
  });

  it('handles a null or non-element target (e.g. window)', () => {
    expect(isEditableEventTarget(null)).toBe(false);
    expect(isEditableEventTarget(target({}))).toBe(false);
  });
});
