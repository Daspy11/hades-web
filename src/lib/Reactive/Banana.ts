/**
 * A TypeScript implementation of the `reactive-banana` FRP library (Combinators and
 * Frameworks), including the extensions from Paul Johnson's fork that HADES relies on
 * (`switchE` with an initial event, i.e. `switchE1`, and `reactimate_` returning a stop action).
 *
 * Semantics
 * ---------
 * The network runs in discrete *moments* (transactions). When an input event fires:
 *
 *  1. every node reachable from the input is visited and the stateful nodes and sinks among
 *     them are collected;
 *  2. each collected node pulls its input occurrences (memoised per moment). `execute` actions
 *     run during this phase, so new network fragments can be built;
 *  3. state changes are committed: `stepper`/`accumB`/`switchB` behaviors take their new
 *     values, `switchE` switches to its new event. Hence `b <@ e` sees the value of `b` *before*
 *     the moment, exactly as in reactive-banana;
 *  4. `reactimate` actions run, then `reactimate'` futures (whose values are read after the
 *     commit);
 *  5. events fired while a moment is in progress are queued and run as later moments.
 *
 * `MomentIO` actions are ordinary synchronous functions that build network nodes. Recursive
 * definitions (Haskell `mdo`/`RecursiveDo`) use `lazyE` / `lazyB`, which resolve their thunks at
 * the end of the current network-building phase.
 *
 * Child edges are held by `WeakRef`, so fragments of the network that are no longer referenced
 * by any live sink or by application code can be garbage collected.
 */
import { Just, Nothing, type Maybe } from "../Data/Maybe";
import type { Either } from "../Data/Either";

// ---------------------------------------------------------------------------------------------
// Internals

const NONE: unique symbol = Symbol("none");
type Occ<A> = A | typeof NONE;

let nextId = 1;
let txCounter = 0;
/** Incremented on every commit; used to cache behavior values. */
let epoch = 0;

interface Tx {
  readonly id: number;
  readonly source: SourceE<any>;
  readonly value: unknown;
}

let currentTx: Tx | null = null;
const fireQueue: (() => void)[] = [];
let draining = false;

/** Nodes that must be told when their inputs fire. */
abstract class Node {
  readonly id = nextId++;
  /** Weak references to dependants. */
  private kids: WeakRef<Node>[] = [];
  addChild(n: Node): void {
    this.kids.push(new WeakRef(n));
    if (this.kids.length > 64 && this.kids.length % 64 === 0) this.prune();
  }
  private prune(): void {
    this.kids = this.kids.filter((w) => w.deref() !== undefined);
  }
  children(): Node[] {
    const r: Node[] = [];
    let dead = 0;
    for (const w of this.kids) {
      const n = w.deref();
      if (n) r.push(n);
      else dead++;
    }
    if (dead > 16) this.prune();
    return r;
  }
  /** Stateful nodes and sinks override this to take part in a moment. */
  isActive(): boolean {
    return false;
  }
  /** Phase 2: pull inputs and compute pending state. */
  prepare(_tx: Tx): void {}
  /** Phase 3: commit pending state. */
  commit(): void {}
}

// ---------------------------------------------------------------------------------------------
// Events

export abstract class Event<A> extends Node {
  private memoTx = -1;
  private memo: Occ<A> = NONE;
  /** @internal */
  occ(tx: Tx): Occ<A> {
    if (this.memoTx === tx.id) return this.memo;
    this.memoTx = tx.id;
    this.memo = NONE; // guard against cycles
    const v = this.compute(tx);
    this.memo = v;
    return v;
  }
  /** @internal */
  protected abstract compute(tx: Tx): Occ<A>;
}

class NeverE extends Event<any> {
  protected compute(): Occ<any> {
    return NONE;
  }
}
const neverE = new NeverE();
/** `never` */
export function never<A>(): Event<A> {
  return neverE;
}

class SourceE<A> extends Event<A> {
  constructor(readonly network: EventNetwork) {
    super();
  }
  protected compute(tx: Tx): Occ<A> {
    return tx.source === this ? (tx.value as A) : NONE;
  }
}

class MapE<A, B> extends Event<B> {
  constructor(private readonly f: (a: A) => B, private readonly e: Event<A>) {
    super();
    e.addChild(this);
  }
  protected compute(tx: Tx): Occ<B> {
    const a = this.e.occ(tx);
    return a === NONE ? NONE : this.f(a);
  }
}

class FilterMapE<A, B> extends Event<B> {
  constructor(private readonly f: (a: A) => Occ<B>, private readonly e: Event<A>) {
    super();
    e.addChild(this);
  }
  protected compute(tx: Tx): Occ<B> {
    const a = this.e.occ(tx);
    return a === NONE ? NONE : this.f(a);
  }
}

class UnionE<A> extends Event<A> {
  constructor(private readonly f: (a: A, b: A) => A, private readonly e1: Event<A>, private readonly e2: Event<A>) {
    super();
    e1.addChild(this);
    e2.addChild(this);
  }
  protected compute(tx: Tx): Occ<A> {
    const a = this.e1.occ(tx), b = this.e2.occ(tx);
    if (a === NONE) return b;
    if (b === NONE) return a;
    return this.f(a, b);
  }
}

class ApplyE<A, B> extends Event<B> {
  constructor(private readonly bf: Behavior<(a: A) => B>, private readonly e: Event<A>) {
    super();
    e.addChild(this);
  }
  protected compute(tx: Tx): Occ<B> {
    const a = this.e.occ(tx);
    return a === NONE ? NONE : this.bf.sample()(a);
  }
}

class FilterApplyE<A> extends Event<A> {
  constructor(private readonly bp: Behavior<(a: A) => boolean>, private readonly e: Event<A>) {
    super();
    e.addChild(this);
  }
  protected compute(tx: Tx): Occ<A> {
    const a = this.e.occ(tx);
    return a === NONE ? NONE : this.bp.sample()(a) ? a : NONE;
  }
}

class ExecuteE<A> extends Event<A> {
  constructor(private readonly e: Event<() => A>, private readonly net: EventNetwork) {
    super();
    e.addChild(this);
  }
  protected compute(tx: Tx): Occ<A> {
    const act = this.e.occ(tx);
    if (act === NONE) return NONE;
    return withNetwork(this.net, () => buildPhase(act));
  }
}

/** Lazily resolved event, for recursive definitions. */
class LazyE<A> extends Event<A> {
  private target: Event<A> | null = null;
  constructor(private thunk: (() => Event<A>) | null) {
    super();
    pendingLazies.push(this);
  }
  /** @internal */
  resolve(): void {
    if (this.target === null && this.thunk !== null) {
      const t = this.thunk();
      this.thunk = null;
      this.target = t;
      t.addChild(this);
    }
  }
  protected compute(tx: Tx): Occ<A> {
    this.resolve();
    return this.target ? this.target.occ(tx) : NONE;
  }
}

// Stateful events

class AccumE<A> extends Event<A> {
  private pending: Occ<A> = NONE;
  constructor(private state: A, private readonly e: Event<(a: A) => A>) {
    super();
    e.addChild(this);
  }
  override isActive(): boolean {
    return true;
  }
  protected compute(tx: Tx): Occ<A> {
    const f = this.e.occ(tx);
    return f === NONE ? NONE : f(this.state);
  }
  override prepare(tx: Tx): void {
    this.pending = this.occ(tx);
  }
  override commit(): void {
    if (this.pending !== NONE) this.state = this.pending;
    this.pending = NONE;
  }
}

class SwitchE<A> extends Event<A> {
  private pending: Event<A> | null = null;
  constructor(private current: Event<A>, private readonly ee: Event<Event<A>>) {
    super();
    ee.addChild(this);
    current.addChild(this);
  }
  override isActive(): boolean {
    return true;
  }
  protected compute(tx: Tx): Occ<A> {
    return this.current.occ(tx);
  }
  override prepare(tx: Tx): void {
    const n = this.ee.occ(tx);
    this.pending = n === NONE ? null : n;
  }
  override commit(): void {
    if (this.pending !== null) {
      this.current = this.pending;
      this.current.addChild(this);
    }
    this.pending = null;
  }
}

class OnceE<A> extends Event<A> {
  private done = false;
  private fired = false;
  constructor(private readonly e: Event<A>) {
    super();
    e.addChild(this);
  }
  override isActive(): boolean {
    return !this.done;
  }
  protected compute(tx: Tx): Occ<A> {
    return this.done ? NONE : this.e.occ(tx);
  }
  override prepare(tx: Tx): void {
    this.fired = this.occ(tx) !== NONE;
  }
  override commit(): void {
    if (this.fired) this.done = true;
  }
}

// ---------------------------------------------------------------------------------------------
// Behaviors

/**
 * Dependency tracking: cells read while sampling, for `changes`. A frame is marked volatile if
 * a polled behavior was read, in which case derived values are not cached.
 */
interface TrackFrame extends Set<Cell<any>> {
  volatile?: boolean;
}
let tracking: TrackFrame[] = [];

export abstract class Behavior<A> {
  readonly id = nextId++;
  /** Current value (as of the start of the current moment). */
  abstract sample(): A;
}

/** A behavior whose value is held in a cell updated by an event. */
abstract class Cell<A> extends Behavior<A> {
  /** The event whose occurrence may change the cell. */
  abstract trigger(): Event<any>;
}

class ConstB<A> extends Behavior<A> {
  constructor(private readonly v: A) {
    super();
  }
  sample(): A {
    return this.v;
  }
}

/** Cached derived behavior. */
abstract class DerivedB<A> extends Behavior<A> {
  private cacheEpoch = -1;
  private cache!: A;
  private deps: Set<Cell<any>> = new Set();
  private volatile = false;
  sample(): A {
    if (this.cacheEpoch !== epoch || this.volatile) {
      const mine: TrackFrame = new Set<Cell<any>>();
      tracking.push(mine);
      try {
        this.cache = this.compute();
      } finally {
        tracking.pop();
      }
      this.deps = mine;
      this.volatile = !!mine.volatile;
      this.cacheEpoch = epoch;
    }
    const outer = tracking[tracking.length - 1];
    if (outer) {
      for (const d of this.deps) outer.add(d);
      if (this.volatile) outer.volatile = true;
    }
    return this.cache;
  }
  protected abstract compute(): A;
}

class MapB<A, B> extends DerivedB<B> {
  constructor(private readonly f: (a: A) => B, private readonly b: Behavior<A>) {
    super();
  }
  protected compute(): B {
    return this.f(this.b.sample());
  }
}

class ApB<A, B> extends DerivedB<B> {
  constructor(private readonly bf: Behavior<(a: A) => B>, private readonly bx: Behavior<A>) {
    super();
  }
  protected compute(): B {
    return this.bf.sample()(this.bx.sample());
  }
}

class Lift2B<A, B, C> extends DerivedB<C> {
  constructor(private readonly f: (a: A, b: B) => C, private readonly b1: Behavior<A>, private readonly b2: Behavior<B>) {
    super();
  }
  protected compute(): C {
    return this.f(this.b1.sample(), this.b2.sample());
  }
}

class SeqB<A> extends DerivedB<A[]> {
  constructor(private readonly bs: readonly Behavior<A>[]) {
    super();
  }
  protected compute(): A[] {
    return this.bs.map((b) => b.sample());
  }
}

class PollB<A> extends Behavior<A> {
  constructor(private readonly io: () => A) {
    super();
  }
  sample(): A {
    const t = tracking[tracking.length - 1];
    if (t) t.volatile = true;
    return this.io();
  }
}

class LazyB<A> extends Behavior<A> {
  private target: Behavior<A> | null = null;
  constructor(private thunk: (() => Behavior<A>) | null) {
    super();
  }
  sample(): A {
    if (this.target === null) {
      if (this.thunk === null) throw new Error("lazyB: unresolved");
      this.target = this.thunk();
      this.thunk = null;
    }
    return this.target.sample();
  }
}

/** The event node driving a stepper-like cell. */
class CellUpdater<A> extends Node {
  private pending: Occ<A> = NONE;
  constructor(private readonly e: Event<A>, private readonly apply: (a: A) => void) {
    super();
    e.addChild(this);
  }
  override isActive(): boolean {
    return true;
  }
  override prepare(tx: Tx): void {
    this.pending = this.e.occ(tx);
  }
  override commit(): void {
    if (this.pending !== NONE) this.apply(this.pending);
    this.pending = NONE;
  }
}

class StepperB<A> extends Cell<A> {
  private readonly updater: CellUpdater<A>;
  constructor(private value: A, private readonly e: Event<A>) {
    super();
    this.updater = new CellUpdater(e, (v) => {
      this.value = v;
    });
  }
  sample(): A {
    const t = tracking[tracking.length - 1];
    if (t) t.add(this);
    return this.value;
  }
  trigger(): Event<any> {
    return this.e;
  }
  /** Keep the updater reachable for as long as the behavior is. */
  get _updater(): CellUpdater<A> {
    return this.updater;
  }
}

class SwitchB<A> extends Cell<A> {
  private readonly updater: CellUpdater<Behavior<A>>;
  constructor(private current: Behavior<A>, private readonly eb: Event<Behavior<A>>) {
    super();
    this.updater = new CellUpdater(eb, (b) => {
      this.current = b;
    });
  }
  sample(): A {
    const t = tracking[tracking.length - 1];
    if (t) t.add(this);
    return this.current.sample();
  }
  trigger(): Event<any> {
    return this.eb;
  }
  get _updater(): CellUpdater<Behavior<A>> {
    return this.updater;
  }
}

// ---------------------------------------------------------------------------------------------
// Changes

/** A value that is only available after the current moment has been committed. */
export interface Future<A> {
  readonly get: () => A;
}
export function mapFuture<A, B>(f: (a: A) => B, fa: Future<A>): Future<B> {
  return { get: () => f(fa.get()) };
}

class ChangesE<A> extends Event<Future<A>> {
  private deps: Set<Cell<any>> = new Set();
  constructor(private readonly b: Behavior<A>) {
    super();
    this.retrack();
    // Re-track once recursive (lazy) references in the current build phase are resolved.
    postBuild.push(() => this.retrack());
  }
  override isActive(): boolean {
    return true;
  }
  /** @internal */
  retrack(): void {
    const mine = new Set<Cell<any>>();
    tracking.push(mine);
    try {
      this.b.sample();
    } catch {
      // Sampling may fail before recursive definitions are resolved.
    } finally {
      tracking.pop();
    }
    for (const c of mine) if (!this.deps.has(c)) c.trigger().addChild(this);
    this.deps = mine;
  }
  protected compute(tx: Tx): Occ<Future<A>> {
    for (const c of this.deps) {
      if (c.trigger().occ(tx) !== NONE) return { get: () => this.b.sample() };
    }
    return NONE;
  }
  override prepare(tx: Tx): void {
    this.occ(tx);
  }
  override commit(): void {
    postCommit.push(() => this.retrack());
  }
}

// ---------------------------------------------------------------------------------------------
// Sinks and networks

class Sink<A> extends Node {
  stopped = false;
  private pending: Occ<A> = NONE;
  constructor(private readonly e: Event<A>, private readonly run: (a: A) => void, readonly network: EventNetwork) {
    super();
    e.addChild(this);
  }
  override isActive(): boolean {
    return !this.stopped && this.network.actuated;
  }
  override prepare(tx: Tx): void {
    this.pending = this.e.occ(tx);
  }
  override commit(): void {
    if (this.pending !== NONE) {
      const v = this.pending;
      sinkQueue.push([this.id, () => {
        if (!this.stopped) this.run(v);
      }]);
    }
    this.pending = NONE;
  }
}

let sinkQueue: [number, () => void][] = [];
let postCommit: (() => void)[] = [];

/** An event network created by `compile`. */
export class EventNetwork {
  actuated = false;
  /** Strong references to the sinks keep the network fragments that feed them alive. */
  readonly sinks = new Set<Sink<any>>();
  /** Strong references to nodes that must stay alive with the network. */
  readonly keep: unknown[] = [];
}

/** The network used for nodes created outside `compile`. Always actuated. */
const globalNetwork = new EventNetwork();
globalNetwork.actuated = true;
let currentNetwork: EventNetwork = globalNetwork;

function withNetwork<A>(net: EventNetwork, f: () => A): A {
  const prev = currentNetwork;
  currentNetwork = net;
  try {
    return f();
  } finally {
    currentNetwork = prev;
  }
}

const pendingLazies: LazyE<any>[] = [];
let postBuild: (() => void)[] = [];
let buildDepth = 0;

/** Run a network-building action, resolving lazy (recursive) references at the end. */
function buildPhase<A>(f: () => A): A {
  buildDepth++;
  try {
    return f();
  } finally {
    buildDepth--;
    if (buildDepth === 0) resolveLazies();
  }
}

function resolveLazies(): void {
  while (pendingLazies.length > 0) {
    const l = pendingLazies.shift()!;
    l.resolve();
  }
  if (postBuild.length > 0) {
    const pb = postBuild;
    postBuild = [];
    for (const f of pb) f();
  }
}

function runTx(source: SourceE<any>, value: unknown): void {
  resolveLazies();
  const tx: Tx = { id: ++txCounter, source, value };
  currentTx = tx;
  // Phase 1: collect active nodes reachable from the source.
  const seen = new Set<number>();
  const active: Node[] = [];
  const stack: Node[] = [source];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (n.isActive()) active.push(n);
    for (const c of n.children()) if (!seen.has(c.id)) stack.push(c);
  }
  active.sort((a, b) => a.id - b.id);
  try {
    // Phase 2: pull.
    buildPhase(() => {
      for (const n of active) n.prepare(tx);
    });
    // Phase 3: commit.
    for (const n of active) n.commit();
  } finally {
    epoch++;
    currentTx = null;
  }
  // Phase 4: effects.
  const sinks = sinkQueue;
  sinkQueue = [];
  sinks.sort((a, b) => a[0] - b[0]);
  for (const [, act] of sinks) {
    try {
      act();
    } catch (err) {
      reportError(err);
    }
  }
  const pc = postCommit;
  postCommit = [];
  for (const f of pc) f();
}

let errorHandler: (err: unknown) => void = (err) => console.error("reactimate:", err);
/** Install a handler for exceptions thrown by `reactimate` actions. */
export function setErrorHandler(h: (err: unknown) => void): void {
  errorHandler = h;
}
function reportError(err: unknown): void {
  try {
    errorHandler(err);
  } catch (e2) {
    console.error(e2);
  }
}

function fire<A>(source: SourceE<A>, value: A): void {
  if (!source.network.actuated) return;
  fireQueue.push(() => runTx(source, value));
  if (draining) return;
  draining = true;
  try {
    while (fireQueue.length > 0) {
      const t = fireQueue.shift()!;
      try {
        t();
      } catch (err) {
        reportError(err);
      }
    }
  } finally {
    draining = false;
  }
}

/** True while a moment is being processed. */
export function inMoment(): boolean {
  return currentTx !== null || draining;
}

// ---------------------------------------------------------------------------------------------
// Public API: Frameworks

/** `compile`: build a network. The network starts paused. */
export function compile(build: () => void): EventNetwork {
  const net = new EventNetwork();
  withNetwork(net, () => buildPhase(build));
  return net;
}
export function actuate(net: EventNetwork): void {
  net.actuated = true;
}
export function pause(net: EventNetwork): void {
  net.actuated = false;
}
/** `getEventNetwork` */
export function getEventNetwork(): EventNetwork {
  return currentNetwork;
}
/** Run a `MomentIO` action in the context of a network (`runMomentIO_` / `liftMomentIO`). */
export function runMomentIO<A>(net: EventNetwork, act: () => A): A {
  return withNetwork(net, () => buildPhase(act));
}
/** Run a network-building action outside `compile` (in the always-active global network). */
export function liftMomentIO<A>(act: () => A): A {
  return buildPhase(act);
}

/** `newEvent`: an event and the handler that fires it. */
export function newEvent<A>(): [Event<A>, (a: A) => void] {
  const src = new SourceE<A>(currentNetwork);
  return [src, (a: A) => fire(src, a)];
}

/** `newBehavior`: a behavior and an action to set it. */
export function newBehavior<A>(initial: A): [Behavior<A>, (a: A) => void] {
  const [e, h] = newEvent<A>();
  const b = new StepperB(initial, e);
  currentNetwork.keep.push(b);
  return [b, h];
}

/** `reactimate` */
export function reactimate(e: Event<() => void>): void {
  reactimate_(e);
}
/** `reactimate_`: as `reactimate`, returning an action that stops it. */
export function reactimate_(e: Event<() => void>): () => void {
  const net = currentNetwork;
  const s = new Sink(e, (act) => act(), net);
  net.sinks.add(s);
  return () => {
    s.stopped = true;
    net.sinks.delete(s);
  };
}
/** `reactimate'` */
export function reactimatePrime(e: Event<Future<() => void>>): void {
  reactimatePrime_(e);
}
/** `reactimate_'` */
export function reactimatePrime_(e: Event<Future<() => void>>): () => void {
  const net = currentNetwork;
  const s = new Sink(e, (fut) => postCommit.push(() => {
    try {
      fut.get()();
    } catch (err) {
      reportError(err);
    }
  }), net);
  net.sinks.add(s);
  return () => {
    s.stopped = true;
    net.sinks.delete(s);
  };
}

/** `changes`: an event that fires whenever the behavior may have changed. */
export function changes<A>(b: Behavior<A>): Event<Future<A>> {
  return new ChangesE(b);
}

/** `fromPoll`: a behavior that is re-sampled whenever it is needed. */
export function fromPoll<A>(io: () => A): Behavior<A> {
  return new PollB(io);
}

/** `mapEventIO f e` */
export function mapEventIO<A, B>(f: (a: A) => B, e: Event<A>): Event<B> {
  return execute(mapE((a: A) => () => f(a), e));
}

/** `liftIOLater`: run an action after the current network-building phase. */
export function liftIOLater(act: () => void): void {
  if (currentTx !== null) postCommit.push(act);
  else queueMicrotask(act);
}

/**
 * Non-Haskell helper: observe a behavior from outside the network (e.g. from a React hook).
 * The callback runs after each moment in which the behavior may have changed.
 */
export function subscribeB<A>(b: Behavior<A>, cb: (a: A) => void): () => void {
  return liftMomentIO(() => reactimatePrime_(mapE((f: Future<A>) => mapFuture((a: A) => () => cb(a), f), changes(b))));
}
/** Non-Haskell helper: observe an event from outside the network. */
export function subscribeE<A>(e: Event<A>, cb: (a: A) => void): () => void {
  return liftMomentIO(() => reactimate_(mapE((a: A) => () => cb(a), e)));
}

// ---------------------------------------------------------------------------------------------
// Public API: Combinators

export function mapE<A, B>(f: (a: A) => B, e: Event<A>): Event<B> {
  if (e === neverE) return neverE;
  return new MapE(f, e);
}
/** `e <&> f` / `fmap` with flipped arguments. */
export function mapE_<A, B>(e: Event<A>, f: (a: A) => B): Event<B> {
  return mapE(f, e);
}
/** `v <$ e` */
export function constE<A>(v: A, e: Event<any>): Event<A> {
  return mapE(() => v, e);
}

export function filterE<A>(p: (a: A) => boolean, e: Event<A>): Event<A> {
  if (e === neverE) return neverE;
  return new FilterMapE((a: A) => (p(a) ? a : NONE), e);
}
export function filterJust<A>(e: Event<Maybe<A>>): Event<A> {
  if (e === neverE) return neverE;
  return new FilterMapE((m: Maybe<A>) => (m.tag === "Just" ? m.value : NONE), e);
}
/** `mapMaybe f e` (Haskell `filterJust . fmap f`). */
export function mapMaybeE<A, B>(f: (a: A) => Maybe<B>, e: Event<A>): Event<B> {
  if (e === neverE) return neverE;
  return new FilterMapE((a: A) => {
    const m = f(a);
    return m.tag === "Just" ? m.value : NONE;
  }, e);
}
export function filterApply<A>(bp: Behavior<(a: A) => boolean>, e: Event<A>): Event<A> {
  if (e === neverE) return neverE;
  return new FilterApplyE(bp, e);
}
export function whenE<A>(b: Behavior<boolean>, e: Event<A>): Event<A> {
  return filterApply(mapB((x: boolean) => () => x, b), e);
}
export function split<A, B>(e: Event<Either<A, B>>): [Event<A>, Event<B>] {
  return [
    new FilterMapE((x: Either<A, B>) => (x.tag === "Left" ? x.value : NONE), e),
    new FilterMapE((x: Either<A, B>) => (x.tag === "Right" ? x.value : NONE), e),
  ];
}
export function unionWith<A>(f: (a: A, b: A) => A, e1: Event<A>, e2: Event<A>): Event<A> {
  if (e1 === neverE) return e2;
  if (e2 === neverE) return e1;
  return new UnionE(f, e1, e2);
}
/** `unions :: [Event (a -> a)] -> Event (a -> a)`: simultaneous functions are composed. */
export function unions<A>(es: readonly Event<(a: A) => A>[]): Event<(a: A) => A> {
  return es.reduceRight<Event<(a: A) => A>>(
    (acc, e) => unionWith((f, g) => (x: A) => f(g(x)), e, acc),
    neverE,
  );
}
/** Left-biased union of a list of events (`foldr (unionWith const) never`). */
export function unionsFirst<A>(es: readonly Event<A>[]): Event<A> {
  return es.reduceRight<Event<A>>((acc, e) => unionWith((a) => a, e, acc), neverE);
}
/** `Semigroup` on events: `unionWith (<>)`. */
export function appendE<A>(append: (a: A, b: A) => A, e1: Event<A>, e2: Event<A>): Event<A> {
  return unionWith(append, e1, e2);
}

/** `bf <@> e` */
export function apply<A, B>(bf: Behavior<(a: A) => B>, e: Event<A>): Event<B> {
  if (e === neverE) return neverE;
  return new ApplyE(bf, e);
}
/** `b <@ e` */
export function tag<A>(b: Behavior<A>, e: Event<any>): Event<A> {
  if (e === neverE) return neverE;
  return new ApplyE(mapB((v: A) => () => v, b), e);
}
/** `(f <$> b) <@> e` written with the function first: `applyWith(f, b, e)` = `f b e`. */
export function applyWith<A, B, C>(f: (a: A, b: B) => C, b: Behavior<A>, e: Event<B>): Event<C> {
  return apply(mapB((a: A) => (x: B) => f(a, x), b), e);
}

export function stepper<A>(initial: A, e: Event<A>): Behavior<A> {
  return new StepperB(initial, e);
}
export function accumE<A>(initial: A, e: Event<(a: A) => A>): Event<A> {
  return new AccumE(initial, e);
}
export function accumB<A>(initial: A, e: Event<(a: A) => A>): Behavior<A> {
  return stepper(initial, accumE(initial, e));
}
/** `mapAccum acc e` where `e :: Event (acc -> (x, acc))`. */
export function mapAccum<Acc, X>(initial: Acc, e: Event<(acc: Acc) => [X, Acc]>): [Event<X>, Behavior<Acc>] {
  const pairs = accumE<[X | typeof NONE, Acc]>([NONE, initial], mapE((f: (acc: Acc) => [X, Acc]) => (p: [X | typeof NONE, Acc]) => f(p[1]), e));
  const xs = new FilterMapE((p: [X | typeof NONE, Acc]) => p[0], pairs);
  const acc = stepper(initial, mapE((p: [X | typeof NONE, Acc]) => p[1], pairs));
  return [xs as Event<X>, acc];
}
/** `switchE` (and `switchE1` from the HADES fork when an initial event is given). */
export function switchE<A>(ee: Event<Event<A>>, initial: Event<A> = neverE): Event<A> {
  return new SwitchE(initial, ee);
}
export function switchB<A>(initial: Behavior<A>, eb: Event<Behavior<A>>): Behavior<A> {
  return new SwitchB(initial, eb);
}
/** `execute`: run network-building actions when the event fires. */
export function execute<A>(e: Event<() => A>): Event<A> {
  if (e === neverE) return neverE;
  return new ExecuteE(e, currentNetwork);
}
/** `observeE` */
export function observeE<A>(e: Event<() => A>): Event<A> {
  return execute(e);
}
export function once<A>(e: Event<A>): Event<A> {
  return new OnceE(e);
}

/** `valueB`: the current value of a behavior. */
export function valueB<A>(b: Behavior<A>): A {
  return b.sample();
}
/** `valueBLater`: a thunk for the value, for use inside recursive definitions. */
export function valueBLater<A>(b: Behavior<A>): () => A {
  let done = false;
  let v: A;
  liftIOLater(() => {
    if (!done) {
      v = b.sample();
      done = true;
    }
  });
  return () => {
    if (!done) {
      v = b.sample();
      done = true;
    }
    return v;
  };
}

export function pureB<A>(v: A): Behavior<A> {
  return new ConstB(v);
}
export function mapB<A, B>(f: (a: A) => B, b: Behavior<A>): Behavior<B> {
  if (b instanceof ConstB) {
    let cached = false;
    let v: B;
    return new (class extends Behavior<B> {
      sample(): B {
        if (!cached) {
          v = f(b.sample());
          cached = true;
        }
        return v;
      }
    })();
  }
  return new MapB(f, b);
}
/** `bf <*> bx` */
export function applyB<A, B>(bf: Behavior<(a: A) => B>, bx: Behavior<A>): Behavior<B> {
  return new ApB(bf, bx);
}
export function liftA2B<A, B, C>(f: (a: A, b: B) => C, b1: Behavior<A>, b2: Behavior<B>): Behavior<C> {
  return new Lift2B(f, b1, b2);
}
export function liftA3B<A, B, C, D>(f: (a: A, b: B, c: C) => D, b1: Behavior<A>, b2: Behavior<B>, b3: Behavior<C>): Behavior<D> {
  return applyB(liftA2B((a: A, b: B) => (c: C) => f(a, b, c), b1, b2), b3);
}
export function sequenceB<A>(bs: readonly Behavior<A>[]): Behavior<A[]> {
  return new SeqB(bs);
}

/** Forward reference to an event defined later in the same network-building phase. */
export function lazyE<A>(thunk: () => Event<A>): Event<A> {
  return new LazyE(thunk);
}
/** Forward reference to a behavior defined later in the same network-building phase. */
export function lazyB<A>(thunk: () => Behavior<A>): Behavior<A> {
  return new LazyB(thunk);
}

/** Helper to express Haskell `Maybe`-returning `split`-like filtering in one go. */
export function partitionE<A>(p: (a: A) => boolean, e: Event<A>): [Event<A>, Event<A>] {
  return [filterE(p, e), filterE((a) => !p(a), e)];
}

/** Convert a `Maybe` occurrence check for tests: the latest value an event fired with. */
export function lastValue<A>(e: Event<A>, initial: Maybe<A> = Nothing): Behavior<Maybe<A>> {
  return stepper(initial, mapE((a: A) => Just(a), e));
}
