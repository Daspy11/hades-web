/**
 * Haskell `Data.Colour`, `Data.Colour.SRGB`, `Data.Colour.CIE` and `Data.Colour.Names`.
 *
 * As in the Haskell library, colours are stored as linear-light RGB triples. The `Semigroup`
 * instance adds colours (light mixing) and `mempty` is black.
 */
import { EqSym } from "./Ord";
import { Just, Nothing, type Maybe } from "./Maybe";

export class Colour {
  constructor(readonly r: number, readonly g: number, readonly b: number) {}
  [EqSym](o: unknown): boolean {
    return o instanceof Colour && o.r === this.r && o.g === this.g && o.b === this.b;
  }
  toString(): string {
    return sRGB24show(this);
  }
}

export interface RGB {
  readonly channelRed: number;
  readonly channelGreen: number;
  readonly channelBlue: number;
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function fromLinear(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** `sRGB r g b` with channels in [0, 1] in the non-linear sRGB space. */
export function sRGB(r: number, g: number, b: number): Colour {
  return new Colour(toLinear(r), toLinear(g), toLinear(b));
}
/** `sRGB24 r g b` with 8-bit channels. */
export function sRGB24(r: number, g: number, b: number): Colour {
  return sRGB(r / 255, g / 255, b / 255);
}
/** `rgb` in linear space (Data.Colour.RGBSpace / Linear). */
export function rgbLinear(r: number, g: number, b: number): Colour {
  return new Colour(r, g, b);
}

export function toSRGB(c: Colour): RGB {
  return { channelRed: fromLinear(c.r), channelGreen: fromLinear(c.g), channelBlue: fromLinear(c.b) };
}

function to8(v: number): number {
  // Haskell rounds with `round` on the clamped value (banker's rounding is irrelevant here).
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function toSRGB24(c: Colour): { channelRed: number; channelGreen: number; channelBlue: number } {
  const s = toSRGB(c);
  return { channelRed: to8(s.channelRed), channelGreen: to8(s.channelGreen), channelBlue: to8(s.channelBlue) };
}

/** `sRGB24show`: `#rrggbb` */
export function sRGB24show(c: Colour): string {
  const s = toSRGB24(c);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return "#" + h(s.channelRed) + h(s.channelGreen) + h(s.channelBlue);
}

/** `sRGB24reads`: parses `#rrggbb` or `rrggbb` (the whole string must match). */
export function sRGB24read(str: string): Maybe<Colour> {
  const m = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(str);
  if (!m) return Nothing;
  return Just(sRGB24(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)));
}

/** CSS colour string for drawing. */
export function toCss(c: Colour, alpha = 1): string {
  const s = toSRGB(c);
  const f = (v: number) => Math.max(0, Math.min(255, v * 255)).toFixed(1);
  return alpha >= 1
    ? `rgb(${f(s.channelRed)}, ${f(s.channelGreen)}, ${f(s.channelBlue)})`
    : `rgba(${f(s.channelRed)}, ${f(s.channelGreen)}, ${f(s.channelBlue)}, ${alpha})`;
}

/** CIE luminance (Y) of the colour. */
export function luminance(c: Colour): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** `blend w c1 c2` = w*c1 + (1-w)*c2 */
export function blend(w: number, c1: Colour, c2: Colour): Colour {
  return new Colour(w * c1.r + (1 - w) * c2.r, w * c1.g + (1 - w) * c2.g, w * c1.b + (1 - w) * c2.b);
}
export function darken(s: number, c: Colour): Colour {
  return new Colour(s * c.r, s * c.g, s * c.b);
}
export function append(a: Colour, b: Colour): Colour {
  return new Colour(a.r + b.r, a.g + b.g, a.b + b.b);
}
export const mempty: Colour = new Colour(0, 0, 0);

// AlphaColour (minimal).
export class AlphaColour {
  constructor(readonly colour: Colour, readonly alpha: number) {}
  [EqSym](o: unknown): boolean {
    return o instanceof AlphaColour && o.alpha === this.alpha && (this.alpha === 0 || this.colour[EqSym](o.colour));
  }
}
export function opaque(c: Colour): AlphaColour {
  return new AlphaColour(c, 1);
}
export function withOpacity(c: Colour, a: number): AlphaColour {
  return new AlphaColour(c, a);
}
export const transparent = new AlphaColour(mempty, 0);
export function alphaChannel(a: AlphaColour): number {
  return a.alpha;
}
/** `over top bottom` for alpha colours over an opaque colour. */
export function overColour(top: AlphaColour, bottom: Colour): Colour {
  return blend(top.alpha, top.colour, bottom);
}

// Data.Colour.Names (SVG colour names).
const svgNames: Record<string, string> = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4",
  azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000",
  blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a",
  burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e",
  coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00",
  darkorchid: "#9932cc", darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b", darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1", darkviolet: "#9400d3", deeppink: "#ff1493", deepskyblue: "#00bfff",
  dimgray: "#696969", dimgrey: "#696969", dodgerblue: "#1e90ff", firebrick: "#b22222",
  floralwhite: "#fffaf0", forestgreen: "#228b22", fuchsia: "#ff00ff", gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff", gold: "#ffd700", goldenrod: "#daa520", gray: "#808080",
  grey: "#808080", green: "#008000", greenyellow: "#adff2f", honeydew: "#f0fff0",
  hotpink: "#ff69b4", indianred: "#cd5c5c", indigo: "#4b0082", ivory: "#fffff0",
  khaki: "#f0e68c", lavender: "#e6e6fa", lavenderblush: "#fff0f5", lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd", lightblue: "#add8e6", lightcoral: "#f08080", lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3", lightgreen: "#90ee90",
  lightgrey: "#d3d3d3", lightpink: "#ffb6c1", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32",
  linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db",
  mediumseagreen: "#3cb371", mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc", mediumvioletred: "#c71585", midnightblue: "#191970",
  mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5", navajowhite: "#ffdead",
  navy: "#000080", oldlace: "#fdf5e6", olive: "#808000", olivedrab: "#6b8e23",
  orange: "#ffa500", orangered: "#ff4500", orchid: "#da70d6", palegoldenrod: "#eee8aa",
  palegreen: "#98fb98", paleturquoise: "#afeeee", palevioletred: "#db7093",
  papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb",
  plum: "#dda0dd", powderblue: "#b0e0e6", purple: "#800080", red: "#ff0000",
  rosybrown: "#bc8f8f", royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072",
  sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d",
  silver: "#c0c0c0", skyblue: "#87ceeb", slateblue: "#6a5acd", slategray: "#708090",
  slategrey: "#708090", snow: "#fffafa", springgreen: "#00ff7f", steelblue: "#4682b4",
  tan: "#d2b48c", teal: "#008080", thistle: "#d8bfd8", tomato: "#ff6347",
  turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3", white: "#ffffff",
  whitesmoke: "#f5f5f5", yellow: "#ffff00", yellowgreen: "#9acd32",
};

export function readColourName(name: string): Maybe<Colour> {
  const h = svgNames[name.toLowerCase()];
  return h ? sRGB24read(h) : Nothing;
}

function named(n: string): Colour {
  const r = sRGB24read(svgNames[n]);
  if (r.tag === "Nothing") throw new Error(n);
  return r.value;
}

export const black = named("black");
export const white = named("white");
export const red = named("red");
export const green = named("green");
export const blue = named("blue");
export const yellow = named("yellow");
export const gray = named("gray");
export const grey = gray;
export const lightgray = named("lightgray");
export const darkgray = named("darkgray");
export const orange = named("orange");
export const purple = named("purple");
export const cyan = named("cyan");
export const magenta = named("magenta");
export const pink = named("pink");
export const brown = named("brown");
export const navy = named("navy");
export const lightblue = named("lightblue");
export const lightyellow = named("lightyellow");
export const lightgreen = named("lightgreen");
export const silver = named("silver");
