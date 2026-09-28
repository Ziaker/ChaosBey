import { describe, expect, it } from 'vitest';
import { WebGl2UnavailableError } from '../../src/app/bootstrap/bootFailureScreen';
import { createRenderer } from '../../src/app/bootstrap/createRenderer';

// GDD 117: a WebGL2 context failure must reach boot as its own error type,
// so main.ts can show the player a message instead of a blank page.
describe('createRenderer — WebGL2 unavailable', () => {
  it('turns three.js failing to create its context into a WebGl2UnavailableError that keeps the original cause', () => {
    // A canvas whose getContext() refuses WebGL2, like a GPU-less or
    // blocklisted browser does.
    const canvas = {
      getContext: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
      setAttribute: () => {},
      style: {},
    } as unknown as HTMLCanvasElement;

    let thrown: unknown;
    try {
      createRenderer(canvas);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WebGl2UnavailableError);
    expect((thrown as Error).message).toMatch(/WebGL2 context could not be created/);
    expect((thrown as Error).cause).toBeInstanceOf(Error);
  });
});
