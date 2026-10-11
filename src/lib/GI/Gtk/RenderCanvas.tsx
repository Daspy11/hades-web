/**
 * React rendering of `GtkDrawingArea`: a `<canvas>` that emits the GTK "draw" signal with a
 * Cairo context and translates DOM input into GDK events.
 *
 * The widget's element is a `<div>` with the widget's size; the `<canvas>` inside it covers only
 * the part of the widget that is visible in the nearest scrolling ancestor (it is
 * `position: sticky`, and the Cairo context is translated by its offset). So a large drawing area
 * in a scrolled window (a zoomed-in diagram) costs no more than the visible area, as with GTK's
 * clipped exposes. Event coordinates are relative to the whole widget, as in GTK.
 */
import React, { useEffect, useRef } from "react";
import { baseProps, useWidget, type LayoutStyle } from "./Render";
import type { DrawingArea } from "./Widgets";
import { Context } from "../Cairo";
import { eventKeyFromDom, modifiersOf, onImagesLoaded, type EventButton, type EventScroll } from "../Gdk";
import { handleAccelerator } from "./RenderRoot";

/** The nearest ancestor that scrolls, if any. */
function scrollingAncestor(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowX) || /(auto|scroll)/.test(s.overflowY)) return p;
  }
  return null;
}

export function DrawingAreaView({ w, layout }: { w: DrawingArea; layout?: LayoutStyle }) {
  useWidget(w);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const frame = useRef<number | null>(null);

  const draw = () => {
    frame.current = null;
    const c = canvasRef.current;
    const o = outerRef.current;
    if (!c || !o || w.destroyed) return;
    // Size the canvas to the visible part of the widget.
    const sc = scrollerRef.current;
    const cssW = sc ? Math.min(o.clientWidth, sc.clientWidth) : o.clientWidth;
    const cssH = sc ? Math.min(o.clientHeight, sc.clientHeight) : o.clientHeight;
    if (c.style.width !== `${cssW}px`) c.style.width = `${cssW}px`;
    if (c.style.height !== `${cssH}px`) {
      c.style.height = `${cssH}px`;
      c.style.marginBottom = `${-cssH}px`; // The canvas does not add to the widget's height.
    }
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    // Offset of the visible part within the widget.
    const or = o.getBoundingClientRect(), cr0 = c.getBoundingClientRect();
    const offX = cr0.left - or.left, offY = cr0.top - or.top;
    const cr = new Context(ctx as any, { a: dpr, b: 0, c: 0, d: dpr, e: -offX * dpr, f: -offY * dpr });
    try {
      w.emit("draw", cr);
    } catch (err) {
      console.error("draw handler failed", err);
    }
  };
  const schedule = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    const id = w.connect("queue-draw", schedule);
    const stopImages = onImagesLoaded(schedule);
    const o = outerRef.current;
    let ro: ResizeObserver | null = null;
    const sc = o ? scrollingAncestor(o) : null;
    scrollerRef.current = sc;
    if (o) {
      ro = new ResizeObserver(() => {
        w.emit("size-allocate", { x: 0, y: 0, width: o.clientWidth, height: o.clientHeight });
        schedule();
      });
      ro.observe(o);
      if (sc) ro.observe(sc);
    }
    sc?.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      w.disconnect(id);
      stopImages();
      ro?.disconnect();
      sc?.removeEventListener("scroll", schedule);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [w]);
  // Re-render requests (version changes) also redraw.
  useEffect(() => schedule());

  const toButton = (e: MouseEvent | React.MouseEvent, type: EventButton["type"]): EventButton => {
    const r = outerRef.current!.getBoundingClientRect();
    return {
      type,
      button: e.button === 0 ? 1 : e.button === 1 ? 2 : 3,
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      xRoot: e.clientX,
      yRoot: e.clientY,
      state: modifiersOf(e),
      time: e.timeStamp,
      dom: (e as React.MouseEvent).nativeEvent ?? (e as MouseEvent),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!w.sensitive) return;
    if (w.canFocus || w.focusOnClick) canvasRef.current?.focus({ preventScroll: true });
    e.preventDefault();
    w.emit("button-press-event", toButton(e, "EventTypeButtonPress"));
    if (e.detail === 2) w.emit("button-press-event", toButton(e, "EventType2buttonPress"));
    // Implicit grab: follow the pointer until the button is released.
    const move = (ev: MouseEvent) => {
      const r = outerRef.current?.getBoundingClientRect();
      if (!r) return;
      w.emit("motion-notify-event", { x: ev.clientX - r.left, y: ev.clientY - r.top, state: modifiersOf(ev), time: ev.timeStamp });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
      if (outerRef.current) w.emit("button-release-event", toButton(ev, "EventTypeButtonRelease"));
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (e.buttons !== 0) return; // handled by the grab
    const r = outerRef.current!.getBoundingClientRect();
    w.emit("motion-notify-event", { x: e.clientX - r.left, y: e.clientY - r.top, state: modifiersOf(e), time: e.timeStamp });
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const r = (outerRef.current ?? c).getBoundingClientRect();
      const scale = e.deltaMode === 1 ? 1 / 3 : e.deltaMode === 2 ? 1 : 1 / 100;
      const ev: EventScroll = {
        direction: "ScrollDirectionSmooth",
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        deltaX: e.deltaX * scale,
        deltaY: e.deltaY * scale,
        state: modifiersOf(e),
        time: e.timeStamp,
      };
      if (w.emit("scroll-event", ev) === true) e.preventDefault();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [w]);

  const props = baseProps(w, "", { display: "block", ...layout });
  return (
    <div
      {...props}
      ref={(e: HTMLDivElement | null) => {
        outerRef.current = e;
        props.ref(e);
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "sticky", left: 0, top: 0, display: "block", width: 0, height: 0, cursor: w.cursor, outline: "none", touchAction: "none" }}
        tabIndex={w.canFocus ? 0 : -1}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          // GTK windows activate accelerators before the focus widget sees the key.
          handleAccelerator(e.nativeEvent);
          if (e.nativeEvent.defaultPrevented) return;
          if (w.emit("key-press-event", eventKeyFromDom(e.nativeEvent)) === true) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onKeyUp={(e) => {
          w.emit("key-release-event", eventKeyFromDom(e.nativeEvent));
        }}
        onFocus={() => w.emit("focus-in-event", { in_: true })}
        onBlur={() => w.emit("focus-out-event", { in_: false })}
      />
    </div>
  );
}
