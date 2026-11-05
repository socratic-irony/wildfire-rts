const PREFIX = 'cinderline.';

/** Read a saved preference. Storage can be unavailable (private mode, blocked). */
export function loadPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function savePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  const raw = loadPreference(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  savePreference(key, JSON.stringify(value));
}
