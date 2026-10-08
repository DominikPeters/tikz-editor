import type { Scenario } from "../../packages/core/src/editing/testing/index.js";

const R = String.raw;
const itemize = (...lines: string[]) => ["\\begin{itemize}", ...lines, "\\end{itemize}"].join("\n");
const R_MACRO = R`\newcommand{\R}{\mathbb{R}}`;

/**
 * Today's canvas-focus behavior, pinned so that refactors (architecture
 * slices 2–3) can prove they change nothing, and so that the intended
 * changes in slice 4 show up as explicit expectation flips. Entries marked
 * "bug" are behaviors the scenarios doc replaces.
 */
export const characterisationScenarios: readonly Scenario[] = [
  { id: "prose →", title: "→ moves one character in prose", body: "Le‸t us go.", keys: "→", expect: "Let‸ us go." },
  { id: "math → (bug)", title: "→ crawls through \\setminus one source character at a time", body: R`$A‸\setminus B$`, keys: "→×3", expect: R`$A\se‸tminus B$` },
  { id: "frac → (bug)", title: "→ crawls through \\frac's source", body: R`$‸\frac{a}{b}$ x`, keys: "→×4", expect: R`$\fra‸c{a}{b}$ x` },
  { id: "bold edge", title: "one → crosses the closing brace of \\textbf (two stops)", body: R`Some \textbf{bold‸} text.`, keys: "→", expect: R`Some \textbf{bold}‸ text.` },
  { id: "list ⏎", title: "⏎ splits an item", body: itemize(R`\item First‸ one`, R`\item Second`), keys: "⏎", expect: itemize(R`\item First`, R`\item ‸one`, R`\item Second`) },
  { id: "list ⏎ empty last", title: "⏎ on an empty last item exits the list", body: itemize(R`\item First`, R`\item ‸`) + "\nAfter.", keys: "⏎", expect: itemize(R`\item First`) + "\n‸\nAfter." },
  { id: "list ⌫ item start", title: "⌫ at item start merges into the previous item", body: itemize(R`\item First`, R`\item ‸Second`), keys: "⌫", expect: itemize(R`\item First ‸Second`) },
  { id: "list ⇥", title: "⇥ nests an item", body: itemize(R`\item First`, R`\item ‸Second`), keys: "⇥", expect: itemize(R`\item First`, R`\begin{itemize}`, R`\item ‸Second`, R`\end{itemize}`) },
  { id: "⇧⏎", title: "⇧⏎ inserts a line break", body: "One‸ two.", keys: "⇧⏎", expect: R`One \\ ‸two.` },
  { id: "prose ⏎", title: "⏎ in prose inserts a paragraph break", body: "One‸ two.", keys: "⏎", expect: "One\n\n‸two." },
  { id: "math ⏎", title: "⏎ inside inline math is swallowed", body: "Let $a‸+b$ be.", keys: "⏎", expect: "Let $a‸+b$ be." },
  { id: "⌫ after formula (bug)", title: "⌫ after a formula deletes its closing $", preamble: R_MACRO, body: R`Let $x\in\R^n$‸ be.`, keys: "⌫", expect: R`Let $x\in\R^n‸ be.` },
  { id: "⌘B wraps", title: "⌘B wraps a selection", body: "Make ⟦this⟧ bold.", keys: "⌘B", expect: R`Make \textbf{⟦this⟧} bold.` },
  { id: "⌘B mid-run", title: "⌘B mid-run splits the run in place", body: R`\textbf{one ‸two}`, keys: "⌘B", expect: R`\textbf{one }‸\textbf{two}` },
  { id: "% (bug)", title: "% is inserted raw (a comment)", body: "Up by 5‸ overall.", keys: "%", expect: "Up by 5%‸ overall." },
  { id: "$ (bug)", title: "$ is not paired", body: "Let ‸ be.", keys: "$x", expect: "Let $x‸ be." },
  { id: "⌫ after bold (bug)", title: "⌫ after a bold run deletes its closing brace", body: R`\textbf{bold}‸ x`, keys: "⌫", expect: R`\textbf{bold‸ x` },
  { id: "⇧→ in math", title: "⇧→ selects one symbol inside a formula", body: R`$a‸+b$`, keys: "⇧→", expect: R`$a⟦+⟧b$` },
  { id: "↓", title: "↓ moves to the nearest x on the next rendered row", body: itemize(R`\item Alpha beta‸ gamma`, R`\item Delta epsilon zeta`), keys: "↓", expect: itemize(R`\item Alpha beta gamma`, R`\item Delta epsil‸on zeta`) },
  { id: "Home", title: "Home goes to the row start", body: "One two‸ three.", keys: "Home", expect: "‸One two three." },
  { id: "End", title: "End goes to the row end", body: "One two‸ three.", keys: "End", expect: "One two three.‸" },
  { id: "script typing (bug)", title: "typing after a script digit leaves the script unbraced", body: R`$x^‸2 +1$`, keys: "→ 3", expect: R`$x^23‸ +1$` },
  { id: "second ^ (bug)", title: "a second ^ creates a double superscript", body: R`$x^2 ‸+1$`, keys: "^3", expect: R`$x^2 ^3‸+1$` },
  { id: "⌫ after frac (bug)", title: "⌫ after a fraction deletes its closing brace", body: R`$\frac{a}{b}‸+c$`, keys: "⌫", expect: R`$\frac{a}{b‸+c$` },
  { id: "range ⌫ across \\textbf (bug)", title: "deleting a range across \\textbf{ leaves an unbalanced brace", body: R`a⟦b\textbf{c⟧d}e`, keys: "⌫", expect: R`a‸d}e` },
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
