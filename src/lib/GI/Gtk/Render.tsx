/**
 * React rendering of the web GTK toolkit's retained widgets.
 *
 * `WidgetView` subscribes to a widget and renders it according to its `kind`. Containers
 * render their children with `WidgetView`, passing layout styles derived from GTK packing.
 * Radix UI primitives provide accessible behaviour for checkboxes, radio buttons, selects,
 * tabs, sliders, separators, toolbars, menus, dialogs, popovers and tooltips.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as RadioGroup from "@radix-ui/react-radio-group";
import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import * as Slider from "@radix-ui/react-slider";
import * as RSeparator from "@radix-ui/react-separator";
import { createPortal } from "react-dom";
import { Bin, Widget, stripMnemonic, iconSizePixels, type Align } from "./Core";
import * as W from "./Widgets";
import { ComboBox, ComboBoxText, IconView } from "./Choosers";
import { TreeView } from "./TreeView";
import { iconUrl } from "./IconTheme";
import { actionEnabledFor } from "./Widgets";
import { onAnyActionEnabledChanged } from "../Gio";
import { eventKeyFromDom, modifiersOf, type EventButton } from "../Gdk";
import { parseMarkup } from "../Pango";
import { TreeViewView, IconViewView } from "./RenderTree";
import { DrawingAreaView } from "./RenderCanvas";
import { ToolbarView, MenuBarView } from "./RenderBars";

export function useWidget(w: Widget): number {
  return useSyncExternalStore(w.subscribe, w.getVersion, w.getVersion);
}

/** Re-render when any Gio action's enabled state changes. */
function useActionsVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => onAnyActionEnabledChanged(() => setV((x) => x + 1)), []);
  return v;
}

export type LayoutStyle = React.CSSProperties;

function alignSelf(a: Align): React.CSSProperties["alignSelf"] {
  switch (a) {
    case "AlignStart": return "flex-start";
    case "AlignEnd": return "flex-end";
    case "AlignCenter": return "center";
    case "AlignBaseline": return "baseline";
    default: return "stretch";
  }
}

/** Common attributes for a widget's root element. */
export function baseProps(w: Widget, extraClass: string, layout?: LayoutStyle): {
  className: string;
  style: React.CSSProperties;
  "data-name"?: string;
  "aria-disabled"?: boolean;
  ref: (el: HTMLElement | null) => void;
} {
  const classes = ["gtk-" + w.kind, extraClass, ...Array.from(w.classes)];
  if (!w.sensitive) classes.push("insensitive");
  const style: React.CSSProperties = { ...layout };
  if (w.widthRequest >= 0) style.minWidth = w.widthRequest;
  if (w.heightRequest >= 0) style.minHeight = w.heightRequest;
  const m = w.margin;
  if (m.top || m.bottom || m.start || m.end) {
    style.marginTop = (Number(style.marginTop) || 0) + m.top;
    style.marginBottom = (Number(style.marginBottom) || 0) + m.bottom;
    style.marginLeft = (Number(style.marginLeft) || 0) + m.start;
    style.marginRight = (Number(style.marginRight) || 0) + m.end;
  }
  Object.assign(style, w.style);
  return {
    className: classes.filter(Boolean).join(" "),
    style,
    "data-name": w.name || undefined,
    "aria-disabled": w.sensitive ? undefined : true,
    ref: (el: HTMLElement | null) => w.setElement(el),
  };
}

/** Mouse event handlers that emit GTK button-press/release events on a widget. */
export function buttonEventHandlers(w: Widget, el: () => HTMLElement | null): {
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseUp?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
} {
  const hasPress = w.hasHandlers("button-press-event");
  const hasRelease = w.hasHandlers("button-release-event");
  if (!hasPress && !hasRelease) return {};
  const ev = (e: React.MouseEvent, type: EventButton["type"]): EventButton => {
    const r = el()?.getBoundingClientRect();
    return {
      type,
      button: e.button === 0 ? 1 : e.button === 1 ? 2 : 3,
      x: r ? e.clientX - r.left : e.clientX,
      y: r ? e.clientY - r.top : e.clientY,
      xRoot: e.clientX,
      yRoot: e.clientY,
      state: modifiersOf(e),
      time: e.timeStamp,
      dom: e.nativeEvent,
    };
  };
  return {
    onMouseDown: hasPress ? (e) => {
      if (!w.sensitive) return;
      let handled = w.emit("button-press-event", ev(e, "EventTypeButtonPress"));
      if (e.detail === 2) handled = w.emit("button-press-event", ev(e, "EventType2buttonPress")) || handled;
      if (handled === true) {
        e.preventDefault();
        e.stopPropagation();
      }
    } : undefined,
    onMouseUp: hasRelease ? (e) => {
      if (w.emit("button-release-event", ev(e, "EventTypeButtonRelease")) === true) e.stopPropagation();
    } : undefined,
    onContextMenu: hasPress ? (e) => e.preventDefault() : undefined,
  };
}

export function keyHandler(w: Widget): ((e: React.KeyboardEvent) => void) | undefined {
  if (!w.hasHandlers("key-press-event")) return undefined;
  return (e) => {
    if (w.emit("key-press-event", eventKeyFromDom(e.nativeEvent)) === true) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
}

export function focusHandlers(w: Widget): { onFocus?: () => void; onBlur?: () => void } {
  const r: { onFocus?: () => void; onBlur?: () => void } = {};
  if (w.hasHandlers("focus-in-event")) r.onFocus = () => w.emit("focus-in-event", { in_: true });
  if (w.hasHandlers("focus-out-event")) r.onBlur = () => w.emit("focus-out-event", { in_: false });
  return r;
}

/** Wrap an element in a tooltip if the widget has tooltip text. */
function withTooltip(w: Widget, el: React.ReactElement): React.ReactElement {
  if (!w.tooltip) return el;
  return <TooltipWrap w={w}>{el}</TooltipWrap>;
}

/**
 * Shows the widget's tooltip below it when the pointer rests on it, as GTK does. The widget
 * views do not forward refs or event props (a Radix `Tooltip.Trigger asChild` got neither, so
 * tooltips never opened), so the wrapper is a `display: contents` span, which adds no layout
 * box but still sees the pointer events of the widget, and the tooltip is placed from the
 * widget's own element.
 */
function TooltipWrap({ w, children }: { w: Widget; children: React.ReactElement }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => clear, [clear]);
  const hide = () => {
    clear();
    setPos(null);
  };
  return (
    <span
      style={{ display: "contents" }}
      onPointerEnter={() => {
        clear();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          const r = w.el?.getBoundingClientRect();
          if (r) setPos({ left: Math.max(8, Math.min(window.innerWidth - 8, r.left + r.width / 2)), top: r.bottom + 4 });
        }, 600);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
    >
      {children}
      {pos && w.tooltip
        ? createPortal(
          <div className="gtk-tooltip" role="tooltip" style={{ position: "fixed", left: pos.left, top: pos.top, transform: "translateX(-50%)" }}>
            {w.tooltip}
          </div>,
          document.body,
        )
        : null}
    </span>
  );
}

export function WidgetView({ w, layout }: { w: Widget; layout?: LayoutStyle }): React.ReactElement | null {
  useWidget(w);
  if (w.destroyed || !w.visible) return null;
  const el = renderKind(w, layout);
  return el ? withTooltip(w, el) : null;
}

function renderKind(w: Widget, layout?: LayoutStyle): React.ReactElement | null {
  switch (w.kind) {
    case "box": case "buttonBox": return <BoxView w={w as W.Box} layout={layout} />;
    case "label": return <LabelView w={w as W.Label} layout={layout} />;
    case "entry": return <EntryView w={w as W.Entry} layout={layout} />;
    case "button": case "toggleButton": return <ButtonView w={w as W.Button} layout={layout} />;
    case "checkButton": return <CheckButtonView w={w as W.CheckButton} layout={layout} />;
    case "radioButton": return <RadioButtonView w={w as W.RadioButton} layout={layout} />;
    case "linkButton": return <LinkButtonView w={w as W.LinkButton} layout={layout} />;
    case "frame": return <FrameView w={w as W.Frame} layout={layout} />;
    case "scrolledWindow": return <ScrolledWindowView w={w as W.ScrolledWindow} layout={layout} />;
    case "viewport": case "bin": case "eventBox": case "toolItem": return <BinView w={w as W.Viewport} layout={layout} />;
    case "layout": return <LayoutView w={w as W.Layout} layout={layout} />;
    case "grid": return <GridView w={w as W.Grid} layout={layout} />;
    case "separator": return <SeparatorView w={w as W.Separator} layout={layout} />;
    case "image": return <ImageView w={w as W.Image} layout={layout} />;
    case "spinner": return <span {...baseProps(w, "", layout)}><span className="gtk-spinner-wheel" /></span>;
    case "textView": return <TextViewView w={w as W.TextView} layout={layout} />;
    case "scale": return <ScaleView w={w as W.Scale} layout={layout} />;
    case "calendar": return <CalendarView w={w as W.Calendar} layout={layout} />;
    case "notebook": return <NotebookView w={w as W.Notebook} layout={layout} />;
    case "paned": return <PanedView w={w as W.Paned} layout={layout} />;
    case "drawingArea": return <DrawingAreaView w={w as W.DrawingArea} layout={layout} />;
    case "comboBox": case "comboBoxText": return <ComboBoxView w={w as ComboBox} layout={layout} />;
    case "iconView": return <IconViewView w={w as IconView} layout={layout} />;
    case "treeView": return <TreeViewView w={w as TreeView} layout={layout} />;
    case "toolbar": return <ToolbarView w={w as W.Toolbar} layout={layout} />;
    case "menuBar": return <MenuBarView w={w as W.MenuBar} layout={layout} />;
    case "container": return <BoxView w={w as W.Box} layout={layout} />;
    case "window": case "dialog": case "messageDialog": case "aboutDialog": case "colorChooserDialog":
    case "menu": case "popover":
      return null; // Toplevels are rendered by GtkRoot.
    default:
      return <div {...baseProps(w, "", layout)}>{w.getChildren().map((c) => <WidgetView key={c.objectId} w={c} />)}</div>;
  }
}

// ---------------------------------------------------------------------------------------------
// Containers

function childLayout(c: Widget, horizontal: boolean, expandAll: boolean): LayoutStyle {
  const p = c.packing;
  const expand = p.expand || expandAll || (horizontal ? c.hexpandSet && c.hexpand : c.vexpandSet && c.vexpand);
  const s: LayoutStyle = {
    flexGrow: expand ? 1 : 0,
    flexShrink: expand ? 1 : 0,
    flexBasis: expandAll ? 0 : "auto",
  };
  if (expand) {
    if (horizontal) s.minWidth = 0;
    else s.minHeight = 0;
  }
  if (p.padding) {
    if (horizontal) {
      s.marginLeft = p.padding;
      s.marginRight = p.padding;
    } else {
      s.marginTop = p.padding;
      s.marginBottom = p.padding;
    }
  }
  const cross = horizontal ? c.valign : c.halign;
  s.alignSelf = alignSelf(cross);
  if (expand && !p.fill) {
    const main = horizontal ? c.halign : c.valign;
    s.alignItems = "center";
    s.justifyContent = main === "AlignStart" ? "flex-start" : main === "AlignEnd" ? "flex-end" : "center";
  }
  return s;
}

function BoxView({ w, layout }: { w: W.Box; layout?: LayoutStyle }) {
  const horizontal = w.orientation === "OrientationHorizontal";
  const isButtonBox = w instanceof W.ButtonBox;
  // A GtkButtonBox lays its children out in insertion order whatever their pack type (it uses
  // `_gtk_box_get_children`), so dialog buttons added with `dialogAddButton` (packed at the end)
  // read left to right in the order they were added: "Cancel", "OK", "Apply".
  const start = isButtonBox ? w.children : w.children.filter((c) => c.packing.packType !== "PackTypeEnd");
  const end = isButtonBox ? [] : w.children.filter((c) => c.packing.packType === "PackTypeEnd").reverse();
  const anyExpand = w.children.some((c) => c.visible && (c.packing.expand || (horizontal ? c.hexpandSet && c.hexpand : c.vexpandSet && c.vexpand)));
  const style: LayoutStyle = {
    display: "flex",
    flexDirection: horizontal ? "row" : "column",
    gap: w.spacing,
    padding: w.borderWidth || undefined,
  };
  if (isButtonBox) {
    const l = (w as W.ButtonBox).layout;
    style.justifyContent = l === "ButtonBoxStyleCenter" ? "center" : l === "ButtonBoxStyleStart" ? "flex-start" : l === "ButtonBoxStyleSpread" ? "space-evenly" : l === "ButtonBoxStyleEdge" ? "space-between" : "flex-end";
  }
  const kids: React.ReactNode[] = [];
  const wrap = (c: Widget, extra: LayoutStyle = {}) => {
    const cl = { ...childLayout(c, horizontal, w.homogeneous), ...extra };
    if (c.packing.expand && !c.packing.fill) {
      const { alignItems, justifyContent, ...outer } = cl;
      kids.push(
        <div key={c.objectId} className="gtk-box-slot" style={{ ...outer, display: "flex", flexDirection: horizontal ? "row" : "column", alignItems, justifyContent }}>
          <WidgetView w={c} />
        </div>,
      );
    } else kids.push(<WidgetView key={c.objectId} w={c} layout={cl} />);
  };
  start.forEach((c) => wrap(c));
  end.forEach((c, i) => wrap(c, i === 0 && !anyExpand && !isButtonBox ? (horizontal ? { marginLeft: "auto" } : { marginTop: "auto" }) : {}));
  const props = baseProps(w, horizontal ? "horizontal" : "vertical", { ...style, ...layout });
  const el = useRef<HTMLElement | null>(null);
  return (
    <div
      {...props}
      ref={(e) => {
        el.current = e;
        props.ref(e);
      }}
      onKeyDown={keyHandler(w)}
      {...buttonEventHandlers(w, () => el.current)}
    >
      {homogeneousButtons(w, horizontal) ? (
        // GTK3 button boxes give their children equal widths (the "non-homogeneous" child
        // property defaults to false): the widest button sets the width of all of them.
        <div className="gtk-buttonbox-cells" style={{ display: "inline-grid", gridAutoFlow: "column", gridAutoColumns: "1fr", gap: w.spacing }}>
          {kids}
        </div>
      ) : (
        kids
      )}
    </div>
  );
}

/** True if a horizontal button box should lay its children out with equal widths. */
function homogeneousButtons(w: W.Box, horizontal: boolean): boolean {
  if (!(w instanceof W.ButtonBox) || !horizontal) return false;
  const l = w.layout;
  return l !== "ButtonBoxStyleSpread" && l !== "ButtonBoxStyleEdge" && l !== "ButtonBoxStyleExpand" && w.children.filter((c) => c.visible).length > 1;
}

function BinView({ w, layout }: { w: Bin; layout?: LayoutStyle }) {
  const c = w.child();
  const el = useRef<HTMLElement | null>(null);
  const props = baseProps(w, "", { display: "flex", flexDirection: "column", ...layout });
  return (
    <div
      {...props}
      ref={(e) => {
        el.current = e;
        props.ref(e);
      }}
      {...buttonEventHandlers(w, () => el.current)}
      onKeyDown={keyHandler(w)}
    >
      {c ? <WidgetView w={c} layout={{ flex: "1 1 auto", minHeight: 0, minWidth: 0 }} /> : null}
    </div>
  );
}

function LayoutView({ w, layout }: { w: W.Layout; layout?: LayoutStyle }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The layout's own allocation is reported with "size-allocate", as GTK does.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = "";
    const ro = new ResizeObserver(() => {
      const r = { x: 0, y: 0, width: el.clientWidth, height: el.clientHeight };
      const key = `${r.width}x${r.height}`;
      if (key === last) return;
      last = key;
      w.emit("size-allocate", r);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  const props = baseProps(w, "", { position: "relative", ...layout });
  return (
    <div
      {...props}
      ref={(e) => {
        ref.current = e as HTMLDivElement | null;
        props.ref(e);
      }}
    >
      <div style={{ position: "relative", width: w.width, height: w.height }}>
        {w.children.map((c) => {
          const [x, y] = w.positions.get(c) ?? [0, 0];
          const size = w.sizes.get(c);
          const sizeStyle: LayoutStyle = size ? { width: size[0], height: size[1], boxSizing: "border-box" } : {};
          return <WidgetView key={c.objectId} w={c} layout={{ position: "absolute", left: x, top: y, ...sizeStyle }} />;
        })}
      </div>
    </div>
  );
}

/**
 * `gtk_widget_compute_expand`: a widget expands if its expand flag is set, or, when it has not
 * been set explicitly, if any visible descendant expands.
 */
function computeExpand(w: Widget, horizontal: boolean): boolean {
  if (horizontal ? w.hexpandSet : w.vexpandSet) return horizontal ? w.hexpand : w.vexpand;
  return w.getChildren().some((c) => c.visible && computeExpand(c, horizontal));
}

function GridView({ w, layout }: { w: W.Grid; layout?: LayoutStyle }) {
  let cols = 0, rows = 0;
  const hexpandCols = new Set<number>(), vexpandRows = new Set<number>();
  for (const c of w.children) {
    const [l, t, wd, ht] = w.placement.get(c) ?? [0, 0, 1, 1];
    cols = Math.max(cols, l + wd);
    rows = Math.max(rows, t + ht);
    if (computeExpand(c, true)) for (let i = l; i < l + wd; i++) hexpandCols.add(i);
    if (computeExpand(c, false)) for (let i = t; i < t + ht; i++) vexpandRows.add(i);
  }
  const colT = Array.from({ length: cols }, (_, i) => (w.columnHomogeneous ? "1fr" : hexpandCols.has(i) ? "minmax(0, 1fr)" : "auto")).join(" ");
  const rowT = Array.from({ length: rows }, (_, i) => (w.rowHomogeneous ? "1fr" : vexpandRows.has(i) ? "minmax(0, 1fr)" : "auto")).join(" ");
  return (
    <div {...baseProps(w, "", { display: "grid", gridTemplateColumns: colT, gridTemplateRows: rowT, alignContent: vexpandRows.size > 0 || w.rowHomogeneous ? "stretch" : "start", justifyContent: hexpandCols.size > 0 || w.columnHomogeneous ? "stretch" : "start", columnGap: w.columnSpacing, rowGap: w.rowSpacing, padding: w.borderWidth || undefined, ...layout })}>
      {w.children.map((c) => {
        const [l, t, wd, ht] = w.placement.get(c) ?? [0, 0, 1, 1];
        return (
          <WidgetView
            key={c.objectId}
            w={c}
            layout={{ gridColumn: `${l + 1} / span ${wd}`, gridRow: `${t + 1} / span ${ht}`, justifySelf: c.halign === "AlignFill" ? "stretch" : alignSelf(c.halign) as any, alignSelf: c.valign === "AlignFill" ? "stretch" : alignSelf(c.valign), minWidth: 0 }}
          />
        );
      })}
    </div>
  );
}

function FrameView({ w, layout }: { w: W.Frame; layout?: LayoutStyle }) {
  const c = w.child();
  return (
    <div {...baseProps(w, w.shadow === "ShadowTypeNone" ? "flat" : "", { display: "flex", flexDirection: "column", ...layout })}>
      {w.labelWidget ? <div className="gtk-frame-label"><WidgetView w={w.labelWidget} /></div> : w.label ? <div className="gtk-frame-label">{w.label}</div> : null}
      <div className="gtk-frame-border" style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {c ? <WidgetView w={c} layout={{ flex: "1 1 auto", minHeight: 0 }} /> : null}
      </div>
    </div>
  );
}

function ScrolledWindowView({ w, layout }: { w: W.ScrolledWindow; layout?: LayoutStyle }) {
  const c = w.child();
  const ref = useRef<HTMLDivElement | null>(null);
  const ov = (p: string) => (p === "PolicyTypeNever" ? "hidden" : p === "PolicyTypeAlways" ? "scroll" : "auto");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      w.hadj.value = el.scrollLeft;
      w.hadj.upper = el.scrollWidth;
      w.hadj.pageSize = el.clientWidth;
      w.vadj.value = el.scrollTop;
      w.vadj.upper = el.scrollHeight;
      w.vadj.pageSize = el.clientHeight;
    };
    sync();
    w.hadj.onSet = (v) => {
      el.scrollLeft = v;
    };
    w.vadj.onSet = (v) => {
      el.scrollTop = v;
    };
    const onScroll = () => {
      sync();
      w.hadj.emit("value-changed");
      w.vadj.emit("value-changed");
    };
    el.addEventListener("scroll", onScroll);
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  });
  const style: LayoutStyle = {
    overflowX: ov(w.hpolicy) as any,
    overflowY: ov(w.vpolicy) as any,
    minHeight: w.minContentHeight >= 0 ? w.minContentHeight : w.propagateNaturalHeight ? undefined : 0,
    minWidth: w.minContentWidth >= 0 ? w.minContentWidth : w.propagateNaturalWidth ? undefined : 0,
    maxHeight: w.maxContentHeight >= 0 ? w.maxContentHeight : undefined,
    maxWidth: w.maxContentWidth >= 0 ? w.maxContentWidth : undefined,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    ...layout,
    // An explicit min-content size is a hard minimum, also inside containers that pass
    // `minHeight: 0` for flex shrinking (e.g. notebook pages).
    ...(w.minContentHeight >= 0 ? { minHeight: w.minContentHeight } : {}),
    ...(w.minContentWidth >= 0 ? { minWidth: w.minContentWidth } : {}),
  };
  const props = baseProps(w, w.shadow === "ShadowTypeNone" ? "" : "frame", style);
  return (
    <div
      {...props}
      ref={(e) => {
        ref.current = e;
        props.ref(e);
      }}
    >
      {c ? <WidgetView w={c} layout={{ flex: "1 0 auto" }} /> : null}
    </div>
  );
}

function SeparatorView({ w, layout }: { w: W.Separator; layout?: LayoutStyle }) {
  const p = baseProps(w, "", layout);
  return (
    <RSeparator.Root
      ref={p.ref as any}
      className={p.className}
      style={p.style}
      orientation={w.orientation === "OrientationHorizontal" ? "horizontal" : "vertical"}
    />
  );
}

function PanedView({ w, layout }: { w: W.Paned; layout?: LayoutStyle }) {
  const horizontal = w.orientation === "OrientationHorizontal";
  const ref = useRef<HTMLDivElement | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const pos = horizontal ? ev.clientX - r.left : ev.clientY - r.top;
      w.setPositionUser(Math.max(40, Math.min(pos, (horizontal ? r.width : r.height) - 40)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const first: LayoutStyle = w.position >= 0
    ? { flex: `0 0 ${w.position}px`, minWidth: 0, minHeight: 0 }
    : { flex: w.resize1 ? "1 1 0" : "0 0 auto", minWidth: 0, minHeight: 0 };
  const second: LayoutStyle = { flex: w.position >= 0 || w.resize2 ? "1 1 0" : "0 0 auto", minWidth: 0, minHeight: 0 };
  const props = baseProps(w, horizontal ? "horizontal" : "vertical", { display: "flex", flexDirection: horizontal ? "row" : "column", ...layout });
  return (
    <div
      {...props}
      ref={(e) => {
        ref.current = e;
        props.ref(e);
      }}
    >
      {w.child1 ? <WidgetView w={w.child1} layout={first} /> : null}
      <div
        className="gtk-paned-handle"
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          const cur = w.position >= 0 ? w.position : (horizontal ? (w.child1?.el?.offsetWidth ?? 200) : (w.child1?.el?.offsetHeight ?? 200));
          if (e.key === (horizontal ? "ArrowLeft" : "ArrowUp")) w.setPositionUser(cur - 20);
          if (e.key === (horizontal ? "ArrowRight" : "ArrowDown")) w.setPositionUser(cur + 20);
        }}
      />
      {w.child2 ? <WidgetView w={w.child2} layout={second} /> : null}
    </div>
  );
}

/**
 * The notebook tab being dragged (HTML5 drag and drop). As in GTK, a reorderable tab can be
 * dragged to another position in its notebook, and a detachable tab can be dragged to another
 * notebook with the same group name (`notebookSetGroupName`).
 */
let tabDrag: { from: W.Notebook; child: Widget } | null = null;

/** Can the tab being dragged be dropped on the notebook? */
function tabDropAllowed(to: W.Notebook): boolean {
  if (!tabDrag) return false;
  const { from, child } = tabDrag;
  const page = from.pages.find((p) => p.child === child);
  if (!page) return false;
  // As in GTK, a detachable tab dropped back on its own notebook (which is in its own group)
  // is moved to the drop position, even if it is not reorderable.
  if (from === to) return page.reorderable || (page.detachable && from.groupName !== null);
  if (!page.detachable || from.groupName === null || from.groupName !== to.groupName) return false;
  // Not into a notebook inside the page being dragged.
  for (let a: Widget | null = to; a; a = a.parent) if (a === child) return false;
  return true;
}

function NotebookView({ w, layout }: { w: W.Notebook; layout?: LayoutStyle }) {
  const cur = w.currentPage;
  const props = baseProps(w, w.showBorder ? "" : "flat", { display: "flex", flexDirection: "column", ...layout });
  // Tab position where a dragged tab would be dropped (for the drop indicator).
  const [dropAt, setDropAt] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // As GTK does for a scrollable notebook, keep the current tab scrolled into view.
  const nPages = w.pages.length;
  useEffect(() => {
    const list = listRef.current;
    if (!list || !w.scrollable || cur < 0) return;
    const tab = Array.from(list.children).filter((el) => el.classList.contains("gtk-notebook-tab"))[cur];
    if (!tab) return;
    const lr = list.getBoundingClientRect(), tr = tab.getBoundingClientRect();
    if (tr.right > lr.right) list.scrollLeft += tr.right - lr.right;
    if (tr.left < lr.left) list.scrollLeft -= lr.left - tr.left;
  }, [cur, nPages, w.scrollable]);
  const dropIndex = (e: React.DragEvent): number => {
    const tabs = listRef.current ? Array.from(listRef.current.children).filter((el) => el.classList.contains("gtk-notebook-tab")) : [];
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) return i;
    }
    return tabs.length;
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!tabDropAllowed(w)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const i = dropIndex(e);
    if (i !== dropAt) setDropAt(i);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (dropAt !== null && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!tabDrag || !tabDropAllowed(w)) return;
    e.preventDefault();
    e.stopPropagation();
    const { from, child } = tabDrag;
    tabDrag = null;
    const i = dropIndex(e);
    setDropAt(null);
    if (from === w) {
      const old = W.notebookPageNum(w, child);
      const to = i > old ? i - 1 : i;
      if (to !== old) W.notebookReorderChild(w, child, to);
    } else W.notebookDoDetachTab(from, w, child, i);
  };
  // GTK's "reorder-tab" key bindings: Alt+arrow keys, Alt+Home and Alt+End on a reorderable tab.
  const onTabKeyDown = (p: W.NotebookPage, i: number, e: React.KeyboardEvent) => {
    if (!e.altKey || !p.reorderable) return;
    const n = w.pages.length;
    const to = e.key === "ArrowLeft" || e.key === "ArrowUp" ? i - 1
      : e.key === "ArrowRight" || e.key === "ArrowDown" ? i + 1
        : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (to >= 0 && to < n && to !== i) W.notebookReorderChild(w, p.child, to);
  };
  return (
    <Tabs.Root
      ref={props.ref as any}
      className={props.className}
      style={props.style}
      data-name={props["data-name"]}
      value={cur >= 0 ? String(w.pages[cur]?.child.objectId ?? "") : ""}
      onValueChange={(v) => {
        const n = w.pages.findIndex((p) => String(p.child.objectId) === v);
        if (n >= 0) w.switchTo(n);
      }}
      activationMode="manual"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {w.showTabs ? (
        <div className="gtk-notebook-header">
          {w.actionWidgets.start ? <div className="gtk-notebook-action"><WidgetView w={w.actionWidgets.start} /></div> : null}
          <Tabs.List
            ref={listRef}
            className={"gtk-notebook-tabs" + (w.scrollable ? " scrollable" : "") + (dropAt !== null && w.pages.length === 0 ? " drop-target" : "")}
            loop
          >
            {w.pages.map((p, i) => (
              <Tabs.Trigger key={p.child.objectId} value={String(p.child.objectId)} asChild>
                <div
                  className={"gtk-notebook-tab" + (i === cur ? " active" : "") +
                    (dropAt === i ? " drop-before" : dropAt === w.pages.length && i === w.pages.length - 1 ? " drop-after" : "")}
                  draggable={p.detachable || p.reorderable}
                  aria-keyshortcuts={p.reorderable ? "Alt+ArrowLeft Alt+ArrowRight Alt+Home Alt+End" : undefined}
                  onDragStart={(e) => {
                    if (!p.detachable && !p.reorderable) return;
                    e.stopPropagation();
                    tabDrag = { from: w, child: p.child };
                    e.dataTransfer.setData("application/x-gtk-notebook-tab", String(p.child.objectId));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    tabDrag = null;
                    setDropAt(null);
                  }}
                  onKeyDown={(e) => onTabKeyDown(p, i, e)}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                >
                  {p.tabLabel ? <WidgetView w={p.tabLabel} /> : <span>{`Page ${i + 1}`}</span>}
                </div>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {w.actionWidgets.end ? <div className="gtk-notebook-action"><WidgetView w={w.actionWidgets.end} /></div> : null}
        </div>
      ) : null}
      {/* As in GTK, the notebook requests the size of its largest page, so a dialog does not
          change size when the user switches tabs: the pages share one grid cell and the
          inactive ones are hidden with `visibility` (still laid out, not shown or focusable). */}
      <div
        className="gtk-notebook-pages"
        // GTK clips the pages to the notebook's allocation (e.g. a notebook squeezed in a pane).
        style={{ flex: "1 1 auto", position: "relative", minHeight: 0, display: "grid", gridTemplate: "minmax(0, 1fr) / minmax(0, 1fr)", overflow: "hidden" }}
      >
        {w.pages.map((p, i) => (
          <Tabs.Content
            key={p.child.objectId}
            value={String(p.child.objectId)}
            forceMount
            className="gtk-notebook-page"
            style={{
              gridArea: "1 / 1",
              display: p.child.visible ? "flex" : "none",
              visibility: i === cur ? undefined : "hidden",
              flexDirection: "column",
              minHeight: 0,
              minWidth: 0,
            }}
          >
            <WidgetView w={p.child} layout={{ flex: "1 1 auto", minHeight: 0 }} />
          </Tabs.Content>
        ))}
      </div>
    </Tabs.Root>
  );
}

// ---------------------------------------------------------------------------------------------
// Simple widgets

function textAlignOf(xalign: number, justify: string): React.CSSProperties["textAlign"] {
  if (justify === "JustificationCenter") return "center";
  if (justify === "JustificationRight") return "right";
  if (justify === "JustificationFill") return "justify";
  return xalign <= 0.25 ? "left" : xalign >= 0.75 ? "right" : "center";
}

/** Render Pango markup as React nodes. */
export function MarkupText({ markup }: { markup: string }): React.ReactElement {
  const [text, attrs] = parseMarkup(markup);
  const enc = new TextEncoder();
  // Build boundaries.
  const bounds = new Set<number>([0, text.length]);
  const byteToIdx = (b: number) => {
    let acc = 0;
    for (let i = 0; i < text.length; i++) {
      if (acc >= b) return i;
      acc += enc.encode(text[i]).length;
    }
    return text.length;
  };
  const ranges = attrs.attrs.map((a) => ({ a, s: byteToIdx(a.startIndex), e: byteToIdx(a.endIndex) }));
  ranges.forEach((r) => {
    bounds.add(r.s);
    bounds.add(r.e);
  });
  const pts = Array.from(bounds).filter((x) => x >= 0 && x <= text.length).sort((a, b) => a - b);
  const parts: React.ReactNode[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const s = pts[i], e = pts[i + 1];
    const style: React.CSSProperties = {};
    for (const r of ranges) {
      if (r.s <= s && r.e >= e) {
        if (r.a.kind === "weight") style.fontWeight = r.a.value === "WeightBold" ? 700 : 400;
        if (r.a.kind === "style") style.fontStyle = "italic";
        if (r.a.kind === "underline") style.textDecoration = "underline";
        if (r.a.kind === "foreground") style.color = r.a.value;
        if (r.a.kind === "background") style.background = r.a.value;
      }
    }
    parts.push(<span key={i} style={style}>{text.slice(s, e)}</span>);
  }
  return <>{parts}</>;
}

function LabelView({ w, layout }: { w: W.Label; layout?: LayoutStyle }) {
  const el = useRef<HTMLElement | null>(null);
  const style: LayoutStyle = {
    textAlign: textAlignOf(w.xalign, w.wrap ? w.justify : "JustificationLeft"),
    whiteSpace: w.wrap ? "pre-wrap" : "pre",
    overflowWrap: w.wrap && w.wrapMode !== "WrapModeWord" ? "anywhere" : undefined,
    userSelect: w.selectable ? "text" : undefined,
    ...(w.ellipsize !== "EllipsizeModeNone" ? { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } : {}),
    // max-width-chars limits the natural width; a label given an explicit allocation (a child
    // of a Layout, see `widgetSizeAllocate`) uses the whole allocated width, as in GTK.
    ...(w.maxWidthChars > 0 && layout?.width === undefined ? { maxWidth: `${w.maxWidthChars}ch` } : {}),
    ...(w.widthChars > 0 ? { minWidth: `${w.widthChars}ch` } : {}),
    ...layout,
  };
  const props = baseProps(w, "", style);
  const content = w.useMarkup ? <MarkupText markup={w.text} /> : w.useUnderline ? stripMnemonic(w.text) : w.text;
  return (
    <span
      {...props}
      ref={(e) => {
        el.current = e;
        props.ref(e);
      }}
      {...buttonEventHandlers(w, () => el.current)}
    >
      {content}
    </span>
  );
}

function EntryView({ w, layout }: { w: W.Entry; layout?: LayoutStyle }) {
  const el = useRef<HTMLDivElement | null>(null);
  // Padding (16px) and border (2px) plus room for the caret: GTK's width-chars counts text only.
  // GTK's width-chars is the requested width; an entry that expands horizontally may grow beyond it.
  const wc = w.widthChars > 0 ? `calc(${w.widthChars}ch + 20px)` : null;
  const style: LayoutStyle = { ...(wc ? (w.hexpand ? { minWidth: wc } : { width: wc }) : {}), ...layout };
  const props = baseProps(w, w.hasFrame ? "" : "flat", style);
  const icon = (pos: "EntryIconPositionPrimary" | "EntryIconPositionSecondary") => {
    const name = w.icons[pos];
    if (!name) return null;
    const url = iconUrl(name, 16);
    return (
      <button
        type="button"
        className="gtk-entry-icon"
        tabIndex={-1}
        title={w.iconTooltips[pos] ?? undefined}
        aria-label={w.iconTooltips[pos] ?? name}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          const r = el.current?.getBoundingClientRect();
          w.emit("icon-press", pos, {
            type: "EventTypeButtonPress", button: 1, x: r ? e.clientX - r.left : 0, y: r ? e.clientY - r.top : 0,
            xRoot: e.clientX, yRoot: e.clientY, state: modifiersOf(e), time: e.timeStamp,
          });
        }}
      >
        {url ? <img src={url} alt="" width={16} height={16} /> : null}
      </button>
    );
  };
  return (
    <div
      {...props}
      ref={(e) => {
        el.current = e;
        props.ref(e);
      }}
      {...buttonEventHandlers(w, () => el.current)}
    >
      {icon("EntryIconPositionPrimary")}
      <input
        type={w.visibility ? "text" : "password"}
        value={w.text}
        readOnly={!w.editable}
        disabled={!w.sensitive}
        placeholder={w.placeholder}
        maxLength={w.maxLength > 0 ? w.maxLength : undefined}
        spellCheck={w.inputHints.includes("InputHintsSpellcheck")}
        style={{ textAlign: w.xalign >= 0.75 ? "right" : w.xalign >= 0.25 ? "center" : "left", ...(wc && w.hexpand ? { width: 0 } : {}) }}
        onChange={(e) => w.userSetText(e.target.value)}
        onKeyDown={(e) => {
          const kh = keyHandler(w);
          if (kh) kh(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter") w.emit("activate");
          if (e.key === "Escape") {
            const f = w.data.get("finish") as ((c: boolean) => void) | undefined;
            if (f) f(true);
          }
        }}
        {...focusHandlers(w)}
        onBlur={() => {
          if (w.hasHandlers("focus-out-event")) w.emit("focus-out-event", { in_: false });
          const f = w.data.get("finish") as ((c: boolean) => void) | undefined;
          if (f) f(false);
        }}
      />
      {icon("EntryIconPositionSecondary")}
    </div>
  );
}

function ButtonContent({ w }: { w: W.Button }) {
  const c = w.child();
  // As in GTK, a child widget with the default horizontal alignment (fill) gets the whole width
  // of the button (so a wrapping label with xalign 0 is left-aligned in a wide button).
  if (c) return <WidgetView w={c} layout={c.halign === "AlignFill" ? { flex: "1 1 auto", minWidth: 0 } : undefined} />;
  const label = w.label ? (w.useUnderline ? stripMnemonic(w.label) : w.label) : null;
  return (
    <>
      {w.image ? <WidgetView w={w.image} /> : null}
      {label ? <span className="gtk-button-label">{label}</span> : null}
    </>
  );
}

function ButtonView({ w, layout }: { w: W.Button; layout?: LayoutStyle }) {
  useActionsVersion();
  const enabled = w.sensitive && (!w.actionName || actionEnabledFor(w, w.actionName));
  const toggle = w instanceof W.ToggleButton;
  const isDefault = w.data.get("response") === -5 || w.data.get("response") === -10;
  const props = baseProps(w, [w.relief === "ReliefStyleNone" ? "flat" : "", toggle && (w as W.ToggleButton).active ? "checked" : "", w.image && !w.label ? "image-button" : "", isDefault ? "suggested-action" : ""].join(" "), layout);
  const el = useRef<HTMLElement | null>(null);
  return (
    <button
      {...props}
      ref={(e) => {
        el.current = e;
        props.ref(e);
      }}
      type="button"
      disabled={!enabled}
      aria-pressed={toggle ? (w as W.ToggleButton).active : undefined}
      onClick={() => w.click()}
      onPointerDown={() => w.emit("pressed")}
      {...buttonEventHandlers(w, () => el.current)}
      onKeyDown={keyHandler(w)}
      {...focusHandlers(w)}
    >
      <ButtonContent w={w} />
    </button>
  );
}

function CheckButtonView({ w, layout }: { w: W.CheckButton; layout?: LayoutStyle }) {
  const props = baseProps(w, "", layout);
  const label = w.label ? (w.useUnderline ? stripMnemonic(w.label) : w.label) : null;
  const id = "chk" + w.objectId;
  return (
    <div {...props}>
      <Checkbox.Root
        id={id}
        className="gtk-check"
        checked={w.inconsistent ? "indeterminate" : w.active}
        disabled={!w.sensitive}
        onCheckedChange={() => w.click()}
      >
        <Checkbox.Indicator className="gtk-check-indicator">{w.inconsistent ? "–" : "✓"}</Checkbox.Indicator>
      </Checkbox.Root>
      {label ? <label htmlFor={id}>{label}</label> : w.child() ? <WidgetView w={w.child()!} /> : null}
    </div>
  );
}

function RadioButtonView({ w, layout }: { w: W.RadioButton; layout?: LayoutStyle }) {
  const props = baseProps(w, "", layout);
  const label = w.label ? (w.useUnderline ? stripMnemonic(w.label) : w.label) : null;
  const id = "rad" + w.objectId;
  return (
    <RadioGroup.Root
      ref={props.ref as any}
      className={props.className}
      style={props.style}
      value={w.active ? "on" : ""}
      onValueChange={() => w.click()}
      disabled={!w.sensitive}
    >
      <RadioGroup.Item id={id} value="on" className="gtk-radio">
        <RadioGroup.Indicator className="gtk-radio-indicator" />
      </RadioGroup.Item>
      {label ? <label htmlFor={id}>{label}</label> : null}
    </RadioGroup.Root>
  );
}

function LinkButtonView({ w, layout }: { w: W.LinkButton; layout?: LayoutStyle }) {
  const props = baseProps(w, "", layout);
  return (
    <a
      {...props}
      href={w.uri}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!w.sensitive) e.preventDefault();
        else w.emit("clicked");
      }}
    >
      {w.image && (w.alwaysShowImage || !w.label) ? <WidgetView w={w.image} /> : null}
      {w.label ? (w.useUnderline ? stripMnemonic(w.label) : w.label) : w.image ? null : w.uri}
    </a>
  );
}

function ImageView({ w, layout }: { w: W.Image; layout?: LayoutStyle }) {
  const size = w.pixelSize > 0 ? w.pixelSize : iconSizePixels(w.iconSize);
  let src: string | null = null;
  let width: number | undefined = size, height: number | undefined = size;
  if (w.pixbuf) {
    src = w.pixbuf.url;
    // An explicit pixel size also applies to pixbufs (as in GTK 4).
    width = w.pixelSize > 0 ? w.pixelSize : w.pixbuf.width > 0 ? w.pixbuf.width : undefined;
    height = w.pixelSize > 0 ? w.pixelSize : w.pixbuf.height > 0 ? w.pixbuf.height : undefined;
  } else if (w.file) {
    src = w.file;
    width = undefined;
    height = undefined;
  } else src = iconUrl(w.iconName, size);
  // GTK draws an image centred in its allocation, so a stretched image is centred instead.
  const centred: LayoutStyle | undefined = layout && (layout.alignSelf === "stretch" || layout.justifySelf === "stretch")
    ? { ...layout, ...(layout.alignSelf === "stretch" ? { alignSelf: "center" } : {}), ...(layout.justifySelf === "stretch" ? { justifySelf: "center" } : {}) }
    : layout;
  const props = baseProps(w, "", { width, height, ...centred });
  const el = useRef<HTMLElement | null>(null);
  if (!src) return <span {...props} />;
  return (
    <img
      {...props}
      ref={(e) => {
        el.current = e;
        props.ref(e);
      }}
      src={src}
      alt=""
      draggable={false}
      width={width}
      height={height}
      {...buttonEventHandlers(w, () => el.current)}
    />
  );
}

function TextViewView({ w, layout }: { w: W.TextView; layout?: LayoutStyle }) {
  const props = baseProps(w, "", { display: "flex", ...layout });
  const el = useRef<HTMLElement | null>(null);
  return (
    <div
      {...props}
      ref={(e) => {
        el.current = e;
        props.ref(e);
      }}
      {...buttonEventHandlers(w, () => el.current)}
    >
      <textarea
        value={w.buffer.text}
        readOnly={!w.editable}
        disabled={!w.sensitive}
        spellCheck
        style={{
          flex: "1 1 auto",
          whiteSpace: w.wrapMode === "WrapModeNone" ? "pre" : "pre-wrap",
          overflowWrap: w.wrapMode === "WrapModeChar" || w.wrapMode === "WrapModeWordChar" ? "anywhere" : undefined,
          paddingLeft: w.leftMargin || undefined,
          paddingRight: w.rightMargin || undefined,
        }}
        onChange={(e) => w.buffer.setTextInternal(e.target.value, true)}
        onKeyDown={keyHandler(w)}
        {...focusHandlers(w)}
      />
    </div>
  );
}

function ScaleView({ w, layout }: { w: W.Scale; layout?: LayoutStyle }) {
  const props = baseProps(w, w.orientation === "OrientationHorizontal" ? "horizontal" : "vertical", layout);
  return (
    <div {...props}>
      <Slider.Root
        className="gtk-slider"
        min={w.min}
        max={w.max}
        step={w.step}
        value={[w.value]}
        orientation={w.orientation === "OrientationHorizontal" ? "horizontal" : "vertical"}
        disabled={!w.sensitive}
        onValueChange={(v) => w.setValue(v[0])}
      >
        <Slider.Track className="gtk-slider-track">
          <Slider.Range className="gtk-slider-range" />
        </Slider.Track>
        <Slider.Thumb className="gtk-slider-thumb" aria-label="Value" />
      </Slider.Root>
      {w.drawValue ? <span className="gtk-scale-value">{w.value.toFixed(w.digits)}</span> : null}
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function CalendarView({ w, layout }: { w: W.Calendar; layout?: LayoutStyle }) {
  const first = new Date(w.year, w.month, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(w.year, w.month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const go = (dm: number) => {
    let m = w.month + dm, y = w.year;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    w.month = m;
    w.year = y;
    w.day = Math.min(w.day, new Date(y, m + 1, 0).getDate());
    w.changed();
    w.emit("month-changed");
  };
  const props = baseProps(w, "", layout);
  return (
    <div {...props} role="grid" aria-label={`${MONTHS[w.month]} ${w.year}`}>
      <div className="gtk-calendar-header">
        <button type="button" className="flat" aria-label="Previous month" onClick={() => go(-1)}>‹</button>
        <span>{MONTHS[w.month]}</span>
        <button type="button" className="flat" aria-label="Next month" onClick={() => go(1)}>›</button>
        <button type="button" className="flat" aria-label="Previous year" onClick={() => go(-12)}>‹</button>
        <span>{w.year}</span>
        <button type="button" className="flat" aria-label="Next year" onClick={() => go(12)}>›</button>
      </div>
      <div className="gtk-calendar-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} className="gtk-calendar-dow">{d}</span>)}
        {cells.map((d, i) => d === null ? <span key={i} /> : (
          <button
            key={i}
            type="button"
            className={"gtk-calendar-day" + (d === w.day ? " selected" : "")}
            onClick={() => {
              w.day = d;
              w.changed();
              w.emit("day-selected");
            }}
            onDoubleClick={() => {
              w.day = d;
              w.changed();
              w.emit("day-selected-double-click");
            }}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

function ComboBoxView({ w, layout }: { w: ComboBox; layout?: LayoutStyle }) {
  const isText = w instanceof ComboBoxText;
  const rows = isText ? [] : w.model?.roots() ?? [];
  const n = isText ? (w as ComboBoxText).items.length : rows.length;
  const item = (i: number): React.ReactNode => {
    if (isText) return <span>{(w as ComboBoxText).items[i]}</span>;
    const node = rows[i];
    if (!node) return null;
    const props = w.itemProps(node);
    let bg: string | undefined, fg: string | undefined;
    const parts = props.map((p, k) => {
      if (p.cellBackground || p.background) bg = p.cellBackground ?? p.background;
      if (p.foreground) fg = p.foreground;
      if (p.kind === "pixbuf") {
        const url = p.pixbuf?.url ?? iconUrl(p.iconName ?? null, 16);
        return url ? <img key={k} src={url} width={16} height={16} alt="" /> : <span key={k} style={{ width: 16 }} />;
      }
      return <span key={k}>{p.markup !== undefined && p.markup !== null ? <MarkupText markup={String(p.markup)} /> : String(p.text ?? "")}</span>;
    });
    return <span className="gtk-combo-item" style={{ background: bg, color: fg }}>{parts}</span>;
  };
  const props = baseProps(w, "", layout);
  return (
    <Select.Root
      // "" (not undefined) for no selection: Radix shows the placeholder and the Select stays
      // controlled when an item is chosen later.
      value={w.active >= 0 ? String(w.active) : ""}
      onValueChange={(v) => w.setActive(parseInt(v, 10), true)}
      disabled={!w.sensitive}
    >
      <Select.Trigger ref={props.ref as any} className={props.className} style={props.style} data-name={props["data-name"]} aria-label="Select">
        <Select.Value placeholder=" ">{w.active >= 0 ? item(w.active) : null}</Select.Value>
        <Select.Icon className="gtk-combo-arrow">
          <img src={iconUrl("pan-down-symbolic", 16) ?? undefined} width={16} height={16} alt="" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="gtk-combo-popup" position="popper" sideOffset={2}>
          <Select.ScrollUpButton className="gtk-combo-scroll">▲</Select.ScrollUpButton>
          <Select.Viewport>
            {Array.from({ length: n }, (_, i) => (
              <Select.Item key={i} value={String(i)} className="gtk-combo-option">
                <Select.ItemText>{item(i)}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="gtk-combo-scroll">▼</Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export { useCallback, useLayoutEffect };
