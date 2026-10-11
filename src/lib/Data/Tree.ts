/** Haskell `Data.Tree`: rose trees. */

export interface Tree<A> {
  readonly rootLabel: A;
  readonly subForest: Forest<A>;
}
export type Forest<A> = readonly Tree<A>[];

export function Node<A>(rootLabel: A, subForest: Forest<A> = []): Tree<A> {
  return { rootLabel, subForest };
}

export function fmapTree<A, B>(f: (a: A) => B, t: Tree<A>): Tree<B> {
  return Node(f(t.rootLabel), t.subForest.map((c) => fmapTree(f, c)));
}
export function fmapForest<A, B>(f: (a: A) => B, ts: Forest<A>): Tree<B>[] {
  return ts.map((t) => fmapTree(f, t));
}

/** Pre-order flattening. */
export function flatten<A>(t: Tree<A>): A[] {
  const r: A[] = [];
  const go = (n: Tree<A>) => {
    r.push(n.rootLabel);
    n.subForest.forEach(go);
  };
  go(t);
  return r;
}

export function flattenForest<A>(ts: Forest<A>): A[] {
  return ts.flatMap(flatten);
}

export function levels<A>(t: Tree<A>): A[][] {
  const r: A[][] = [];
  let cur: Tree<A>[] = [t];
  while (cur.length > 0) {
    r.push(cur.map((n) => n.rootLabel));
    cur = cur.flatMap((n) => [...n.subForest]);
  }
  return r;
}

/** `foldTree f t` where `f label childResults`. */
export function foldTree<A, B>(f: (a: A, bs: B[]) => B, t: Tree<A>): B {
  return f(t.rootLabel, t.subForest.map((c) => foldTree(f, c)));
}

export function unfoldTree<B, A>(f: (b: B) => [A, B[]], b: B): Tree<A> {
  const [a, bs] = f(b);
  return Node(a, bs.map((x) => unfoldTree(f, x)));
}
export function unfoldForest<B, A>(f: (b: B) => [A, B[]], bs: readonly B[]): Tree<A>[] {
  return bs.map((b) => unfoldTree(f, b));
}

/** Render as an ASCII drawing (Haskell `drawTree`). */
export function drawTree(t: Tree<string>): string {
  return draw(t).join("\n");
}
export function drawForest(ts: Forest<string>): string {
  return ts.map((t) => drawTree(t) + "\n").join("\n");
}
function draw(t: Tree<string>): string[] {
  const lines = t.rootLabel.split("\n");
  const drawSub = (ts: Forest<string>): string[] => {
    if (ts.length === 0) return [];
    if (ts.length === 1) return ["|", ...shift("`- ", "   ", draw(ts[0]))];
    return ["|", ...shift("+- ", "|  ", draw(ts[0])), ...drawSub(ts.slice(1))];
  };
  const shift = (first: string, other: string, ls: string[]) =>
    ls.map((l, i) => (i === 0 ? first : other) + l);
  return [...lines, ...drawSub(t.subForest)];
}

/** Traverse a tree in pre-order with an effectful (synchronous) action. */
export function forTree<A>(t: Tree<A>, f: (a: A) => void): void {
  f(t.rootLabel);
  for (const c of t.subForest) forTree(c, f);
}
