// Ported from hades/src/Data/Aeson/Orphan.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This package is a home for the following orphan instances:
 *
 * > instance (RealFrac a, Floating a) => ToJSON (Colour a)
 * > instance (RealFrac a, Floating a) => FromJSON (Colour a)
 *
 * "Colour" is represented as a hex string in HTML style.
 *
 * In TypeScript the two instances are the codec `JSON_Colour`. It is the same encoding as the
 * runtime library's `J.colourJ`, which codecs elsewhere may use interchangeably.
 */
import * as J from "@/lib/Data/Aeson";
import * as T from "@/lib/Data/Text";
import { isSpace } from "@/lib/Data/Char";
import { sRGB24read, sRGB24show, type Colour } from "@/lib/Data/Colour";

/** `instance ToJSON (Colour a)` and `instance FromJSON (Colour a)`. */
export const JSON_Colour: J.JSONCodec<Colour> = J.codec(
  (c) => J.textJ.toJSON(sRGB24show(c)),
  (v) =>
    J.withText(
      "Colour",
      (str) => {
        const r = sRGB24read(T.dropAround(isSpace, str));
        if (r.tag === "Just") return r.value;
        return J.fail("Colour not parsed: " + T.showText(str));
      },
      v,
    ),
);
