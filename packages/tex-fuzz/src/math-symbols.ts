/** Independent source vocabulary: keep literal characters and control symbols distinct. */
export const TEX_FUZZ_MATH_SYMBOLS = [
  "|", "\\|", "\\vert", "\\Vert", "\\lvert", "\\rvert", "\\lVert", "\\rVert",
  "!", ";", "?", "/", ":", ",", ".", "+", "-", "*", "=", "<", ">",
  "(", ")", "[", "]", "\\{", "\\}", "\\%", "\\mid", "\\parallel",
] as const;

/** Minimized differential findings and neighboring cases that must stay fixed. */
export const TEX_FUZZ_MATH_LAYOUT_ORACLE_FORMULAS = [
  String.raw`\stackrel{*}{.}`, String.raw`\stackrel{a}{b}`,
  String.raw`\overset{a}{b}`, String.raw`\overset{a}{+}`,
  String.raw`\underset{a}{b}`, String.raw`\overunderset{u}{d}{x}`,
  String.raw`\mathop{.}\limits_a^b`,
  String.raw`{]}^{{z}}`, String.raw`{x}^{{z}}`, String.raw`]^{z}`,
  String.raw`{;}_{x}^{z}`, String.raw`x_{|X|}^{\|X\|}`,
  String.raw`\begin{cases}.&\begin{pmatrix}+&\beta\end{pmatrix}\end{cases}`,
  String.raw`\begin{cases}x&\begin{array}{c}x\\y\end{array}\end{cases}`,
  String.raw`\begin{cases}x&\begin{matrix}x\\y\end{matrix}\end{cases}+\begin{matrix}x\\y\end{matrix}`,
  String.raw`\overbrace{x}`, String.raw`\underbrace{x}`,
  String.raw`\overbrace{\frac{|}{\infty}}`, String.raw`\underbrace{\frac{x}{y}}`,
  String.raw`\overbrace{x}^{n}`, String.raw`\underbrace{\frac{x}{y}}_{n}`,
  String.raw`\overbrace{abcdefgh}+\underbrace{abcdefgh}`,
  String.raw`x_{\overbrace{a+b}^{n}}`, String.raw`x^{\underbrace{a+b}_{n}}`,
  String.raw`x_{\begin{pmatrix}z&;\end{pmatrix}}`,
  String.raw`\frac{\begin{pmatrix}x\end{pmatrix}}{y}`,
  String.raw`\sqrt[{\begin{pmatrix}x\end{pmatrix}}]{x}`,
  String.raw`x_{\begin{cases}x&y\end{cases}}`, String.raw`x_{\begin{array}{c}x\end{array}}`,
  String.raw`x_{y_{\textbf{if}}}`, String.raw`x_{y_{\textbf{if}}}+\text{if}`,
  String.raw`x\notin A`, String.raw`\notin_a^b`,
  String.raw`x^{\sqrt{x}}`, String.raw`\stackrel{\sqrt{x}}{a}`,
  String.raw`\sqrt[{x}]{\lVert}`, String.raw`x^{\sqrt[{x}]{\lVert}}`,
  String.raw`\frac{\sqrt{\ell}}{y}+\text{if}`,
  String.raw`\displaystyle |X|+\|X\|`, String.raw`\scriptstyle |X|+\|X\|`,
  String.raw`\scriptscriptstyle {]}^{{z}}`, String.raw`\displaystyle\stackrel{*}{.}`,
] as const;

export type TexFuzzMathSymbol = typeof TEX_FUZZ_MATH_SYMBOLS[number];

const symbolSet = new Set<string>(TEX_FUZZ_MATH_SYMBOLS);
export function texFuzzMathSymbolFeature(value: string): `math.symbol.${TexFuzzMathSymbol}` | null {
  return symbolSet.has(value) ? `math.symbol.${value as TexFuzzMathSymbol}` : null;
}

/** These small cases must pass the glyph oracle independently of random sampling. */
export const TEX_FUZZ_MATH_SYMBOL_ORACLE_FORMULAS = [
  String.raw`|X|`, String.raw`\|X\|`, String.raw`\vert X\vert`, String.raw`\Vert X\Vert`,
  String.raw`\lvert X\rvert`, String.raw`\lVert X\rVert`,
  String.raw`\left|X\right|`, String.raw`\left\|X\right\|`,
  String.raw`a/b`, String.raw`n!;x?`, String.raw`x_{|X|}`, String.raw`x_{\|X\|}`,
  String.raw`\begin{matrix}x\\{[}\end{matrix}`,
  String.raw`\begin{matrix}x\\{*}\end{matrix}`,
] as const;
