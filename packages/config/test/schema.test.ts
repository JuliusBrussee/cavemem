import { describe, expect, it } from 'vitest';
import { SettingsSchema, defaultSettings } from '../src/index.js';

describe('SettingsSchema', () => {
  it('parses empty object into defaults', () => {
    const parsed = SettingsSchema.parse({});
    expect(parsed.workerPort).toBe(37777);
    expect(parsed.compression.intensity).toBe('full');
  });

  it('rejects invalid intensity', () => {
    expect(() => SettingsSchema.parse({ compression: { intensity: 'xxx' } })).toThrow();
  });

  it('defaults match exported defaultSettings', () => {
    expect(defaultSettings.workerPort).toBe(37777);
    expect(defaultSettings.embedding.provider).toBe('local');
  });

  it('idleShutdownMs defaults to 600000', () => {
    expect(defaultSettings.embedding.idleShutdownMs).toBe(600_000);
  });

  it('idleShutdownMs: 0 disables idle shutdown and is preserved as 0', () => {
    const parsed = SettingsSchema.parse({ embedding: { idleShutdownMs: 0 } });
    expect(parsed.embedding.idleShutdownMs).toBe(0);
  });

  it('clamps a negative idleShutdownMs to 0', () => {
    const parsed = SettingsSchema.parse({ embedding: { idleShutdownMs: -5000 } });
    expect(parsed.embedding.idleShutdownMs).toBe(0);
  });
});
