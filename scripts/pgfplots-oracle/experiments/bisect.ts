/**
 * Parallel batched bisection of step-function transitions (design 5.3).
 * Each task: a parameter interval [lo, hi] whose endpoints classify
 * differently, a body builder, and a classifier of the result. Every round
 * places `k` points inside every open interval, all tasks in ONE TeX run,
 * and keeps the sub-interval containing the first change. Stops when the
 * interval is below `tol`.
 */
import { runExperiment, type ExpResult, type ExpOptions } from "./lib.js";

export interface BisectTask {
  name: string;
  lo: number;
  hi: number;
  body: (v: number) => string;
  classify: (r: ExpResult) => string;
}

export interface BisectResult { name: string; lo: number; hi: number; classLo: string; classHi: string; rounds: number }

const fmt = (v: number) => Number(v.toPrecision(12)).toString();

export function bisectAll(expName: string, tasks: BisectTask[], tol: (t: BisectTask, lo: number, hi: number) => boolean, options: ExpOptions & { k?: number; maxRounds?: number } = {}): BisectResult[] {
  const k = options.k ?? 9;
  const state = tasks.map((t) => ({ t, lo: t.lo, hi: t.hi, cLo: "", cHi: "", done: false, rounds: 0 }));
  // Endpoints.
  const idOf = (i: number, end: string, v: number) => `b${i}-${end}-${fmt(v).replace(/[^0-9a-z]/giu, "p")}`;
  const ends = runExperiment(expName, state.flatMap((st, i) => [
    { id: idOf(i, "lo", st.lo), body: st.t.body(st.lo) },
    { id: idOf(i, "hi", st.hi), body: st.t.body(st.hi) },
  ]), options);
  const byId = new Map(ends.map((r) => [r.id, r]));
  const cls = (st: (typeof state)[number], r: ExpResult | undefined) => (r ? st.t.classify(r) : "TeX-error");
  state.forEach((st, i) => {
    st.cLo = cls(st, byId.get(idOf(i, "lo", st.lo))); st.cHi = cls(st, byId.get(idOf(i, "hi", st.hi)));
    if (st.cLo === st.cHi) { st.done = true; console.error(`[bisect] ${st.t.name}: endpoints agree (${st.cLo})`); }
  });
  for (let round = 0; round < (options.maxRounds ?? 12); round += 1) {
    const open = state.filter((st) => !st.done && !tol(st.t, st.lo, st.hi));
    if (open.length === 0) break;
    const cases = open.flatMap((st) => Array.from({ length: k }, (_, j) => {
      const v = Number((st.lo + ((st.hi - st.lo) * (j + 1)) / (k + 1)).toPrecision(12));
      return { id: `b${state.indexOf(st)}-r${round}-${j}`, body: st.t.body(v), meta: { v } };
    }));
    const res = runExperiment(expName, cases, { ...options, quiet: true });
    for (const st of open) {
      const idx = state.indexOf(st);
      const byCase = new Map(res.map((r) => [r.id, r]));
      const mine = cases.filter((c) => c.id.startsWith(`b${idx}-r${round}-`));
      let lo = st.lo; let hi = st.hi;
      for (const c0 of mine) {
        const c = cls(st, byCase.get(c0.id)); const v = c0.meta.v;
        if (c === st.cLo) lo = v;
        else { hi = v; if (c !== st.cHi) { st.cHi = c; } break; }
      }
      st.lo = lo; st.hi = hi; st.rounds = round + 1;
    }
  }
  return state.map((st) => ({ name: st.t.name, lo: st.lo, hi: st.hi, classLo: st.cLo, classHi: st.cHi, rounds: st.rounds }));
}
