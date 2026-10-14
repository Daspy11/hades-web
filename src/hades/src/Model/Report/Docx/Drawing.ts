// Ported from hades/src/Model/Report/Docx/Drawing.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * DrawingML combinators.
 *
 * TypeScript port
 * ---------------
 * * `EMU` (Haskell `Integer`) is a `number`; the unit conversions round with the Haskell
 *   (banker's) `round`.
 * * `inlinePicture` runs in the `DocMonad`: it takes the `StateCell<DocState>` first
 *   (`inlinePicture(st, [w, h], ref, title)`), as do the other `DocMonad` functions.
 */
import * as T from "@/lib/Data/Text";
import { round } from "@/lib/Prelude";
import * as X from "@/lib/Text/XML/Light";
import type { ImageRef } from "@/hades/src/Model/Report/Base";
import {
  getMediaRef, nameSpace, newId, qNode, qual, wName, wText,
  type DocMonad,
} from "@/hades/src/Model/Report/Docx/Document";

type Text = T.Text;


/**
 * EMU = English Metric Unit. Unit of length designed to divide both centimeters and inches into
 * a whole number of units. See ECMA-376 Part 1 Section 20.1.2.
 */
export type EMU = number;


/** Measurement in centimters converted into EMUs */
export function centimeters(x: number): EMU {
  return round(x * 360000);
}


/** Measurement in US inches converted into EMUs. */
export function inches(x: number): EMU {
  return round(x * 914400);
}


/** Measurement in Points converted into EMUs */
export function points(x: number): EMU {
  return round(x * 12700); // 914400 / 72
}


/** Haskell `show` of an `Integer` (no exponent notation for big values). */
function showInteger(n: EMU): string {
  return Number.isFinite(n) && !Number.isSafeInteger(n) ? BigInt(n).toString() : String(n);
}


/** Qualified name for a Drawing XML node. */
export function wpName(n: Text): X.QName {
  return qual("wp", T.unpack(n));
}


/** Qualified name for a Drawing XML node in \"@p:@\". */
export function pName(n: Text): X.QName {
  return qual("pic", T.unpack(n));
}


/** Qualified name for a Drawing XML node in \"@a:@\". */
export function aName(n: Text): X.QName {
  return qual("a", T.unpack(n));
}


/** Attribute with qualified name for Drawing XML */
export function wpAttr(nm: Text, v: Text): X.Attr {
  return X.Attr(wpName(nm), T.unpack(v));
}


/**
 * Wrap the picture with @<w:drawing>@ and @<wp:inline>@.
 *
 * @param size Width and height of the drawing in points.
 * @param ref Image to include.
 * @param title Image name.
 */
export function inlinePicture(st: DocMonad, size: readonly [number, number], ref: ImageRef, title: Text): X.Element {
  const [w, h] = size;
  const mkPicture = (picId1: string): X.Element => {
    const b = blipFill(st, ref);
    const nv = nonVisualProperties(picId1, title, true);
    const sp = shapeProperties(0, 0, w, h);
    return X.node(pName("pic"), [[nameSpace("pic", picUri)], [nv, b, sp]]);
  };
  const picId = T.unpack(newId(st));
  const picture = mkPicture(picId);
  return X.node(wName("drawing"), X.node(wpName("inline"), [
    [
      X.Attr(X.unqual("distT"), "0"),
      X.Attr(X.unqual("distB"), "0"),
      X.Attr(X.unqual("distL"), "0"),
      X.Attr(X.unqual("distR"), "0"),
    ], [
      X.node(wpName("extent"), [
        X.Attr(X.unqual("cx"), showInteger(points(w))),
        X.Attr(X.unqual("cy"), showInteger(points(h)))]),
      X.node(wpName("effectExtent"), [ // Don't know what this does, but Word adds it.
        X.Attr(X.unqual("l"), "0"),
        X.Attr(X.unqual("t"), "0"),
        X.Attr(X.unqual("r"), "0"),
        X.Attr(X.unqual("b"), "0")]),
      X.node(wpName("docPr"), [
        X.Attr(X.unqual("id"), picId),
        X.Attr(X.unqual("name"), T.unpack(title))]),
      X.node(wpName("cNvGraphicFramePr"), null),
      X.node(aName("graphic"), [
        nameSpace("a", aUri),
        X.node(aName("graphicData"), [X.Attr(X.unqual("uri"), picUri), picture])]),
    ],
  ]));
}

export const picUri: string = "http://schemas.openxmlformats.org/drawingml/2006/picture";

export const aUri: string = "http://schemas.openxmlformats.org/drawingml/2006/main";

export const svgUri: string = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";

/**
 * Non-visual picture properties.
 *
 * @param picId Picture ID.
 * @param title Picture name.
 * @param lock Lock aspect ratio.
 */
export function nonVisualProperties(picId: string, title: Text, lock: boolean): X.Element {
  return X.node(pName("nvPicPr"), [
    X.node(pName("cNvPr"), [
      X.Attr(X.unqual("id"), picId),
      X.Attr(X.unqual("name"), T.unpack(title)),
    ]),
    X.node(
      pName("cNvPicPr"),
      lock ? [X.node(aName("picLocks"), X.Attr(X.unqual("noChangeAspect"), "1"))] : [],
    ),
  ]);
}


/** A reference to an embedded image. */
export function blipFill(st: DocMonad, ref: ImageRef): X.Element {
  // This is gnarly. Generate a blip node with the PNG in its attribute.
  // If there is an SVG then wrap it in an extLst in the blip node content.
  const png = getMediaRef(st, ref, "PngTarget");
  if (png.tag === "Nothing") return wText("Missing image");
  const pngRel = png.value;
  const pngAttr = X.Attr(qual("r", "embed"), T.unpack(pngRel.relId));
  const svgM = getMediaRef(st, ref, "SvgTarget");
  return X.node(pName("blipFill"), [
    svgM.tag === "Nothing"
      ? X.node(aName("blip"), pngAttr)
      // No SVG, so blip contains bare attribute and no content.
      : X.node(aName("blip"), [
        pngAttr,
        // blip node content: SVG incantations.
        qNode("a", "extLst", qNode("a", "ext", [
          X.Attr(X.unqual("uri"), "{96DAC541-7B7A-43D3-8B79-37D633B846F1}"),
          qNode("asvg", "svgBlip", [
            X.Attr(qual("xmlns", "asvg"), svgUri),
            X.Attr(qual("r", "embed"), T.unpack(svgM.value.relId)),
          ]),
        ])),
      ]),
    X.node(aName("stretch"), X.node(aName("fillRect"), null)),
  ]);
}


/** Shape properties: rectangle with the given position and width and height. */
export function shapeProperties(x: number, y: number, w: number, h: number): X.Element {
  return X.node(pName("spPr"), [
    X.node(aName("xfrm"), [
      X.node(aName("off"), [
        X.Attr(X.unqual("x"), showInteger(points(x))),
        X.Attr(X.unqual("y"), showInteger(points(y)))]),
      X.node(aName("ext"), [
        X.Attr(X.unqual("cx"), showInteger(points(w))),
        X.Attr(X.unqual("cy"), showInteger(points(h)))]),
    ]),
    X.node(aName("prstGeom"), [
      X.Attr(X.unqual("prst"), "rect"),
      X.node(aName("avLst"), null),
    ]),
    X.node(aName("noFill"), null),
    X.node(aName("ln"), X.node(aName("noFill"), null)),
  ]);
}


/* Design note:

The contents of the picture combinators are largely incantations taken
from ECMA-376 Part 1 Appendix L.4.10.2, which includes the following "simple" example:
  <p:pic>
    <p:nvPicPr>
      <p:cNvPr id="4" name="St_Patrick's_Day.jpg"/>
      <p:cNvPicPr>
        <a:picLocks noChangeAspect="1"/>
      </p:cNvPicPr>
      <p:nvPr/>
    </p:nvPicPr>
    <p:blipFill>
      <a:blip r:embed="rId2"/>
      <a:stretch>
        <a:fillRect/>
      </a:stretch>
    </p:blipFill>
    <p:spPr>
      <a:xfrm>
        <a:off x="1346200" y="914400"/>
        <a:ext cx="3657600" cy="2743200"/>
      </a:xfrm>
      <a:prstGeom prst="rect">
        <a:avLst/>
      </a:prstGeom>
      <a:noFill/>
      <a:ln>
        <a:noFill/>
      </a:ln>
    </p:spPr>
  </p:pic>

This has then been enhanced using cargo-cult cut-and-paste from
a Word document with embedded SVG. Nodes were added until Word stopped
complaining.
*/
