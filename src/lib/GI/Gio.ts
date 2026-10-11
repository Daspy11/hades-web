/**
 * Browser replacement for the parts of GIO used by HADES: simple actions on windows
 * (`win.save` etc., activated by menu items, tool buttons and keyboard accelerators) and
 * opening URIs.
 */
import { GObject, type SignalHandlerId } from "./Gtk/Core";
import type { Window } from "./Gtk/Widgets";

export class SimpleAction extends GObject {
  enabled = true;
  constructor(readonly name: string) {
    super();
  }
  activate(param: unknown): void {
    if (!this.enabled) return;
    this.emit("activate", param);
  }
}

export function simpleActionNew(name: string, _paramType: unknown | null): SimpleAction {
  return new SimpleAction(name);
}
export function simpleActionSetEnabled(a: SimpleAction, b: boolean): void {
  if (a.enabled === b) return;
  a.enabled = b;
  a.emit("notify::enabled");
  enabledListeners.forEach((cb) => cb());
}
export function onSimpleActionActivate(a: SimpleAction, cb: (param: unknown) => void): SignalHandlerId {
  return a.connect("activate", cb);
}
export function actionActivate(a: SimpleAction, param: unknown | null): void {
  a.activate(param);
}
export function actionGetEnabled(a: SimpleAction): boolean {
  return a.enabled;
}

const enabledListeners = new Set<() => void>();
/** Subscribe to changes of any action's enabled state (used by the renderer). */
export function onAnyActionEnabledChanged(cb: () => void): () => void {
  enabledListeners.add(cb);
  return () => enabledListeners.delete(cb);
}

/** `actionMapAddAction window action` */
export function actionMapAddAction(w: Window, a: SimpleAction): void {
  w.actions.set(a.name, a);
  enabledListeners.forEach((cb) => cb());
}
export function actionMapLookupAction(w: Window, name: string): SimpleAction | null {
  return w.actions.get(name) ?? null;
}

/**
 * `applicationSetAccelsForAction app "win.save" ["<Control>s"]`, registered on a window.
 * Accelerators use GTK syntax: `<Control>`, `<Shift>`, `<Alt>`/`<Mod1>` modifiers then a key name.
 */
export function setAccelsForAction(w: Window, actionName: string, accels: readonly string[]): void {
  for (const a of accels) w.accels.set(normaliseAccel(a), actionName.replace(/^(win|app)\./, ""));
}

export function normaliseAccel(a: string): string {
  const mods: string[] = [];
  let rest = a;
  const re = /^<([A-Za-z0-9]+)>/;
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    const n = m[1].toLowerCase();
    mods.push(n === "primary" || n === "ctrl" ? "control" : n === "mod1" ? "alt" : n);
    rest = rest.slice(m[0].length);
  }
  mods.sort();
  return [...mods, rest.toLowerCase()].join("+");
}

/** Accelerator string for a DOM keyboard event, normalised like `normaliseAccel`. */
export function accelOfEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.altKey) mods.push("alt");
  if (e.ctrlKey || e.metaKey) mods.push("control");
  if (e.shiftKey && e.key.length > 1) mods.push("shift");
  mods.sort();
  let key = e.key.toLowerCase();
  if (key === " ") key = "space";
  return [...mods, key].join("+");
}

/** `showUriOnWindow`: open a URI in a new browser tab. */
export function showUriOnWindow(_w: unknown, uri: string, _time: number): void {
  window.open(uri, "_blank", "noopener");
}
export const showUri = showUriOnWindow;
