/**
 * React rendering of toolbars, menu bars and popup menus, using Radix Toolbar, Menubar and
 * DropdownMenu primitives.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as RToolbar from "@radix-ui/react-toolbar";
import * as Menubar from "@radix-ui/react-menubar";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { baseProps, useWidget, WidgetView, type LayoutStyle } from "./Render";
import * as W from "./Widgets";
import { stripMnemonic, type Widget } from "./Core";
import { iconUrl } from "./IconTheme";
import { onAnyActionEnabledChanged } from "../Gio";

function useActionsVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => onAnyActionEnabledChanged(() => setV((x) => x + 1)), []);
  return v;
}

function itemEnabled(item: W.MenuItem | W.ToolButton): boolean {
  return item.sensitive && (!item.actionName || W.actionEnabledFor(item, item.actionName));
}

/** Accelerator labels for well-known actions, shown in menus as in GTK. */
const accelHints: Record<string, string> = {
  "win.new": "Ctrl+N", "win.open": "Ctrl+O", "win.save": "Ctrl+S", "win.saveAs": "Shift+Ctrl+S",
  "win.quit": "Ctrl+Q", "win.undo": "Ctrl+Z", "win.redo": "Shift+Ctrl+Z", "win.find": "Ctrl+F",
};

// ---------------------------------------------------------------------------------------------
// Menu items, generic over the Radix menu family

type Family = typeof Menubar | typeof Dropdown;

function MenuItemsView({ menu, F, close }: { menu: W.MenuShell; F: Family; close?: () => void }) {
  useWidget(menu);
  useActionsVersion();
  const items = menu.children.filter((c) => c.visible && !c.destroyed);
  return (
    <>
      {items.map((it) => <MenuEntry key={it.objectId} item={it} F={F} close={close} />)}
    </>
  );
}

function MenuEntry({ item, F, close }: { item: Widget; F: Family; close?: () => void }) {
  useWidget(item);
  if (item instanceof W.SeparatorMenuItem) return <F.Separator className="gtk-menu-separator" />;
  if (!(item instanceof W.MenuItem)) return null;
  const label = item.useUnderline ? stripMnemonic(item.label) : item.label;
  const icon = item.iconName ? iconUrl(item.iconName, 16) : null;
  const content = (
    <>
      <span className="gtk-menu-icon">{icon ? <img src={icon} width={16} height={16} alt="" /> : null}</span>
      <span className="gtk-menu-label">{label}</span>
      {item.actionName && accelHints[item.actionName] ? <span className="gtk-menu-accel">{accelHints[item.actionName]}</span> : null}
    </>
  );
  if (item.submenu) {
    return (
      <F.Sub>
        <F.SubTrigger className="gtk-menu-item" disabled={!item.sensitive}>
          {content}
          <span className="gtk-menu-arrow">›</span>
        </F.SubTrigger>
        <F.Portal>
          <F.SubContent className="gtk-menu" sideOffset={-2} alignOffset={-4}>
            <MenuItemsView menu={item.submenu} F={F} close={close} />
          </F.SubContent>
        </F.Portal>
      </F.Sub>
    );
  }
  if (item instanceof W.CheckMenuItem) {
    return (
      <F.CheckboxItem
        className="gtk-menu-item"
        checked={item.active}
        disabled={!itemEnabled(item)}
        onSelect={() => {
          item.activate();
          close?.();
        }}
      >
        <span className="gtk-menu-icon">{item.active ? "✓" : ""}</span>
        <span className="gtk-menu-label">{label}</span>
      </F.CheckboxItem>
    );
  }
  return (
    <F.Item
      className="gtk-menu-item"
      disabled={!itemEnabled(item)}
      title={item.tooltip ?? undefined}
      onSelect={() => {
        // Run after the menu has closed so focus returns to the page first.
        setTimeout(() => item.activate(), 0);
        close?.();
      }}
    >
      {content}
    </F.Item>
  );
}

// ---------------------------------------------------------------------------------------------
// Menu bar

export function MenuBarView({ w, layout }: { w: W.MenuBar; layout?: LayoutStyle }) {
  useActionsVersion();
  const props = baseProps(w, "", layout);
  const tops = w.children.filter((c): c is W.MenuItem => c instanceof W.MenuItem && c.visible);
  return (
    <Menubar.Root ref={props.ref as any} className={props.className} style={props.style}>
      {tops.map((m) => (
        <Menubar.Menu key={m.objectId}>
          <Menubar.Trigger className="gtk-menubar-item" title={m.tooltip ?? undefined}>
            {m.useUnderline ? stripMnemonic(m.label) : m.label}
          </Menubar.Trigger>
          {m.submenu ? (
            <Menubar.Portal>
              <Menubar.Content className="gtk-menu" align="start" sideOffset={0}>
                <MenuItemsView menu={m.submenu} F={Menubar} />
              </Menubar.Content>
            </Menubar.Portal>
          ) : null}
        </Menubar.Menu>
      ))}
    </Menubar.Root>
  );
}

// ---------------------------------------------------------------------------------------------
// Popup menus (GtkMenu shown with menuPopupAtPointer)

export function PopupMenuView({ m }: { m: W.Menu }) {
  useWidget(m);
  if (!m.open || !m.at) return null;
  const close = () => W.menuPopdown(m);
  return (
    <Dropdown.Root open modal onOpenChange={(o) => { if (!o) close(); }}>
      <Dropdown.Trigger asChild>
        <span style={{ position: "fixed", left: m.at.x, top: m.at.y, width: 0, height: 0 }} aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="gtk-menu" align="start" side="bottom" sideOffset={0} collisionPadding={4}>
          <MenuItemsView menu={m} F={Dropdown} close={close} />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

// ---------------------------------------------------------------------------------------------
// Toolbar

/** The toolbar style in effect for a tool item (its parent toolbar's). */
function styleOf(t: Widget): W.ToolbarStyle {
  const p = t.parent;
  return p instanceof W.Toolbar ? p.toolbarStyle : "ToolbarStyleBothHoriz";
}

function ToolButtonInner({ t, size }: { t: W.ToolButton; size: number }) {
  const style = styleOf(t);
  const icon = t.iconWidget ? null : iconUrl(t.iconName, size);
  const hasIcon = !!t.iconWidget || !!icon;
  const label = t.label ? (t.useUnderline ? stripMnemonic(t.label) : t.label) : "";
  // GTK shows labels according to the toolbar style; a button without an icon always shows its label.
  const showIcon = style !== "ToolbarStyleText" || !label;
  const showLabel =
    !!label && (!hasIcon || style === "ToolbarStyleText" || style === "ToolbarStyleBoth" || (style === "ToolbarStyleBothHoriz" && t.isImportant));
  return (
    <>
      {showIcon ? (t.iconWidget ? <WidgetView w={t.iconWidget} /> : icon ? <img src={icon} width={size} height={size} alt="" draggable={false} /> : null) : null}
      {showLabel ? <span className="gtk-toolbutton-label">{label}</span> : null}
    </>
  );
}

function ToolItemView({ it }: { it: Widget }) {
  useWidget(it);
  useActionsVersion();
  if (!it.visible) return null;
  if (it instanceof W.SeparatorToolItem) {
    // `draw: false` is an invisible spacer; with `expand` it fills the free space.
    if (!it.draw) return <span className="gtk-toolbar-spacer" aria-hidden style={{ flex: it.expand ? "1 1 auto" : "0 0 12px" }} />;
    return <RToolbar.Separator className="gtk-toolbar-separator" style={it.expand ? { flex: "1 1 auto" } : undefined} />;
  }
  if (it instanceof W.MenuToolButton) {
    const menu = it.menu;
    // The Radix trigger opens on pointer down unless it is disabled itself (a disabled child
    // button still receives pointer events), so the trigger gets the arrow's state too.
    const arrowDisabled = !itemEnabled(it) || !menu || menu.children.length === 0;
    return (
      <span className="gtk-menutoolbutton" title={it.tooltip ?? undefined}>
        <RToolbar.Button className="gtk-toolbutton" disabled={!itemEnabled(it)} onClick={() => it.click()} aria-label={it.label ? stripMnemonic(it.label) : undefined} title={it.tooltip ? undefined : it.label ? stripMnemonic(it.label) : undefined} data-style={styleOf(it)}>
          <ToolButtonInner t={it} size={24} />
        </RToolbar.Button>
        <Dropdown.Root modal={false}>
          <Dropdown.Trigger asChild disabled={arrowDisabled}>
            <RToolbar.Button className="gtk-toolbutton gtk-menutoolbutton-arrow" disabled={arrowDisabled} aria-label={it.arrowTooltip ?? "More"}>
              <img src={iconUrl("pan-down-symbolic", 16) ?? undefined} width={12} height={12} alt="" />
            </RToolbar.Button>
          </Dropdown.Trigger>
          {menu ? (
            <Dropdown.Portal>
              <Dropdown.Content className="gtk-menu" align="start" sideOffset={2}>
                <MenuItemsView menu={menu} F={Dropdown} />
              </Dropdown.Content>
            </Dropdown.Portal>
          ) : null}
        </Dropdown.Root>
      </span>
    );
  }
  if (it instanceof W.ToolButton) {
    return (
      <RToolbar.Button
        className="gtk-toolbutton"
        disabled={!itemEnabled(it)}
        title={it.tooltip ?? (it.label ? stripMnemonic(it.label) : undefined)}
        aria-label={it.label ? stripMnemonic(it.label) : it.tooltip ?? undefined}
        data-style={styleOf(it)}
        onClick={() => it.click()}
      >
        <ToolButtonInner t={it} size={24} />
      </RToolbar.Button>
    );
  }
  if (it instanceof W.ToolItem) {
    const c = it.child();
    return <span className="gtk-toolitem" style={it.expand ? { flex: "1 1 auto" } : undefined}>{c ? <WidgetView w={c} /> : null}</span>;
  }
  return <WidgetView w={it} />;
}

/** Width of the overflow arrow button (`.gtk-toolbar-arrow`), including its margins. */
const toolbarArrowWidth = 30;

/**
 * The natural width of a rendered tool item, including margins. An expanding item (a spacer or
 * a separator with `expand`) only needs its minimum width, as in GTK.
 */
function toolItemWidth(it: Widget, el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const margins = (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
  if (it instanceof W.ToolItem && it.expand) return margins;
  return el.getBoundingClientRect().width + margins;
}

/**
 * GTK's menu proxy for a tool item in the overflow menu: a tool button becomes a menu item with
 * its label, a menu tool button also gets its menu as a submenu, a drawn separator becomes a
 * separator, and anything else (an invisible spacer, a custom tool item) is left out.
 */
function ToolItemProxy({ it }: { it: Widget }) {
  useWidget(it);
  if (it instanceof W.SeparatorToolItem) return it.draw ? <Dropdown.Separator className="gtk-menu-separator" /> : null;
  if (!(it instanceof W.ToolButton)) return null;
  const label = it.label ? (it.useUnderline ? stripMnemonic(it.label) : it.label) : it.tooltip ?? "";
  const content = (
    <>
      <span className="gtk-menu-icon" />
      <span className="gtk-menu-label">{label}</span>
    </>
  );
  if (it instanceof W.MenuToolButton && it.menu) {
    return (
      <Dropdown.Sub>
        <Dropdown.SubTrigger className="gtk-menu-item" disabled={!itemEnabled(it)}>
          {content}
          <span className="gtk-menu-arrow">›</span>
        </Dropdown.SubTrigger>
        <Dropdown.Portal>
          <Dropdown.SubContent className="gtk-menu" sideOffset={-2}>
            <MenuItemsView menu={it.menu} F={Dropdown} />
          </Dropdown.SubContent>
        </Dropdown.Portal>
      </Dropdown.Sub>
    );
  }
  return (
    <Dropdown.Item className="gtk-menu-item" disabled={!itemEnabled(it)} onSelect={() => it.click()}>
      {content}
    </Dropdown.Item>
  );
}

export function ToolbarView({ w, layout }: { w: W.Toolbar; layout?: LayoutStyle }) {
  useWidget(w);
  useActionsVersion();
  const props = baseProps(w, "", layout);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    rootRef.current = el;
    props.ref(el);
  };
  const horizontal = w.orientation !== "OrientationVertical";
  const items = w.children.filter((c) => c.visible && !c.destroyed);
  // GTK `show-arrow`: the number of leading items that fit; the rest go into the overflow menu.
  const [nShown, setNShown] = useState(Number.POSITIVE_INFINITY);
  const widths = useRef(new Map<number, number>());
  const itemKey = items.map((c) => c.objectId).join(",");
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !horizontal || !w.showArrow) {
      if (nShown !== Number.POSITIVE_INFINITY) setNShown(Number.POSITIVE_INFINITY);
      return;
    }
    const fit = () => {
      // Measure the items that are rendered (the first ones, in order, before the arrow).
      const els = Array.from(root.children).filter((el) => !(el as HTMLElement).classList.contains("gtk-toolbar-arrow")) as HTMLElement[];
      const shown = Math.min(items.length, els.length);
      for (let i = 0; i < shown; i++) widths.current.set(items[i].objectId, toolItemWidth(items[i], els[i]));
      const cs = getComputedStyle(root);
      const avail = root.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const ws = items.map((c) => widths.current.get(c.objectId) ?? 34);
      const total = ws.reduce((a, b) => a + b, 0);
      let n = items.length;
      if (total > avail + 0.5) {
        n = 0;
        let acc = toolbarArrowWidth;
        while (n < items.length && acc + ws[n] <= avail + 0.5) acc += ws[n++];
      }
      setNShown((old) => (old === n || (old >= items.length && n >= items.length) ? old : n));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);
    return () => ro.disconnect();
  });
  const shownItems = nShown >= items.length ? items : items.slice(0, nShown);
  const overflow = nShown >= items.length ? [] : items.slice(nShown);
  return (
    <RToolbar.Root
      ref={setRef}
      className={props.className}
      style={props.style}
      orientation={horizontal ? "horizontal" : "vertical"}
      loop
      data-items={itemKey}
    >
      {shownItems.map((c) => <ToolItemView key={c.objectId} it={c} />)}
      {overflow.length > 0 ? (
        <Dropdown.Root modal={false}>
          <Dropdown.Trigger asChild>
            <RToolbar.Button className="gtk-toolbutton gtk-toolbar-arrow" aria-label="More tools">
              <img src={iconUrl("pan-down-symbolic", 16) ?? undefined} width={16} height={16} alt="" />
            </RToolbar.Button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content className="gtk-menu" align="end" sideOffset={2}>
              {overflow.map((c) => <ToolItemProxy key={c.objectId} it={c} />)}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      ) : null}
    </RToolbar.Root>
  );
}

export { MenuItemsView };
export type { React };
