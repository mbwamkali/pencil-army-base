/** Accessibility choices, kept on this device only. */
export interface Settings {
  largeText: boolean;
  /** Hit and miss marks get shapes and strong contrast, so they never rely on colour or faint smudges. */
  clearMarkers: boolean;
}

const KEY = "pencil-army-base:settings";

function load(): Settings {
  const fallback: Settings = { largeText: false, clearMarkers: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Settings>;
    return { largeText: s.largeText === true, clearMarkers: s.clearMarkers === true };
  } catch {
    return fallback;
  }
}

export const settings: Settings = load();

/** Mirrors the settings onto the page so the stylesheet can react to them. */
export function applySettings(): void {
  document.body.classList.toggle("large-text", settings.largeText);
  document.body.classList.toggle("clear-markers", settings.clearMarkers);
}

export function setSetting(key: keyof Settings, value: boolean): void {
  settings[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // The choice still applies until the page closes.
  }
  applySettings();
}
