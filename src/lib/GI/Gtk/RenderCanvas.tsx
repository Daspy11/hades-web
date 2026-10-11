/**
 * React rendering of `GtkDrawingArea`: a `<canvas>` that emits the GTK "draw" signal with a
 * Cairo context and translates DOM input into GDK events.
 */
import React, { useEffect, useRef } from "react";
import { baseProps, useWidget, type LayoutStyle } from "./Render";
import type { DrawingArea } from "./Widgets";
import { Context } from "../Cairo";
import { eventKeyFromDom, modifiersOf, onImagesLoaded, type EventButton, type EventScroll } from "../Gdk";

export function DrawingAreaView({ w, layout }: { w: DrawingArea; layout?: LayoutStyle }) {
  useWidget(w);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef<number | null>(null);

  const draw = () => {
    frame.current = null;
    const c = canvasRef.current;
    if (!c || w.destroyed) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth, cssH = c.clientHeight;
    const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    const cr = new Context(ctx as any, { a: dpr, b: 0, c: 0, d: dpr, e: 0, f: 0 });
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
    const c = canvasRef.current;
    let ro: ResizeObserver | null = null;
    if (c) {
      ro = new ResizeObserver(() => {
        w.emit("size-allocate", { x: 0, y: 0, width: c.clientWidth, height: c.clientHeight });
        schedule();
      });
      ro.observe(c);
    }
    schedule();
    return () => {
      w.disconnect(id);
      stopImages();
      ro?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [w]);
  // Re-render requests (version changes) also redraw.
  useEffect(() => schedule());

  const toButton = (e: MouseEvent | React.MouseEvent, type: EventButton["type"]): EventButton => {
    const r = canvasRef.current!.getBoundingClientRect();
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
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return;
      w.emit("motion-notify-event", { x: ev.clientX - r.left, y: ev.clientY - r.top, state: modifiersOf(ev), time: ev.timeStamp });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
      if (canvasRef.current) w.emit("button-release-event", toButton(ev, "EventTypeButtonRelease"));
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (e.buttons !== 0) return; // handled by the grab
    const r = canvasRef.current!.getBoundingClientRect();
    w.emit("motion-notify-event", { x: e.clientX - r.left, y: e.clientY - r.top, state: modifiersOf(e), time: e.timeStamp });
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const r = c.getBoundingClientRect();
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
    <canvas
      {...(props as any)}
      ref={(e: HTMLCanvasElement | null) => {
        canvasRef.current = e;
        props.ref(e);
      }}
      style={{ ...props.style, cursor: w.cursor, outline: "none", touchAction: "none" }}
      tabIndex={w.canFocus ? 0 : -1}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
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
  );
}
