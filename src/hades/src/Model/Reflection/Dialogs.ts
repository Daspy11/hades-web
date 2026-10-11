// Ported from hades/src/Model/Reflection/Dialogs.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Dialogs for editing reflective types (fields, extensions, reference types) and the values
 * described by them.
 *
 * TypeScript port
 * ---------------
 * * Haskell values of polymorphic gadget or dialog types are zero-argument generic functions:
 *   `fieldDialog()`, `fieldDialogSelector()`, `builtInDialog()`, `decoBoolDialog()`,
 *   `enumTypeDialog()`. Constrained ones take their dictionaries: `referenceListDialog(cls)`,
 *   `referenceTypeDialog(cls)` (the `Reflective` dictionary) and `decoRangeDialog(show, read)`
 *   (the `Show` and `Read` instances of the range type).
 * * `Default` instances are passed as values (`def :: Integer` is `0`, `def :: [a]` is `[]`, ...).
 * * `addDecoBool`, `addDecoRange`, `addDecoEnum` and `addFieldDecoration` take the gadget to
 *   decorate as their last argument.
 */
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as MP from "@/lib/Text/Megaparsec";
import { Just, Nothing, bindMaybe, fromMaybe, isJust, listToMaybe, mapMaybeValue, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { isSpace } from "@/lib/Data/Char";
import { showDay, type Day } from "@/lib/Data/Time";
import { div, error, readDouble, readInteger, showDouble, showInt } from "@/lib/Prelude";
import {
  _1, _2, contains, identity, iso, ix, preview, prism, to, view, _Just,
  type Iso, type Prism,
} from "@/lib/Control/Lens";
import { isURIReference } from "@/lib/Network/URI";
import { def_Bool, def_Day, def_Text } from "@/banana-ui/base/Data/Default/Orphan";
import {
  blankIconName, def_Colour, longDate, textPrismDouble, textPrismInteger,
  type Colour, type IconName,
} from "@/banana-ui/base/Reactive/Banana/Common";
import {
  ComboItem, Dialog, OkApplyButton, PrismaticGadget, accum, arr, box, colourBox, comboBox,
  constantDialog, coloured, dateBox, focusing, focusingOver, form, frame, gDot, gPipe, gProd,
  icon, iconBox, isStandardContext, maybeTextBox, memoBox, message, optional, optionalOver,
  prismatic, readOnlyText, simpleCombo, simpleFrame, simpleTextBox, styled1, table, textBox,
  tickBox, typedTextBox, unionTab, validate, validateText, validateText1, validateTextOver,
  withEnv, buttonBar,
  type Dialog_, type DialogSelector_, type Gadget, type Gadget_, type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import {
  EditColour, EditCombo, EditEntry, EditFixed, EditIcon, Opt, TableDelete, TableShuffle,
  enumField, mkField, type Table,
} from "@/banana-ui/base/Reactive/Banana/Table";
import type { Relation } from "./NamedRelation";
import { ShowErrorComponent_Text, topExpr, type FunctionTable } from "./Parser";
import {
  RefType, refTypeSets, refTypeSingles, refTypeTableToList, type RefType as RefTypeT,
} from "./References";
import type { Reflective } from "./Reflective";
import {
  BuiltInDef, DecoBool, DecoRange, EnumItem, Field, _BuiltInDef, _DecoBoolDef, _DecoIntDef, _DecoRealDef, _EnumDef,
  builtInFields, def_BuiltInType, def_DecoType, def_DecoType_Bool, enumItemColour, enumItemIcon,
  enumItemName, fieldMulti, fieldName, fieldNameIso, fieldType, fieldsByName, rangeMap, rangePrism,
  show_BuiltInType, typeDescription, validRange,
  type BuiltInType, type DecoType, type EnumType, type FieldId, type FieldName, type FieldTable,
  type Multiplicity, type Range, type RangeMap, type TypeDef,
} from "./Types";
import {
  ExtNone, ExtText, _ExtBool, _ExtDate, _ExtInt, _ExtReal, _ExtText, def_ExtValue, displayValue,
  extValue, type ExtValue, type ExtensionValues, type Variant,
} from "./Values";

/**
 * Lens's `below` for `Maybe`: @below k :: Prism' (Maybe s) (Maybe a)@ matches when the contents
 * (if any) match @k@.
 */
function below<St, A>(k: Prism<St, A>): Prism<Maybe<St>, Maybe<A>> {
  return prism(
    (m: Maybe<A>) => mapMaybeValue((a: A) => k.review(a), m),
    (s: Maybe<St>) => {
      if (s.tag === "Nothing") return Right(Nothing as Maybe<A>);
      const r = k.match(s.value);
      return r.tag === "Right" ? Right(Just(r.value)) : Left(s);
    },
  );
}

/**
 * Create a gadget to edit values described by a field. If the first argument is @True@ then
 * Note boxes will expand vertically to fill the available space.
 */
export function fieldElement<E = any, W = any>(vExpand: boolean, field: Field): Gadget_<E, W, ExtValue> {
  const ro = field.fieldReadOnly, multi = field._fieldMulti, t = field._fieldType;

  const bool = <A>(p: readonly [A, A], v: ExtValue): Maybe<A> => {
    if (v.tag === "ExtBool") return Just(v._0 ? p[1] : p[0]);
    return Nothing;
  };
  const range = <A, B>(prsm: Prism<ExtValue, A>, rm: RangeMap<A, B>, v: ExtValue): Maybe<B> =>
    preview(prsm.dot(to((x: A) => rangeMap(rm, x))).dot(_Just<B>()), v);
  // Does the RangeMap have any icons in it?
  const rmapIcons = <A>(rm: RangeMap<A, readonly [Maybe<IconName>, Maybe<Colour>]>): boolean =>
    rm.some((r) => isJust(r[1][0]));
  const multiMod = <A>(d: A, prsm: Prism<ExtValue, A>, g: Gadget_<E, W, A>): Gadget_<E, W, ExtValue> => {
    switch (multi) {
      case "Optional":
        return prismatic(Nothing as Maybe<A>, optionalExtension.dot(below(prsm)), optional(d, g));
      case "One":
        return prismatic(d, prsm, g);
    }
  };
  const basicGadget = (readOnly: boolean, m: BuiltInType): Gadget_<E, W, ExtValue> => {
    switch (m) {
      case "ModelBool": return multiMod(def_Bool, _ExtBool, tickBox());
      case "ModelInt":
        return readOnly
          ? multiMod(0, _ExtInt, readOnlyText((_e: E, n: number) => T.pack(showInt(n))))
          : multiMod(0, _ExtInt, typedTextBox(showInt, readInteger));
      case "ModelReal":
        return readOnly
          ? multiMod(0, _ExtReal, readOnlyText((_e: E, r: number) => T.pack(showDouble(r))))
          : multiMod(0, _ExtReal, typedTextBox(showDouble, readDouble));
      case "ModelText":
        return readOnly
          ? multiMod(def_Text, _ExtText, styled1("table-cell", message((_e: E, s: T.Text) => s)))
          : multiMod(def_Text, _ExtText, simpleTextBox());
      case "ModelURL":
        return readOnly
          ? multiMod(def_Text, _ExtText, styled1("table-cell", message((_e: E, s: T.Text) => s)))
          : multiMod(def_Text, _ExtText, textBox((_e: E) => urlPrism));
      case "ModelNote":
        return readOnly
          ? multiMod(def_Text, _ExtText, styled1("table-cell", message((_e: E, s: T.Text) => s)))
          : multiMod(def_Text, _ExtText, memoBox("MemoSmall", vExpand));
      case "ModelDate":
        return readOnly
          ? multiMod(def_Day(), _ExtDate, styled1("table-cell", message((_e: E, d: Day) => T.pack(showDay(d)))))
          : multiMod(def_Day(), _ExtDate, dateBox(longDate));
    }
  };
  // Prism which allows a valid URL to pass but not any other text.
  const urlPrism: Prism<T.Text, T.Text> =
    prism((s: T.Text) => s, (str: T.Text) => (isURIReference(T.unpack(str)) ? Right(str) : Left(str)));

  switch (t.tag) {
    case "BuiltInDef":
      return basicGadget(ro, t._0);
    case "DecoBoolDef": {
      const deco = t._0;
      if (deco.tag === "DecoBool") {
        const icons = deco._0, colours = deco._1;
        const g1 = multiMod(def_Bool, _ExtBool, tickBox<E, W>());
        const g2 = icons.tag === "Just"
          ? icon((v: ExtValue) => fromMaybe(blankIconName, bool(icons.value, v)), g1)
          : g1;
        return colours.tag === "Just" ? coloured((v: ExtValue) => bool(colours.value, v), g2) : g2;
      }
      // Can't happen, but type checker can't figure that out.
      return multiMod(def_Bool, _ExtBool, tickBox());
    }
    case "DecoIntDef": {
      const deco = t._0;
      if (deco.tag !== "DecoRange") return error("fieldElement: DecoBool for an Integer type");
      const r = deco._0, rm = deco._1;
      const g1 = multiMod(0, _ExtInt, textBox((_e: E) => textPrismInteger.dot(rangePrism(r))));
      const g2 = rmapIcons(rm)
        ? icon((v: ExtValue) => fromMaybe(blankIconName, bindMaybe(range(_ExtInt, rm, v), (p) => p[0])), g1)
        : g1;
      return coloured((v: ExtValue) => bindMaybe(range(_ExtInt, rm, v), (p) => p[1]), g2);
    }
    case "DecoRealDef": {
      const deco = t._0;
      if (deco.tag !== "DecoRange") return error("fieldElement: DecoBool for a Real type");
      const r = deco._0, rm = deco._1;
      const g1 = multiMod(0, _ExtReal, textBox((_e: E) => textPrismDouble.dot(rangePrism(r))));
      const g2 = rmapIcons(rm)
        ? icon((v: ExtValue) => fromMaybe(blankIconName, bindMaybe(range(_ExtReal, rm, v), (p) => p[0])), g1)
        : g1;
      return coloured((v: ExtValue) => bindMaybe(range(_ExtReal, rm, v), (p) => p[1]), g2);
    }
    case "EnumDef": {
      const enum1 = t._0;
      return multiMod(def_ExtValue, identity<ExtValue>(),
        comboBox((_e: E) => enum1.map((i) =>
          ComboItem(i._enumItemName, i._enumItemIcon, i._enumItemColour, ExtText(i._enumItemName)))));
    }
  }
}

/** `optionalExtension :: Iso' ExtValue (Maybe ExtValue)` */
const optionalExtension: Iso<ExtValue, Maybe<ExtValue>> = iso(
  (v: ExtValue) => (v.tag === "ExtNone" ? Nothing : Just(v)),
  (m: Maybe<ExtValue>) => fromMaybe(ExtNone, m),
);

/** Add icons and colours to the element suitable for boolean values. */
function addDecoBool<E, W, B>(
  icons: Maybe<readonly [IconName, IconName]>,
  colours: Maybe<readonly [Colour, Colour]>,
  g: Gadget<E, W, ExtValue, B>,
): Gadget<E, W, ExtValue, B> {
  const iDeco = (g1: Gadget<E, W, ExtValue, B>): Gadget<E, W, ExtValue, B> => {
    if (icons.tag === "Nothing") return g1;
    const [falseI, trueI] = icons.value;
    return icon((v: ExtValue) => {
      const b = preview(_ExtBool, v);
      return b.tag === "Just" ? (b.value ? trueI : falseI) : blankIconName;
    }, g1);
  };
  const cDeco = (g1: Gadget<E, W, ExtValue, B>): Gadget<E, W, ExtValue, B> => {
    if (colours.tag === "Nothing") return g1;
    const [falseC, trueC] = colours.value;
    return coloured((v: ExtValue) => {
      const b = preview(_ExtBool, v);
      return b.tag === "Just" ? Just(b.value ? trueC : falseC) : Nothing;
    }, g1);
  };
  return iDeco(cDeco(g));
}

/** Add icons and colours to the element suitable for ordered values. */
function addDecoRange<E, W, A, B>(
  m: RangeMap<A, readonly [Maybe<IconName>, Maybe<Colour>]>,
  prsm: Prism<ExtValue, A>,
  g: Gadget<E, W, ExtValue, B>,
): Gadget<E, W, ExtValue, B> {
  const iDeco = (g1: Gadget<E, W, ExtValue, B>): Gadget<E, W, ExtValue, B> =>
    m.some((r) => isJust(r[1][0]))
      ? icon((v: ExtValue) => fromMaybe(blankIconName, bindMaybe(preview(prsm, v), (v1) =>
        bindMaybe(rangeMap(m, v1), (p) => p[0]))), g1)
      : g1;
  const cDeco = (g1: Gadget<E, W, ExtValue, B>): Gadget<E, W, ExtValue, B> =>
    m.some((r) => isJust(r[1][1]))
      ? coloured((v: ExtValue) => bindMaybe(preview(prsm, v), (v1) =>
        bindMaybe(rangeMap(m, v1), (p) => p[1])), g1)
      : g1;
  return iDeco(cDeco(g));
}

/** Add icons and colours to the element from an enumeration type. */
function addDecoEnum<E, W, B>(typ: EnumType, g: Gadget<E, W, ExtValue, B>): Gadget<E, W, ExtValue, B> {
  const tbl = M.fromList(typ.map((i) => [view(enumItemName, i), i] as [T.Text, EnumItem]));
  const iDeco = (g1: Gadget<E, W, ExtValue, B>): Gadget<E, W, ExtValue, B> =>
    typ.some((i) => isJust(view(enumItemIcon, i)))
      ? icon((v: ExtValue) =>
        fromMaybe(blankIconName, preview(ix<T.Text, EnumItem>(displayValue(v)).dot(enumItemIcon).dot(_Just<IconName>()), tbl)), g1)
      : g1;
  const cDeco = (g1: Gadget<E, W, ExtValue, B>): Gadget<E, W, ExtValue, B> =>
    typ.some((i) => isJust(view(enumItemColour, i)))
      ? coloured((v: ExtValue) =>
        preview(ix<T.Text, EnumItem>(displayValue(v)).dot(enumItemColour).dot(_Just<Colour>()), tbl), g1)
      : g1;
  return iDeco(cDeco(g));
}

/** Add icons and colours as specified by a type to any dialog element. */
export function addFieldDecoration<E, W>(typ: TypeDef, g: Gadget_<E, W, ExtValue>): Gadget_<E, W, ExtValue> {
  switch (typ.tag) {
    case "DecoBoolDef":
      return typ._0.tag === "DecoBool" ? addDecoBool(typ._0._0, typ._0._1, g) : g;
    case "DecoIntDef":
      return typ._0.tag === "DecoRange" ? addDecoRange(typ._0._1, _ExtInt, g) : g;
    case "DecoRealDef":
      return typ._0.tag === "DecoRange" ? addDecoRange(typ._0._1, _ExtReal, g) : g;
    case "EnumDef":
      return addDecoEnum(typ._0, g);
    default:
      return g;
  }
}

/** Like "fieldElement", but promoted to work on a table of "ExtensionValues". */
export function fieldElement1<E = any, W = any>(
  vExpand: boolean, field: Field,
): [T.Text, GadgetF_<E, W, ExtensionValues>] {
  return [
    view(fieldName, field),
    focusing(extValue<FieldId>(field.fieldId), fieldElement<E, W>(vExpand, field)),
  ];
}

/** The duplicated entries in a list, in sorted order (`map head $ filter ((> 1) . length) $ group $ sort xs`). */
function duplicates(xs: readonly T.Text[]): T.Text[] {
  return L.group(L.sort(xs)).filter((g) => g.length > 1).map((g) => L.head(g));
}

/**
 * Dialog for field names that can be used in variants.
 *
 * New fields require unique IDs. This is a pure function so it can't provide unique IDs. Instead
 * new fields are given a FieldId of @nil@. This must be replaced with a fresh UUID by the caller.
 */
export function fieldDialog<E = any, W = any>(): Dialog_<E, W, readonly Field[]> {
  const validFields = (fs: readonly Field[]): Maybe<T.Text> => {
    const nms = [...fs, ...M.elems(builtInFields)].map((f) => view(fieldName, f));
    return listToMaybe([
      ...(nms.some((n) => T.isNull(n)) ? ["Names must not be empty."] : []),
      ...duplicates(nms).map((n) => "Duplicate name: " + n),
    ]);
  };
  // Pseudo-ISO to strip leading or trailing spaces.
  const strips: Iso<FieldName, FieldName> = iso(T.strip, T.strip);
  const fieldColumns: Table<Field> = [
    mkField("Name", fieldName.dot(strips), Nothing, EditEntry(identity<T.Text>()), Nothing),
    mkField("Multiplicity", fieldMulti, Nothing, enumField<Multiplicity>(["One", "Optional"]), Nothing),
    mkField("Type", fieldType, Nothing, EditFixed(typeDescription), Nothing),
  ];
  const blankName = " -?- ";
  const blankEntry = Field(false, U.nil, blankName, "One", BuiltInDef("ModelText"));
  // Add and remove the blank entry.
  const extraIso: Iso<readonly Field[], readonly Field[]> = iso(
    (fs: readonly Field[]) => [...fs, blankEntry],
    (fs: readonly Field[]) => fs.filter((f) => T.strip(blankName) !== T.strip(view(fieldName, f))),
  );
  return Dialog("Fields", OkApplyButton,
    simpleFrame("Fields",
      prismatic([] as readonly Field[], extraIso,
        validateText(validFields,
          table<E, W, Field>([TableDelete], fieldColumns, Just(fieldDialogSelector<E, W>()))))));
}

/** Edit a field. */
function fieldDialogSelector<E = any, W = any>(): DialogSelector_<E, W, Field> {
  return constantDialog(Dialog("Edit data field", OkApplyButton,
    accum(focusing(fieldType, unionTab<E, W, TypeDef, TypeDef>([
      ["Built-in", PrismaticGadget(def_BuiltInType, _BuiltInDef, builtInDialog<E, W>())],
      ["Deco\nBool", PrismaticGadget(def_DecoType_Bool, _DecoBoolDef, decoBoolDialog<E, W>())],
      ["Deco\nInt", PrismaticGadget(def_DecoType, _DecoIntDef,
        decoRangeDialog<E, W, number>(showInt, readInteger))],
      ["Deco\nReal", PrismaticGadget(def_DecoType, _DecoRealDef,
        decoRangeDialog<E, W, number>(showDouble, readDouble))],
      ["Enumeration", PrismaticGadget([] as EnumType, _EnumDef, enumTypeDialog<E, W>())],
    ])))));
}

/** Dialog for extensions to a single variant. */
export function extensionDialog<A, E = any, W = any>(
  fieldTable: FieldTable, variant: Variant<A>,
): Dialog_<E, W, readonly FieldId[]> {
  const fieldTable2: M.Map<FieldName, Field> = fieldsByName(fieldTable);
  const nameSet = S.fromList(M.elems(fieldTable).map((f) => view(fieldName, f)));
  const validExtensions = (fs: readonly FieldName[]): Maybe<T.Text> => listToMaybe([
    ...(fs.some((f) => T.isNull(f)) ? ["Names must not be empty."] : []),
    ...duplicates(fs).map((f) => "Duplicate field: " + f),
    ...fs.filter((f1) => !S.member(f1, nameSet)).map((f) => "Unknown field: " + f),
  ]);
  const fieldList = M.keys(fieldTable2);
  const extensionTable: Table<FieldName> =
    [mkField("Field Name", identity<FieldName>(), Nothing, EditCombo(fieldList), Nothing)];
  const blankText = " -?- ";
  const extraIso: Iso<readonly FieldName[], readonly FieldName[]> = iso(
    (fs: readonly FieldName[]) => [...fs, blankText],
    (fs: readonly FieldName[]) => fs.filter((f) => T.strip(f) !== T.strip(blankText)),
  );
  return Dialog(variant, OkApplyButton,
    accum(
      focusingOver(fieldNameIso(fieldTable),
        validateTextOver(validExtensions,
          frame((_: readonly FieldName[]) => Just("Extension Fields"),
            focusing(extraIso,
              table<E, W, FieldName>([TableDelete, TableShuffle], extensionTable, Nothing)))))));
}

/** Dialog for selecting a subset from a universe. */
export function subsetDialog<A, E = any, W = any>(
  title: T.Text, valName: (a: A) => T.Text, universe1: S.Set<A>,
): Dialog_<E, W, S.Set<A>> {
  return Dialog(title, OkApplyButton, subsetGadget<A, E, W>(valName, universe1));
}

/** Subdialog for selecting a subset from a universe. */
export function subsetGadget<A, E = any, W = any>(valName: (a: A) => T.Text, universe1: S.Set<A>): Gadget_<E, W, S.Set<A>> {
  const [uni1, uni2] = L.splitAt(div(S.size(universe1) + 1, 2), L.sortOn(valName, S.toList(universe1)));
  const checkBox = (x: A): readonly [T.Text, GadgetF_<E, W, S.Set<A>>] =>
    [valName(x), focusing(contains<A>(x), tickBox<E, W>())];
  return accum(gPipe(
    accum(box<E, W, S.Set<A>>("Horizontal", [[
      form("Vertical", uni1.map(checkBox)),
      form("Vertical", uni2.map(checkBox)),
    ]])),
    buttonBar<E, W, S.Set<A>>([["Set all", () => universe1], ["Clear all", () => S.empty<A>(universe1.cmp)]]),
  ));
}

/**
 * Describe a subset of a universe as either the set of elements or the set of non-elements.
 * depending on which is shorter.
 */
export function showSubset<A>(valName: (a: A) => T.Text, universe1: S.Set<A>, xs: S.Set<A>): T.Text {
  if (S.isNull(xs)) return "<Nothing>";
  if (equals(xs, universe1)) return "<Everything>";
  if (S.size(xs) < 3 + div(S.size(universe1), 2)) return T.intercalate(", ", L.sort(S.toList(xs).map(valName)));
  return "All except " + T.intercalate(", ", L.sort(S.toList(S.difference(universe1, xs)).map(valName)));
}

/**
 * A sub-dialog component for entering expressions. As the expression is typed it is checked for
 * errors.
 *
 * @param knownFields Known value identifiers.
 */
export function expressionEntry<E = any, W = any>(ftable: FunctionTable<E>, knownFields: FieldTable): Gadget_<E, W, T.Text> {
  const check = (v: T.Text): Maybe<T.Text> => {
    const r = MP.parse(topExpr(ftable, knownFields), "", v);
    if (r.tag === "Left") {
      return Just(T.pack(MP.parseErrorTextPretty(ShowErrorComponent_Text, L.head(r.value.bundleErrors))));
    }
    return Nothing;
  };
  return validateText(check, memoBox<E, W>("MemoSmall", true));
}

/** Sub-dialog for selecting one of the built-in types. */
function builtInDialog<E = any, W = any>(): Gadget_<E, W, BuiltInType> {
  const builtInMenu = simpleCombo<E, W, BuiltInType>(
    ["ModelBool", "ModelInt", "ModelReal", "ModelText", "ModelURL", "ModelNote", "ModelDate"], show_BuiltInType);
  return accum(form("Vertical", [["Built-in Type:", focusing(identity<BuiltInType>(), builtInMenu)]]));
}

/** Sub-dialog for designing decorated booleans. */
function decoBoolDialog<E = any, W = any>(): Gadget_<E, W, DecoType<boolean>> {
  type Icons = Maybe<readonly [IconName, IconName]>;
  type Colours = Maybe<readonly [Colour, Colour]>;
  const icons: Gadget_<E, W, Icons> = accum(simpleFrame("Icons",
    optionalOver<E, W, readonly [IconName, IconName], readonly [IconName, IconName]>([def_Text, def_Text],
      form<E, W, readonly [IconName, IconName]>("Vertical", [
        ["Icon for \"False\":", focusing(_1<IconName, IconName>(),
          validate((s: T.Text) => !T.isNull(s), iconBox<E, W>((c) => !isStandardContext(c))))],
        ["Icon for \"True\":", focusing(_2<IconName, IconName>(),
          validate((s: T.Text) => !T.isNull(s), iconBox<E, W>((c) => !isStandardContext(c))))],
      ]))));
  const colours: Gadget_<E, W, Colours> = accum(simpleFrame("Colours",
    optionalOver<E, W, readonly [Colour, Colour], readonly [Colour, Colour]>([def_Colour, def_Colour],
      form<E, W, readonly [Colour, Colour]>("Vertical", [
        ["Colour for \"False\":", focusing(_1<Colour, Colour>(), colourBox<E, W>())],
        ["Colour for \"True\":", focusing(_2<Colour, Colour>(), colourBox<E, W>())],
      ]))));
  return gPipe(
    arr((d: DecoType<boolean>): [Icons, Colours] => {
      if (d.tag !== "DecoBool") return error("decoBoolDialog: irrefutable pattern failed for DecoBool");
      return [d._0, d._1];
    }),
    gProd(icons, colours),
    arr(([i, c]: [Icons, Colours]) => DecoBool(i, c)),
  );
}

/** Sub-dialog for designing decorated ranges. The arguments are the `Show` and `Read` instances of @a@. */
function decoRangeDialog<E = any, W = any, A = any>(
  show: (a: A) => string, read: (s: string) => Maybe<A>,
): Gadget<E, W, DecoType<A>, DecoType<A>> {
  type Attrs = readonly [Maybe<IconName>, Maybe<Colour>];
  type Deco = RangeMap<A, Attrs>;
  type Sub = readonly [Range<A>, Attrs];
  const splitRange = (d: DecoType<A>): [Range<A>, Deco] => {
    if (d.tag === "DecoRange") return [d._0, d._1];
    return [[Nothing, Nothing], []];
  };
  const editRange: Gadget_<E, W, Range<A>> =
    validate(validRange,
      accum(form<E, W, Range<A>>("Vertical", [
        ["Lower bound:", focusing(_1<Maybe<A>, Maybe<A>>(), maybeTextBox<E, W, A>(show, read))],
        ["Upper bound:", focusing(_2<Maybe<A>, Maybe<A>>(), maybeTextBox<E, W, A>(show, read))],
      ])));
  const textPrismA: Prism<T.Text, A> = prism(
    (a: A) => T.pack(show(a)),
    (t: T.Text) => {
      const r = read(T.unpack(t));
      return r.tag === "Just" ? Right(r.value) : Left(t);
    },
  );
  const subrangeTable: Table<Sub> = [
    mkField("Lower", _1<Range<A>, Attrs>().dot(_1<Maybe<A>, Maybe<A>>()), Nothing, Opt(EditEntry(textPrismA)), Nothing),
    mkField("Upper", _1<Range<A>, Attrs>().dot(_2<Maybe<A>, Maybe<A>>()), Nothing, Opt(EditEntry(textPrismA)), Nothing),
    mkField("Icon", _2<Range<A>, Attrs>().dot(_1<Maybe<IconName>, Maybe<Colour>>()),
      Nothing, Opt(EditIcon((c) => !isStandardContext(c))), Nothing),
    mkField("Colour", _2<Range<A>, Attrs>().dot(_2<Maybe<IconName>, Maybe<Colour>>()),
      Nothing, Opt(EditColour), Nothing),
  ];
  const blankSubrange: Sub = [[Nothing, Nothing], [Nothing, Nothing]];
  const extraIso: Iso<Deco, Deco> = iso(
    (xs: Deco) => [...xs, blankSubrange],
    (xs: Deco) => xs.filter((x) => !equals(x, blankSubrange)),
  );
  const editMap: Gadget_<E, W, Deco> =
    frame((_: Deco) => Just("Subrange Attributes (first match wins)"),
      validate((xs: Deco) => xs.every((x) => validRange(x[0])),
        accum(focusing(extraIso,
          table<E, W, Sub>([TableDelete, TableShuffle], subrangeTable, Nothing)))));
  return gPipe(
    arr(splitRange),
    gProd(editRange, editMap),
    arr(([r, m]: [Range<A>, Deco]) => DecoRange(r, m)),
  );
}

/** Table definition for enumerated items. */
const enumValuesTable: Table<EnumItem> = [
  mkField("Item", enumItemName, Nothing, EditEntry(identity<T.Text>()), Nothing),
  mkField("Icon", enumItemIcon, Nothing, Opt(EditIcon((c) => !isStandardContext(c))), Nothing),
  mkField("Colour", enumItemColour, Nothing, Opt(EditColour), Nothing),
];

/** Dialog definition for enumerated types. The first part of the tuple is the type name. */
function enumTypeDialog<E = any, W = any>(): Gadget<E, W, EnumType, EnumType> {
  const blankName = " -?- ";
  const blankEnumItem: EnumItem = EnumItem(blankName, Nothing, Nothing);
  const extraIso: Iso<readonly EnumItem[], readonly EnumItem[]> = iso(
    (xs: readonly EnumItem[]) => [...xs, blankEnumItem],
    (xs: readonly EnumItem[]) => xs.filter((i) => T.strip(view(enumItemName, i)) !== T.strip(blankName)),
  );
  return frame((_: EnumType) => Just("Enumerated Values"),
    accum(focusing(extraIso,
      table<E, W, EnumItem>([TableDelete, TableShuffle], enumValuesTable, Nothing))));
}

/** Dialog showing a list of extension reference types and enabling editing. */
export function referenceListDialog<A, E = any, W = any>(
  cls: Reflective<A>,
): Dialog_<E, W, readonly (readonly [Relation, RefTypeT<A>])[]> {
  type Row = readonly [Relation, RefTypeT<A>];
  const namesTaken = (xs: readonly Row[]): S.Set<FieldName> =>
    S.fromList([...refTypeTableToList(cls.reflectiveBuiltInRefs), ...xs].map((p) => p[0])); // Include built-in reference type names.
  const refTable: Gadget_<E, W, readonly Row[]> =
    withEnv(arr(namesTaken),
      table<S.Set<FieldName>, W, Row>(
        [TableDelete],
        [mkField("Reference type name", _1<Relation, RefTypeT<A>>(), Nothing, EditFixed((t: Relation) => t), Nothing)],
        Just(constantDialog(referenceTypeDialog<A, W>(cls)))));
  const blankRef: Row = [blankRefName, RefType<A>([], [false, false])];
  const extraIso = <B>(r: readonly [Relation, B]): Iso<readonly (readonly [Relation, B])[], readonly (readonly [Relation, B])[]> =>
    iso(
      (xs: readonly (readonly [Relation, B])[]) => [...xs, r],
      (xs: readonly (readonly [Relation, B])[]) => xs.filter((x) => T.strip(x[0]) !== T.strip(r[0])),
    );
  return Dialog("Reference Types", OkApplyButton, accum(
    simpleFrame("Reference Names", focusing(extraIso(blankRef), refTable))));
}

/** Placeholder name for potential new reference types in the table. */
const blankRefName: T.Text = " -?- ";

/** Dialog for editing a single reference type. */
export function referenceTypeDialog<A, W = any>(
  cls: Reflective<A>,
): Dialog_<S.Set<FieldName>, W, readonly [FieldName, RefTypeT<A>]> {
  type E = S.Set<FieldName>;
  type Item = readonly [FieldName, RefTypeT<A>];
  type Sides = readonly [S.Set<Variant<A>>, S.Set<Variant<A>>];
  const hideBlank = (str: T.Text): T.Text => (T.strip(str) === T.strip(blankRefName) ? "" : str);
  const singleMenu: Gadget_<E, W, boolean> = comboBox((_e: E) => [
    ComboItem("Many", Nothing, Nothing, false),
    ComboItem("One", Nothing, Nothing, true),
  ]);
  const allVariants: S.Set<Variant<A>> = S.fromList(cls.reflectiveDefaults.map((a) => cls.reflectiveName(a)));
  const showSet = (s: S.Set<Variant<A>>): T.Text => showSubset((v: Variant<A>) => cls.variantUserLabel(v), allVariants, s);
  const sidesDialog: Dialog_<E, W, Sides> = Dialog("Edit two sides of the relationship", OkApplyButton, accum(
    box<E, W, Sides>("Horizontal", [
      [simpleFrame("Side A can contain:", focusing(_1<S.Set<Variant<A>>, S.Set<Variant<A>>>(),
        subsetGadget<Variant<A>, E, W>((v) => cls.variantUserLabel(v), allVariants)))],
      [simpleFrame("Side B can contain:", focusing(_2<S.Set<Variant<A>>, S.Set<Variant<A>>>(),
        subsetGadget<Variant<A>, E, W>((v) => cls.variantUserLabel(v), allVariants)))],
    ])));
  const typeTable: Gadget_<E, W, readonly Sides[]> = table<E, W, Sides>(
    [TableDelete],
    [
      mkField("Side A", _1<S.Set<Variant<A>>, S.Set<Variant<A>>>(), Nothing, EditFixed(showSet), Nothing),
      mkField("Side B", _2<S.Set<Variant<A>>, S.Set<Variant<A>>>(), Nothing, EditFixed(showSet), Nothing),
    ],
    Just(constantDialog(sidesDialog)));
  const extraType: Iso<readonly Sides[], readonly Sides[]> = iso(
    (xs: readonly Sides[]) => [...xs, [S.empty<Variant<A>>(), S.empty<Variant<A>>()] as Sides],
    (xs: readonly Sides[]) => xs.filter(([s1, s2]) => !(S.isNull(s1) && S.isNull(s2))),
  );
  const nameIsValid = (_e: E, _i: T.Text, newName: T.Text): Maybe<T.Text> =>
    T.isNull(newName) ? Just("Enter a name.") : Nothing;
  const bothSides = (typ: Item): Maybe<Variant<A>> => {
    const sets = view(refTypeSets<A>(), typ[1]);
    const sideA = sets.reduceRight((acc, p) => S.union(p[0], acc), S.empty<Variant<A>>());
    const sideB = sets.reduceRight((acc, p) => S.union(p[1], acc), S.empty<Variant<A>>());
    return listToMaybe(S.toList(S.intersection(sideA, sideB)));
  };
  const isManyOne = (typ: Item): boolean => {
    const [a, b] = view(refTypeSingles<A>(), typ[1]);
    return a !== b;
  };
  const msg = (nm: Variant<A>): T.Text => nm + " appears on both sides of a one-many type.";
  const typeIsValid = (typ: Item): Maybe<T.Text> =>
    isManyOne(typ) ? mapMaybeValue(msg, bothSides(typ)) : Nothing;
  const sidesLens = _2<FieldName, RefTypeT<A>>().dot(refTypeSets<A>()).dot(extraType);
  return Dialog("Reference Type", OkApplyButton, accum(
    validateTextOver(typeIsValid, box<E, W, Item>("Vertical", [[
      form<E, W, Item>("Vertical", [["Name:", focusing(_1<FieldName, RefTypeT<A>>(),
        validateText1(nameIsValid,
          gDot(arr((s: T.Text) => T.dropAround(isSpace, s)), gDot(simpleTextBox<E, W>(), arr(hideBlank)))))]]),
      form<E, W, Item>("Horizontal", [
        ["Side A multiplicity:", focusing(_2<FieldName, RefTypeT<A>>().dot(refTypeSingles<A>()).dot(_1<boolean, boolean>()), singleMenu)],
        ["Side B multiplicity:", focusing(_2<FieldName, RefTypeT<A>>().dot(refTypeSingles<A>()).dot(_2<boolean, boolean>()), singleMenu)],
      ]),
      simpleFrame("Entity Types", focusing(sidesLens, typeTable)),
    ]]))));
}
