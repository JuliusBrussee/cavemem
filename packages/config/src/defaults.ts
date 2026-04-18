import { type Settings, SettingsSchema } from './schema.js';

export const defaultSettings: Settings = SettingsSchema.parse({});
