/**
 * The root of the rendered widget tree: the main application window fills the browser
 * viewport; other toplevels (windows, dialogs, message dialogs, popovers and popup menus) are
 * rendered as Radix overlays. Keyboard accelerators registered on windows are handled here.
 */
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import * as RDialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import { toplevels, type Widget, stripMnemonic } from "./Core";
import * as W from "./Widgets";
import { ColorChooserDialog } from "./Choosers";
import { useWidget, WidgetView } from "./Render";
import { PopupMenuView } from "./RenderBars";
import { iconUrl } from "./IconTheme";
import { accelOfEvent } from "../Gio";
import type { RGBA } from "../Gdk";
import "./theme.css";

function useToplevels(): Widget[] {
  useSyncExternalStore(toplevels.subscribe, toplevels.getVersion, toplevels.getVersion);
  return toplevels.list();
}

/** Make a dialog draggable by its title bar. */
function useDrag(): [React.RefObject<HTMLDivElement>, (e: React.PointerEvent) => void] {
  const ref = useRef<HTMLDivElement>(null);
  const offset = useRef({ x: 0, y: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const sx = e.clientX - offset.current.x, sy = e.clientY - offset.current.y;
    const move = (ev: PointerEvent) => {
      offset.current = { x: ev.clientX - sx, y: ev.clientY - sy };
      el.style.translate = `${offset.current.x}px ${offset.current.y}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return [ref, onPointerDown];
}

function TitleBar({ title, onClose, onPointerDown }: { title: string; onClose: () => void; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div className="gtk-titlebar" onPointerDown={onPointerDown}>
      <span className="gtk-titlebar-spacer" />
      <RDialog.Title className="gtk-titlebar-title">{title}</RDialog.Title>
      <button type="button" className="gtk-titlebar-close" aria-label="Close" onClick={onClose}>
        <img src={iconUrl("window-close-symbolic", 16) ?? undefined} width={16} height={16} alt="" />
      </button>
    </div>
  );
}

function DialogView({ d }: { d: W.Dialog }) {
  useWidget(d);
  const [ref, onDrag] = useDrag();
  if (d.destroyed || !d.visible) return null;
  const sizeStyle: React.CSSProperties = {};
  if (d.defaultWidth > 0) sizeStyle.width = `min(${d.defaultWidth}px, 95vw)`;
  if (d.defaultHeight > 0) sizeStyle.height = `min(${d.defaultHeight}px, 92vh)`;
  return (
    <RDialog.Root open modal={d.modal} onOpenChange={(o) => { if (!o) d.requestClose(); }}>
      <RDialog.Portal>
        {d.modal ? <RDialog.Overlay className="gtk-dialog-overlay" /> : null}
        <RDialog.Content
          ref={ref}
          className={"gtk-dialog-window " + Array.from(d.classes).join(" ")}
          style={sizeStyle}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            d.requestClose();
          }}
          onPointerDownOutside={(e) => {
            if (!d.modal) return;
            e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (d.modal) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            // Focus the first input rather than the close button.
            const el = ref.current?.querySelector<HTMLElement>(".gtk-dialog-content input, .gtk-dialog-content textarea, .gtk-dialog-content [role=tree]");
            if (el) {
              e.preventDefault();
              el.focus();
            }
          }}
        >
          <TitleBar title={d.title} onClose={() => d.requestClose()} onPointerDown={onDrag} />
          <div className="gtk-dialog-content">
            <WidgetView w={d.contentArea} layout={{ flex: "1 1 auto", minHeight: 0 }} />
          </div>
          {d.actionArea.children.length > 0 ? (
            <div className="gtk-dialog-action-area">
              <WidgetView w={d.actionArea} />
            </div>
          ) : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function messageIcon(t: W.MessageDialog["messageType"]): string | null {
  switch (t) {
    case "MessageTypeError": return iconUrl("dialog-error-symbolic", 48);
    case "MessageTypeWarning": return iconUrl("dialog-warning-symbolic", 48);
    case "MessageTypeQuestion": return iconUrl("dialog-question-symbolic", 48);
    case "MessageTypeInfo": return iconUrl("dialog-information-symbolic", 48);
    default: return null;
  }
}

function MessageDialogView({ d }: { d: W.MessageDialog }) {
  useWidget(d);
  if (d.destroyed || !d.visible) return null;
  const icon = messageIcon(d.messageType);
  const buttons = d.actionArea.children.slice().reverse().filter((b): b is W.Button => b instanceof W.Button);
  return (
    <AlertDialog.Root open onOpenChange={(o) => { if (!o) d.requestClose(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="gtk-dialog-overlay" />
        <AlertDialog.Content
          className="gtk-dialog-window gtk-message-dialog"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            d.requestClose();
          }}
        >
          <div className="gtk-message-body">
            {icon ? <img className="gtk-message-icon" src={icon} width={48} height={48} alt="" /> : null}
            <div>
              <AlertDialog.Title className="gtk-message-text">{d.text}</AlertDialog.Title>
              {d.secondaryText ? <AlertDialog.Description className="gtk-message-secondary">{d.secondaryText}</AlertDialog.Description> : <AlertDialog.Description />}
              {d.contentArea.children.length > 0 ? <WidgetView w={d.contentArea} /> : null}
            </div>
          </div>
          <div className="gtk-message-buttons">
            {buttons.map((b, i) => {
              const resp = b.data.get("response") as number | undefined;
              const destructive = resp === -6 || resp === -9 || resp === -7;
              const btn = (
                <button
                  key={b.objectId}
                  type="button"
                  className={"gtk-button" + (i === buttons.length - 1 && !destructive ? " suggested-action" : "")}
                  onClick={() => b.click()}
                >
                  {b.label ? stripMnemonic(b.label) : ""}
                </button>
              );
              return resp === -6 ? <AlertDialog.Cancel asChild key={b.objectId}>{btn}</AlertDialog.Cancel> : btn;
            })}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function AboutDialogView({ d }: { d: W.AboutDialog }) {
  useWidget(d);
  const [ref, onDrag] = useDrag();
  if (d.destroyed || !d.visible) return null;
  const logo = d.logoIconName ? iconUrl(d.logoIconName, 128) : null;
  return (
    <RDialog.Root open onOpenChange={(o) => { if (!o) d.requestClose(); }}>
      <RDialog.Portal>
        <RDialog.Overlay className="gtk-dialog-overlay" />
        <RDialog.Content ref={ref} className="gtk-dialog-window gtk-about-dialog" aria-describedby={undefined}>
          <TitleBar title={`About ${d.programName}`} onClose={() => d.requestClose()} onPointerDown={onDrag} />
          <div className="gtk-about-body">
            {logo ? <img src={logo} width={128} height={128} alt="" /> : null}
            <div className="gtk-about-name">{d.programName}</div>
            {d.version ? <div className="gtk-about-version">{d.version}</div> : null}
            {d.comments ? <div className="gtk-about-comments">{d.comments}</div> : null}
            {d.website ? <a href={d.website} target="_blank" rel="noopener noreferrer">{d.websiteLabel || d.website}</a> : null}
            {d.copyright ? <div className="gtk-about-copyright">{d.copyright}</div> : null}
            {d.license ? <div className="gtk-about-license">{d.license}</div> : null}
            {d.authors.length > 0 ? <div className="gtk-about-authors">{d.authors.join(", ")}</div> : null}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

const PALETTE = [
  "#99c1f1", "#62a0ea", "#3584e4", "#1c71d8", "#1a5fb4",
  "#8ff0a4", "#57e389", "#33d17a", "#2ec27e", "#26a269",
  "#f9f06b", "#f8e45c", "#f6d32d", "#f5c211", "#e5a50a",
  "#ffbe6f", "#ffa348", "#ff7800", "#e66100", "#c64600",
  "#f66151", "#ed333b", "#e01b24", "#c01c28", "#a51d2d",
  "#dc8add", "#c061cb", "#9141ac", "#813d9c", "#613583",
  "#cdab8f", "#b5835a", "#986a44", "#865e3c", "#63452c",
  "#ffffff", "#f6f5f4", "#deddda", "#c0bfbc", "#9a9996",
  "#77767b", "#5e5c64", "#3d3846", "#241f31", "#000000",
];

function hexOf(c: RGBA): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return "#" + h(c.red) + h(c.green) + h(c.blue);
}
function rgbaOf(hex: string): RGBA {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { red: 0, green: 0, blue: 0, alpha: 1 };
  return { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255, alpha: 1 };
}

function ColorChooserView({ d }: { d: ColorChooserDialog }) {
  useWidget(d);
  const [ref, onDrag] = useDrag();
  if (d.destroyed || !d.visible) return null;
  const cur = hexOf(d.rgba);
  return (
    <RDialog.Root open onOpenChange={(o) => { if (!o) d.requestClose(); }}>
      <RDialog.Portal>
        <RDialog.Overlay className="gtk-dialog-overlay" />
        <RDialog.Content ref={ref} className="gtk-dialog-window gtk-color-chooser" aria-describedby={undefined}>
          <TitleBar title={d.title} onClose={() => d.requestClose()} onPointerDown={onDrag} />
          <div className="gtk-dialog-content">
            <div className="gtk-color-palette" role="listbox" aria-label="Colours">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={c === cur}
                  aria-label={c}
                  className={"gtk-color-swatch" + (c === cur ? " selected" : "")}
                  style={{ background: c }}
                  onClick={() => d.userSetRgba(rgbaOf(c))}
                  onDoubleClick={() => {
                    d.userSetRgba(rgbaOf(c));
                    d.respond(-5);
                  }}
                />
              ))}
            </div>
            <label className="gtk-color-custom">
              <span>Custom</span>
              <input type="color" value={cur} onChange={(e) => d.userSetRgba(rgbaOf(e.target.value))} />
              <code>{cur}</code>
            </label>
          </div>
          <div className="gtk-dialog-action-area">
            <WidgetView w={d.actionArea} />
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function WindowView({ w }: { w: W.Window }) {
  useWidget(w);
  const [ref, onDrag] = useDrag();
  useEffect(() => {
    if (w.isMain && w.title) document.title = w.title;
  });
  useEffect(() => {
    if (!w.isMain) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      if (w.unloadGuard?.()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [w, w.isMain]);
  if (w.destroyed || !w.visible) return null;
  const c = w.child();
  if (w.isMain) {
    return (
      <div className={"gtk-window gtk-main-window " + Array.from(w.classes).join(" ")} data-name={w.name || undefined} ref={(e) => w.setElement(e)}>
        {c ? <WidgetView w={c} layout={{ flex: "1 1 auto", minHeight: 0 }} /> : null}
      </div>
    );
  }
  const sizeStyle: React.CSSProperties = {};
  if (w.defaultWidth > 0) sizeStyle.width = `min(${w.defaultWidth}px, 95vw)`;
  if (w.defaultHeight > 0) sizeStyle.height = `min(${w.defaultHeight}px, 92vh)`;
  return (
    <RDialog.Root open modal={w.modal} onOpenChange={(o) => { if (!o) w.requestClose(); }}>
      <RDialog.Portal>
        <RDialog.Content
          ref={ref}
          className={"gtk-dialog-window gtk-window " + Array.from(w.classes).join(" ")}
          style={sizeStyle}
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            w.requestClose();
          }}
        >
          <TitleBar title={w.title} onClose={() => w.requestClose()} onPointerDown={onDrag} />
          <div className="gtk-dialog-content" style={{ padding: 0 }}>
            {c ? <WidgetView w={c} layout={{ flex: "1 1 auto", minHeight: 0 }} /> : null}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function PopoverView({ p }: { p: W.Popover }) {
  useWidget(p);
  if (p.destroyed || !p.open) return null;
  const anchorEl = p.relativeTo?.el ?? null;
  const rect = (): DOMRect => {
    const r = anchorEl?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
    if (p.pointingTo) return new DOMRect(r.left + p.pointingTo.x, r.top + p.pointingTo.y, p.pointingTo.width, p.pointingTo.height);
    return r;
  };
  const side = p.position === "PositionTypeTop" ? "top" : p.position === "PositionTypeLeft" ? "left" : p.position === "PositionTypeRight" ? "right" : "bottom";
  const c = p.child();
  return (
    <Popover.Root open modal={false} onOpenChange={(o) => { if (!o) W.popoverPopdown(p); }}>
      <Popover.Anchor virtualRef={{ current: { getBoundingClientRect: rect } }} />
      <Popover.Portal>
        <Popover.Content className="gtk-popover" side={side} sideOffset={6} collisionPadding={8}>
          {c ? <WidgetView w={c} /> : null}
          <Popover.Arrow className="gtk-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ToplevelView({ w }: { w: Widget }) {
  if (w instanceof ColorChooserDialog) return <ColorChooserView d={w} />;
  if (w instanceof W.MessageDialog) return <MessageDialogView d={w} />;
  if (w instanceof W.AboutDialog) return <AboutDialogView d={w} />;
  if (w instanceof W.Dialog) return <DialogView d={w} />;
  if (w instanceof W.Window) return <WindowView w={w} />;
  if (w instanceof W.Popover) return <PopoverView p={w} />;
  if (w instanceof W.Menu) return <PopupMenuView m={w} />;
  return null;
}

/**
 * Activate the window accelerator for a key event, if there is one (and prevent the browser
 * default). Exported so that widgets which consume key events themselves (the drawing area) can
 * give accelerators priority, as GTK windows do.
 */
export function handleAccelerator(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const accel = accelOfEvent(e);
  if (!accel.includes("+") && !/^f\d+$/.test(accel)) return;
  const target = e.target as HTMLElement | null;
  const inText = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  if (inText && /^control\+[zyxcva]$/.test(accel)) return;
  // A modal dialog blocks the main window's accelerators.
  if (document.querySelector(".gtk-dialog-overlay")) return;
  for (const w of W.mainWindows) {
    const name = w.accels.get(accel);
    if (name) {
      const a = w.actions.get(name);
      if (a && a.enabled) {
        e.preventDefault();
        a.activate(null);
      }
      return;
    }
  }
}

export function GtkRoot(): React.ReactElement {
  const tops = useToplevels();
  useEffect(() => {
    window.addEventListener("keydown", handleAccelerator);
    return () => window.removeEventListener("keydown", handleAccelerator);
  }, []);
  return (
    <Tooltip.Provider delayDuration={600} skipDelayDuration={300}>
      {tops.map((w) => <ToplevelView key={w.objectId} w={w} />)}
    </Tooltip.Provider>
  );
}

let mounted = false;
/** `Gtk.main`: mount the widget tree into the page (idempotent). */
export function main(): void {
  if (mounted) return;
  mounted = true;
  let el = document.getElementById("root");
  if (!el) {
    el = document.createElement("div");
    el.id = "root";
    document.body.appendChild(el);
  }
  createRoot(el).render(<GtkRoot />);
}
/** `Gtk.init`: nothing to initialise in the browser. */
export function init(_args: unknown): void {}
/** `Gtk.mainQuit`: there is no main loop to leave; the page stays open. */
export function mainQuit(): void {}
