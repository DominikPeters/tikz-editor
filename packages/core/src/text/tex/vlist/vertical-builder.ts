/**
 * LaTeX's vertical-mode list machinery, operation by operation.
 *
 * Each method follows the macro it is named after in the installed kernel
 * (tex-src/latex-installed/latex.ltx, 2023-11-01; commented source in
 * tex-src/latex-base/ltlists.dtx and ltspace.dtx). The builder tracks only
 * what decides vertical glue: the tail of the list (\lastskip), the paragraph
 * skips, the per-level list registers and LaTeX's list flags. Interline
 * (baselineskip/lineskip) glue is applied by the vlist layout from measured
 * boxes, so it is not modelled here.
 *
 * See design/vertical-list-builder.md.
 */

import { roundTexPt } from "../fonts/units.js";

/** TeX glue with finite stretch and shrink, in points. */
export interface VerticalGlue {
  readonly natural: number;
  readonly stretch: number;
  readonly shrink: number;
}

export const ZERO_GLUE: VerticalGlue = { natural: 0, stretch: 0, shrink: 0 };

export function glue(natural: number, stretch = 0, shrink = 0): VerticalGlue {
  return { natural, stretch, shrink };
}

function addGlue(left: VerticalGlue, right: VerticalGlue): VerticalGlue {
  return { natural: left.natural + right.natural, stretch: left.stretch + right.stretch, shrink: left.shrink + right.shrink };
}

function negateGlue(value: VerticalGlue): VerticalGlue {
  return { natural: -value.natural, stretch: -value.stretch, shrink: -value.shrink };
}

/** The list registers \list's second argument and \@list<depth> install. */
export interface VerticalListRegisters {
  readonly topsep: VerticalGlue;
  readonly partopsep: VerticalGlue;
  readonly itemsep: VerticalGlue;
  readonly parsep: VerticalGlue;
}

/** The registers \trivlist reads (center, flushleft, flushright, …). */
export interface VerticalTrivlistRegisters {
  readonly topsep: VerticalGlue;
  readonly partopsep: VerticalGlue;
}

export type VerticalListNode =
  | { readonly kind: "glue"; readonly glue: VerticalGlue; readonly origin: string; readonly ref?: unknown }
  | { readonly kind: "penalty"; readonly penalty: number; readonly ref?: unknown }
  | { readonly kind: "whatsit" }
  | { readonly kind: "box"; readonly id: string };

interface ListLevel {
  readonly kind: "list" | "trivlist" | "quote";
  /** \@topsepadd, captured at \@trivlist and used by \@endparenv. */
  readonly topsepAdd: VerticalGlue;
  /** \@topsep: opening skip used by the first \item when not @noparlist. */
  readonly topsep: VerticalGlue;
  itemsep: VerticalGlue;
  /** An explicitly assigned \topsep, read by an alignment nested in this level. */
  topsepRegister: VerticalGlue | undefined;
  readonly noParList: boolean;
  /** \@outerparskip and \parskip as they were set by this level. */
  readonly outerParskip: VerticalGlue;
  readonly parskip: VerticalGlue;
  /** Group-restored values to reinstate at \end. */
  readonly savedParskip: VerticalGlue;
  readonly savedOuterParskip: VerticalGlue;
}

export interface VerticalListBuilderOptions {
  /** \parskip outside any list (zero in Beamer and the article class default text). */
  readonly parskip?: VerticalGlue;
  /** The container starts in minipage mode (\@setminipage). */
  readonly minipage?: boolean;
  readonly itemPenalty?: number;
  readonly beginParPenalty?: number;
  readonly endParPenalty?: number;
  /**
   * Beamer's itemize/enumerate/description run \usebeamercolor[fg] (a
   * \color) before \list (beamerbaselocalstructure.sty 195-270, 303-316).
   * In vertical mode that leaves a color-stack push in the list, so the
   * list's opening \addvspace does not see a preceding skip. LuaLaTeX's
   * \showlists puts the matching pop before \@endparenv's glue, so a list's
   * closing skip still collapses with what follows.
   */
  readonly listColorWhatsits?: boolean;
  /** \prevdepth when the list starts; undefined means "ignore" (-1000pt). */
  readonly prevDepth?: number;
  readonly lineskip?: number;
  readonly lineskipLimit?: number;
  /** The list starts in horizontal mode (TikZ node text with a text width begins a paragraph). */
  readonly horizontal?: boolean;
}

/** What baseline glue needs to know about a box appended to the list (tex.web §679). */
export interface VerticalBoxMetrics {
  readonly height: number;
  readonly depth: number;
  /** \baselineskip in force for this box (natural size). */
  readonly baselineSkip: number;
}

export class VerticalListBuilder {
  private readonly nodes: VerticalListNode[] = [];
  private readonly levels: ListLevel[] = [];
  private parskip: VerticalGlue;
  private outerParskip: VerticalGlue;
  private horizontal = false;
  /** An explicit \par (or nothing yet) separates the current point from the last paragraph. */
  private afterExplicitPar = true;
  private minipage: boolean;
  private inLabel = false;
  private newList = false;
  private noParItem = false;
  private readonly itemPenalty: number;
  private readonly beginParPenalty: number;
  private readonly endParPenalty: number;
  private readonly listColorWhatsits: boolean;
  /** \prevdepth, or undefined for TeX's ignore_depth. */
  private prevDepthValue: number | undefined;
  private readonly lineskip: number;
  private readonly lineskipLimit: number;

  constructor(options: VerticalListBuilderOptions = {}) {
    this.parskip = options.parskip ?? ZERO_GLUE;
    this.outerParskip = this.parskip;
    this.minipage = options.minipage === true;
    this.itemPenalty = options.itemPenalty ?? -51;
    this.beginParPenalty = options.beginParPenalty ?? -51;
    this.endParPenalty = options.endParPenalty ?? -51;
    this.listColorWhatsits = options.listColorWhatsits === true;
    this.prevDepthValue = options.prevDepth;
    this.lineskip = options.lineskip ?? 1;
    this.lineskipLimit = options.lineskipLimit ?? 0;
    this.horizontal = options.horizontal === true;
  }

  get prevDepth(): number | undefined {
    return this.prevDepthValue;
  }

  get inHorizontalMode(): boolean {
    return this.horizontal;
  }

  /**
   * append_to_vlist (tex.web §679): baselineskip − prevdepth − height, or
   * \lineskip when that is below \lineskiplimit; none after ignore_depth.
   */
  private appendBoxWithInterline(id: string, metrics: VerticalBoxMetrics | undefined): void {
    if (metrics && this.prevDepthValue !== undefined) {
      // TeX works in scaled points.
      const gap = roundTexPt(metrics.baselineSkip - this.prevDepthValue - metrics.height);
      this.nodes.push({ kind: "glue", glue: glue(gap < this.lineskipLimit ? this.lineskip : gap), origin: "interline" });
    }
    this.nodes.push({ kind: "box", id });
    if (metrics) this.prevDepthValue = metrics.depth;
  }

  /** An explicit \prevdepth assignment (undefined: ignore_depth). */
  setPrevDepth(depth: number | undefined): void {
    this.prevDepthValue = depth;
  }

  /** \nointerlineskip: \prevdepth := -1000pt. */
  noInterline(): void {
    this.prevDepthValue = undefined;
  }

  /** A rule in vertical mode: no baseline glue before it, ignore_depth after it (tex.web §1056). */
  rule(id: string): void {
    this.horizontal = false;
    this.nodes.push({ kind: "box", id });
    this.prevDepthValue = undefined;
  }

  /**
   * A display ends the current paragraph's lines, then appends
   * \predisplaypenalty and the above skip (tex.web §1203). `ref` carries the
   * resolved display glue item.
   */
  displayAbove(above: VerticalGlue, ref?: unknown): void {
    this.horizontal = false;
    this.nodes.push({ kind: "penalty", penalty: 10_000 });
    this.vskip(above, "display-above", ref);
  }

  /** The display box, with baseline glue from \prevdepth (tex.web §1205). */
  displayBox(id: string, metrics: VerticalBoxMetrics | undefined): void {
    this.appendBoxWithInterline(id, metrics);
  }

  /** A display alignment row whose baseline glue was computed by the alignment itself. */
  rawBox(id: string, depth: number): void {
    this.nodes.push({ kind: "box", id });
    this.prevDepthValue = depth;
  }

  /**
   * \postdisplaypenalty and the below skip; TeX then resumes horizontal mode,
   * and an immediate \par ends an empty paragraph that adds nothing (tex.web §1206).
   */
  displayBelow(below: VerticalGlue, ref?: unknown): void {
    this.nodes.push({ kind: "penalty", penalty: 0 });
    this.vskip(below, "display-below", ref);
    this.horizontal = true;
  }

  /** The nodes appended so far. */
  get list(): readonly VerticalListNode[] {
    return this.nodes;
  }

  get listDepth(): number {
    return this.levels.filter(level => level.kind !== "trivlist").length;
  }

  /** \lastskip: the last node's glue, or zero when the last node is not glue. */
  lastskip(): VerticalGlue {
    const last = this.nodes.at(-1);
    return last?.kind === "glue" ? last.glue : ZERO_GLUE;
  }

  /** \vskip; `ref` ties an authored skip to the item it came from. */
  vskip(value: VerticalGlue, origin = "vskip", ref?: unknown): void {
    this.nodes.push({ kind: "glue", glue: value, origin, ...(ref !== undefined ? { ref } : {}) });
  }

  penalty(value: number, ref?: unknown): void {
    this.nodes.push({ kind: "penalty", penalty: value, ...(ref !== undefined ? { ref } : {}) });
  }

  /** A non-discardable node, e.g. a \color stack operation in vertical mode. */
  whatsit(): void {
    this.nodes.push({ kind: "whatsit" });
  }

  private removeLastskip(): VerticalGlue {
    const last = this.nodes.at(-1);
    if (last?.kind !== "glue") return ZERO_GLUE;
    // \vskip-\lastskip cancels the tail glue; collapsing it keeps the list readable.
    this.nodes.pop();
    return last.glue;
  }

  /** \addvspace and \@xaddvskip (latex.ltx 7504–7530). */
  addvspace(value: VerticalGlue, origin = "addvspace", ref?: unknown): void {
    if (this.horizontal || this.minipage) return;
    const last = this.lastskip();
    if (last.natural === 0) {
      this.vskip(value, origin, ref);
      return;
    }
    if (last.natural < value.natural) {
      this.removeLastskip();
      this.vskip(value, origin, ref);
      return;
    }
    if (value.natural < 0 && last.natural >= 0) {
      const tail = this.removeLastskip();
      this.vskip(addGlue(value, tail), origin);
    }
  }

  /**
   * \addpenalty (latex.ltx 7531ff): the penalty goes before the tail skip,
   * so \lastskip still sees that skip afterwards.
   */
  addpenalty(value: number): void {
    if (this.horizontal || this.minipage) return;
    const last = this.nodes.at(-1);
    if (last?.kind !== "glue") {
      this.penalty(value);
      return;
    }
    this.nodes.splice(this.nodes.length - 1, 0, { kind: "penalty", penalty: value });
  }

  /** \par in horizontal mode ends the paragraph; in vertical mode it does nothing. */
  par(explicit = false): void {
    this.horizontal = false;
    if (explicit) this.afterExplicitPar = true;
  }

  /**
   * A paragraph (or \leavevmode) starts: \parskip unless the list is empty
   * or the container is still in minipage mode, then \everypar's effects from
   * \@item: \@minipagefalse, \@newlistfalse, the pending label is placed.
   */
  startParagraph(id: string, metrics?: VerticalBoxMetrics): void {
    if (this.horizontal) {
      // Lines resumed after a display belong to the same paragraph: no \parskip.
      this.appendBoxWithInterline(id, metrics);
      return;
    }
    if (this.nodes.length > 0 && !this.minipage) this.vskip(this.parskip, `${this.levels.at(-1)?.kind ?? "list"}:parskip`);
    this.afterExplicitPar = false;
    this.minipage = false;
    this.newList = false;
    this.inLabel = false;
    this.horizontal = true;
    this.appendBoxWithInterline(id, metrics);
  }

  /**
   * A box appended in vertical mode (a block, a columns box, …). When the
   * box's first paragraph ran \@item's \everypar, it placed the pending
   * labels and cleared @inlabel, @newlist and @minipage.
   */
  box(id: string, consumesItemLabels = false, metrics?: VerticalBoxMetrics): void {
    this.horizontal = false;
    this.appendBoxWithInterline(id, metrics);
    if (consumesItemLabels) {
      this.inLabel = false;
      this.newList = false;
      this.noParItem = false;
      this.minipage = false;
    }
  }

  /** An item label from an enclosing container is still pending (@inlabel is global). */
  inheritPendingLabel(): void {
    this.inLabel = true;
  }

  get pendingLabel(): boolean {
    return this.inLabel;
  }

  /** \@trivlist (latex.ltx 12829). */
  private trivlistCore(kind: ListLevel["kind"], topsep: VerticalGlue, partopsep: VerticalGlue, itemsep: VerticalGlue, parsep: VerticalGlue): void {
    let topsepAdd = topsep;
    // \@trivlist adds \partopsep in vertical mode. LuaLaTeX gives none for a list or alignment that
    // opens right after another one closed without an explicit \par (test/tex-shaping.spec.ts,
    // "keeps separate trivlist boundary glue across an authored penalty"), so only an explicit \par counts.
    if (!this.horizontal && this.afterExplicitPar) topsepAdd = addGlue(topsepAdd, partopsep);
    else this.par();
    const noParList = this.inLabel;
    if (noParList) this.noParItem = true;
    const listTopsep = addGlue(noParList ? ZERO_GLUE : topsepAdd, this.parskip);
    const savedParskip = this.parskip;
    const savedOuterParskip = this.outerParskip;
    this.newList = true;
    // \@outerparskip\parskip, then \list sets \parskip\parsep.
    this.outerParskip = this.parskip;
    this.parskip = parsep;
    this.levels.push({ kind, topsepAdd, topsep: listTopsep, itemsep, topsepRegister: undefined, noParList, outerParskip: this.outerParskip,
      parskip: this.parskip, savedParskip, savedOuterParskip });
  }

  /** \list (latex.ltx 12806) with registers from \@list<depth> and the list's own argument. */
  beginList(registers: VerticalListRegisters, colorWhatsit = this.listColorWhatsits): void {
    // In horizontal mode the color node goes into the paragraph that \@trivlist ends.
    if (colorWhatsit && !this.horizontal) this.whatsit();
    this.trivlistCore("list", registers.topsep, registers.partopsep, registers.itemsep, registers.parsep);
  }

  /** quote and quotation: \list with an empty \item (article.cls). */
  beginQuote(registers: VerticalListRegisters): void {
    this.trivlistCore("quote", registers.topsep, registers.partopsep, registers.itemsep, registers.parsep);
    this.item();
  }

  /**
   * \trivlist (latex.ltx 12861) followed by the environment's \item\relax,
   * as center, flushleft and flushright do. \trivlist sets \parsep to \parskip.
   */
  beginTrivlist(registers: VerticalTrivlistRegisters): void {
    this.trivlistCore("trivlist", registers.topsep, registers.partopsep, ZERO_GLUE, this.parskip);
    this.item();
  }

  /** A register assignment such as \setlength{\itemsep}{8pt} at the current level. */
  setRegister(name: "topsep" | "partopsep" | "itemsep" | "parsep" | "parskip", value: VerticalGlue): void {
    const level = this.levels.at(-1);
    if (name === "parskip") this.parskip = value;
    else if (name === "itemsep" && level) level.itemsep = value;
    else if (name === "topsep" && level) level.topsepRegister = value;
  }

  /** The \topsep register an alignment opened here would read, if inside a list. */
  currentTopsep(): VerticalGlue | undefined {
    return this.levels.at(-1)?.topsepRegister;
  }

  /** \@item (latex.ltx 12921), the vertical part. */
  item(): void {
    const level = this.levels.at(-1);
    if (!level) return;
    if (this.noParItem) {
      // \@donoparitem (latex.ltx 12909).
      this.noParItem = false;
      if (!this.minipage) {
        const tail = this.removeLastskip();
        this.vskip(addGlue(addGlue(tail, this.outerParskip), negateGlue(this.parskip)), `${level.kind}:donoparitem`);
      }
    } else {
      if (this.horizontal) this.par();
      if (this.newList) {
        this.addpenalty(this.beginParPenalty);
        this.addvspace(level.topsep, `${level.kind}:topsep`);
        this.addvspace(negateGlue(this.parskip), `${level.kind}:topsep-parskip`);
      } else {
        this.addpenalty(this.itemPenalty);
        this.addvspace(level.itemsep, `${level.kind}:itemsep`);
      }
    }
    this.inLabel = true;
  }

  /** \endtrivlist and \@endparenv (latex.ltx 12873, 12895). */
  endList(): void {
    const level = this.levels.pop();
    if (!level) return;
    if (this.inLabel) {
      // \leavevmode places the pending label as an empty line.
      this.startParagraph(`label-line:${this.nodes.length}`);
      this.inLabel = false;
    }
    this.newList = false;
    this.par();
    if (!level.noParList) {
      const last = this.lastskip();
      if (last.natural > 0) {
        this.removeLastskip();
        this.vskip(addGlue(addGlue(last, this.parskip), negateGlue(this.outerParskip)), `${level.kind}:endtrivlist`);
      }
      this.addpenalty(this.endParPenalty);
      this.addvspace(level.topsepAdd, `${level.kind}:endparenv`);
    }
    // The environment group restores \parskip and \@outerparskip.
    this.parskip = level.savedParskip;
    this.outerParskip = level.savedOuterParskip;
  }

  /**
   * Glue between the previous box accepted by `isAnchor` and the box with this
   * id, leaving out glue whose origin `exclude` rejects.
   */
  glueSince(id: string, isAnchor: (boxId: string) => boolean, exclude: (origin: string) => boolean = () => false): VerticalGlue {
    const index = this.nodes.findIndex(node => node.kind === "box" && node.id === id);
    if (index < 0) return ZERO_GLUE;
    let total = ZERO_GLUE;
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      const node = this.nodes[cursor];
      if (!node) break;
      if (node.kind === "box" && isAnchor(node.id)) break;
      if (node.kind === "glue" && !exclude(node.origin)) total = addGlue(total, node.glue);
    }
    return total;
  }

  /** Total glue between the previous box and the box with this id. */
  glueBefore(id: string): VerticalGlue {
    const index = this.nodes.findIndex(node => node.kind === "box" && node.id === id);
    if (index < 0) return ZERO_GLUE;
    let total = ZERO_GLUE;
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      const node = this.nodes[cursor];
      if (!node || node.kind === "box") break;
      if (node.kind === "glue") total = addGlue(total, node.glue);
    }
    return total;
  }
}
