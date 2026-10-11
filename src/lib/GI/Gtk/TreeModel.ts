/**
 * GTK tree models for the web toolkit: `TreePath`, `TreeIter`, `ListStore`/`TreeStore` (columns
 * of GValues), the gi-gtk-hs typed stores `SeqStore`/`ForestStore` (`Data.GI.Gtk.ModelView`)
 * and `TreeModelSort`.
 *
 * All models share one representation: a forest of `RowNode`s whose `data` is either an array
 * of column values (GValue stores) or an arbitrary JavaScript value (typed stores). Iterators
 * point directly at nodes; paths are computed by walking up the tree.
 */
import { GObject, type SignalHandlerId } from "./Core";
import type { Tree, Forest } from "../../Data/Tree";
import { Node as TNode } from "../../Data/Tree";

// ---------------------------------------------------------------------------------------------
// Paths and iterators

/** A path: list of child indices from the root. The empty path is the "null"/root path. */
export class TreePath {
  constructor(public indices: number[]) {}
  toString(): string {
    return this.indices.join(":");
  }
}
export function treePathNew(): TreePath {
  return new TreePath([]);
}
export function treePathNewFromIndices(ix: readonly number[]): TreePath {
  return new TreePath([...ix]);
}
export function treePathNewFromString(s: string): TreePath {
  return new TreePath(s === "" ? [] : s.split(":").map((x) => parseInt(x, 10)));
}
export function treePathNewFirst(): TreePath {
  return new TreePath([0]);
}
/** `treePathGetIndices` returns `Maybe [Int32]` in gi-gtk; here `number[] | null`. */
export function treePathGetIndices(p: TreePath): number[] | null {
  return p.indices.length === 0 ? null : [...p.indices];
}
export function treePathToString(p: TreePath): string {
  return p.toString();
}
export function treePathCopy(p: TreePath): TreePath {
  return new TreePath([...p.indices]);
}
export function treePathUp(p: TreePath): boolean {
  if (p.indices.length === 0) return false;
  p.indices.pop();
  return p.indices.length > 0;
}
export function treePathDown(p: TreePath): void {
  p.indices.push(0);
}
export function treePathNext(p: TreePath): void {
  if (p.indices.length > 0) p.indices[p.indices.length - 1]++;
}
export function treePathPrev(p: TreePath): boolean {
  const n = p.indices.length;
  if (n === 0 || p.indices[n - 1] === 0) return false;
  p.indices[n - 1]--;
  return true;
}
export function treePathGetDepth(p: TreePath): number {
  return p.indices.length;
}
export function treePathAppendIndex(p: TreePath, i: number): void {
  p.indices.push(i);
}
export function treePathCompare(a: TreePath, b: TreePath): number {
  const n = Math.min(a.indices.length, b.indices.length);
  for (let i = 0; i < n; i++) if (a.indices[i] !== b.indices[i]) return a.indices[i] < b.indices[i] ? -1 : 1;
  return a.indices.length === b.indices.length ? 0 : a.indices.length < b.indices.length ? -1 : 1;
}
export function treePathIsAncestor(a: TreePath, descendant: TreePath): boolean {
  return a.indices.length < descendant.indices.length && a.indices.every((x, i) => descendant.indices[i] === x);
}

/** A row node. */
export class RowNode {
  parent: RowNode | null = null;
  children: RowNode[] = [];
  constructor(public data: any) {}
  index(): number {
    return this.parent ? this.parent.children.indexOf(this) : -1;
  }
}

/** Iterators reference a node of a specific model. */
export class TreeIter {
  constructor(public model: TreeModel | null, public node: RowNode | null) {}
}
export function treeIterCopy(it: TreeIter): TreeIter {
  return new TreeIter(it.model, it.node);
}

/** A boxed value in a column store (`GValue`). */
export interface GValue {
  readonly value: any;
}
export function toGValue(v: any): GValue {
  return { value: v };
}
/** `fromGValue`: strings come back nullable (`string | null`), as gi-gtk's `Maybe Text`. */
export function fromGValue<A = any>(g: GValue): A {
  return (g ? g.value : null) as A;
}
export type GType = "gchararray" | "guint" | "gint" | "gboolean" | "gdouble" | "GdkPixbuf" | "gpointer";
export const gtypeString: GType = "gchararray";
export const gtypeUInt: GType = "guint";
export const gtypeInt: GType = "gint";
export const gtypeBoolean: GType = "gboolean";
export const gtypeDouble: GType = "gdouble";
export const gtypePixbuf: GType = "GdkPixbuf";

// ---------------------------------------------------------------------------------------------
// TreeModel base

/** The interface the tree view renders from. */
export abstract class TreeModel extends GObject {
  /** Monotonic change counter, used by views to re-render. */
  version = 0;
  abstract roots(): RowNode[];
  abstract nColumns(): number;
  /** The value displayed for a column (GValue stores) — typed stores return their row. */
  abstract columnValue(node: RowNode, col: number): any;

  bump(): void {
    this.version++;
    this.emit("model-changed");
  }

  nodeAt(path: TreePath): RowNode | null {
    let list = this.roots();
    let node: RowNode | null = null;
    for (const i of path.indices) {
      node = list[i] ?? null;
      if (!node) return null;
      list = node.children;
    }
    return node;
  }
  pathOf(node: RowNode): TreePath {
    const ix: number[] = [];
    let n: RowNode | null = node;
    while (n) {
      const p: RowNode | null = n.parent;
      ix.unshift(p ? p.children.indexOf(n) : this.roots().indexOf(n));
      n = p;
    }
    return new TreePath(ix);
  }
  iter(node: RowNode | null): TreeIter {
    return new TreeIter(this, node);
  }
  siblings(node: RowNode): RowNode[] {
    return node.parent ? node.parent.children : this.roots();
  }
}

export function treeModelGetIter(m: TreeModel, p: TreePath): [boolean, TreeIter] {
  const n = m.nodeAt(p);
  return [n !== null && p.indices.length > 0, m.iter(n)];
}
export function treeModelGetIterFirst(m: TreeModel): [boolean, TreeIter] {
  const r = m.roots();
  return [r.length > 0, m.iter(r[0] ?? null)];
}
export function treeModelGetIterFromString(m: TreeModel, s: string): [boolean, TreeIter] {
  return treeModelGetIter(m, treePathNewFromString(s));
}
export function treeModelGetPath(m: TreeModel, it: TreeIter): TreePath {
  return it.node ? m.pathOf(it.node) : new TreePath([]);
}
/** Advances the iterator in place; returns false at the end. */
export function treeModelIterNext(m: TreeModel, it: TreeIter): boolean {
  if (!it.node) return false;
  const sib = m.siblings(it.node);
  const i = sib.indexOf(it.node);
  if (i < 0 || i + 1 >= sib.length) {
    it.node = null;
    return false;
  }
  it.node = sib[i + 1];
  return true;
}
export function treeModelIterPrevious(m: TreeModel, it: TreeIter): boolean {
  if (!it.node) return false;
  const sib = m.siblings(it.node);
  const i = sib.indexOf(it.node);
  if (i <= 0) {
    it.node = null;
    return false;
  }
  it.node = sib[i - 1];
  return true;
}
export function treeModelIterNthChild(m: TreeModel, parent: TreeIter | null, n: number): [boolean, TreeIter] {
  const list = parent && parent.node ? parent.node.children : m.roots();
  const c = list[n] ?? null;
  return [c !== null, m.iter(c)];
}
export function treeModelIterChildren(m: TreeModel, parent: TreeIter | null): [boolean, TreeIter] {
  return treeModelIterNthChild(m, parent, 0);
}
export function treeModelIterHasChild(_m: TreeModel, it: TreeIter): boolean {
  return !!it.node && it.node.children.length > 0;
}
export function treeModelIterNChildren(m: TreeModel, it: TreeIter | null): number {
  return it && it.node ? it.node.children.length : m.roots().length;
}
export function treeModelIterParent(m: TreeModel, child: TreeIter): [boolean, TreeIter] {
  const p = child.node?.parent ?? null;
  return [p !== null, m.iter(p)];
}
export function treeModelGetValue(m: TreeModel, it: TreeIter, col: number): GValue {
  return toGValue(it.node ? m.columnValue(it.node, col) : null);
}
export function treeModelGetNColumns(m: TreeModel): number {
  return m.nColumns();
}
export function treeModelForeach(m: TreeModel, f: (m: TreeModel, path: TreePath, it: TreeIter) => boolean): void {
  const go = (nodes: RowNode[]): boolean => {
    for (const n of nodes) {
      if (f(m, m.pathOf(n), m.iter(n))) return true;
      if (go(n.children)) return true;
    }
    return false;
  };
  go(m.roots());
}

export function afterTreeModelRowChanged(m: TreeModel, cb: (p: TreePath, it: TreeIter) => void): SignalHandlerId {
  return m.connect("row-changed", cb, true);
}
export function afterTreeModelRowInserted(m: TreeModel, cb: (p: TreePath, it: TreeIter) => void): SignalHandlerId {
  return m.connect("row-inserted", cb, true);
}
export function afterTreeModelRowDeleted(m: TreeModel, cb: (p: TreePath) => void): SignalHandlerId {
  return m.connect("row-deleted", cb, true);
}
export const onTreeModelRowChanged = (m: TreeModel, cb: (p: TreePath, it: TreeIter) => void) => m.connect("row-changed", cb);
export const onTreeModelRowInserted = (m: TreeModel, cb: (p: TreePath, it: TreeIter) => void) => m.connect("row-inserted", cb);
export const onTreeModelRowDeleted = (m: TreeModel, cb: (p: TreePath) => void) => m.connect("row-deleted", cb);

// ---------------------------------------------------------------------------------------------
// Column stores (GtkListStore / GtkTreeStore)

export class TreeStore extends TreeModel {
  private rootNodes: RowNode[] = [];
  constructor(readonly types: readonly GType[]) {
    super();
  }
  roots(): RowNode[] {
    return this.rootNodes;
  }
  nColumns(): number {
    return this.types.length;
  }
  columnValue(node: RowNode, col: number): any {
    return (node.data as any[])[col];
  }
  insertNode(parent: RowNode | null, pos: number, data: any): RowNode {
    const n = new RowNode(data);
    n.parent = parent;
    const list = parent ? parent.children : this.rootNodes;
    const p = pos < 0 || pos > list.length ? list.length : pos;
    list.splice(p, 0, n);
    this.bump();
    this.emit("row-inserted", this.pathOf(n), this.iter(n));
    return n;
  }
  removeNode(n: RowNode): void {
    const path = this.pathOf(n);
    const list = this.siblings(n);
    const i = list.indexOf(n);
    if (i >= 0) list.splice(i, 1);
    n.parent = null;
    this.bump();
    this.emit("row-deleted", path);
  }
  clear(): void {
    const old = this.rootNodes;
    this.rootNodes = [];
    for (let i = old.length - 1; i >= 0; i--) {
      this.bump();
      this.emit("row-deleted", new TreePath([i]));
    }
  }
}
export class ListStore extends TreeStore {}

export function treeStoreNew(types: readonly GType[]): TreeStore {
  return new TreeStore(types);
}
export function listStoreNew(types: readonly GType[]): ListStore {
  return new ListStore(types);
}
/** `treeStoreInsert store parent pos` returns the new row's iterator. */
export function treeStoreInsert(s: TreeStore, parent: TreeIter | null, pos: number): TreeIter {
  const n = s.insertNode(parent?.node ?? null, pos, new Array(s.types.length).fill(null));
  return s.iter(n);
}
export function treeStoreAppend(s: TreeStore, parent: TreeIter | null): TreeIter {
  return treeStoreInsert(s, parent, -1);
}
export function treeStoreSet(s: TreeStore, it: TreeIter, cols: readonly number[], values: readonly GValue[]): void {
  if (!it.node) return;
  const data = [...(it.node.data as any[])];
  cols.forEach((c, i) => {
    data[c] = values[i]?.value ?? null;
  });
  it.node.data = data;
  s.bump();
  s.emit("row-changed", s.pathOf(it.node), it);
}
export function treeStoreSetValue(s: TreeStore, it: TreeIter, col: number, v: GValue): void {
  treeStoreSet(s, it, [col], [v]);
}
/** Removes the row; the iterator moves to the next sibling. Returns whether it is valid. */
export function treeStoreRemove(s: TreeStore, it: TreeIter): boolean {
  if (!it.node) return false;
  const n = it.node;
  const sib = s.siblings(n);
  const next = sib[sib.indexOf(n) + 1] ?? null;
  s.removeNode(n);
  it.node = next;
  return next !== null;
}
export function treeStoreClear(s: TreeStore): void {
  s.clear();
}
export const listStoreInsert = (s: ListStore, pos: number): TreeIter => treeStoreInsert(s, null, pos);
export const listStoreAppend = (s: ListStore): TreeIter => treeStoreInsert(s, null, -1);
export const listStoreSet = treeStoreSet;
export const listStoreSetValue = treeStoreSetValue;
export const listStoreRemove = treeStoreRemove;
export const listStoreClear = treeStoreClear;

// ---------------------------------------------------------------------------------------------
// Typed stores (Data.GI.Gtk.ModelView)

/** `SeqStore a`: a list of values. */
export class SeqStore<A> extends TreeModel {
  private rows: RowNode[] = [];
  constructor(initial: readonly A[]) {
    super();
    this.rows = initial.map((v) => new RowNode(v));
  }
  roots(): RowNode[] {
    return this.rows;
  }
  nColumns(): number {
    return 1;
  }
  columnValue(node: RowNode): any {
    return node.data;
  }
  getValue(n: number): A {
    const r = this.rows[n];
    if (!r) throw new Error("seqStoreGetValue: index out of range");
    return r.data as A;
  }
  setValue(n: number, v: A): void {
    const r = this.rows[n];
    if (!r) return;
    r.data = v;
    this.bump();
    this.emit("row-changed", new TreePath([n]), this.iter(r));
  }
  insert(n: number, v: A): number {
    const p = n < 0 || n > this.rows.length ? this.rows.length : n;
    const node = new RowNode(v);
    this.rows.splice(p, 0, node);
    this.bump();
    this.emit("row-inserted", new TreePath([p]), this.iter(node));
    return p;
  }
  remove(n: number): void {
    if (n < 0 || n >= this.rows.length) return;
    this.rows.splice(n, 1);
    this.bump();
    this.emit("row-deleted", new TreePath([n]));
  }
  clear(): void {
    for (let i = this.rows.length - 1; i >= 0; i--) this.remove(i);
  }
  toList(): A[] {
    return this.rows.map((r) => r.data as A);
  }
}
export function seqStoreNew<A>(initial: readonly A[]): SeqStore<A> {
  return new SeqStore(initial);
}
export function seqStoreGetValue<A>(s: SeqStore<A>, n: number): A {
  return s.getValue(n);
}
export function seqStoreSetValue<A>(s: SeqStore<A>, n: number, v: A): void {
  s.setValue(n, v);
}
export function seqStoreInsert<A>(s: SeqStore<A>, n: number, v: A): void {
  s.insert(n, v);
}
export function seqStoreAppend<A>(s: SeqStore<A>, v: A): number {
  return s.insert(-1, v);
}
export function seqStorePrepend<A>(s: SeqStore<A>, v: A): void {
  s.insert(0, v);
}
export function seqStoreRemove<A>(s: SeqStore<A>, n: number): void {
  s.remove(n);
}
export function seqStoreClear<A>(s: SeqStore<A>): void {
  s.clear();
}
export function seqStoreToList<A>(s: SeqStore<A>): A[] {
  return s.toList();
}
export function seqStoreGetSize<A>(s: SeqStore<A>): number {
  return s.roots().length;
}
export function seqStoreIterToIndex<A>(it: TreeIter): number {
  return it.node ? it.node.index() < 0 ? (it.model ? it.model.roots().indexOf(it.node) : -1) : it.node.index() : -1;
}

/** `ForestStore a`: a forest of values. */
export class ForestStore<A> extends TreeModel {
  private rootNodes: RowNode[];
  constructor(initial: Forest<A>) {
    super();
    this.rootNodes = initial.map((t) => this.build(t, null));
  }
  private build(t: Tree<A>, parent: RowNode | null): RowNode {
    const n = new RowNode(t.rootLabel);
    n.parent = parent;
    n.children = t.subForest.map((c) => this.build(c, n));
    return n;
  }
  roots(): RowNode[] {
    return this.rootNodes;
  }
  nColumns(): number {
    return 1;
  }
  columnValue(node: RowNode): any {
    return node.data;
  }
  insertForest(parentPath: TreePath, pos: number, forest: Forest<A>): void {
    const parent = parentPath.indices.length === 0 ? null : this.nodeAt(parentPath);
    const list = parent ? parent.children : this.rootNodes;
    let p = pos < 0 || pos > list.length ? list.length : pos;
    for (const t of forest) {
      const n = this.build(t, parent);
      list.splice(p++, 0, n);
      this.bump();
      this.emit("row-inserted", this.pathOf(n), this.iter(n));
    }
  }
  toTree(n: RowNode): Tree<A> {
    return TNode(n.data as A, n.children.map((c) => this.toTree(c)));
  }
  clear(): void {
    const old = this.rootNodes;
    this.rootNodes = [];
    for (let i = old.length - 1; i >= 0; i--) {
      this.bump();
      this.emit("row-deleted", new TreePath([i]));
    }
  }
}
export function forestStoreNew<A>(initial: Forest<A>): ForestStore<A> {
  return new ForestStore(initial);
}
export function forestStoreGetValue<A>(s: ForestStore<A>, p: TreePath): A {
  const n = s.nodeAt(p);
  if (!n) throw new Error("forestStoreGetValue: invalid path " + p.toString());
  return n.data as A;
}
export function forestStoreGetTree<A>(s: ForestStore<A>, p: TreePath): Tree<A> {
  const n = s.nodeAt(p);
  if (!n) throw new Error("forestStoreGetTree: invalid path " + p.toString());
  return s.toTree(n);
}
export function forestStoreGetForest<A>(s: ForestStore<A>): Tree<A>[] {
  return s.roots().map((n) => s.toTree(n));
}
export function forestStoreSetValue<A>(s: ForestStore<A>, p: TreePath, v: A): void {
  const n = s.nodeAt(p);
  if (!n) return;
  n.data = v;
  s.bump();
  s.emit("row-changed", p, s.iter(n));
}
/** `forestStoreChange store path f`: returns whether the path was valid. */
export function forestStoreChange<A>(s: ForestStore<A>, p: TreePath, f: (a: A) => A): boolean {
  const n = s.nodeAt(p);
  if (!n) return false;
  forestStoreSetValue(s, p, f(n.data as A));
  return true;
}
export function forestStoreInsert<A>(s: ForestStore<A>, parentPath: TreePath, pos: number, v: A): void {
  s.insertForest(parentPath, pos, [TNode(v, [])]);
}
export function forestStoreInsertTree<A>(s: ForestStore<A>, parentPath: TreePath, pos: number, t: Tree<A>): void {
  s.insertForest(parentPath, pos, [t]);
}
export function forestStoreInsertForest<A>(s: ForestStore<A>, parentPath: TreePath, pos: number, f: Forest<A>): void {
  s.insertForest(parentPath, pos, f);
}
export function forestStoreRemove<A>(s: ForestStore<A>, p: TreePath): boolean {
  const n = s.nodeAt(p);
  if (!n) return false;
  const list = s.siblings(n);
  list.splice(list.indexOf(n), 1);
  n.parent = null;
  s.bump();
  s.emit("row-deleted", p);
  return true;
}
export function forestStoreClear<A>(s: ForestStore<A>): void {
  s.clear();
}
export function forestStoreGetValueByIter<A>(s: ForestStore<A>, it: TreeIter): A {
  return it.node!.data as A;
}

/** `customStoreGetRow`/`treeModelGetRow` for typed stores. */
export function typedStoreGetRow<A>(_s: TreeModel, it: TreeIter): A {
  return it.node!.data as A;
}

// ---------------------------------------------------------------------------------------------
// TreeModelSort

export type TreeIterCompareFunc = (m: TreeModel, a: TreeIter, b: TreeIter) => number;

/**
 * A sorted view of a child model. Sorted nodes wrap child nodes (`data` holds the child node);
 * the view is rebuilt whenever the child model changes.
 */
export class TreeModelSort extends TreeModel {
  child: TreeModel | null = null;
  private sortFuncs = new Map<number, TreeIterCompareFunc>();
  private sortColumn: number | null = null;
  private ascending = true;
  private builtVersion = -1;
  private rootNodes: RowNode[] = [];
  private map = new Map<RowNode, RowNode>();
  private childHandlers: SignalHandlerId[] = [];

  setModel(m: TreeModel): void {
    if (this.child) for (const h of this.childHandlers) this.child.disconnect(h);
    this.child = m;
    this.childHandlers = [
      m.connect("row-changed", () => this.relay("row-changed")),
      m.connect("row-inserted", () => this.relay("row-inserted")),
      m.connect("row-deleted", () => this.relay("row-deleted")),
      m.connect("model-changed", () => this.bump()),
    ];
    this.builtVersion = -1;
    this.bump();
  }
  setProperty(name: string, value: unknown): void {
    if (name === "model") this.setModel(value as TreeModel);
  }
  private relay(sig: string): void {
    this.builtVersion = -1;
    this.emit(sig, new TreePath([]), this.iter(null));
  }
  private rebuild(): void {
    if (!this.child) {
      this.rootNodes = [];
      return;
    }
    const childModel = this.child;
    if (this.builtVersion === childModel.version) return;
    this.map = new Map();
    const cmp = this.sortColumn !== null ? this.sortFuncs.get(this.sortColumn) : undefined;
    const build = (nodes: RowNode[], parent: RowNode | null): RowNode[] => {
      let wrapped = nodes.map((cn) => {
        const sn = new RowNode(cn);
        sn.parent = parent;
        this.map.set(cn, sn);
        sn.children = build(cn.children, sn);
        return sn;
      });
      if (cmp) {
        wrapped = wrapped
          .map((w, i) => [w, i] as const)
          .sort((x, y) => {
            const r = cmp(childModel, childModel.iter(x[0].data), childModel.iter(y[0].data));
            return (this.ascending ? r : -r) || x[1] - y[1];
          })
          .map((p) => p[0]);
      }
      return wrapped;
    };
    this.rootNodes = build(childModel.roots(), null);
    this.builtVersion = childModel.version;
  }
  roots(): RowNode[] {
    this.rebuild();
    return this.rootNodes;
  }
  nColumns(): number {
    return this.child ? this.child.nColumns() : 0;
  }
  columnValue(node: RowNode, col: number): any {
    return this.child ? this.child.columnValue(node.data as RowNode, col) : null;
  }
  override nodeAt(path: TreePath): RowNode | null {
    this.rebuild();
    return super.nodeAt(path);
  }
  override pathOf(node: RowNode): TreePath {
    this.rebuild();
    return super.pathOf(node);
  }
  setSortFunc(col: number, f: TreeIterCompareFunc): void {
    this.sortFuncs.set(col, f);
    this.builtVersion = -1;
    this.bump();
  }
  setSortColumn(col: number, asc: boolean): void {
    this.sortColumn = col;
    this.ascending = asc;
    this.builtVersion = -1;
    this.bump();
  }
  sortedNodeFor(childNode: RowNode): RowNode | null {
    this.rebuild();
    return this.map.get(childNode) ?? null;
  }
}
export function treeModelSortNewWithModel(m: TreeModel): TreeModelSort {
  const s = new TreeModelSort();
  s.setModel(m);
  return s;
}
export function treeSortableSetSortFunc(s: TreeModelSort, col: number, f: TreeIterCompareFunc): void {
  s.setSortFunc(col, f);
}
export function treeSortableSetSortColumnId(s: TreeModelSort, col: number, order: "SortTypeAscending" | "SortTypeDescending"): void {
  s.setSortColumn(col, order === "SortTypeAscending");
}
export function treeModelSortConvertIterToChildIter(s: TreeModelSort, it: TreeIter): TreeIter {
  return new TreeIter(s.child, it.node ? (it.node.data as RowNode) : null);
}
export function treeModelSortConvertChildIterToIter(s: TreeModelSort, it: TreeIter): [boolean, TreeIter] {
  const n = it.node ? s.sortedNodeFor(it.node) : null;
  return [n !== null, s.iter(n)];
}
export function treeModelSortConvertChildPathToPath(s: TreeModelSort, p: TreePath): TreePath | null {
  const cn = s.child?.nodeAt(p) ?? null;
  const n = cn ? s.sortedNodeFor(cn) : null;
  return n ? s.pathOf(n) : null;
}
export function treeModelSortConvertPathToChildPath(s: TreeModelSort, p: TreePath): TreePath | null {
  const n = s.nodeAt(p);
  return n && s.child ? s.child.pathOf(n.data as RowNode) : null;
}
export function treeModelSortGetModel(s: TreeModelSort): TreeModel | null {
  return s.child;
}

// ---------------------------------------------------------------------------------------------
// Row references

export class TreeRowReference {
  constructor(readonly model: TreeModel, readonly node: RowNode | null) {}
}
export function treeRowReferenceNew(m: TreeModel, p: TreePath): TreeRowReference | null {
  const n = m.nodeAt(p);
  return n ? new TreeRowReference(m, n) : null;
}
export function treeRowReferenceGetPath(r: TreeRowReference): TreePath | null {
  if (!r.node) return null;
  // The node may have been removed from the model.
  let n: RowNode | null = r.node;
  while (n.parent) n = n.parent;
  if (!r.model.roots().includes(n)) return null;
  return r.model.pathOf(r.node);
}
export function treeRowReferenceValid(r: TreeRowReference): boolean {
  return treeRowReferenceGetPath(r) !== null;
}
