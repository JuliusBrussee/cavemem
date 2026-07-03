export {
  SettingsSchema,
  type Settings,
  type CompressionIntensity,
  type EmbeddingProvider,
} from './schema.js';
export { defaultSettings } from './defaults.js';
export { loadSettings, saveSettings, resolveDataDir, settingsPath } from './loader.js';
export { settingsDocs, type SettingDoc } from './docs.js';
export { globToRegExp, matchesGlob } from './glob.js';
