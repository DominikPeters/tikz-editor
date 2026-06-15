#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_FONTS = [
  "cmr10",
  "cmr7",
  "cmr5",
  "cmbx10",
  "cmbx7",
  "cmbx5",
  "cmti10",
  "cmti7",
  "cmbxti10",
  "cmtt10",
  "cmtt8",
  "cmss10",
  "cmss8",
  "cmssi10",
  "cmssbx10",
  "cmcsc10",
  "tcrm1000",
  "cmmi10",
  "cmmi7",
  "cmmi5",
  "cmsy10",
  "cmsy7",
  "cmsy5",
  "cmex10",
];
const DEFAULT_OTF_GLYPHS = [
  {
    fontName: "lmroman10-regular",
    fileName: "lmroman10-regular.otf",
    codeRanges: [[0x20, 0x7e]],
    codes: [0xfb00, 0xfb01, 0xfb02, 0xfb03, 0xfb04, 0x2013, 0x2022],
    ligKerns: [
      ["lig", 0x66, 0x66, 0xfb00],
      ["lig", 0x66, 0x69, 0xfb01],
      ["lig", 0x66, 0x6c, 0xfb02],
      ["lig", 0xfb00, 0x69, 0xfb03],
      ["lig", 0xfb00, 0x6c, 0xfb04],
    ],
  },
  {
    fontName: "lmroman10-bold",
    fileName: "lmroman10-bold.otf",
    codeRanges: [[0x20, 0x7e]],
    codes: [0xfb00, 0xfb01, 0xfb02, 0xfb03, 0xfb04, 0x2013],
    ligKerns: [
      ["lig", 0x66, 0x66, 0xfb00],
      ["lig", 0x66, 0x69, 0xfb01],
      ["lig", 0x66, 0x6c, 0xfb02],
      ["lig", 0xfb00, 0x69, 0xfb03],
      ["lig", 0xfb00, 0x6c, 0xfb04],
    ],
  },
  {
    fontName: "lmroman10-italic",
    fileName: "lmroman10-italic.otf",
    codeRanges: [[0x20, 0x7e]],
    codes: [0xfb00, 0xfb01, 0xfb02, 0xfb03, 0xfb04],
    ligKerns: [
      ["lig", 0x66, 0x66, 0xfb00],
      ["lig", 0x66, 0x69, 0xfb01],
      ["lig", 0x66, 0x6c, 0xfb02],
      ["lig", 0xfb00, 0x69, 0xfb03],
      ["lig", 0xfb00, 0x6c, 0xfb04],
    ],
  },
  {
    fontName: "lmroman10-bolditalic",
    fileName: "lmroman10-bolditalic.otf",
    codeRanges: [[0x20, 0x7e]],
    codes: [0xfb00, 0xfb01, 0xfb02, 0xfb03, 0xfb04],
    ligKerns: [
      ["lig", 0x66, 0x66, 0xfb00],
      ["lig", 0x66, 0x69, 0xfb01],
      ["lig", 0x66, 0x6c, 0xfb02],
      ["lig", 0xfb00, 0x69, 0xfb03],
      ["lig", 0xfb00, 0x6c, 0xfb04],
    ],
  },
  {
    fontName: "lmromancaps10-regular",
    fileName: "lmromancaps10-regular.otf",
    codeRanges: [[0x20, 0x7e]],
  },
  {
    fontName: "lmsans10-regular",
    fileName: "lmsans10-regular.otf",
    codeRanges: [[0x20, 0x7e]],
    codes: [0xfb00, 0xfb01, 0xfb02, 0xfb03, 0xfb04],
    ligKerns: [
      ["lig", 0x66, 0x66, 0xfb00],
      ["lig", 0x66, 0x69, 0xfb01],
      ["lig", 0x66, 0x6c, 0xfb02],
      ["lig", 0xfb00, 0x69, 0xfb03],
      ["lig", 0xfb00, 0x6c, 0xfb04],
    ],
  },
  {
    fontName: "lmsans10-bold",
    fileName: "lmsans10-bold.otf",
    codeRanges: [[0x20, 0x7e]],
    codes: [0xfb00, 0xfb01, 0xfb02, 0xfb03, 0xfb04],
    ligKerns: [
      ["lig", 0x66, 0x66, 0xfb00],
      ["lig", 0x66, 0x69, 0xfb01],
      ["lig", 0x66, 0x6c, 0xfb02],
      ["lig", 0xfb00, 0x69, 0xfb03],
      ["lig", 0xfb00, 0x6c, 0xfb04],
    ],
  },
  {
    fontName: "lmsans10-oblique",
    fileName: "lmsans10-oblique.otf",
    codeRanges: [[0x20, 0x7e]],
    codes: [0xfb00, 0xfb01, 0xfb02, 0xfb03, 0xfb04],
    ligKerns: [
      ["lig", 0x66, 0x66, 0xfb00],
      ["lig", 0x66, 0x69, 0xfb01],
      ["lig", 0x66, 0x6c, 0xfb02],
      ["lig", 0xfb00, 0x69, 0xfb03],
      ["lig", 0xfb00, 0x6c, 0xfb04],
    ],
  },
  {
    fontName: "lmsans10-boldoblique",
    fileName: "lmsans10-boldoblique.otf",
    codeRanges: [[0x20, 0x7e]],
    codes: [0xfb00, 0xfb01, 0xfb02, 0xfb03, 0xfb04],
    ligKerns: [
      ["lig", 0x66, 0x66, 0xfb00],
      ["lig", 0x66, 0x69, 0xfb01],
      ["lig", 0x66, 0x6c, 0xfb02],
      ["lig", 0xfb00, 0x69, 0xfb03],
      ["lig", 0xfb00, 0x6c, 0xfb04],
    ],
  },
];
const outputPath = resolve(
  process.cwd(),
  "packages/core/src/text/tex/fonts/data/computer-modern-ot1.generated.ts"
);

const atomPattern = /^(?<kind>[CODH])\s+(?<value>.+)$/;
const charStartPattern = /^\s*\(CHARACTER\s+(?<atom>.+)$/;
const plAtomSource = String.raw`(?:C\s+.|O\s+[0-7]+|D\s+\d+|H\s+[0-9A-Fa-f]+)`;
const metricPattern = /^\s*\((?<kind>CHARWD|CHARHT|CHARDP|CHARIC)\s+R\s+(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\)/;
const nextLargerPattern = new RegExp(String.raw`^\s*\(NEXTLARGER\s+(?<atom>${plAtomSource})\)`);
const varcharStartPattern = /^\s*\(VARCHAR\b/;
const varcharPartPattern = new RegExp(String.raw`^\s*\((?<part>TOP|MID|BOT|REP)\s+(?<atom>${plAtomSource})\)`);
const fontdimenPattern = /^\s*\((?<name>[A-Z0-9]+)\s+R\s+(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\)/;
const labelPattern = /^\s*\(LABEL\s+(?<atom>.+)\)/;
const ligPattern = new RegExp(
  String.raw`^\s*\(LIG\s+(?<right>${plAtomSource})\s+(?<out>${plAtomSource})\)`
);
const kernPattern = new RegExp(
  String.raw`^\s*\(KRN\s+(?<right>${plAtomSource})\s+R\s+(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\)`
);
const designSizePattern = /^\(DESIGNSIZE\s+R\s+(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))\)/;
const checksumPattern = /^\(CHECKSUM\s+O\s+(?<value>[0-7]+)\)/;
const codingSchemePattern = /^\(CODINGSCHEME\s+(?<value>.+)\)/;
const familyPattern = /^\(FAMILY\s+(?<value>.+)\)/;

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function parseAtom(raw) {
  const normalized = raw.trim().replace(/\)+$/, "");
  const match = atomPattern.exec(normalized);
  if (!match?.groups) {
    throw new Error(`Unsupported PL atom: ${raw}`);
  }
  const value = match.groups.value;
  switch (match.groups.kind) {
    case "C":
      return value.codePointAt(0) ?? 0;
    case "O":
      return Number.parseInt(value, 8);
    case "D":
      return Number.parseInt(value, 10);
    case "H":
      return Number.parseInt(value, 16);
    default:
      throw new Error(`Unsupported PL atom kind: ${match.groups.kind}`);
  }
}

function roundMetric(value) {
  return Number(value.toFixed(6));
}

function parsePl(pl) {
  const font = {
    family: "",
    codingScheme: "",
    checksum: "",
    designSize: 10,
    source: {
      kind: "tfm",
      name: "",
    },
    fontdimen: {},
    chars: {},
    ligKerns: [],
  };
  let currentChar = null;
  let inFontdimen = false;
  let currentLabels = [];

  for (const line of pl.split(/\r?\n/)) {
    const family = familyPattern.exec(line);
    if (family?.groups) {
      font.family = family.groups.value;
      continue;
    }
    const codingScheme = codingSchemePattern.exec(line);
    if (codingScheme?.groups) {
      font.codingScheme = codingScheme.groups.value;
      continue;
    }
    const designSize = designSizePattern.exec(line);
    if (designSize?.groups) {
      font.designSize = Number(designSize.groups.value);
      continue;
    }
    const checksum = checksumPattern.exec(line);
    if (checksum?.groups) {
      font.checksum = checksum.groups.value;
      continue;
    }

    if (line.trim().startsWith("(FONTDIMEN")) {
      inFontdimen = true;
      continue;
    }
    if (inFontdimen) {
      if (line.trim() === ")") {
        inFontdimen = false;
        continue;
      }
      const metric = fontdimenPattern.exec(line);
      if (metric?.groups) {
        font.fontdimen[metric.groups.name.toLowerCase()] = roundMetric(Number(metric.groups.value));
      }
      continue;
    }

    const charStart = charStartPattern.exec(line);
    if (charStart?.groups) {
      const code = parseAtom(charStart.groups.atom);
      currentChar = { code };
      font.chars[code] = currentChar;
      continue;
    }
    if (currentChar) {
      const metric = metricPattern.exec(line);
      if (metric?.groups) {
        const key = {
          CHARWD: "width",
          CHARHT: "height",
          CHARDP: "depth",
          CHARIC: "italicCorrection",
        }[metric.groups.kind];
        currentChar[key] = roundMetric(Number(metric.groups.value));
        continue;
      }
      const nextLarger = nextLargerPattern.exec(line);
      if (nextLarger?.groups) {
        currentChar.nextLarger = parseAtom(nextLarger.groups.atom);
        continue;
      }
      if (varcharStartPattern.test(line)) {
        currentChar.varchar = {};
        continue;
      }
      const varcharPart = varcharPartPattern.exec(line);
      if (varcharPart?.groups && currentChar.varchar) {
        currentChar.varchar[varcharPart.groups.part.toLowerCase()] = parseAtom(varcharPart.groups.atom);
        continue;
      }
      if (line.trim() === ")") {
        currentChar = null;
        continue;
      }
    }

    const label = labelPattern.exec(line);
    if (label?.groups) {
      currentLabels.push(parseAtom(label.groups.atom));
      continue;
    }
    if (line.trim() === "(STOP)") {
      currentLabels = [];
      continue;
    }
    if (currentLabels.length > 0) {
      const lig = ligPattern.exec(line);
      if (lig?.groups) {
        const right = parseAtom(lig.groups.right);
        const out = parseAtom(lig.groups.out);
        for (const left of currentLabels) {
          font.ligKerns.push(["lig", left, right, out]);
        }
        continue;
      }
      const kern = kernPattern.exec(line);
      if (kern?.groups) {
        const right = parseAtom(kern.groups.right);
        const value = roundMetric(Number(kern.groups.value));
        for (const left of currentLabels) {
          font.ligKerns.push(["kern", left, right, value]);
        }
      }
    }
  }

  return font;
}

function generate(fontNames) {
  const fonts = {};
  for (const fontName of fontNames) {
    const tfmPath = run("kpsewhich", [`${fontName}.tfm`]);
    if (!tfmPath) {
      throw new Error(`Could not resolve ${fontName}.tfm through kpsewhich`);
    }
    const pl = execFileSync("tftopl", [tfmPath], { encoding: "utf8" });
    const font = parsePl(pl);
    font.source = {
      kind: "tfm",
      name: fontName,
    };
    font.glyphs = extractSvgGlyphPaths(fontName, Object.keys(font.chars).map(Number));
    fonts[fontName] = font;
  }
  for (const font of DEFAULT_OTF_GLYPHS) {
    fonts[font.fontName] = generateOtfGlyphFont(font);
  }
  return fonts;
}

function otfCodesForFont(font) {
  const codes = new Set(font.codes ?? []);
  for (const [start, end] of font.codeRanges ?? []) {
    for (let code = start; code <= end; code += 1) {
      codes.add(code);
    }
  }
  return [...codes].sort((a, b) => a - b);
}

function parseOtfCmap(fontPath) {
  const cmap = execFileSync("ttx", ["-q", "-t", "cmap", "-o", "-", fontPath], { encoding: "utf8" });
  const entries = new Map();
  const mapPattern = /<map code="0x(?<code>[0-9a-fA-F]+)" name="(?<name>[^"]+)"\/>/g;
  let match = mapPattern.exec(cmap);
  while (match?.groups) {
    entries.set(Number.parseInt(match.groups.code, 16), match.groups.name);
    match = mapPattern.exec(cmap);
  }
  return entries;
}

function extractOtfFontDimen(fontPath) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-otf-fontdimen-"));
  try {
    const fontDir = `${dirname(fontPath)}/`;
    const fontFile = basename(fontPath);
    const texSource = `\\documentclass{article}
\\usepackage{fontspec}
\\setmainfont{${escapeTexPath(fontFile)}}[Path=${escapeTexPath(fontDir)}]
\\begin{document}
X
\\directlua{
  local f = font.getfont(font.current())
  for k,v in pairs(f.parameters or {}) do
    texio.write_nl("TIKZ_FONT_PARAM " .. tostring(k) .. "=" .. tostring(v))
  end
}
\\end{document}
`;
    writeFileSync(join(tempDir, "fontdimen.tex"), texSource, "utf8");
    execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "fontdimen.tex"], {
      cwd: tempDir,
      env: {
        ...process.env,
        TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
        TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
      },
      stdio: "pipe",
    });
    const log = readFileSync(join(tempDir, "fontdimen.log"), "utf8");
    const params = {};
    for (const line of log.split(/\r?\n/)) {
      const match = /TIKZ_FONT_PARAM (?<name>[^=]+)=(?<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+))/.exec(line);
      if (match?.groups) {
        params[match.groups.name] = Number(match.groups.value);
      }
    }
    const size = params.size;
    if (!size) {
      throw new Error(`Could not resolve font parameter size for ${fontPath}`);
    }
    return {
      slant: roundMetric((params.slant ?? 0) / size),
      space: roundMetric((params.space ?? 0) / size),
      stretch: roundMetric((params.space_stretch ?? 0) / size),
      shrink: roundMetric((params.space_shrink ?? 0) / size),
      xheight: roundMetric((params.x_height ?? 0) / size),
      quad: roundMetric((params.quad ?? 0) / size),
      extraspace: roundMetric((params.extra_space ?? 0) / size),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractOtfCharMetrics(fontPath, codes) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-otf-metrics-"));
  try {
    const fontDir = `${dirname(fontPath)}/`;
    const fontFile = basename(fontPath);
    const sortedCodes = codes
      .filter((code) => Number.isInteger(code) && code >= 0)
      .sort((a, b) => a - b);
    const luaCodes = sortedCodes.join(",");
    const texSource = `\\documentclass{article}
\\usepackage{fontspec}
\\setmainfont{${escapeTexPath(fontFile)}}[Path=${escapeTexPath(fontDir)},Ligatures=NoCommon]
\\begin{document}
X
\\directlua{
  local f = font.getfont(font.current())
  local size = f.size or 1
  for _, code in ipairs({${luaCodes}}) do
    local c = (f.characters or {})[code]
    if c then
      texio.write_nl(
        "TIKZ_CHAR_METRIC " .. tostring(code) ..
        " width=" .. tostring((c.width or 0) / size) ..
        " height=" .. tostring((c.height or 0) / size) ..
        " depth=" .. tostring((c.depth or 0) / size) ..
        " italic=" .. tostring((c.italic or 0) / size)
      )
    end
  end
}
\\end{document}
`;
    writeFileSync(join(tempDir, "metrics.tex"), texSource, "utf8");
    execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "metrics.tex"], {
      cwd: tempDir,
      env: {
        ...process.env,
        TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
        TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
      },
      stdio: "pipe",
    });
    const log = readFileSync(join(tempDir, "metrics.log"), "utf8");
    const metrics = new Map();
    for (const line of log.split(/\r?\n/)) {
      const match = /TIKZ_CHAR_METRIC (?<code>\d+) width=(?<width>[+-]?(?:\d+(?:\.\d*)?|\.\d+)) height=(?<height>[+-]?(?:\d+(?:\.\d*)?|\.\d+)) depth=(?<depth>[+-]?(?:\d+(?:\.\d*)?|\.\d+)) italic=(?<italic>[+-]?(?:\d+(?:\.\d*)?|\.\d+))/.exec(line);
      if (!match?.groups) {
        continue;
      }
      const metric = {
        code: Number(match.groups.code),
        width: roundMetric(Number(match.groups.width)),
        height: roundMetric(Number(match.groups.height)),
        depth: roundMetric(Number(match.groups.depth)),
        italicCorrection: roundMetric(Number(match.groups.italic)),
      };
      metrics.set(metric.code, metric);
    }
    return metrics;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractOtfKernPairs(fontPath, codes) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-otf-kerns-"));
  try {
    const fontDir = `${dirname(fontPath)}/`;
    const fontFile = basename(fontPath);
    const sortedCodes = codes
      .filter((code) => code !== 0x20 && Number.isInteger(code) && code >= 0)
      .sort((a, b) => a - b);
    const pairProbes = [];
    for (const left of sortedCodes) {
      for (const right of sortedCodes) {
        pairProbes.push(
          `\\setbox\\pairbox=\\hbox{\\char"${left.toString(16).toUpperCase()}\\char"${right.toString(16).toUpperCase()}}%\n` +
          `\\directlua{inspect_pair(${left}, ${right}, tex.box.pairbox)}`
        );
      }
    }
    const texSource = `\\documentclass{article}
\\usepackage{fontspec}
\\setmainfont{${escapeTexPath(fontFile)}}[Path=${escapeTexPath(fontDir)},Ligatures=TeX]
\\newbox\\pairbox
\\begin{document}
\\directlua{
  local kern_id = node.id("kern")
  local function sp(value)
    return (value or 0) / 65536
  end
  function inspect_pair(left, right, box)
    local kern = 0
    for n in node.traverse(box.list) do
      if n.id == kern_id then
        kern = kern + sp(n.kern or n.width)
      end
    end
    if math.abs(kern) > 0.0000001 then
      texio.write_nl("TIKZ_KERN " .. tostring(left) .. " " .. tostring(right) .. " " .. tostring(kern))
    end
  end
}
${pairProbes.join("\n")}
\\end{document}
`;
    writeFileSync(join(tempDir, "kerns.tex"), texSource, "utf8");
    execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "kerns.tex"], {
      cwd: tempDir,
      env: {
        ...process.env,
        TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
        TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
      },
      stdio: "pipe",
      maxBuffer: 50 * 1024 * 1024,
    });
    const log = readFileSync(join(tempDir, "kerns.log"), "utf8");
    const kerns = [];
    for (const line of log.split(/\r?\n/)) {
      const match = /TIKZ_KERN (?<left>\d+) (?<right>\d+) (?<width>[+-]?(?:\d+(?:\.\d*)?|\.\d+))/.exec(line);
      if (!match?.groups) {
        continue;
      }
      kerns.push([
        "kern",
        Number(match.groups.left),
        Number(match.groups.right),
        roundMetric(Number(match.groups.width) / 10),
      ]);
    }
    return kerns;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function generateOtfGlyphFont(font) {
  const fontPath = run("kpsewhich", [font.fileName]);
  if (!fontPath) {
    throw new Error(`Could not resolve ${font.fileName} through kpsewhich`);
  }
  const cmap = parseOtfCmap(fontPath);
  const codes = otfCodesForFont(font);
  const metrics = extractOtfCharMetrics(fontPath, codes);
  const chars = {};
  const glyphs = {};
  for (const code of codes) {
    const glyphName = cmap.get(code);
    if (!glyphName) {
      throw new Error(`Could not resolve cmap entry for U+${code.toString(16).toUpperCase()} in ${font.fileName}`);
    }
    const metric = metrics.get(code);
    if (!metric) {
      throw new Error(`Could not resolve LuaTeX character metric for ${glyphName} (U+${code.toString(16).toUpperCase()}) in ${font.fileName}`);
    }
    chars[code] = metric;
    if (code !== 0x20) {
      glyphs[code] = "";
    }
  }
  Object.assign(glyphs, extractOtfSvgGlyphPaths(fontPath, Object.keys(glyphs).map(Number)));
  const ligKerns = [
    ...font.ligKerns ?? [],
    ...extractOtfKernPairs(fontPath, [
      ...codes,
      ...((font.ligKerns ?? [])
        .filter((rule) => rule[0] === "lig")
        .map((rule) => rule[3])),
    ]),
  ];
  return {
    family: font.fontName,
    codingScheme: "Unicode OpenType",
    checksum: "",
    designSize: 10,
    source: {
      kind: "opentype",
      name: font.fileName,
    },
    fontdimen: extractOtfFontDimen(fontPath),
    chars,
    ligKerns,
    glyphs,
  };
}

function texCharList(codes) {
  return codes
    .filter((code) => Number.isInteger(code) && code >= 0 && code <= 255)
    .sort((a, b) => a - b)
    .map((code) => `\\char${code}`)
    .join("");
}

function extractSvgGlyphPaths(fontName, codes) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-glyphs-"));
  try {
    const texSource = `\\nopagenumbers\\font\\f=${fontName} at 10pt\\f ${texCharList(codes)}\\bye\n`;
    writeFileSync(join(tempDir, "glyphs.tex"), texSource, "utf8");
    execFileSync("tex", ["-interaction=nonstopmode", "glyphs.tex"], {
      cwd: tempDir,
      stdio: "pipe",
    });
    const output = execFileSync(
      "dvisvgm",
      ["--no-fonts", "--exact-bbox", "--stdout", "glyphs.dvi"],
      { cwd: tempDir, encoding: "utf8" }
    );
    const xmlStart = output.indexOf("<?xml");
    const svg = xmlStart >= 0 ? output.slice(xmlStart) : output;
    const glyphs = {};
    const pathPattern = /<path\s+id='g0-(\d+)'\s+d='([^']*)'\/>/g;
    let match = pathPattern.exec(svg);
    while (match) {
      glyphs[match[1]] = match[2];
      match = pathPattern.exec(svg);
    }
    return glyphs;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function escapeTexPath(value) {
  return value.replace(/\\/g, "\\textbackslash{}").replace(/([{}%#&_$])/g, "\\$1");
}

function extractOtfSvgGlyphPaths(fontPath, codes) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-otf-glyph-"));
  try {
    const fontDir = `${dirname(fontPath)}/`;
    const fontFile = basename(fontPath);
    const sortedCodes = codes
      .filter((code) => code !== 0x20)
      .sort((a, b) => a - b);
    const text = sortedCodes
      .map((code) => `{\\char"${code.toString(16).toUpperCase()}}`)
      .join("\\hskip1pt ");
    const texSource = `\\documentclass{article}
\\usepackage{fontspec}
\\pagestyle{empty}
\\setmainfont{${escapeTexPath(fontFile)}}[Path=${escapeTexPath(fontDir)},Ligatures=NoCommon]
\\begin{document}
${text}
\\end{document}
`;
    writeFileSync(join(tempDir, "glyph.tex"), texSource, "utf8");
    execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "glyph.tex"], {
      cwd: tempDir,
      env: {
        ...process.env,
        TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
        TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
      },
      stdio: "pipe",
    });
    const output = execFileSync(
      "dvisvgm",
      ["--pdf", "--no-fonts", "--exact-bbox", "--stdout", "glyph.pdf"],
      { cwd: tempDir, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
    );
    const pathsById = new Map();
    const pathPattern = /<path\s+id='(?<id>g0-\d+)'\s+d='(?<path>[^']*)'\/>/g;
    let pathMatch = pathPattern.exec(output);
    while (pathMatch?.groups) {
      pathsById.set(pathMatch.groups.id, pathMatch.groups.path);
      pathMatch = pathPattern.exec(output);
    }
    const usePattern = /<use\b[^>]*(?:xlink:href|href)='#(?<id>g0-\d+)'[^>]*>/g;
    const useIds = [];
    let useMatch = usePattern.exec(output);
    while (useMatch?.groups) {
      useIds.push(useMatch.groups.id);
      useMatch = usePattern.exec(output);
    }
    const glyphs = {};
    for (const [index, code] of sortedCodes.entries()) {
      const pathId = useIds[index];
      const path = pathId ? pathsById.get(pathId) : undefined;
      if (!path) {
        throw new Error(`Could not extract SVG path for U+${code.toString(16).toUpperCase()} from ${fontPath}`);
      }
      glyphs[code] = path;
    }
    return glyphs;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const fonts = generate(DEFAULT_FONTS);
  const source = `// Generated by scripts/generate-tex-font-data.mjs. Do not edit by hand.
import type { GeneratedTexFontTable } from "../types.js";

export const COMPUTER_MODERN_OT1_FONTS: GeneratedTexFontTable = ${JSON.stringify(fonts, null, 2)};
`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, source);
  console.log(`Wrote ${outputPath}`);
}

main();
