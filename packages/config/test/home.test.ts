import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// resolveCavememHome() caches its result for the life of the process, so each
// test resets the module registry and re-imports it fresh — otherwise the
// first test to run would poison every test after it.

let home: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalCavememHome: string | undefined;
let originalXdgDataHome: string | undefined;
let originalPlatform: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'cavemem-home-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  originalCavememHome = process.env.CAVEMEM_HOME;
  originalXdgDataHome = process.env.XDG_DATA_HOME;
  // node:os.homedir() reads USERPROFILE on Windows; keep them in sync so
  // resolveCavememHome()'s homedir() call lines up with `home` on any platform.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CAVEMEM_HOME;
  delete process.env.XDG_DATA_HOME;
});

afterEach(() => {
  restoreEnv('HOME', originalHome);
  restoreEnv('USERPROFILE', originalUserProfile);
  restoreEnv('CAVEMEM_HOME', originalCavememHome);
  restoreEnv('XDG_DATA_HOME', originalXdgDataHome);
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
    originalPlatform = undefined;
  }
  rmSync(home, { recursive: true, force: true });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function setPlatform(platform: string): void {
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('resolveCavememHome', () => {
  it('CAVEMEM_HOME env var wins even when a legacy dir and XDG var exist', async () => {
    const custom = join(home, 'custom-home');
    process.env.CAVEMEM_HOME = custom;
    mkdirSync(join(home, '.cavemem'), { recursive: true });
    process.env.XDG_DATA_HOME = join(home, 'xdg-data');
    setPlatform('linux');

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(custom);
  });

  it('an existing ~/.cavemem wins over XDG on Linux', async () => {
    mkdirSync(join(home, '.cavemem'), { recursive: true });
    process.env.XDG_DATA_HOME = join(home, 'xdg-data');
    setPlatform('linux');

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(join(home, '.cavemem'));
  });

  it('uses XDG_DATA_HOME/cavemem when set and no legacy dir exists', async () => {
    const xdg = join(home, 'xdg-data');
    process.env.XDG_DATA_HOME = xdg;

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(join(xdg, 'cavemem'));
  });

  it('defaults to ~/.local/share/cavemem on Linux with no XDG var and no legacy dir', async () => {
    setPlatform('linux');

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(join(home, '.local', 'share', 'cavemem'));
  });

  it('keeps ~/.cavemem on macOS when no CAVEMEM_HOME or XDG var is set', async () => {
    setPlatform('darwin');

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(join(home, '.cavemem'));
  });

  it('caches the resolved path for the life of the process', async () => {
    setPlatform('darwin');
    const { resolveCavememHome } = await import('../src/home.js');

    const first = resolveCavememHome();
    // Creating the legacy dir after the first call must not change the result.
    mkdirSync(join(home, '.cavemem'), { recursive: true });
    expect(resolveCavememHome()).toBe(first);
  });

  it('ignores a relative CAVEMEM_HOME (hooks run with cwd = project dir)', async () => {
    process.env.CAVEMEM_HOME = './mem';
    setPlatform('darwin');

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(join(home, '.cavemem'));
  });

  it('ignores a relative XDG_DATA_HOME per the XDG spec', async () => {
    process.env.XDG_DATA_HOME = 'data';
    setPlatform('linux');

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(join(home, '.local', 'share', 'cavemem'));
  });

  it('honors an explicit XDG_DATA_HOME on macOS too (no legacy dir)', async () => {
    const xdg = join(home, 'xdg-data');
    process.env.XDG_DATA_HOME = xdg;
    setPlatform('darwin');

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(join(xdg, 'cavemem'));
  });

  it('expands a ~-prefixed CAVEMEM_HOME against the home dir', async () => {
    process.env.CAVEMEM_HOME = '~/custom-home';
    setPlatform('darwin');

    const { resolveCavememHome } = await import('../src/home.js');
    expect(resolveCavememHome()).toBe(join(home, 'custom-home'));
  });
});

describe('SettingsSchema dataDir default', () => {
  it('follows the resolved cavemem home when dataDir is not set explicitly', async () => {
    const custom = join(home, 'custom-home');
    process.env.CAVEMEM_HOME = custom;

    const { SettingsSchema } = await import('../src/schema.js');
    expect(SettingsSchema.parse({}).dataDir).toBe(custom);
  });

  it('still lets an explicit dataDir override the resolved home', async () => {
    process.env.CAVEMEM_HOME = join(home, 'custom-home');
    const explicitDir = join(home, 'elsewhere');

    const { SettingsSchema } = await import('../src/schema.js');
    expect(SettingsSchema.parse({ dataDir: explicitDir }).dataDir).toBe(explicitDir);
  });
});
