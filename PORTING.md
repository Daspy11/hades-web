# Porting HADES from Haskell to TypeScript

This repository is a 1:1 port of [PaulJohnson/hades](https://github.com/PaulJohnson/hades) to a
Vite + React + TypeScript single page application. Every Haskell source file has a TypeScript
counterpart at the same relative path under `src/`, with the same module structure and the same
exported names. This document is the rulebook for that port. Follow it exactly: other modules are
being ported in parallel and rely on these conventions to line up.

## 1. Layout

| Haskell                                        | TypeScript                                          |
|------------------------------------------------|-----------------------------------------------------|
| `banana-ui/base/Reactive/Banana/Common.hs`     | `src/banana-ui/base/Reactive/Banana/Common.ts`      |
| `banana-ui/gtk/src/Reactive/Banana/GI/*.hs`    | `src/banana-ui/gtk/src/Reactive/Banana/GI/*.ts`     |
| `hades/src/Hades/Abstract/Delta.hs`            | `src/hades/src/Hades/Abstract/Delta.ts`             |
| `hades/evidence/Evidence/Model.hs`             | `src/hades/evidence/Evidence/Model.ts`              |
| `dsm/gsn/GSN/Model.hs`                         | `src/dsm/gsn/GSN/Model.ts`                          |
| `dsm/Main.hs`                                  | `src/dsm/Main.ts`                                   |
| `hades/test/Test/Expression.hs`                | `src/hades/test/Test/Expression.test.ts`            |
| `share/` data directories                      | copied verbatim to the same place under `src/`      |

Imports use the `@/` alias for `src/`, e.g.
`import { Delta } from "@/hades/src/Hades/Abstract/Delta";`. Haskell re-export modules
(`Hades.Abstract`, `Hades.GI`, `Reactive.Banana.GI`) become `export * from ...` files.

The original source is checked out at
`/tmp/claude-0/-home-user-hades-web/8067b2bd-c9be-5a08-92fc-6c85b497e508/scratchpad/src/hades/`.
Read the Haskell file you are porting in full before writing anything.

Each TypeScript file starts with a short header comment (`/** ... */`) carrying over the Haskell
module documentation (the `{- | ... -}` block). Keep the Haddock comments on functions and types
as TSDoc comments. Drop the copyright boilerplate except for one line:
`// Ported from <haskell path>. Copyright © Paul Johnson. See LICENSE.`

## 2. Haskell libraries → `src/lib`

The Haskell dependencies are replaced by modules in `src/lib`. Read their source when in doubt;
they are short and documented. Haskell argument order is preserved everywhere.

| Haskell                                  | TypeScript                                   | Notes |
|------------------------------------------|----------------------------------------------|-------|
| `Prelude`, `Text.Read`, `Data.IORef`, `Control.Monad` | `@/lib/Prelude`                 | `showDouble`, `readInt`, `readDouble`, `round` (banker's), `div`/`mod`, `IORef`, `absurd` |
| `Data.Maybe`                             | `@/lib/Data/Maybe`                           | explicit `Maybe<A>`: `Just(x)`, `Nothing` |
| `Data.Either`                            | `@/lib/Data/Either`                          | `Left(x)`, `Right(x)` |
| `Data.Ord`, `Eq`/`Ord` classes           | `@/lib/Data/Ord`                             | `equals`, `compare`, `Ordering` = `-1 \| 0 \| 1` |
| `Data.List`                              | `import * as L from "@/lib/Data/List"`       | |
| `Data.Text`                              | `import * as T from "@/lib/Data/Text"`       | `Text` = `string` |
| `Data.Char`                              | `@/lib/Data/Char`                            | `Char` = one-code-point `string` |
| `Data.Map`, `Data.Map.Strict`            | `import * as M from "@/lib/Data/Map"`        | `M.Map<K, V>` (persistent) |
| `Data.Set`                               | `import * as S from "@/lib/Data/Set"`        | `S.Set<A>` (persistent) |
| `Data.Tree`                              | `@/lib/Data/Tree`                            | `Tree<A>`, `Forest<A>`, `Node(label, kids)` |
| `Data.UUID`, `.V4`, `.V5`                | `import * as U from "@/lib/Data/UUID"`       | `UUID` = canonical lower-case `string` |
| `Data.Time.*`                            | `@/lib/Data/Time`                            | `Day` = `"YYYY-MM-DD"`, `UTCTime` = epoch ms |
| `Data.Colour.*`                          | `@/lib/Data/Colour`                          | `Colour` class (linear RGB) |
| `Data.Aeson`, `Data.Aeson.Lens`          | `import * as J from "@/lib/Data/Aeson"`      | codecs, see §6 |
| `Control.Lens`                           | `@/lib/Control/Lens`                         | optics, see §5 |
| `Reactive.Banana` (+ Frameworks)         | `import * as B from "@/lib/Reactive/Banana"` | see §8 |
| `GI.Cairo.Render`, `GI.Pango`            | `@/lib/GI/Cairo`, `@/lib/GI/Pango`           | canvas / SVG backends (later wave) |
| `GI.Gtk`, `GI.Gdk`                       | `@/lib/GI/Gtk`                               | web widget toolkit (later wave) |
| `Data.Vector`                            | plain arrays                                 | |
| `Data.ByteString`                        | `Uint8Array`                                 | text ↔ bytes: `U.encodeUtf8`/`U.decodeUtf8` |
| `Data.HashMap.Strict`                    | `M.Map` or a JS `Map` (insertion order does not matter) | |

If something is missing, write a local helper in your module. Only add to `src/lib` if it is
clearly general purpose, and then only with a small, additive `Edit` (other agents edit these
files concurrently — never rewrite a whole lib file).

## 3. Data types

### 3.1 Records and sums

* **Single-constructor records** become a `readonly` interface plus a constructor function with
  the constructor's name. Field names are kept exactly, *including* leading underscores:

  ```ts
  // data Point = Point {_pX, _pY :: Double}
  export interface Point { readonly _pX: number; readonly _pY: number }
  export function Point(_pX: number, _pY: number): Point { return { _pX, _pY }; }
  ```

* **Sum types** become tagged unions on `tag`, with the constructor name as the tag. Positional
  fields are named `_0`, `_1`, ...; record-syntax fields keep their names. Every constructor gets
  a constructor function (or a constant for nullary constructors in a mixed sum):

  ```ts
  // data BoundBox = BoundBox Point Point | NoBox
  export type BoundBox =
    | { readonly tag: "BoundBox"; readonly _0: Point; readonly _1: Point }
    | { readonly tag: "NoBox" };
  export function BoundBox(_0: Point, _1: Point): BoundBox { return { tag: "BoundBox", _0, _1 }; }
  export const NoBox: BoundBox = { tag: "NoBox" };
  ```

  Pattern matching becomes `switch (x.tag)` with an exhaustive `default: return absurd(x)`.

* **Enumerations** (all constructors nullary) become string literal unions of the constructor
  names, plus a `<camelTypeName>Values` array in constructor order (for `Enum`/`Bounded`,
  `[minBound ..]`, `simpleCombo` etc.):

  ```ts
  export type MemoBoxSize = "MemoSmall" | "MemoMedium" | "MemoLarge";
  export const memoBoxSizeValues: readonly MemoBoxSize[] = ["MemoSmall", "MemoMedium", "MemoLarge"];
  ```

  `show` of such a value is the string itself. If the derived `Ord` is relied upon (map keys,
  `sort`, `<`), use `enumComparator(memoBoxSizeValues)` from `@/lib/Data/Ord` — the default
  structural compare would sort them alphabetically.

* **Single-constructor positional types** (`data Foo = Foo Int Text`) become an interface with
  fields `_0`, `_1`, ... and no `tag`, plus the constructor function.
* **Newtypes** are erased to their contents (`type Variant<A> = string`, with phantom parameters
  allowed) when their instances are derived/the same as the contents'. A newtype with its own
  instances (e.g. `newtype Menu a = Menu [[MenuItem a]]` with its own `Functor`) is a
  single-constructor type `{ _0: ... }`. A newtype with a custom `Eq`/`Ord` is a class
  implementing `[EqSym]`/`[OrdSym]` (e.g. `Name`, which uses natural ordering).

* **GADTs / existentials** become tagged unions with `any` for existentially quantified types.

* Haskell `deriving (Eq, Ord)` needs nothing: `equals`/`compare` are structural. Hand-written
  `Eq`/`Ord` instances become `[EqSym]`/`[OrdSym]` methods (classes) or explicit `eqFoo`/`compareFoo`
  functions passed where needed.

* **Tuples** are arrays: `[a, b]` with type `readonly [A, B]` in parameters, `[A, B]` in results.
  `()` is `null` (type `null`). **Lists** are arrays (`readonly A[]` in parameters). Infinite or
  lazy lists must be replaced case by case (generators, functions or bounded arrays).

* **Maybe** is always the explicit `Maybe<A>` from `@/lib/Data/Maybe`, never `A | undefined`
  (nested `Maybe (Maybe a)` occurs and must keep its meaning). **Either** likewise.

### 3.2 Names

* Keep every Haskell identifier. Primes become underscores (`foo'` → `foo_`). Names that clash
  with JavaScript reserved words get a trailing underscore (`delete` → `delete_`, `try` → `try_`,
  `default` → `default_`, `new` → `new_`, `in` → `in_`). Lens names are kept (`pX`, `deltaZoom`).
* Operators get descriptive names; put the Haskell operator in the doc comment
  (`/** Haskell (..=) */ export function textPair(...)`).
* Type class methods keep their names as dictionary members (see §4).

## 4. Type classes → dictionaries

A Haskell class becomes a TypeScript interface whose members are the class methods. Superclasses
become `extends`. Associated types become extra type parameters, or `any` where TypeScript cannot
express them.

```haskell
class HasId a where identifier :: a -> DiagramId
class (Monad (Base v), HasId v) => Viewable v where
  itemTouched :: v -> Scale -> Point -> Bool
  itemView :: v -> Delta v (View v)
```
```ts
export interface HasId<A> { identifier(a: A): DiagramId }
export interface Viewable<V> extends HasId<V> {
  itemTouched(v: V, s: Scale, p: Point): boolean;
  itemView(d: DeltaCtx<V>, v: V): Delta<V, View<V>>;
}
```

* A constrained function takes its dictionaries as the **first** parameters, one per constrained
  type variable, typed as the intersection of its classes:
  `(EntityClass v, HasDiagrams p v) => ...` → `function f<V>(cls: EntityClass<V> & HasDiagrams<any, V>, ...)`.
  Exceptions: `Eq`, `Ord`, `Show` (structural, no dictionary unless the instance is custom), and
  contexts that already carry the dictionary (`DeltaCtx.cls`, `ModelEditCtx.cls`, see §7) — do not
  pass it twice.
* Class methods with no value argument (`reflectiveDefaults :: [a]`, `mempty`) are plain members.
* Instances are exported constants (or functions when the instance has constraints) named
  `ClassName_TypeName`: `export const Reflective_Package = <A>(cls: EntityClass<A>): Reflective<Package<A>> => ({...})`.
* Standard classes use these conventions instead:
  * `ToJSON`/`FromJSON` → one codec `JSON_TypeName` (see §6);
  * `Semigroup`/`Monoid` → `append_TypeName(a, b)` and `mempty_TypeName` (a constant or a function);
  * `Functor` → `fmap_TypeName(f, x)`;
  * `Default` → `def_TypeName` (constant, or a function if it must be fresh, e.g. today's date);
  * `Show` (when used for display) → `show_TypeName(x): string`.

## 5. Lenses (`@/lib/Control/Lens`)

Optics are values: `Lens<S, A>`, `Prism<S, A>`, `Iso<S, A>`, `Traversal<S, A>`, `Getter<S, A>`,
`Fold<S, A>`, `Setter<S, A>` (each also has `T`, `B` parameters for type-changing optics).
Composition `l1 . l2` is `l1.dot(l2)`. Polymorphic standard optics are functions:
`_1()`, `_2()`, `_3()`, `_Just()`, `_Left()`, `_Right()`, `each()` (arrays), `eachMap()`,
`both()`, `at(k)` (maps), `atSet(k)`, `contains(k)`, `ix(k)` (maps), `ixList(i)`, `non(d)`,
`to(f)`, `filtered(p)`, `failing(a, b)`, `singular(t)`, `re(p)`, `from(i)`, `identity()` (`id`).

| Haskell | TypeScript |
|---|---|
| `s ^. l` | `view(l, s)` |
| `s ^? l` | `preview(l, s)` |
| `s ^?! l` | `previewOrThrow(l, s)` |
| `s ^.. l` | `toListOf(l, s)` |
| `l .~ v $ s`, `set l v s` | `set(l, v, s)` |
| `l %~ f $ s`, `over l f s` | `over(l, f, s)` |
| `l ?~ v $ s` | `setJust(l, v, s)` |
| `review l v`, `l # v`, `v ^. re l` | `review(l, v)` |
| `has l s` | `has(l, s)` |
| `use l` / `uses l f` | `use(st, l)` / `uses(st, l, f)` |
| `l .= v` / `assign l v` | `assign(st, l, v)` |
| `l %= f` / `modifying l f` | `modifying(st, l, f)` |
| `l ?= v` | `assignJust(st, l, v)` |
| `l *= n` / `l += n` | `multiplying(st, l, n)` / `adding(st, l, n)` |

`st` is anything with a mutable `state` field (`StateCell<S>`), e.g. a `DeltaCtx` or `ModelEditCtx`.

Define a record lens with `lens(get, (s, v) => ({...s, field: v}))`. A lens on a monomorphic
type is a constant (`export const pX: Lens<Point, number> = lens(...)`). A lens on a polymorphic
type is a function with defaulted type parameters, so it can be used without type arguments
(the result then has `any` in it) or with them for full checking:
`export function diagramContents<V = any>(): Lens<Diagram<V>, M.Map<DiagramId, V>>`, used as
`view(deltaDiagram<V>().dot(diagramContents<V>()), s)` or simply
`view(deltaDiagram().dot(diagramContents()), s)`. Constrained polymorphic lenses take their
dictionary: `diagramList<V = any>(cls: HasId<V>)`. Template-Haskell
`makeLenses` lenses are written out by hand with the generated names.

## 6. JSON (`@/lib/Data/Aeson`)

`ToJSON`/`FromJSON` instances become a `JSONCodec<A>` named `JSON_TypeName` (a function taking
codecs/dictionaries if the instance is constrained):

```ts
export const JSON_Point: J.JSONCodec<Point> = J.codec(
  (p) => J.object([["x", p._pX], ["y", p._pY]]),
  (v) => J.withObject("Point", (o) => Point(J.field(o, "x", J.doubleJ), J.field(o, "y", J.doubleJ)), v),
);
```

| Haskell | TypeScript |
|---|---|
| `object ["k" .= v]` | `J.object([["k", JSON_X.toJSON(v)]])` |
| `v .: "k"` | `J.field(o, "k", codecOrParser)` |
| `v .:? "k"` | `J.fieldMaybe(o, "k", c)` (missing/null → `Nothing`) |
| `v .:? "k" .!= d` | `J.fieldDefault(o, "k", c, d)` |
| `p1 <\|> p2` | `J.alt(p1, p2)(v)` |
| `fail msg` | `J.fail(msg)` (throws `JSONParseError`) |
| `withObject n f v` | `J.withObject(n, f, v)` |
| `Map Text v` | `J.mapJ(J.textKey, c)`; `Map UUID v` → `J.mapJ(J.uuidKey, c)`; other key types → `J.mapPairsJ(ck, cv)` unless the Haskell key type has a `ToJSONKey` text instance |
| `Maybe a` / `[a]` / `(a,b)` / `Either` / `Set` | `J.maybeJ`, `J.listJ`, `J.tuple2J`, `J.eitherJ`, `J.setJ` |
| `Text`, `Bool`, `Int`, `Integer`, `Double`, `Day`, `UUID`, `Colour` | `J.textJ`, `J.boolJ`, `J.intJ`, `J.integerJ`, `J.doubleJ`, `J.dayJ`, `J.uuidJ`, `J.colourJ` |

The JSON produced must be exactly what aeson produces for the same Haskell value (field names,
`null`s, nesting), because the app must open `.dsm` files written by the original program
(see `src/dsm/share/examples/`).

## 7. Monads

Monadic Haskell code becomes direct-style TypeScript. Here is the mapping for each monad in the
code base. **Use these exact shapes.**

### 7.1 Pure monads

* `State s` → a function taking a `StateCell<S>` (`{ state: S }`) as its **first** parameter and
  mutating `cell.state`. `get`/`put`/`modify`/`gets` → `getState`/`putState`/`modifyState`/`gets`
  from Lens.ts, or just `st.state`. `runState act s0` → create a cell, run, read it back.
* `Reader r` → an extra first parameter. `Writer w` → an accumulator parameter.
* `Either e`/`Except e` used for errors → throw an exception class and catch it where Haskell
  matches on the `Either`, **or** return `Either` explicitly when the Haskell API exposes `Either`
  to callers (keep the API shape the callers see).
* `Maybe` monad → early returns.
* `Identity` → plain values.

### 7.2 `IO`

Synchronous TypeScript wherever possible. Actions that block on the user (GTK `dialogRun`, file
choosers, message boxes) and browser APIs that are asynchronous (file system access, clipboard)
become `async` functions returning `Promise`. Inside FRP `reactimate` handlers, start async work
with `void someAsync()`. `unsafePerformIO` globals become module-level variables.
`forkIO` → `queueMicrotask`/`setTimeout(…, 0)`.

### 7.3 Coroutines: `AutoMonad`, `Delta`

`Hades.Abstract.AutoMonad` and `Hades.Abstract.Delta` are already ported (read them!). Stream
processors are **generators**. A `Delta v a` computation is

```ts
export type Delta<V, A> = Generator<DeltaYield, A, any>;
export type DeltaAct<V, A> = (d: DeltaCtx<V>) => Delta<V, A>;   // a first-class Delta action
```

and every Haskell function returning `Delta v a` becomes a generator function whose first
parameter is the context:

```haskell
moveUp :: (Viewable v) => DiagramId -> Delta v ()
moveUp uuid = alterDiagram (diagramMoveUp uuid) uuid
```
```ts
export function* moveUp<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, void> {
  yield* alterDiagram(d, (dg) => diagramMoveUp(uuid, dg), uuid);
}
```

* Call other Delta functions with `yield*`: `const v = yield* itemView(d, item)`.
* `d.state` is the `DeltaState<V>` (a `StateCell`), so `use(d, deltaDiagram.dot(diagramContents))`,
  `assign(d, deltaSelection, s)` work directly.
* `d.cls` is the `Viewable`/`Connectable` dictionary for `V`; class methods are called through it:
  `yield* d.cls.itemView(d, item)`, `d.cls.itemTouched(v, s, p)`.
* Delta functions that never yield are still generator functions (uniformity; callers `yield*`).
* `liftBase act` runs an action of the base monad. When the base monad is a `ModelScript` (all model
  diagrams), `d.base` is the `ModelEditCtx` of the running script: `liftBase (lift (goToEntity x))`
  → `goToEntity(d.base, x)`; `liftBase (openDialog sel v)` → `yield* openDialog(d.base, sel, v)`.
* A `Delta (Action v)` stored in data (`Script`, `viewAction`, menus) is a `DeltaAct`.

### 7.4 `ModelEdit v w a` (defined in `Model.Abstract.PackageTree`)

```ts
export type ModelEdit<V, W, A> = (ctx: ModelEditCtx<V, W>) => A;

export class ModelEditCtx<V, W> implements StateCell<ModelEditState<V>> {
  constructor(
    readonly cls: EntityClass<V>,           // dictionary of the top-level model type
    readonly prsm: Traversal<V, W>,         // the Traversal' v w of the Haskell ModelEdit
    readonly cell: { state: ModelEditState<V> },  // shared, mutable
  ) {}
  get state(): ModelEditState<V> { return this.cell.state; }
  set state(s: ModelEditState<V>) { this.cell.state = s; }
}
```

Functions in `ModelEdit` are direct-style with the context first:
`goToEntity :: ModelId -> ModelEdit v w ()` → `export function goToEntity<V, W>(ctx: ModelEditCtx<V, W>, mId: ModelId): void`.
Errors are thrown as `ModelErrorException` (wrapping the Haskell `ModelError` value);
`try act` → `try_(ctx, (c) => act(c))` which restores `ctx.state` on a user error and returns an
`Either<string, A>`. `withSubtype prsm act` → `withSubtype(ctx, prsm, (c) => ...)` (child context,
composed traversal, **same cell**). `withBaseType act` → `withBaseType(ctx, (c) => ...)`.
`runModelEdit prsm st act` keeps its Haskell signature and returns
`Either<ModelError, [ModelUpdate<V, A>, ModelEditState<V>]>`.

### 7.5 `UserScript` / `ModelScript` (defined in `Model.Abstract.DiagramType`)

Scripts are generators that yield `UserScriptFunctor` instructions to the GUI interpreter and are
resumed with the instruction's result:

```ts
export type UserScript<P, V, A> = Generator<UserScriptFunctor<P, V>, A, any>;
export type ModelScript<P, V, A> = UserScript<P, V, A>;
/** A first-class `ModelScript p v w a` value. */
export type ModelScriptAct<P, V, W, A> = (ctx: ModelEditCtx<V, W>) => ModelScript<P, V, A>;
```

* `lift act` (a ModelEdit inside a script) is a direct call with the same context: `goToEntity(ctx, x)`.
* Instructions: `const r = yield* openDialog(ctx, sel, v)`, `yield* openProperties(ctx, uuid)`,
  `yield* openDiagram(ctx, mId)`, `yield* setModelSelection(ctx, s)`, `yield* performIO(ctx, io)` …
* `promoteScript prsm script` → `promoteScript(prsm, act)` returning a `ModelScriptAct` whose
  context is `withSubtype`-derived from the caller's.
* `EntityMenu`, `ActivationScript` hold `ModelScriptAct` values.
* The interpreter may re-run a script from its start, replaying earlier instruction results, to
  emulate Haskell's multi-shot continuations (the dialog *Apply* button). So scripts must be
  deterministic apart from their instructions: do I/O only through `performIO`.

### 7.6 Free-standing monad stacks

Other `StateT`/`ReaderT` stacks: thread the state through a mutable context object passed first.
Name it after the Haskell type and document the mapping in the module header.

## 8. FRP (`@/lib/Reactive/Banana`)

`Event<A>` and `Behavior<A>` follow reactive-banana semantics exactly (read the module header).
`MomentIO a` actions are ordinary **synchronous** functions that build network nodes — never
`await` in them.

| Haskell | TypeScript |
|---|---|
| `f <$> e`, `fmap f e` | `B.mapE(f, e)` |
| `f <$> b`, `pure v`, `bf <*> bx`, `liftA2 f a b` | `B.mapB(f, b)`, `B.pureB(v)`, `B.applyB(bf, bx)`, `B.liftA2B(f, a, b)` |
| `bf <@> e`, `b <@ e` | `B.apply(bf, e)`, `B.tag(b, e)` |
| `never`, `unionWith`, `unions`, `filterE`, `filterJust`, `filterApply`, `whenE`, `split` | same names (`B.never()`) |
| `stepper`, `accumE`, `accumB`, `mapAccum`, `switchB`, `execute`, `observeE`, `once` | same names, no monad |
| `switchE ee` / `switchE1 e0 ee` | `B.switchE(ee)` / `B.switchE(ee, e0)` |
| `valueB b` / `valueBLater b` | `B.valueB(b)` / `B.valueBLater(b)` (returns a thunk) |
| `newEvent` | `const [e, fire] = B.newEvent<A>()` |
| `reactimate`, `reactimate'`, `reactimate_`, `reactimate_'` | `B.reactimate`, `B.reactimatePrime`, `B.reactimate_`, `B.reactimatePrime_` (the `_` variants return the stop action) |
| `changes b`, `Future` | `B.changes(b)`, `B.Future<A>` (`fut.get()` after the moment), `B.mapFuture` |
| `compile`, `actuate`, `pause` | same |
| `fromPoll io` | `B.fromPoll(io)` |
| `Event` `Semigroup` (`e1 <> e2`) | `B.unionWith(append, e1, e2)` with the element type's append |

**Recursive definitions** (`mdo`, `rec`): use `B.lazyE(() => e)` / `B.lazyB(() => b)` for forward
references and give such variables explicit types:

```ts
const feedbackRef: B.Behavior<number> = B.lazyB(() => feedback);
const output = renderSomething(feedbackRef);
const feedback: B.Behavior<number> = B.stepper(0, output);
```

The library resolves lazy references at the end of the current network-building phase. Never
sample (`valueB`) a lazy reference before its target is defined.

## 9. Arrows (`Gadget`)

`Gadget` is an arrow (`Reactive.Banana.GadgetPrimitives`). Arrow combinators are functions
exported from `GadgetPrimitives.ts` (re-exported by `ArrowDialog.ts`):

| Haskell | TypeScript |
|---|---|
| `arr f` | `arr(f)` |
| `id`, `returnA` | `gId()` |
| `g1 >>> g2 >>> g3` | `gPipe(g1, g2, g3)` |
| `g1 <<< g2`, `g1 . g2` | `gDot(g1, g2)` |
| `g1 *** g2` | `gProd(g1, g2)` |
| `g1 &&& g2` | `gFanout(g1, g2)` |
| `first g` / `second g` | `gFirst(g)` / `gSecond(g)` |
| `loop g` | `gLoop(g)` |
| `fmap f g`, `f <$> g` | `gFmap(f, g)` |
| `pure v` | `gPure(v)` |
| `gf <*> gx`, `liftA2 f g1 g2` | `gAp(gf, gx)`, `gLiftA2(f, g1, g2)` |

`proc` notation must be desugared by hand into these combinators (tuples carry the variables in
scope). Keep the original `proc` block in a comment above the desugared code.

## 10. GTK, Cairo and Pango

The `GI.*` libraries are replaced by a web toolkit in `src/lib/GI/` (React + Radix primitives
rendered from retained widget objects). **Read `src/lib/GI/Gtk/README.md` before porting any
module that imports `GI.*`.** Summary of the rules:

| Haskell | TypeScript |
|---|---|
| `import qualified GI.Gtk as Gtk` (also `Data.GI.Gtk as MV`) | `import * as Gtk from "@/lib/GI/Gtk"` (`MV.` functions also live in `Gtk`) |
| `GI.Gdk`, `GI.GdkPixbuf` | `import * as Gdk from "@/lib/GI/Gdk"` |
| `GI.Gio` | `import * as Gio from "@/lib/GI/Gio"` |
| `GI.Cairo.Render` (+ `.Connector`, `GI.Cairo`) | `import * as Cairo from "@/lib/GI/Cairo"` |
| `GI.Pango`, `GI.PangoCairo` | `import * as Pango from "@/lib/GI/Pango"` |
| `Gtk.new Gtk.X [#a := v]` / `Gtk.set w [#a := v]` / `Gtk.get w #a` | `Gtk.new_(Gtk.X, { a: v })` / `Gtk.set(w, { a: v })` / `w.a` (or the `xGetA` function) |
| `Gtk.on w #sig f` / `Gtk.after w #sig f` | the named `Gtk.onXSig` / `Gtk.afterXSig` function, or `w.connect("sig", f[, true])` |
| `Maybe w` widget argument | `w \| null` |
| `Gtk.dialogRun d`, `Gtk.nativeDialogRun f` | `await Gtk.dialogRun(d)` → `number`; the enclosing IO function becomes `async` |
| file paths | virtual paths, `async` I/O from `@/lib/System/IO` (README "Files") |

* **Blocking I/O becomes async; MomentIO stays synchronous.** An `IO` action that waits for the
  user (dialog run, file read/write, file chooser) returns a `Promise`, and so do its callers
  in IO. A `MomentIO` computation cannot await: where the Haskell runs blocking IO inside
  `MomentIO` (or `liftIO` in network construction), create an event with `B.newEvent()`, start the
  async action, and fire the event from its `.then`; or move the call into a `reactimate`
  handler (handlers may be `async`; their Promise is ignored, so catch errors and show them
  with `errorBox`). Document every such restructuring in a comment beginning `// Web:`.
* `unsafePerformIO` around a dialog (e.g. `cannotHappen`) shows the dialog without waiting
  (`void errorBox(...)`) and returns the value.
* Event signal handlers must stay synchronous (they return the "stop propagation" boolean).
* CSS: the GTK CSS shipped with the original (`banana-gtk.css`, `hades-gtk.css`) is already in
  `src/lib/GI/Gtk/theme.css`; `cssProviderLoadFromPath` is a no-op. Style classes added with
  `styleContextAddClass` map to the same CSS class names. If a module needs styling that is not
  there, put it in a `.css` file next to the module and `import "./X.css"`.
* Icons: icon names resolve through `Gtk.iconThemeGetDefault()` / `Gtk.iconUrl` (Adwaita
  symbolic + the bundled `hicolor`/Diametric themes from `share/`).
* Prefer browser-native behaviour where the desktop original used native facilities (README
  "Windows, actions and menus": history, pickers, downloads, keyboard shortcuts, `beforeunload`
  via `Gtk.windowSetUnloadGuard`). Mark each such deviation with a `// Web:` comment.

## 11. Quality bar

* `npx tsc --noEmit -p .` must report **no errors in your files**. (Errors in files owned by other
  agents may appear while they are working; ignore those.)
* No `// @ts-ignore`. Use `any` sparingly and only where Haskell type-level features (associated
  types, rank-n types, existentials) cannot be expressed.
* Port every exported and internal definition; do not drop "unused" code, debugging helpers or
  comments. If something genuinely cannot work in a browser, keep the function with a
  browser-appropriate implementation and explain in a comment.
* Pure modules get a few `vitest` tests next to them (`Foo.test.ts`) for tricky logic
  (parsers, geometry, JSON round trips against the example files).
* Do not run `git` commands; the coordinator commits.

## 12. Cross-module notes from completed ports

Decisions made while porting that other modules depend on. Read before importing these modules.

* **Reflective instances** (`Model.Reflection.Reflective`): `variantUserLabel` is a *required*
  member of `Reflective<A>`; instances that do not override it must set
  `variantUserLabel: defaultVariantUserLabel`. `reflectiveSet(st, a)` takes a
  `StateCell<ExtensionValues>` first: `runState (reflectiveSet v) exts` →
  `const st = { state: exts }; const v2 = cls.reflectiveSet(st, v); /* st.state = leftovers */`.
  Helpers take the dictionary first: `reflectiveNames(cls)`, `reflection(cls, ...)`.
* **ExtValue** (`Model.Reflection.Values`): always build values with the constructor functions
  (`ExtNone`, `ExtBool(b)`, `ExtText(t)`, ...): they carry the Haskell `Ord` on their prototype so
  maps keyed by ExtValue order correctly. Never spread or hand-write ExtValue literals.
  `JSON_ExtensionValues` is the codec for `Map FieldId ExtValue`.
* **Variant** is an erased `string`; `Variant(t)`, `variantCoerce` are identities; `variantName()`
  returns the Iso; `JSON_Variant`, `JSONKey_Variant`.
* `getReferenceValues` and `ReferenceValues` live in `Model/Abstract/Properties`.
* **Geometry**: `Line` is `{_0, _1, _2}` built by `Line(p, vx, vy)`; the `Intersect` class is a
  dictionary (`Intersect_Line`, `Intersect_List(cls)`), used as `intersectPoint(cls, shape, p1, p2)`.
  Constraint functions are overloaded: `constrainBox(b)` returns a `Constraint`, `constrainBox(b, p)` a Point.
* **Connections**: `ConnectorEnd` values must be built with `Unconnected(...)`/`Connected(...)`
  (custom equality on the object). `connectable(d)` returns `d.cls` as `Connectable<V>`;
  `connectableDefaults<V>()` gives the class default methods to spread into instances.
* **Primitives**: action arguments are `(d, v) => Delta<V, A>` (`withItem`, `modifyItem`).
* Constrained Haskell *values* such as `alignLeft :: Connectable v => Action v` are zero-argument
  generic functions in TS (`alignLeft<V>()`, `alignmentTools<V>()`).
* **Commands** (`Hades.Abstract.Commands`): `KeyCommands<V> = M.Map<readonly [Modifiers, string], DeltaAct<V, void>>`;
  `processAction(d, areaBox: (p1, p2) => Paint, keyCommands, act)`; handles are
  `Handle<V> = (d, menu, pt, act) => Delta<V, View<V>>`; `simpleHandle(d, msg, menu, handle, [pt, updateF])`,
  `lineHandles(d, line, handle, updateF, updateFinal)`. Pure callbacks that close over the class
  dictionary in Haskell take it first (`offsetF(cls, v, outer)`); `x -> Delta v a` arguments are `(d, x) => Delta<V, A>`.
* **BasicShapes**: `ShapeClass<S>` extends `J.JSONCodec<S>`; instances `ShapeClass_Rectangle`,
  `BoxShapeClass_Rectangle`, ... `LineShapeClass_LineShape`; shape newtypes are records with their
  Haskell field (`{ _rectangleShape: BoundBox }`) with constant isos (`rectangleShape`).
* `src/hades/src/Hades/Abstract/Commands.test.ts` shows how to drive a diagram through
  `startDelta`/`applyDelta`/`runInner` — a useful template for testing diagram code.
* **banana-ui base** (`GadgetPrimitives`/`ArrowDialog`): nullary Gadget constructors and plain
  gadget values are zero-argument functions (`Null()`, `getEnv()`, `simpleTextBox()`,
  `tickBox()`, `displayText()`, `colourBox()`, ...). Primed type names become `Gadget_`,
  `GadgetF_`, `Dialog_`, `DialogSelector_`. Curried functions stored in constructors are
  uncurried (`Validate._0(e, i, o)`; `DialogSelector` is `(e, i) => Maybe<Dialog>`).
  `Show`/`Read`/`Enum` arguments are explicit: `typedTextBox(show, read)`, `simpleCombo(xs, show)`,
  `boundedCombo(values, show)`, `rangeCombo(enumDict, [x1, x2], show)`. `ButtonIO` actions may
  return a Promise. `disableApply`/`disableApply1` and the constructors come from `GadgetPrimitives`.
* **Common**: `reactimate1(e)` / `reactimate1_(e)` (for `reactimate1'`) return deferred stop
  actions; `textPrism(show, read)` and `textPrismInt`/`textPrismDouble`/`textPrismInteger`;
  `Colour` is the lib `Colour` class (`Colour()`/`getColour()` are identities).
* **Data.UUID.Generate**: `Generator` is an immutable deterministic generator (so replaying a
  script yields the same new ids). The class name shadows TypeScript's `Generator` type: import it
  as `import { Generator as UUIDGenerator } from ".../Data/UUID/Generate"` in modules that also
  write generator functions.
* **Table** (`Reactive.Banana.Table`): `EditBool`, `EditNote`, `EditColour`, `TableDelete`,
  `TableShuffle` are constants; `enumField(values, show)`; `TableColumn` is `{ _0 }`.
* **Data files** (`@/lib/System/Paths`): `getDataDir(pkg)` returns a virtual source path such as
  `/src/dsm/share`; `getDataFileName(pkg, rel)` likewise; convert to a URL with
  `dataFileUrl(path)`; `fetchDataFile(pkg, rel)`, `listDataFiles(pkg, dirPrefix)` (sorted,
  relative to the data dir). Icon themes accept these paths in their search path.
* **XML** (`@/lib/Text/XML/Light`, `.../Light/Types`, `.../Light/Cursor`): ports of the `xml`
  package. `QName` values carry Haskell Eq/Ord on their prototype — build with `QName(...)`, never
  spread. `Proc`, `Input` (`parseXML`), `Output` (`showTopElement`) and `Text.XML.Light.Lens` are
  still to be added (by whoever ports `Model.Report.Docx*`) next to them.
* **Walkable** (`Model.Report.Walkable`): instance dictionaries `Walkable_<A>_<B>` (`[Inline]` is
  `InlineList`): `walk(w, f, b)`, `walkM(w, f, b)`, `query(w, monoid, f, b)`; `Monoid_List<A>()`.
* **EditLock**: `tryEditLock(path, isWritable?)` returns a Promise; await `dropEditLock(l)`.
  **Autosave**: storage functions are async; `autosaveProcess(codec, appName, interval, copies)`
  returns its writer synchronously.
* `@/lib/System/IO` provides virtual file paths (`/handle/...`, `/upload/...`, `/download/...`,
  `/builtin/...`): `readFileText`, `readFileBytes`, `writeFileData`, `takeFileName` etc.

### Model.Abstract.{Properties,Import,ModelExport}, Model.Query.Base (E2)

* `Codec.Xlsx` → `src/lib/Codec/Xlsx.ts`: data model only (`Xlsx`, `Worksheet`, `CellMap` keyed by
  `[row, col]`, `Cell`, `CellValue` constructors, lenses `xlSheets`, `wsCells`, `cellValue`, ...).
  Reading/writing `.xlsx` files (`toXlsx`/`fromXlsx`) is to be added there by whoever ports the
  first module that needs it (Model.GI.Export / Model.Matrices.Excel), additively.
* `QueryStep<V>` = `{ runStep(outers, model, inputs) }` built with `QueryStep(f)`;
  `append_/mempty_/mconcat_QueryStep`, `noStep`, `inStep(q1, q2)`. Constrained steps take `cls`
  first even when unused: `step(cls, rels)`, `filterStep(cls, p)`, `parentStep(cls)`,
  `childrenStep(cls)`, `filterVariants(cls, vars)`, `followArrows(cls, vars, rel1, rel2)`.
  `Query<V>` is opaque (`compileQuery`, `runQuery`, `subQuery`).
* Properties: `putReferenceValues(ctx, e, refs)`; `refPicker(cls, single, pred)`,
  `modelFilter(cls, pred, model)`, `showEntitySet(cls, model, s)`; `reflectiveDialog(cls, menuF)`
  returns `(model, sel) => Maybe<Dialog>`; `modelItemSpecifier(cls, predicate, menuF)` /
  `modelSubsetSpecifier(...)` with a curried predicate `(model) => (entity) => boolean`.
* ModelExport: `ExportList<V>` erased to `readonly Entity<V>[]`; codecs `JSON_ExportList(cls)`,
  `JSON_ModelExport(cls)` (use `cls.entityJ`); `ModelExport(contents, rels, fields, refTypes, exts)`;
  edits `makeExport(ctx, items, meta)`, `importEntities(ctx, location, nr, vs)`,
  `importMetadata(ctx, export)`.
* Import: `NameClashAction` string enum; `importExcel(ctx, clash, book, template)`.
* Tests: `src/testSetup.ts` registers structural equality for `HMap`/`HSet` globally, so
  `toEqual` on maps/sets works in every test file.
