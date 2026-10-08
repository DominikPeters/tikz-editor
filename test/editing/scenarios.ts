import type { Scenario } from "../../packages/core/src/editing/testing/index.js";

const R = String.raw;
const itemize = (...lines: string[]) => ["\\begin{itemize}", ...lines, "\\end{itemize}"].join("\n");
const R_MACRO = R`\newcommand{\R}{\mathbb{R}}`;
const EE_MACRO = R`\newcommand{\ee}[1]{\textcolor{red}{#1}}`;
const INNER_MACRO = R`\newcommand{\inner}[2]{\left\langle #1,#2\right\rangle}`;

/**
 * Today's canvas-focus behavior, pinned so that refactors (architecture
 * slices 2–3) could prove they change nothing. Entries marked "bug" are
 * behaviors the scenarios doc replaces; each is removed when the contract
 * replacing it passes (step 4 removed the motion, deletion and script
 * ones).
 */
export const characterisationScenarios: readonly Scenario[] = [
  { id: "prose →", title: "→ moves one character in prose", body: "Le‸t us go.", keys: "→", expect: "Let‸ us go." },
  { id: "bold edge", title: "one → crosses the closing brace of \\textbf (two stops)", body: R`Some \textbf{bold‸} text.`, keys: "→", expect: R`Some \textbf{bold}‸ text.` },
  { id: "list ⏎", title: "⏎ splits an item", body: itemize(R`\item First‸ one`, R`\item Second`), keys: "⏎", expect: itemize(R`\item First`, R`\item ‸one`, R`\item Second`) },
  { id: "list ⏎ empty last", title: "⏎ on an empty last item exits the list", body: itemize(R`\item First`, R`\item ‸`) + "\nAfter.", keys: "⏎", expect: itemize(R`\item First`) + "\n‸\nAfter." },
  { id: "list ⌫ item start", title: "⌫ at item start merges into the previous item", body: itemize(R`\item First`, R`\item ‸Second`), keys: "⌫", expect: itemize(R`\item First ‸Second`) },
  { id: "list ⇥", title: "⇥ nests an item", body: itemize(R`\item First`, R`\item ‸Second`), keys: "⇥", expect: itemize(R`\item First`, R`\begin{itemize}`, R`\item ‸Second`, R`\end{itemize}`) },
  { id: "⇧⏎", title: "⇧⏎ inserts a line break", body: "One‸ two.", keys: "⇧⏎", expect: R`One \\ ‸two.` },
  { id: "prose ⏎", title: "⏎ in prose inserts a paragraph break", body: "One‸ two.", keys: "⏎", expect: "One\n\n‸two." },
  { id: "math ⏎", title: "⏎ inside inline math is swallowed", body: "Let $a‸+b$ be.", keys: "⏎", expect: "Let $a‸+b$ be." },
  { id: "⌘B wraps", title: "⌘B wraps a selection", body: "Make ⟦this⟧ bold.", keys: "⌘B", expect: R`Make \textbf{⟦this⟧} bold.` },
  { id: "⌘B mid-run", title: "⌘B mid-run splits the run in place", body: R`\textbf{one ‸two}`, keys: "⌘B", expect: R`\textbf{one }‸\textbf{two}` },
  { id: "% (bug)", title: "% is inserted raw (a comment)", body: "Up by 5‸ overall.", keys: "%", expect: "Up by 5%‸ overall." },
  { id: "$ (bug)", title: "$ is not paired", body: "Let ‸ be.", keys: "$x", expect: "Let $x‸ be." },
  { id: "⇧→ in math", title: "⇧→ selects one symbol inside a formula", body: R`$a‸+b$`, keys: "⇧→", expect: R`$a⟦+⟧b$` },
  { id: "↓", title: "↓ moves to the nearest x on the next rendered row", body: itemize(R`\item Alpha beta‸ gamma`, R`\item Delta epsilon zeta`), keys: "↓", expect: itemize(R`\item Alpha beta gamma`, R`\item Delta epsil‸on zeta`) },
  { id: "Home", title: "Home goes to the row start", body: "One two‸ three.", keys: "Home", expect: "‸One two three." },
  { id: "End", title: "End goes to the row end", body: "One two‸ three.", keys: "End", expect: "One two three.‸" },
];

/**
 * Target behavior from design/canvas-keyboard-scenarios.md, written before
 * the editing core exists (architecture "Contract tests first"). These are
 * plain assertions run against today's editor, so every contract it does
 * not yet meet is a failing test until the new editing core replaces the
 * legacy driver. Carets are written at canonical offsets: a position
 * between two children sits at the start of the next child, after any
 * invisible whitespace (`$A\cup ‸B$`, not `$A\cup‸ B$`).
 */
export const contractScenarios: readonly Scenario[] = [
  // Navigation: one press per visible step (R7, N1).
  { id: "N1", title: "crossing $A\\setminus B$ takes five presses", body: R`‸$A\setminus B$ x`, keys: "→×5", expect: R`$A\setminus B$‸ x` },
  { id: "N1 frac", title: "→ enters the numerator, then the denominator", body: R`‸$\frac{a}{b}$ x`, keys: "→×4", expect: R`$\frac{a}{‸b}$ x` },
  { id: "R8 bold", title: "the inside and outside of \\textbf are separate stops", body: R`\textbf{bold‸} x`, keys: "→", expect: R`\textbf{bold}‸ x` },
  { id: "R8 formula", title: "the inside and outside of a formula are separate stops", body: R`$x‸$ y`, keys: "→", expect: R`$x$‸ y` },
  // Deletion (R9, O2, O3).
  { id: "M7", title: "replace \\setminus with \\cup", body: R`$A\setminus B‸$`, keys: R`← ⌫ \cup␣`, expect: R`$A\cup ‸B$` },
  { id: "R9 bold", title: "⌫ after a bold run deletes its last character", body: R`\textbf{bold}‸ x`, keys: "⌫", expect: R`\textbf{bol‸} x` },
  { id: "R9 formula", title: "⌫ after a formula selects it first", body: R`Let $x$‸ be.`, keys: "⌫", expect: R`Let ⟦‸$x$⟧ be.` },
  { id: "R9 formula twice", title: "a second ⌫ deletes the selected formula", body: R`Let $x$‸ be.`, keys: "⌫ ⌫", expect: R`Let ‸ be.` },
  { id: "R9 repeat", title: "auto-repeat never confirms a select-then-delete", body: R`Let $x$‸ be.`, keys: "⌫ ⌫↻", expect: R`Let ⟦‸$x$⟧ be.` },
  { id: "M11", title: "⌫ after a fraction selects it", body: R`$\frac{a}{b}‸+c$`, keys: "⌫", expect: R`$⟦‸\frac{a}{b}⟧+c$` },
  { id: "O2 empty denominator", title: "⌫ in an empty denominator moves to the numerator", body: R`$\frac{a}{‸}$`, keys: "⌫", expect: R`$\frac{a‸}{}$` },
  { id: "O3 backward", title: "⌫ after x² deletes the 2 and the empty script", body: R`$ax^2 ‸$ y`, keys: "⌫", expect: R`$ax ‸$ y` },
  { id: "O3 forward", title: "⌦ before a scripted base selects the whole scripted atom", body: R`$a‸x^2$`, keys: "⌦", expect: R`$a⟦x^2⟧$` },
  { id: "F5", title: "deleting a range across \\textbf{ keeps the wrapper", body: R`a⟦b\textbf{c⟧d}e`, keys: "⌫", expect: R`a‸\textbf{d}e` },
  // Scripts (R6, K4).
  { id: "R6", title: "typing into an unbraced script adds braces", body: R`$x^‸2 +1$`, keys: "→ 3", expect: R`$x^{23‸} +1$` },
  { id: "K4", title: "a second ^ enters the existing superscript", body: R`$x^2 ‸+1$`, keys: "^3", expect: R`$x^{23‸} +1$` },
  // Input rules (R2, R3, K9).
  { id: "R2 %", title: "% in prose is escaped", body: "Up by 5‸ overall.", keys: "%", expect: R`Up by 5\%‸ overall.` },
  { id: "R3 $", title: "$ opens a formula with its closer", body: "Let ‸ be.", keys: "$x", expect: "Let $x‸$ be." },
  { id: "R3 $ step over", title: "typing the closing $ steps over it", body: "Let ‸.", keys: "$x$␣be", expect: "Let $x$ be‸." },
  { id: "K9", title: "[ at item content start is protected from \\item's optional argument", body: itemize(R`\item ‸more`), keys: "[0,1]", expect: itemize(R`\item {}[0,1]‸more`) },
  // Enter ownership (O1, Z1).
  { id: "Z1", title: "⏎ mid-formula splits it when both halves are valid", body: "Let $a‸+b$ be.", keys: "⏎", expect: "Let $a$\n\n$‸+b$ be." },
  { id: "O1 text-in-math", title: "⏎ in a formula inside \\text{} does nothing", body: R`$\text{one $a‸+b$ two}$`, keys: "⏎", expect: R`$\text{one $a‸+b$ two}$` },
  { id: "O1 slot", title: "⏎ in a fraction slot does nothing", body: R`$\frac{a‸+b}{c}$`, keys: "⏎", expect: R`$\frac{a‸+b}{c}$` },
  // Selection (R9 promotion, N3).
  { id: "N3 inside", title: "a selection inside one slot is free", body: R`$a‸+b$`, keys: "⇧→", expect: R`$a⟦+⟧b$` },
  { id: "N3 crossing", title: "a selection crossing into a formula covers all of it", body: R`a‸b $x+y$`, keys: "⇧→×3", expect: R`a⟦b $x+y$⟧` },
  // Formatting (F1).
  { id: "F1 mid-run", title: "⌘B mid-run splits in place without moving the caret", body: R`\textbf{one ‸two}`, keys: "⌘B", expect: R`\textbf{one }‸\textbf{two}` },
];

const align = (...rows: string[]) => ["\\begin{align*}", ...rows.map((row) => `  ${row}`), "\\end{align*}"].join("\n");

/**
 * Edges of the tree-backed motion, selection and deletion (step 4), beyond
 * the contracts: cleanup after deletions, looking through wrappers,
 * invisible items, slot edges and alignment rows.
 */
export const treeEditingScenarios: readonly Scenario[] = [
  // Motion (R7, R11).
  { id: "→ \\label", title: "→ does not stop on both sides of \\label", body: R`a‸\label{x}b`, keys: "→", expect: R`a\label{x}b‸` },
  { id: "→ {}", title: "→ does not stop inside or after a {} terminator", body: R`\LaTeX‸{} is`, keys: "→", expect: R`\LaTeX{} ‸is` },
  { id: "→ paragraphs", title: "crossing a paragraph break costs one press", body: "One‸.\n\nTwo.", keys: "→ → →", expect: "One.\n\nT‸wo." },
  { id: "→ align rows", title: "crossing an alignment row break costs one press", body: align(R`a &= b‸ \\`, "c &= d"), keys: "→ → →", expect: align(R`a &= b \\`, "c &‸= d") },
  { id: "→ hidden overlay", title: "→ skips overlay content hidden on this step", body: R`a‸ \only<2>{xy} b`, keys: "→ →", expect: R`a \only<2>{xy} ‸b` },
  { id: "→ shown overlay", title: "→ enters overlay content shown on this step", step: 2, body: R`a‸ \only<2>{xy} b`, keys: "→ →", expect: R`a \only<2>{‸xy} b` },
  { id: "⌫ hidden overlay", title: "⌫ passes over overlay content hidden on this step", body: R`a \only<2>{xy}‸b`, keys: "⌫", expect: R`a‸\only<2>{xy}b` },
  { id: "→ after \\pause", title: "→ does not enter a paragraph \\pause hides on this step", body: "One‸.\n\\pause\n\nTwo.\n\nThree.", keys: "→ →", expect: "One.‸\n\\pause\n\nTwo.\n\nThree." },
  // Selection (N3).
  { id: "⇧← releases", title: "⇧← back out of a formula releases the promotion", body: R`a‸b $x$`, keys: "⇧→ ⇧→ ⇧→ ⇧←", expect: R`a⟦b ⟧$x$` },
  { id: "⇧← out of math", title: "a selection leaving a formula covers all of it", body: R`$a+b‸$ c`, keys: "⇧← ⇧← ⇧← ⇧←", expect: R`⟦‸$a+b$⟧ c` },
  { id: "F6", title: "typing over a selection crossing into bold keeps the wrapper", body: R`a⟦b\textbf{c⟧d}`, keys: "X", expect: R`aX‸\textbf{d}` },
  // ⌫ and ⌦ (R9, O2, O3, R5).
  { id: "⌫ symbol R5", title: "deleting a symbol keeps the previous control word terminated", body: R`$\alpha\setminus ‸b$`, keys: "⌫", expect: R`$\alpha ‸b$` },
  { id: "⌫ unbraced numerator", title: "emptying an unbraced argument puts braces back", body: R`$‸\frac1n$`, keys: "→ → ⌫", expect: R`$\frac{‸}n$` },
  { id: "⌫ empty bold", title: "a style wrapper disappears with its last character", body: R`a\textbf{d}‸ x`, keys: "⌫", expect: R`a‸ x` },
  { id: "⌫ nested wrappers", title: "nested wrappers disappear together", body: R`a\textit{\textbf{d}}‸ x`, keys: "⌫", expect: R`a‸ x` },
  { id: "⌫ formula start", title: "⌫ at a formula's start steps out", body: R`$‸x$`, keys: "⌫", expect: R`‸$x$` },
  { id: "⌫ bold start", title: "⌫ at a wrapper's start deletes the character before it", body: R`a\textbf{‸b}`, keys: "⌫", expect: R`‸\textbf{b}` },
  { id: "⌦ bold", title: "⌦ before a one-character wrapper removes it", body: R`‸\textbf{b}c`, keys: "⌦", expect: R`‸c` },
  { id: "⌦ formula", title: "⌦ before a formula selects it", body: R`a‸$x$`, keys: "⌦", expect: R`a⟦$x$⟧` },
  { id: "⌦ numerator end", title: "⌦ at the end of the numerator moves to the denominator", body: R`$\frac{a‸}{b}$`, keys: "⌦", expect: R`$\frac{a}{‸b}$` },
  { id: "⌫ script start", title: "⌫ at a superscript's start moves to the base", body: R`$x^{‸2}$`, keys: "⌫", expect: R`$x‸^{2}$` },
  { id: "⌫ empty script", title: "⌫ in an empty superscript removes it", body: R`$x^{‸}$`, keys: "⌫", expect: R`$x‸$` },
  { id: "⌫ inside script", title: "⌫ inside a script keeps its empty braces", body: R`$x^{2‸}$`, keys: "⌫", expect: R`$x^{‸}$` },
  { id: "⌫ into script", title: "⌫ after a longer script deletes its last character", body: R`$x^{23}‸$`, keys: "⌫", expect: R`$x^{2‸}$` },
  { id: "⌫ \\label", title: "⌫ skips an invisible \\label", body: R`ab\label{x}‸ c`, keys: "⌫", expect: R`a‸\label{x} c` },
  { id: "⌫ range in bold", title: "deleting all of a wrapper's content removes it", body: R`\textbf{⟦abc⟧}d`, keys: "⌫", expect: R`‸d` },
  { id: "⌫ row start", title: "⌫ at a row's start moves to the previous row's end", body: align(R`a &= b \\`, "‸c &= d"), keys: "⌫", expect: align(R`a &= b ‸\\`, "c &= d") },
  { id: "⌫ cell start", title: "⌫ at a cell's start moves to the previous cell's end", body: align(R`a &= b \\`, "c &‸= d"), keys: "⌫", expect: align(R`a &= b \\`, "c ‸&= d") },
  // User macros (K1): style macros edit like \\textbf, symbol macros are units, the rest atoms.
  { id: "K1 ⌫", title: "⌫ after a style macro deletes its last character", preamble: EE_MACRO, body: R`\ee{bold}‸ x`, keys: "⌫", expect: R`\ee{bol‸} x` },
  { id: "K1 stops", title: "a style macro has an inside and an outside stop", preamble: EE_MACRO, body: R`\ee{a‸} x`, keys: "→", expect: R`\ee{a}‸ x` },
  { id: "K1 typing", title: "typing inside a style macro extends its argument", preamble: EE_MACRO, body: R`‸x \ee{a}`, keys: "→ → → → x", expect: R`x \ee{ax‸}` },
  { id: "K1 symbol", title: "⌫ deletes a symbol macro in one press", preamble: R_MACRO, body: R`$x\in\R‸$`, keys: "⌫", expect: R`$x\in‸$` },
  { id: "K1 atom", title: "⌫ after a two-argument macro selects it", preamble: INNER_MACRO, body: R`$\inner{a}{b}‸$`, keys: "⌫", expect: R`$⟦‸\inner{a}{b}⟧$` },
  // Scripts (K4).
  { id: "K4 _", title: "a second _ enters the existing subscript", body: R`$x_1 ‸+1$`, keys: "_2", expect: R`$x_{12‸} +1$` },
  { id: "K4 missing", title: "^ after a subscript adds the missing superscript", body: R`$x_1‸$`, keys: "^2", expect: R`$x_1^2‸$` },
];

/**
 * Undo grouping (architecture "Transactions"): a typing run is one step;
 * it ends at a pause, a caret move, or a switch between typing and
 * deleting. Structural edits are their own step.
 */
export const undoScenarios: readonly Scenario[] = [
  { id: "undo run", title: "a typing run is one undo step", body: "a‸", keys: "bcd ⌘Z", expect: "a‸" },
  { id: "undo pause", title: "a pause ends the typing run", body: "a‸", keys: "bc ⏸ de ⌘Z", expect: "abc‸" },
  { id: "undo caret move", title: "a caret move ends the typing run", body: "a‸ z", keys: "bc ← → d ⌘Z", expect: "abc‸ z" },
  { id: "undo ⌫ run", title: "consecutive ⌫ are one step", body: "abcd‸", keys: "⌫ ⌫ ⌘Z", expect: "abcd‸" },
  { id: "undo type then ⌫", title: "typing and deleting are separate steps", body: "a‸", keys: "bc ⌫ ⌘Z", expect: "abc‸" },
  { id: "undo structural", title: "an item split is its own step", body: itemize(R`\item First‸`), keys: "⏎ x ⌘Z", expect: itemize(R`\item First`, R`\item ‸`) },
  { id: "undo structural twice", title: "undoing past an item split restores the item", body: itemize(R`\item First‸`), keys: "⏎ x ⌘Z ⌘Z", expect: itemize(R`\item First‸`) },
  { id: "redo", title: "⇧⌘Z redoes the run", body: "a‸", keys: "bc ⌘Z ⇧⌘Z", expect: "abc‸" },
];

/**
 * Typing ahead of layout (revision protocol): keys that read the layout
 * wait for it, and later keys wait behind them. Run with the burst driver,
 * these must end exactly where the eager driver ends.
 */
export const burstScenarios: readonly Scenario[] = [
  { id: "burst type ⏎ type", title: "type, split the item, keep typing", body: itemize(R`\item First‸`), keys: "ly ⏎ Next", expect: itemize(R`\item Firstly`, R`\item Next‸`) },
  { id: "burst type → ⌫", title: "type, move, delete", body: "One‸ two.", keys: "x → → ⌫", expect: "Onex ‸wo." },
  { id: "burst type ⇥ type", title: "type, nest, type", body: itemize(R`\item First`, R`\item ‸`), keys: "Se ⇥ cond", expect: itemize(R`\item First`, R`\begin{itemize}`, R`\item Second‸`, R`\end{itemize}`) },
  { id: "burst ↓ after typing", title: "↓ after typing uses the new layout", body: itemize(R`\item Alpha beta‸`, R`\item Delta epsilon zeta`), keys: "␣gamma ↓", expect: itemize(R`\item Alpha beta gamma`, R`\item Delta epsilon zeta‸`) },
];
