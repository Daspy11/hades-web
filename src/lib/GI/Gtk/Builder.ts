/**
 * `GtkBuilder` for the web toolkit: builds widgets from a Glade XML interface description
 * (as used by `hades/share/editor-ui.glade`). Supports the widget classes and properties that
 * file uses; unknown classes become plain boxes and unknown properties are ignored.
 */
import { GObject, Widget, Container, registerToplevel, stockLabels, type Orientation } from "./Core";
import * as W from "./Widgets";
import { normaliseAccel } from "../Gio";

export class Builder extends GObject {
  readonly objects = new Map<string, GObject>();
}

function bool(v: string): boolean {
  return v === "True" || v === "true" || v === "1" || v === "yes";
}

function construct(cls: string): GObject | null {
  switch (cls) {
    case "GtkApplicationWindow": {
      const w = W.applicationWindowNew(null);
      return w;
    }
    case "GtkWindow": return W.windowNew("WindowTypeToplevel");
    case "GtkBox": return W.boxNew("OrientationHorizontal", 0);
    case "GtkMenuBar": return W.menuBarNew();
    case "GtkMenu": return W.menuNew();
    case "GtkMenuItem": return W.menuItemNew();
    case "GtkImageMenuItem": return W.menuItemNew();
    case "GtkCheckMenuItem": return new W.CheckMenuItem();
    case "GtkSeparatorMenuItem": return W.separatorMenuItemNew();
    case "GtkToolbar": return W.toolbarNew();
    case "GtkToolButton": return W.toolButtonNew(null, null);
    case "GtkMenuToolButton": return W.menuToolButtonNew(null, null);
    case "GtkSeparatorToolItem": return W.separatorToolItemNew();
    case "GtkToolItem": return W.toolItemNew();
    case "GtkImage": return W.imageNew();
    case "GtkLabel": return W.labelNew(null);
    case "GtkButton": return W.buttonNew();
    case "GtkPaned": return W.panedNew("OrientationHorizontal");
    case "GtkNotebook": return W.notebookNew();
    case "GtkScrolledWindow": return W.scrolledWindowNew(null, null);
    case "GtkStatusbar": return W.boxNew("OrientationHorizontal", 0);
    case "GtkAccelGroup": return new GObject();
    default:
      console.warn("Gtk.Builder: unsupported class " + cls);
      return W.boxNew("OrientationVertical", 0);
  }
}

function applyProperty(obj: GObject, cls: string, name: string, value: string, all: Map<string, GObject>, pendingImages: [W.MenuItem | W.Button, string][]): void {
  const w = obj as any;
  switch (name) {
    case "visible":
      if (w instanceof Widget) w.visible = bool(value);
      return;
    case "can_focus":
      if (w instanceof Widget) w.canFocus = bool(value);
      return;
    case "orientation":
      if ("orientation" in w) w.orientation = (value === "vertical" ? "OrientationVertical" : "OrientationHorizontal") as Orientation;
      return;
    case "spacing":
      if (w instanceof W.Box) w.spacing = parseInt(value, 10);
      return;
    case "label":
      if (w instanceof W.MenuItem) {
        const stock = stockLabels[value];
        w.label = stock ? stock[0] : value;
        if (stock && stock[1]) w.iconName = stock[1];
      } else if (w instanceof W.ToolButton) w.label = value;
      else if (w instanceof W.Label) w.text = value;
      else if (w instanceof W.Button) w.label = value;
      return;
    case "use_underline":
      if ("useUnderline" in w) w.useUnderline = bool(value);
      return;
    case "use_stock":
      return;
    case "tooltip_text":
      if (w instanceof Widget) w.tooltip = value;
      return;
    case "action_name":
      if ("actionName" in w) w.actionName = value;
      return;
    case "icon_name":
      if (w instanceof W.Image) w.iconName = value;
      else if (w instanceof W.ToolButton) w.iconName = value;
      return;
    case "stock":
      if (w instanceof W.Image) w.iconName = stockLabels[value]?.[1] || value;
      return;
    case "stock_id":
      if (w instanceof W.ToolButton) {
        const s = stockLabels[value];
        if (s) {
          if (!w.label) w.label = s[0];
          if (!w.iconName) w.iconName = s[1];
        } else if (value === "gtk-refresh") {
          if (!w.label) w.label = "_Refresh";
          if (!w.iconName) w.iconName = "view-refresh";
        }
      }
      return;
    case "icon_size":
      if (w instanceof W.Image) w.iconSize = parseInt(value, 10);
      return;
    case "image":
      if (w instanceof W.MenuItem || w instanceof W.Button) pendingImages.push([w, value]);
      return;
    case "always_show_image":
      return;
    case "title":
      if (w instanceof W.Window) w.title = value;
      return;
    case "default_width":
      if (w instanceof W.Window) w.defaultWidth = parseInt(value, 10);
      return;
    case "default_height":
      if (w instanceof W.Window) w.defaultHeight = parseInt(value, 10);
      return;
    case "name":
      if (w instanceof Widget) w.name = value;
      return;
    case "hexpand":
      if (w instanceof Widget) {
        w.hexpand = bool(value);
        w.hexpandSet = true;
      }
      return;
    case "vexpand":
      if (w instanceof Widget) {
        w.vexpand = bool(value);
        w.vexpandSet = true;
      }
      return;
    case "sensitive":
      if (w instanceof Widget) w.sensitive = bool(value);
      return;
    case "toolbar_style":
    case "window_position":
    case "icon":
    case "role":
    case "accel_group":
    case "show_arrow":
    case "is_important":
    case "homogeneous":
    case "draw_as_radio":
      return;
    default:
      void cls;
      void all;
      return;
  }
}

/** `<accelerator>` elements waiting for their widget to reach its toplevel window. */
type PendingAccel = [GObject, string];

/** GDK modifier masks of a Glade `<accelerator modifiers="...">` as GTK accelerator prefixes. */
function gladeAccel(key: string, mods: string): string {
  const names: Record<string, string> = {
    GDK_CONTROL_MASK: "<Control>", GDK_SHIFT_MASK: "<Shift>", GDK_MOD1_MASK: "<Alt>",
    GDK_SUPER_MASK: "<Super>", GDK_META_MASK: "<Meta>",
  };
  const prefix = mods.split("|").map((m) => names[m.trim()] ?? "").join("");
  return prefix + key;
}

function buildObject(el: Element, b: Builder, pendingImages: [W.MenuItem | W.Button, string][], pendingAccels: PendingAccel[] = []): GObject | null {
  const cls = el.getAttribute("class") ?? "";
  const id = el.getAttribute("id");
  const obj = construct(cls);
  if (!obj) return null;
  if (id) b.objects.set(id, obj);
  for (const p of Array.from(el.children)) {
    if (p.tagName === "property") applyProperty(obj, cls, p.getAttribute("name") ?? "", p.textContent ?? "", b.objects, pendingImages);
    // An `activate` accelerator of an actionable widget: registered on its window below.
    if (p.tagName === "accelerator" && (p.getAttribute("signal") ?? "activate") === "activate") {
      pendingAccels.push([obj, gladeAccel(p.getAttribute("key") ?? "", p.getAttribute("modifiers") ?? "")]);
    }
  }
  for (const c of Array.from(el.children)) {
    if (c.tagName !== "child") continue;
    const childEl = Array.from(c.children).find((x) => x.tagName === "object");
    if (!childEl) continue;
    const child = buildObject(childEl, b, pendingImages, pendingAccels);
    if (!(child instanceof Widget)) continue;
    const packing = Array.from(c.children).find((x) => x.tagName === "packing");
    const pk: Record<string, string> = {};
    if (packing) for (const p of Array.from(packing.children)) pk[p.getAttribute("name") ?? ""] = p.textContent ?? "";
    if (obj instanceof W.MenuItem && child instanceof W.Menu) W.menuItemSetSubmenu(obj, child);
    else if (obj instanceof W.MenuToolButton && child instanceof W.Menu) W.menuToolButtonSetMenu(obj, child);
    else if (obj instanceof W.Box) {
      const expand = pk.expand ? bool(pk.expand) : false;
      const fill = pk.fill ? bool(pk.fill) : true;
      const padding = pk.padding ? parseInt(pk.padding, 10) : 0;
      if (pk.pack_type === "end") W.boxPackEnd(obj, child, expand, fill, padding);
      else W.boxPackStart(obj, child, expand, fill, padding);
    } else if (obj instanceof Container) obj.add(child);
  }
  return obj;
}

/** `builderNewFromString` */
export function builderNewFromString(xml: string, _len = -1): Builder {
  const b = new Builder();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const pendingImages: [W.MenuItem | W.Button, string][] = [];
  const pendingAccels: PendingAccel[] = [];
  for (const el of Array.from(doc.documentElement.children)) {
    if (el.tagName === "object") {
      const o = buildObject(el, b, pendingImages, pendingAccels);
      if (o instanceof W.Window) registerToplevel(o);
    }
  }
  // Accelerators of widgets with an action name (`win.save`) go to their window's accelerator
  // table (`Gio.setAccelsForAction`), as GTK's accel group activates the widget, which
  // activates its action.
  for (const [w, accel] of pendingAccels) {
    const actionName = (w as { actionName?: string | null }).actionName;
    if (!(w instanceof Widget) || !actionName) continue;
    let top: Widget = w;
    while (top.parent) top = top.parent;
    if (top instanceof W.Window) top.accels.set(normaliseAccel(accel), actionName.replace(/^(win|app)\./, ""));
  }
  for (const [w, imgId] of pendingImages) {
    const img = b.objects.get(imgId);
    if (img instanceof W.Image) {
      if (w instanceof W.MenuItem) w.iconName = img.iconName;
      else w.image = img;
    }
  }
  return b;
}
/**
 * `builderNewFromFile`: the file is a URL whose contents must already be available, so the
 * Glade text is fetched beforehand with `loadBuilderText` (or imported with `?raw`).
 */
export function builderNewFromFile(path: string): Builder {
  const txt = builderTexts.get(path);
  if (txt === undefined) throw new Error("Gtk.Builder: interface file not preloaded: " + path);
  return builderNewFromString(txt);
}
const builderTexts = new Map<string, string>();
/** Register the text of an interface file so that `builderNewFromFile` can find it. */
export function registerBuilderText(path: string, text: string): void {
  builderTexts.set(path, text);
}
export function builderGetObject(b: Builder, id: string): GObject | null {
  return b.objects.get(id) ?? null;
}
