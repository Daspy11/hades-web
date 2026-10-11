/**
 * Scratch check: load the application window from editor-ui.glade with the toolkit Builder.
 */
import * as Gtk from "@/lib/GI/Gtk";
import ui from "@/hades/share/editor-ui.glade?raw";

export function main(): void {
  Gtk.registerBuilderText("/editor-ui.glade", ui);
  const b = Gtk.builderNewFromFile("/editor-ui.glade");
  const win = Gtk.builderGetObject(b, "app-window") as Gtk.Window;
  Gtk.setMainWindow(win);
  const bx = Gtk.builderGetObject(b, "main-box") as Gtk.Box;
  const area = Gtk.labelNew("(diagram area)");
  Gtk.widgetSetVexpand(area, true);
  Gtk.boxPackStart(bx, area, true, true, 0);
  Gtk.widgetShowAll(win);
  Gtk.windowPresent(win);
  Gtk.main();
}
