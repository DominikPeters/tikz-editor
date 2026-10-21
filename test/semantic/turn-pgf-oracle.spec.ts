import { describe, expect, it } from "vitest";
import { elementsOfKind, evaluateSemantic } from "./helpers.js";

// Fresh local PGF endpoints, compiled in the coordinator's Batch 12 oracle.
// A 0.005pt tolerance covers measured PGF fixed-point/trigonometric rounding:
// its 55-degree control coefficient is 0.3262 versus analytic 0.32623506384.
// These assert the continuation endpoint, not full arc/HV SVG geometry.
const cases = [
  {
    "name": "lineidentity",
    "options": "",
    "path": "(0,0) -- (1,0) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      56.90549,
      0.0
    ]
  },
  {
    "name": "linerot90",
    "options": "rotate=90",
    "path": "(0,0) -- (1,0) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      0.0,
      56.90549
    ]
  },
  {
    "name": "linerot45",
    "options": "rotate=45",
    "path": "(0,0) -- (1,0) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      40.2383,
      40.2383
    ]
  },
  {
    "name": "lineanisotropic",
    "options": "xscale=2,yscale=.5",
    "path": "(0,0) -- (1,1) -- ([turn]30:1cm)",
    "outerOptions": "",
    "expected": [
      71.63382,
      27.968
    ]
  },
  {
    "name": "linereflection",
    "options": "xscale=-1,rotate=30",
    "path": "(0,0) -- (1,1) -- ([turn]-30:1cm)",
    "outerOptions": "",
    "expected": [
      -30.53369,
      58.98643
    ]
  },
  {
    "name": "lineskew",
    "options": "cm={1,0,.5,1,(0,0)}",
    "path": "(0,0) -- (1,1) -- ([turn]30:1cm)",
    "outerOptions": "",
    "expected": [
      63.78491,
      55.93602
    ]
  },
  {
    "name": "linerepeated",
    "options": "rotate=45",
    "path": "(0,0) -- (1,0) -- ([turn]30:1cm) -- ([turn]-60:1cm)",
    "outerOptions": "",
    "expected": [
      54.96614,
      54.9662
    ]
  },
  {
    "name": "hvturn",
    "options": "rotate=45",
    "path": "(0,0) -| (1,1) -- ([turn]30:1cm)",
    "outerOptions": "",
    "expected": [
      -27.4833,
      47.60245
    ]
  },
  {
    "name": "cubicturn",
    "options": "rotate=60",
    "path": "(0,0) .. controls (1,0) and (1,1) .. (2,1) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      18.03825,
      88.14896
    ]
  },
  {
    "name": "arcidentity",
    "options": "",
    "path": "(1,0) arc (0:90:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      -28.45274,
      28.45274
    ]
  },
  {
    "name": "arccw",
    "options": "",
    "path": "(1,0) arc (0:-90:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      -28.45274,
      -28.45274
    ]
  },
  {
    "name": "archalf",
    "options": "",
    "path": "(1,0) arc (0:180:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      -28.45274,
      -28.45274
    ]
  },
  {
    "name": "arcfull",
    "options": "",
    "path": "(1,0) arc (0:360:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      28.45274,
      28.45274
    ]
  },
  {
    "name": "arclong",
    "options": "",
    "path": "(1,0) arc (0:450:1cm) -- ([turn]30:1cm)",
    "outerOptions": "",
    "expected": [
      -24.64085,
      14.22638
    ]
  },
  {
    "name": "arcrot90",
    "options": "rotate=90",
    "path": "(1,0) arc (0:90:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      -40.07852,
      25.96806
    ]
  },
  {
    "name": "arcrot45",
    "options": "rotate=45",
    "path": "(1,0) arc (0:90:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      5.03468,
      33.41505
    ]
  },
  {
    "name": "arcanisotropic",
    "options": "xscale=2,yscale=.5",
    "path": "(1,0) arc (0:90:1cm) -- ([turn]30:1cm)",
    "outerOptions": "",
    "expected": [
      -56.62723,
      12.82677
    ]
  },
  {
    "name": "arcreflection",
    "options": "xscale=-1",
    "path": "(1,0) arc (0:90:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      -28.45274,
      28.45274
    ]
  },
  {
    "name": "arcskew",
    "options": "cm={1,0,.5,1,(0,0)}",
    "path": "(1,0) arc (0:90:1cm) -- ([turn]30:1cm)",
    "outerOptions": "",
    "expected": [
      -17.52766,
      14.22638
    ]
  },
  {
    "name": "arcshift",
    "options": "shift={(1cm,2cm)}",
    "path": "(1,0) arc (0:90:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      11.008,
      62.88208
    ]
  },
  {
    "name": "arcellipse",
    "options": "",
    "path": "(2,0) arc (0:90:2cm and 1cm) -- ([turn]30:1cm)",
    "outerOptions": "",
    "expected": [
      -24.64087,
      14.22638
    ]
  },
  {
    "name": "arcnegstart",
    "options": "",
    "path": "(0,-1) arc (-90:45:1cm) -- ([turn]-30:1cm)",
    "outerOptions": "",
    "expected": [
      12.75497,
      47.60242
    ]
  },
  {
    "name": "arcchunk100",
    "options": "rotate=30",
    "path": "(1,0) arc (0:100:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      2.46078,
      41.26253
    ]
  },
  {
    "name": "arcchunk115",
    "options": "rotate=30",
    "path": "(1,0) arc (0:115:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      -4.0389,
      37.25278
    ]
  },
  {
    "name": "arcchunk116",
    "options": "rotate=30",
    "path": "(1,0) arc (0:116:1cm) -- ([turn]0:1cm)",
    "outerOptions": "",
    "expected": [
      -11.5415,
      41.68619
    ]
  },
  {
    "name": "arcnegativechunk",
    "options": "rotate=-20,shift={(2cm,1cm)}",
    "path": "(1,0) arc (0:-105:1cm) -- ([turn]30:1cm)",
    "outerOptions": "",
    "expected": [
      19.63669,
      -24.21935
    ]
  },
  {
    "name": "linenested",
    "outerOptions": "rotate=30",
    "options": "xscale=2,yscale=.5,rotate=15",
    "path": "(0,0) -- (1,1) -- ([turn]30:1cm)",
    "expected": [
      19.02335,
      47.52856
    ]
  },
  {
    "name": "arcnested",
    "outerOptions": "rotate=30",
    "options": "xscale=2,yscale=.5,rotate=15",
    "path": "(1,0) arc (0:90:1cm) -- ([turn]30:1cm)",
    "expected": [
      -69.38,
      -22.46985
    ]
  }
] as const;

describe("turn continuation matches fresh numerical PGF endpoints", () => {
  it.each(cases)("$name", ({ outerOptions, options, path, expected }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\begin{scope}[${outerOptions}]
\begin{scope}[${options}]
\draw ${path};
\end{scope}
\end{scope}
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const paths = elementsOfKind(result.scene.elements, "Path");
    expect(paths).toHaveLength(1);
    const lines = paths[0].commands.filter(command => command.kind === "L");
    expect(lines.length).toBeGreaterThan(0);
    const end = lines.at(-1)!.to;
    expect(Math.abs(end.x - expected[0])).toBeLessThan(0.005);
    expect(Math.abs(end.y - expected[1])).toBeLessThan(0.005);
  });
});
