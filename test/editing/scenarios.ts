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
  { id: "⌘B wraps", title: "⌘B wraps a selection", body: "Make ⟦this⟧ bold.", keys: "⌘B", expect: R`Make \textbf{⟦this⟧} bold.` },
  { id: "⌘B mid-run", title: "⌘B mid-run splits the run in place", body: R`\textbf{one ‸two}`, keys: "⌘B", expect: R`\textbf{one }‸\textbf{two}` },
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

const tabular = (...rows: string[]) => ["\\begin{tabular}{ll}", ...rows, "\\end{tabular}"].join("\n");
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
  { id: "→ alt second", title: "typing after arrows edits only alt's visible second branch", body: R`a‸ \alt<2>{HIDDEN}{shown} b`, keys: "→ → → X", expect: R`a \alt<2>{HIDDEN}{sX‸hown} b` },
  { id: "→ alt first", title: "typing after arrows edits only alt's visible first branch", step: 2, body: R`a‸ \alt<2>{shown}{HIDDEN} b`, keys: "→ → → X", expect: R`a \alt<2>{sX‸hown}{HIDDEN} b` },
  { id: "⌫ alt second", title: "Backspace leaves a visible branch without entering its hidden predecessor", body: R`a \alt<2>{HIDDEN}{‸shown} b`, keys: "⌫", expect: R`a ‸\alt<2>{HIDDEN}{shown} b` },
  { id: "⌦ alt first", title: "Delete leaves a visible branch without entering its hidden successor", step: 2, body: R`a \alt<2>{shown‸}{HIDDEN} b`, keys: "⌦", expect: R`a \alt<2>{shown}{HIDDEN}‸ b` },
  { id: "} alt first", title: "a closing brace leaves the visible branch past its hidden successor", step: 2, body: R`a \alt<2>{shown‸}{HIDDEN} b`, keys: "}", expect: R`a \alt<2>{shown}{HIDDEN}‸ b` },
  { id: "⌫ alt empty", title: "emptying the visible branch keeps the hidden branch's source", step: 2, body: R`a \alt<2>{x‸}{HIDDEN} b`, keys: "⌫ ⌫", expect: R`a ‸\alt<2>{}{HIDDEN} b` },
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
  { id: "⌫ row start", title: "⌫ at a row's start joins it to the previous row (D3)", body: align(R`a &= b \\`, "‸c &= d"), keys: "⌫", expect: align(R`a &= b ‸c &= d`) },
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
 * Input rules (step 5): what a typed character writes, by context.
 */
export const inputRuleScenarios: readonly Scenario[] = [
  // Escaping (R2).
  { id: "R2 &", title: "& in prose is escaped", body: "R‸", keys: "&D", expect: R`R\&D‸` },
  { id: "R2 _", title: "_ in prose is escaped", body: "file‸", keys: "_name", expect: R`file\_name‸` },
  { id: "R2 ^", title: "^ in prose is a circumflex", body: "PO.‸", keys: "^", expect: R`PO.\^{}‸` },
  { id: "R2 % math", title: "% in math is escaped too", body: R`$a‸$`, keys: "%", expect: R`$a\%‸$` },
  { id: "R2 & cell", title: "& in an alignment cell separates cells", body: align(R`a ‸`), keys: "&=", expect: align(R`a &=‸`) },
  // Formulas and braces (R3, M2).
  { id: "R3 $ ⌫", title: "⌫ right after $ removes the empty formula", body: "Let ‸ be.", keys: "$ ⌫", expect: "Let ‸ be." },
  { id: "R3 $ →", title: "leaving an empty formula removes it", body: "Let ‸ be.", keys: "$ →", expect: "Let ‸ be." },
  { id: "R3 $ emptied", title: "emptying a formula leaves a placeholder that typing fills", body: R`Let $x‸$ be.`, keys: "⌫ y", expect: R`Let $y‸$ be.` },
  { id: "R3 $ mid-formula", title: "$ in the middle of a formula does nothing", body: R`$a‸+b$`, keys: "$", expect: R`$a‸+b$` },
  { id: "R3 $ in \\text", title: "$ inside \\text{} opens a nested formula", body: R`$\text{if ‸}$`, keys: "$x$", expect: R`$\text{if $x$‸}$` },
  { id: "M2", title: "$ wraps selected prose in a formula", body: "Let ⟦x⟧ be", keys: "$", expect: "Let $x‸$ be" },
  { id: "R3 {", title: "{ opens a group with its closer", body: R`$a‸$`, keys: "{b", expect: R`$a{b‸}$` },
  { id: "R3 } group", title: "} at the end of a group steps out of it", body: R`a {\bf x‸} y`, keys: "}", expect: R`a {\bf x}‸ y` },
  { id: "R3 } frac", title: "typed TeX \\frac{n}{2} steps through the slots", body: R`$\frac{n‸}{}$`, keys: "}{2}", expect: R`$\frac{n}{2}‸$` },
  { id: "R3 } mid-slot", title: "} in the middle of a slot does nothing", body: R`$\frac{n‸m}{2}$`, keys: "}", expect: R`$\frac{n‸m}{2}$` },
  // Scripts (R6, M13).
  { id: "R6 x^2+1", title: "a script takes one token, then the caret leaves it", body: R`$a‸$`, keys: "x^2+1", expect: R`$ax^2+1‸$` },
  { id: "R6 group", title: "{ first makes the script a group that stays open", body: R`$a‸$`, keys: "e^{i}+", expect: R`$ae^{i}+‸$` },
  { id: "R6 ^ ⌫", title: "⌫ right after ^ removes the empty script", body: R`$x‸$`, keys: "^ ⌫", expect: R`$x‸$` },
  { id: "R6 ^ →", title: "leaving an empty script removes it", body: R`$x ‸y$`, keys: "^ →", expect: R`$x ‸y$` },
  { id: "M13", title: "retyping an emptied unbraced limit keeps it unbraced", body: R`$\sum_{i=1}^m‸$`, keys: "← ⌫ p", expect: R`$\sum_{i=1}^p‸$` },
  // Transformations (R12): quotes (P3), dashes (P4), list autoformat (P10).
  { id: "P3", title: "\" opens and closes TeX quotes", body: "They generalize ‸.", keys: "\"gradient␣equals␣zero.\"", expect: "They generalize ``gradient equals zero.''‸." },
  { id: "P3 ⌘Z", title: "⌘Z right after a converted quote leaves a literal \"", body: "say ‸", keys: "hi␣\" ⌘Z", expect: "say hi \"‸" },
  { id: "P3 ⌘Z ⌘Z", title: "a second ⌘Z undoes the typing run with the quote", body: "say ‸", keys: "hi␣\" ⌘Z ⌘Z", expect: "say ‸" },
  { id: "P3 ⌫", title: "a TeX quote is one item", body: "say ``hi''‸", keys: "⌫", expect: "say ``hi‸" },
  { id: "P3 unicode", title: "a document with Unicode quotes gets Unicode quotes", body: "“one” ‸", keys: "\"two\"", expect: "“one” “two”‸" },
  { id: "P3 math", title: "\" in math stays", body: R`$a‸$`, keys: "\"", expect: R`$a"‸$` },
  { id: "P4", title: "an en dash typed as two keys is one item", body: "pages 3‸", keys: "--5 ⌫ ⌫", expect: "pages 3‸" },
  { id: "P10", title: "- ␣ starting an empty paragraph starts a list", body: "Intro.\n\n‸", keys: "-␣One", expect: "Intro.\n\n\\begin{itemize}\n\\item One‸\n\\end{itemize}" },
  { id: "P10 ⌘Z", title: "⌘Z right after the list autoformat leaves the literal - ␣", body: "Intro.\n\n‸", keys: "-␣ ⌘Z", expect: "Intro.\n\n- ‸" },
  { id: "P10 mid-paragraph", title: "- ␣ mid-paragraph stays text", body: "Intro ‸", keys: "-␣x", expect: "Intro - x‸" },
  { id: "P10 item", title: "- ␣ at an item's start stays text", body: itemize(R`\item ‸`), keys: "-␣", expect: itemize(R`\item - ‸`) },
  // Terminators (R5) and optional arguments (K9).
  { id: "R5 math", title: "a letter after a control word gets a space", body: R`$\alpha‸$`, keys: "x", expect: R`$\alpha x‸$` },
  { id: "R5 text", title: "a letter after a control word gets {}", body: R`see \ldots‸`, keys: "x", expect: R`see \ldots{}x‸` },
  { id: "R5 text space", title: "a space after a control word gets {}", body: R`I use \LaTeX‸`, keys: "␣daily", expect: R`I use \LaTeX{} daily‸` },
  { id: "K9 \\\\", title: "[ after \\\\ is protected from its optional argument", body: R`a\\ ‸b`, keys: "[", expect: R`a\\ {}[‸b` },
];

/**
 * The structural keys on the tree (step 5): ⏎, ⇧⏎, ⇥ and ⌫/⌦ at block
 * edges, decided by ownership (O1) rather than read from the layout.
 */
export const structuralKeyScenarios: readonly Scenario[] = [
  // ⏎ (O1, Z1, D1–D3).
  { id: "⏎ item start", title: "⏎ at an item's start inserts an empty item above", body: itemize(R`\item ‸First one`), keys: "⏎", expect: itemize(R`\item `, R`\item ‸First one`) },
  { id: "⏎ only item", title: "⏎ on the only, empty item removes the list", body: ["Before.", itemize(R`\item ‸`), "After."].join("\n"), keys: "⏎", expect: "Before.\n‸After." },
  { id: "⏎ selection", title: "⏎ over a selection crossing items replaces it with an item break", body: itemize(R`\item First ⟦one`, R`\item Second two⟧`, R`\item Third`), keys: "⏎", expect: itemize(R`\item First`, R`\item ‸`, R`\item Third`) },
  { id: "Z1 bold", title: "⏎ in a bold run splits the wrapper across the break", body: R`a \textbf{one‸ two}`, keys: "⏎", expect: "a \\textbf{one}\n\n\\textbf{‸ two}" },
  { id: "Z1 item", title: "⏎ mid-formula in an item splits the formula across items", body: itemize(R`\item one $a‸+b$ two`), keys: "⏎", expect: itemize(R`\item one $a$`, R`\item $‸+b$ two`) },
  { id: "Z1 formula end", title: "⏎ at a formula's end breaks after it", body: R`Let $a+b‸$ be.`, keys: "⏎", expect: "Let $a+b$\n\n‸be." },
  { id: "⏎ title", title: "⏎ in a block title does nothing", body: R`\begin{block}{Ti‸tle} body \end{block}`, keys: "⏎", expect: R`\begin{block}{Ti‸tle} body \end{block}` },
  { id: "D2", title: "⏎ at a row's end starts a new row", body: align(R`a &= b‸`), keys: "⏎ c", expect: align(R`a &= b \\`, "c‸") },
  { id: "D3", title: "⏎ on the empty last row leaves the alignment", body: align(R`a &= b‸`), keys: "⏎ ⏎ x", expect: align(R`a &= b`, "") + "\nx‸" },
  { id: "D1 ⏎", title: "⏎ in a display goes to the text after it", body: "\\[x‸\\]\nmore", keys: "⏎", expect: "\\[x\\]\n‸more" },
  { id: "⇧⏎ math", title: "⇧⏎ in math does nothing", body: R`Let $a‸$ be.`, keys: "⇧⏎", expect: R`Let $a‸$ be.` },
  // ⇥ (M8, D2).
  { id: "M8 ⇥", title: "⇥ moves through a fraction's slots and out", body: R`$\frac{n‸}{}$`, keys: "⇥ 2 ⇥ +", expect: R`$\frac{n}{2}+‸$` },
  { id: "⇧⇥ slot", title: "⇧⇥ moves back to the previous slot", body: R`$\frac{n}{‸2}$`, keys: "⇧⇥", expect: R`$\frac{n‸}{2}$` },
  { id: "D2 ⇥", title: "⇥ at a row's last cell adds a cell", body: align(R`a &= b‸`), keys: "⇥ c", expect: align(R`a &= b & c‸`) },
  { id: "D3 ⌫ full", title: "⌫ at a row's start moves to the previous row's end when the join would not fit", body: R`$\begin{array}{ll} a & b \\ ‸c & d \end{array}$`, keys: "⌫", expect: R`$\begin{array}{ll} a & b ‸\\ c & d \end{array}$` },
  { id: "D3 ⌫ fits", title: "⌫ joins rows of a fixed-width array when the join fits", body: R`$\begin{array}{ll} a \\ ‸c & d \end{array}$`, keys: "⌫", expect: R`$\begin{array}{ll} a ‸c & d \end{array}$` },
  { id: "D3 ⌦", title: "⌦ at a row's end joins the next row", body: align(R`a &= b‸ \\`, "c &= d"), keys: "⌦", expect: align(R`a &= b‸ c &= d`) },
  { id: "D3 ⌫ empty row", title: "⌫ in an empty row removes the row break before it", body: align(R`a &= b \\`, R`‸\\`, "c &= d"), keys: "⌫", expect: align(R`a &= b ‸\\`, "c &= d") },
  { id: "D3 rule", title: "⌫ does not join rows across a rule", body: tabular(R`a & b \\ \hline`, R`‸c & d`), keys: "⌫", expect: tabular(R`a & b ‸\\ \hline`, R`c & d`) },
  { id: "K13 math column", title: "cells of a >{$}c<{$} column are math", body: "\\begin{tabular}{>{$}c<{$}l}\n‸ & text\n\\end{tabular}", keys: "x^2 ⇥ a^b", expect: "\\begin{tabular}{>{$}c<{$}l}\nx^2 & a\\^{}b‸text\n\\end{tabular}" },
  { id: "K13 ⇥", title: "⇥ and ⇧⇥ move between tabular cells", body: tabular(R`a‸ & b \\`, R`c & d`), keys: "⇥ x ⇥ y ⇧⇥ ⇧⇥ z", expect: tabular(R`az‸ & xb \\`, R`yc & d`) },
  { id: "D4 ⇥", title: "⇥ in a fixed-width array goes to the next row", body: R`$\begin{array}{ll} a & b‸ \\ c & d \end{array}$`, keys: "⇥ x", expect: R`$\begin{array}{ll} a & b \\ x‸c & d \end{array}$` },
  { id: "⇧⇥ unnest", title: "⇧⇥ unnests an item", body: itemize(R`\item First`, R`\begin{itemize}`, R`\item ‸Second`, R`\end{itemize}`), keys: "⇧⇥", expect: itemize(R`\item First`, R`\item ‸Second`) },
  // ⌫ / ⌦ at block edges.
  { id: "⌫ paragraph", title: "⌫ at a paragraph's start joins it to the previous one", body: "One.\n\n‸Two.", keys: "⌫", expect: "One. ‸Two." },
  { id: "⌦ paragraph", title: "⌦ at a paragraph's end joins the next one", body: "One.‸\n\nTwo.", keys: "⌦", expect: "One.‸ Two." },
  { id: "⌫ first item", title: "⌫ at the first item's start does nothing", body: itemize(R`\item ‸First`, R`\item Second`), keys: "⌫", expect: itemize(R`\item ‸First`, R`\item Second`) },
  { id: "⌦ item end", title: "⌦ at an item's end joins the next item", body: itemize(R`\item First‸`, R`\item Second`), keys: "⌦", expect: itemize(R`\item First‸ Second`) },
  { id: "⌫ empty item", title: "⌫ in an empty item joins it to the previous one", body: itemize(R`\item First`, R`\item ‸`), keys: "⌫", expect: itemize(R`\item First‸`) },
];

/**
 * The command chip (R4): `\` opens it, the name stays out of the source
 * until a commit writes the command in one step.
 */
export const chipScenarios: readonly Scenario[] = [
  { id: "P1", title: "\\% commits the control symbol at once", body: "Up by 5‸ overall.", keys: R`\%`, expect: R`Up by 5\%‸ overall.` },
  { id: "P6", title: "␣ after a text command gives a word space", body: "I use ‸ daily", keys: R`\LaTeX␣`, expect: R`I use \LaTeX{}‸ daily` },
  { id: "P6 end", title: "␣ after a text command adds the space when none follows", body: "I use ‸", keys: R`\LaTeX␣`, expect: R`I use \LaTeX{} ‸` },
  { id: "P8", title: "an old-style group with a declaration, typed as TeX", body: "a ‸ b", keys: R`{\bf␣x}`, expect: R`a {\bf x}‸ b` },
  { id: "M1", title: "a formula typed the TeX way gives exactly the keystrokes", preamble: R_MACRO, body: "Let ‸", keys: R`$x\in\R^n$␣be`, expect: R`Let $x\in\R^n$ be‸` },
  { id: "M5", title: "a braced exponent with a command inside", body: R`$a‸$`, keys: R`e^{i\pi}`, expect: R`$ae^{i\pi}‸$` },
  { id: "M8 ␣ ⇥", title: "\\frac␣ creates the slots, ⇥ moves through them", body: R`$a‸$`, keys: R`\frac␣n ⇥ 2 ⇥ +`, expect: R`$a\frac{n}{2}+‸$` },
  { id: "M8 typed", title: "typed TeX \\frac{n}{2} gives exactly that source", body: R`$a‸$`, keys: R`\frac{n}{2}+`, expect: R`$a\frac{n}{2}+‸$` },
  { id: "pmod ⇥", title: "pmod gets its argument without consuming the text ahead", body: R`$a‸b$`, keys: R`\pmod ⇥ n } +`, expect: R`$a\pmod{n}+‸b$` },
  { id: "mod ⇥", title: "mod gets its argument without consuming the text ahead", body: R`$a‸b$`, keys: R`\mod ⇥ n } +`, expect: R`$a\mod{n}+‸b$` },
  { id: "frac comment ⇥", title: "Tab goes to the denominator when a comment precedes the numerator", body: "$\\frac% numerator\n{a‸}{b}$", keys: "⇥", expect: "$\\frac% numerator\n{a}{‸b}$" },
  { id: "K2", title: "\\frac12 stays unbraced", body: R`$a‸$`, keys: R`\frac12`, expect: R`$a\frac12‸$` },
  { id: "M12", title: "a command in a script closes it; R5 spaces the next letter", body: R`$f‸$`, keys: R`+\mu^\top␣x`, expect: R`$f+\mu^\top x‸$` },
  { id: "K3", title: "\\{ pairs with \\}, which is stepped over", body: R`$N = ‸$`, keys: R`\{1\}`, expect: R`$N = \{1\}‸$` },
  { id: "M14", title: "\\left( waits for its \\right)", body: R`$a‸$`, keys: R`\left(x\right)`, expect: R`$a\left(x\right)‸$` },
  { id: "O4", title: "[ right after \\\\ opens its optional argument", body: "a‸ b", keys: R`\\[5pt]`, expect: R`a\\[5pt]‸ b` },
  { id: "K9 sqrt", title: "[ while typing \\sqrt opens the root index", body: R`$a‸$`, keys: R`\sqrt[3]x`, expect: R`$a\sqrt[3]{x‸}$` },
  { id: "V2 ⇥", title: "⇥ accepts the highlighted completion", body: R`$A‸$`, keys: R`\setm ⇥ B`, expect: R`$A\setminus B‸$` },
  { id: "X1", title: "an unknown name commits as typed", body: R`$a‸$`, keys: R`\foo␣`, expect: R`$a\foo‸$` },
  { id: "R4 Esc", title: "Esc cancels the chip without writing", body: "a‸ b", keys: R`\foo Esc`, expect: "a‸ b" },
  { id: "R4 ⌫", title: "⌫ shortens the name, then closes the chip", body: "a‸ b", keys: R`\fo ⌫ ⌫ ⌫ c`, expect: "ac‸ b" },
  { id: "F7", title: "a chip wraps the selection into the command's content", body: "the ⟦main idea⟧ is", keys: R`\emph␣`, expect: R`the \emph{⟦main idea⟧} is` },
  { id: "M9", title: "a selection fills the numerator; the caret goes to the denominator", body: R`$⟦a⟧$`, keys: R`\frac␣`, expect: R`$\frac{a}{‸}$` },
  { id: "R12 chip", title: "a chip commit is one undo step", body: R`$a‸$`, keys: R`\alpha␣ ⌘Z`, expect: R`$a‸$` },
];

/**
 * Edits the LaTeX oracle (test/editing/keystroke-tex-oracle.spec.ts)
 * found TeX rejecting: what the editor writes instead.
 */
export const texValidityScenarios: readonly Scenario[] = [
  { id: "X2 frac", title: "a math command in prose starts a formula", body: "Let ‸ be", keys: R`\frac␣1 ⇥ 2`, expect: R`Let $\frac{1}{2‸}$ be` },
  { id: "X2 alpha", title: "a math symbol committed with ␣ in prose is a formula of its own", body: "Let ‸be", keys: R`\alpha␣`, expect: R`Let $\alpha$ ‸be` },
  { id: "X2 left", title: "\\left( in prose starts a formula with the pair", body: "a ‸ b", keys: R`\left(x`, expect: R`a $\left(x‸\right)$ b` },
  { id: "X3", title: "a text command in math goes into \\text", body: R`$a‸$`, keys: R`\LaTeX␣`, expect: R`$a\text{\LaTeX}‸$` },
  { id: "X3 emph", title: "\\emph is a text command, not a math one", body: R`$a‸$`, keys: R`\emph␣x`, expect: R`$a\text{\emph{x‸}}$` },
  { id: "X4", title: "\\item outside a list writes nothing", body: "a‸ b", keys: R`\item␣`, expect: "a‸ b" },
  { id: "X5", title: "⇧⏎ needs something on its line", body: "a‸ b", keys: "⇧⏎ ⇧⏎", expect: R`a \\ ‸b` },
  { id: "X5 chip", title: "\\\\ typed needs something on its line too", body: "a‸ b", keys: R`⇧⏎ \\`, expect: R`a \\ ‸b` },
  { id: "X5 box", title: "⇧⏎ does nothing in an LR box", body: R`a \mbox{b‸c} d`, keys: "⇧⏎", expect: R`a \mbox{b‸c} d` },
  { id: "X5 math", title: "\\\\ does nothing in inline math", body: R`$a‸$`, keys: R`\\`, expect: R`$a‸$` },
  { id: "X6", title: "& in a row with all its columns writes nothing", body: tabular(R`a & b‸\\`), keys: "&", expect: tabular(R`a & b‸\\`) },
  { id: "X7 prime", title: "' in an empty script keeps its braces", body: R`$x‸$`, keys: R`^'`, expect: R`$x^{'‸}$` },
  { id: "X7 ldots", title: "a symbol that is a macro keeps the script's braces", body: R`$x‸$`, keys: R`^\ldots␣+`, expect: R`$x^{\ldots}+‸$` },
  { id: "X8", title: "a command started inside another's argument gets the braces", body: R`$a‸$`, keys: R`\sqrt\alpha␣`, expect: R`$a\sqrt{\alpha‸}$` },
  { id: "X9", title: "⏎ in a table row closes and reopens the formula around the caret", body: tabular(R`$a‸b$ & c\\`), keys: "⏎", expect: tabular(R`$a$ \\`, R`$‸b$ & c\\`) },
  { id: "X10", title: "deleting what precedes a line break removes the break", body: "a\n\nx‸ \\\\ y", keys: "⌫", expect: "a\n\n‸  y" },
  // Found in real decks (artifacts/beamer-construct-survey.md).
  {
    id: "C1 items", title: "joining items across a comment line keeps the text out of the comment",
    body: itemize(R`\item Real item % note`, "% between", R`\item ‸Another`), keys: "⌫",
    expect: itemize(R`\item Real item % note`, "% between", "‸Another"),
  },
  { id: "C1 paragraphs", title: "joining paragraphs after a comment keeps the text out of it", body: "First line. % tail\n\n‸Second", keys: "⌫", expect: "First line. % tail\n‸Second" },
  { id: "C2", title: "^ before a script whose base is gone goes into that script", body: R`\(\mathbb R‸^n\)`, keys: "⌫ ^ 2", expect: R`\(^{2‸n}\)` },
  { id: "C3", title: "\\verb is not committed from the chip", body: "Re‸fs", keys: R`\verb␣`, expect: "Re‸fs" },
  { id: "C4", title: "< right after \\item is not its overlay specification", body: itemize(R`\item ‸text`), keys: "<", expect: itemize(R`\item {}<‸text`) },
  { id: "C5", title: "an overlay specification typed after the chip is the command's", body: "a ‸ b", keys: R`\only<1->{x}`, expect: R`a \only<1->{x}‸ b` },
  { id: "C6", title: "a body with nothing but spacing still takes typing", body: R`\vspace{1em}‸`, keys: "x", expect: R`\vspace{1em}x‸` },
  { id: "C7", title: "typing before a command's unbraced argument braces it", body: R`T.\textbf‸(be`, keys: "^", expect: R`T.\textbf{\^{}‸(}be` },
  { id: "C8", title: "< right after a block's title is not its overlay specification", body: "\\begin{block}{T}\n‸x\n\\end{block}", keys: "<", expect: "\\begin{block}{T}\n{}<‸x\n\\end{block}" },
  { id: "C9", title: "a prime after a superscript does not make a second one", body: R`$x^2‸$`, keys: "'", expect: R`$x^2{}'‸$` },
  { id: "C10", title: "a table rule outside a table writes nothing", body: "a ‸ b", keys: R`\hline␣`, expect: "a ‸ b" },
  { id: "C11", title: "a command closed by } right away gets its braces", body: R`$x {‸} y$`, keys: R`\underbrace}`, expect: R`$x {\underbrace{}‸} y$` },
  { id: "C12", title: "\\operatorname holds math", body: R`$\operatorname{‸}$`, keys: R`\cup␣`, expect: R`$\operatorname{\cup‸}$` },
  { id: "C14", title: "a character typed after a text command's name in math is text", body: R`$x‸$`, keys: R`\textit_`, expect: R`$x\textit{\_‸}$` },
  { id: "C15", title: "beamer's overlay-aware commands are not committed into \\bm", body: R`\[\bm{E‸}\]`, keys: R`\only␣ \textbf␣ \mathrm␣`, expect: R`\[\bm{E\mathrm{‸}}\]` },
  { id: "C21", title: "\\uncover is not committed into \\operatorname (LuaLaTeX: limit controls)", body: R`$\operatorname{‸}$`, keys: R`\uncover␣ \only␣`, expect: R`$\operatorname{\only{‸}}$` },
  { id: "X6 repeat", title: "a column spec's repetitions count (`*{2}{lr}` is four columns)", body: "\\begin{tabular}{*{2}{lr}}\nA & 1 & B & 2‸\\\\\n\\end{tabular}", keys: "&", expect: "\\begin{tabular}{*{2}{lr}}\nA & 1 & B & 2‸\\\\\n\\end{tabular}" },
  { id: "C16", title: "in overprint, a selection holding \\onslide is not wrapped", body: "\\begin{overprint}\n\\onslide<1>⟦Alpha.\n\\onslide<2>Be⟧ta.\n\\end{overprint}", keys: "⌘B", expect: "\\begin{overprint}\n\\onslide<1>⟦Alpha.\n\\onslide<2>Be⟧ta.\n\\end{overprint}" },
  { id: "C13", title: "< after a frame break is not its overlay specification", body: "Alpha.\n\\framebreak\n‸Beta.", keys: "<", expect: "Alpha.\n\\framebreak\n{}<‸Beta." },
  { id: "C18", title: "in overprint, ⇧⏎ right after \\onslide has no line to end", body: "\\begin{overprint}\n\\onslide<1>‸Alpha.\n\\onslide<2>Beta.\n\\end{overprint}", keys: "⇧⏎", expect: "\\begin{overprint}\n\\onslide<1>‸Alpha.\n\\onslide<2>Beta.\n\\end{overprint}" },
  { id: "C19", title: "\\ then a character that makes no control symbol types that character", body: "a‸ b", keys: "\\<", expect: "a<‸ b" },
  { id: "C20", title: "[ after an environment's overlay specification is not its optional argument", body: "\\begin{lemma}<2->\n‸Text.\n\\end{lemma}", keys: "[", expect: "\\begin{lemma}<2->\n{}[‸Text.\n\\end{lemma}" },
  { id: "C27", title: "⇧⏎ after a wrapper holding only a line break has no line to end", body: "``x''\\textbf{\\\\}‸\n", keys: "⇧⏎", expect: "``x''\\textbf{\\\\}‸\n" },
  { id: "C26", title: "⇧⏎ after a wrapper ending in a line break and a space has no line to end", body: itemize(R`\item a\textbf{ \\ }‸ma`), keys: "⇧⏎", expect: itemize(R`\item a\textbf{ \\ }‸ma`) },
  { id: "C25", title: "\\pause accepted with ⏎ is not committed in the last slot of an overprint", body: "\\begin{overprint}\n\\onslide<1>Alpha.\n\\onslide<2>Gamma.‸\n\\end{overprint}", keys: R`\pause⏎`, expect: "\\begin{overprint}\n\\onslide<1>Alpha.\n\\onslide<2>Gamma.‸\n\\end{overprint}" },
  { id: "C24", title: "⇧⏎ right after a wrapper ending in a line break has no line to end", body: R`a\textbf{b \\ }‸c`, keys: "⇧⏎", expect: R`a\textbf{b \\ }‸c` },
  { id: "C23", title: "a table rule is not committed inside a script in a cell", body: "\\begin{align*}\n  x_{a‸} &= 1\n\\end{align*}", keys: R`\hline␣`, expect: "\\begin{align*}\n  x_{a‸} &= 1\n\\end{align*}" },
  { id: "C22", title: "\\pause is not committed in overprint (beamer: overprints may not overlap)", body: "\\begin{overprint}\n\\onslide<1>Alpha.‸\n\\onslide<2>Beta.\n\\end{overprint}", keys: R`\pause␣`, expect: "\\begin{overprint}\n\\onslide<1>Alpha.‸\n\\onslide<2>Beta.\n\\end{overprint}" },
  { id: "C17", title: "a line break typed before a * does not take it as its star", body: "A page‸*", keys: "\\\\", expect: "A page\\\\{}‸*" },
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
