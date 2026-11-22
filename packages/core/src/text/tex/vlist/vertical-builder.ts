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
  | { readonly kind: "glue"; readonly glue: VerticalGlue; readonly origin: string }
  | { readonly kind: "penalty"; readonly penalty: number }
  | { readonly kind: "whatsit" }
  | { readonly kind: "box"; readonly id: string };

interface ListLevel {
  readonly kind: "list" | "trivlist";
  /** \@topsepadd, captured at \@trivlist and used by \@endparenv. */
  readonly topsepAdd: VerticalGlue;
  /** \@topsep: opening skip used by the first \item when not @noparlist. */
  readonly topsep: VerticalGlue;
  readonly itemsep: VerticalGlue;
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
}

export class VerticalListBuilder {
  private readonly nodes: VerticalListNode[] = [];
  private readonly levels: ListLevel[] = [];
  private parskip: VerticalGlue;
  private outerParskip: VerticalGlue;
  private horizontal = false;
  private minipage: boolean;
  private inLabel = false;
  private newList = false;
  private noParItem = false;
  private readonly itemPenalty: number;
  private readonly beginParPenalty: number;
  private readonly endParPenalty: number;

  constructor(options: VerticalListBuilderOptions = {}) {
    this.parskip = options.parskip ?? ZERO_GLUE;
    this.outerParskip = this.parskip;
    this.minipage = options.minipage === true;
    this.itemPenalty = options.itemPenalty ?? -51;
    this.beginParPenalty = options.beginParPenalty ?? -51;
    this.endParPenalty = options.endParPenalty ?? -51;
  }

  /** The nodes appended so far. */
  get list(): readonly VerticalListNode[] {
    return this.nodes;
  }

  get listDepth(): number {
    return this.levels.filter(level => level.kind === "list").length;
  }

  /** \lastskip: the last node's glue, or zero when the last node is not glue. */
  lastskip(): VerticalGlue {
    const last = this.nodes.at(-1);
    return last?.kind === "glue" ? last.glue : ZERO_GLUE;
  }

  vskip(value: VerticalGlue, origin = "vskip"): void {
    this.nodes.push({ kind: "glue", glue: value, origin });
  }

  penalty(value: number): void {
    this.nodes.push({ kind: "penalty", penalty: value });
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
  addvspace(value: VerticalGlue, origin = "addvspace"): void {
    if (this.horizontal || this.minipage) return;
    const last = this.lastskip();
    if (last.natural === 0) {
      this.vskip(value, origin);
      return;
    }
    if (last.natural < value.natural) {
      this.removeLastskip();
      this.vskip(value, origin);
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
  par(): void {
    this.horizontal = false;
  }

  /**
   * A paragraph (or \leavevmode) starts: \parskip unless the list is empty
   * or the container is still in minipage mode, then \everypar's effects from
   * \@item: \@minipagefalse, \@newlistfalse, the pending label is placed.
   */
  startParagraph(id: string): void {
    if (this.horizontal) return;
    if (this.nodes.length > 0 && !this.minipage) this.vskip(this.parskip, "parskip");
    this.minipage = false;
    this.newList = false;
    this.inLabel = false;
    this.horizontal = true;
    this.nodes.push({ kind: "box", id });
  }

  /** A box appended in vertical mode (a block, a columns box, a picture paragraph's box …). */
  box(id: string): void {
    this.horizontal = false;
    this.nodes.push({ kind: "box", id });
  }

  /** \@trivlist (latex.ltx 12829). */
  private trivlistCore(kind: ListLevel["kind"], topsep: VerticalGlue, partopsep: VerticalGlue, itemsep: VerticalGlue, parsep: VerticalGlue): void {
    let topsepAdd = topsep;
    if (!this.horizontal) topsepAdd = addGlue(topsepAdd, partopsep);
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
    this.levels.push({ kind, topsepAdd, topsep: listTopsep, itemsep, noParList, outerParskip: this.outerParskip,
      parskip: this.parskip, savedParskip, savedOuterParskip });
  }

  /** \list (latex.ltx 12806) with registers from \@list<depth> and the list's own argument. */
  beginList(registers: VerticalListRegisters): void {
    this.trivlistCore("list", registers.topsep, registers.partopsep, registers.itemsep, registers.parsep);
  }

  /**
   * \trivlist (latex.ltx 12861) followed by the environment's \item\relax,
   * as center, flushleft and flushright do. \trivlist sets \parsep to \parskip.
   */
  beginTrivlist(registers: VerticalTrivlistRegisters): void {
    this.trivlistCore("trivlist", registers.topsep, registers.partopsep, ZERO_GLUE, this.parskip);
    this.item();
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
        this.vskip(addGlue(addGlue(tail, this.outerParskip), negateGlue(this.parskip)), "donoparitem");
      }
    } else {
      if (this.horizontal) this.par();
      if (this.newList) {
        this.addpenalty(this.beginParPenalty);
        this.addvspace(level.topsep, "topsep");
        this.addvspace(negateGlue(this.parskip), "topsep-parskip");
      } else {
        this.addpenalty(this.itemPenalty);
        this.addvspace(level.itemsep, "itemsep");
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
        this.vskip(addGlue(addGlue(last, this.parskip), negateGlue(this.outerParskip)), "endtrivlist");
      }
      this.addpenalty(this.endParPenalty);
      this.addvspace(level.topsepAdd, "endparenv");
    }
    // The environment group restores \parskip and \@outerparskip.
    this.parskip = level.savedParskip;
    this.outerParskip = level.savedOuterParskip;
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
