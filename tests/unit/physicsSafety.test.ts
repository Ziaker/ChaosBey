import { describe, expect, it } from 'vitest';
import { checkAngularVelocity, checkLinearVelocity } from '../../src/physics/diagnostics/physicsSafety';

describe('checkLinearVelocity', () => {
  it('returns null for a plausible velocity', () => {
    expect(checkLinearVelocity(1, 0, -2)).toBeNull();
  });

  it('flags NaN components', () => {
    const anomaly = checkLinearVelocity(Number.NaN, 0, 0);
    expect(anomaly?.kind).toBe('non-finite-value');
  });

  it('flags Infinity components', () => {
    const anomaly = checkLinearVelocity(0, Number.POSITIVE_INFINITY, 0);
    expect(anomaly?.kind).toBe('non-finite-value');
  });

  it('flags implausibly high speed', () => {
    const anomaly = checkLinearVelocity(1000, 0, 0);
    expect(anomaly?.kind).toBe('excessive-linear-speed');
  });
});

describe('checkAngularVelocity', () => {
  it('returns null for a plausible angular velocity', () => {
    expect(checkAngularVelocity(0, 10, 0)).toBeNull();
  });

  it('flags non-finite angular velocity', () => {
    const anomaly = checkAngularVelocity(0, Number.NaN, 0);
    expect(anomaly?.kind).toBe('non-finite-value');
  });

  it('flags implausibly high angular speed', () => {
    const anomaly = checkAngularVelocity(0, 5000, 0);
    expect(anomaly?.kind).toBe('excessive-angular-speed');
  });
});
