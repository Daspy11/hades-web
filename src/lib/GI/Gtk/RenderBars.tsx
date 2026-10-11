/**
 * React rendering of toolbars, menu bars and popup menus, using Radix Toolbar, Menubar and
 * DropdownMenu primitives.
 */
import React, { useEffect, useState } from "react";
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
    return (
      <span className="gtk-menutoolbutton" title={it.tooltip ?? undefined}>
        <RToolbar.Button className="gtk-toolbutton" disabled={!itemEnabled(it)} onClick={() => it.click()} aria-label={it.label ? stripMnemonic(it.label) : undefined} title={it.tooltip ? undefined : it.label ? stripMnemonic(it.label) : undefined} data-style={styleOf(it)}>
          <ToolButtonInner t={it} size={24} />
        </RToolbar.Button>
        <Dropdown.Root modal={false}>
          <Dropdown.Trigger asChild>
            <RToolbar.Button className="gtk-toolbutton gtk-menutoolbutton-arrow" disabled={!menu || menu.children.length === 0} aria-label={it.arrowTooltip ?? "More"}>
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

export function ToolbarView({ w, layout }: { w: W.Toolbar; layout?: LayoutStyle }) {
  useWidget(w);
  const props = baseProps(w, "", layout);
  return (
    <RToolbar.Root
      ref={props.ref as any}
      className={props.className}
      style={props.style}
      orientation={w.orientation === "OrientationVertical" ? "vertical" : "horizontal"}
      loop
    >
      {w.children.map((c) => <ToolItemView key={c.objectId} it={c} />)}
    </RToolbar.Root>
  );
}

export { MenuItemsView };
export type { React };
