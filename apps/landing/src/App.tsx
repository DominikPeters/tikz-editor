import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  RiAppleFill,
  RiCheckLine,
  RiCodeLine,
  RiEdit2Line,
  RiExternalLinkLine,
  RiFileListLine,
  RiGithubFill,
  RiNodeTree,
  RiRobot2Line,
  RiSideBarLine,
  RiSlideshowLine,
  RiUbuntuFill,
  RiWindowsFill
} from "@remixicon/react";
import { TOOL_BUTTONS } from "@tikz-editor/app/landing-assets";
import appScreenshotPng960 from "./assets/screenshots/app-screenshot-960.png";
import appScreenshotPng1600 from "./assets/screenshots/app-screenshot-1600.png";
import appScreenshotPng2400 from "./assets/screenshots/app-screenshot-2400.png";
import appScreenshotWebp960 from "./assets/screenshots/app-screenshot-960.webp";
import appScreenshotWebp1600 from "./assets/screenshots/app-screenshot-1600.webp";
import appScreenshotWebp2400 from "./assets/screenshots/app-screenshot-2400.webp";
import codexScreenshotPng960 from "./assets/screenshots/codex-960.png";
import codexScreenshotPng1600 from "./assets/screenshots/codex-1600.png";
import codexScreenshotPng2400 from "./assets/screenshots/codex-2400.png";
import codexScreenshotWebp960 from "./assets/screenshots/codex-960.webp";
import codexScreenshotWebp1600 from "./assets/screenshots/codex-1600.webp";
import codexScreenshotWebp2400 from "./assets/screenshots/codex-2400.webp";
import multiFigurePng960 from "./assets/screenshots/multi-figure-960.png";
import multiFigurePng1600 from "./assets/screenshots/multi-figure-1600.png";
import multiFigurePng2400 from "./assets/screenshots/multi-figure-2400.png";
import multiFigureWebp960 from "./assets/screenshots/multi-figure-960.webp";
import multiFigureWebp1600 from "./assets/screenshots/multi-figure-1600.webp";
import multiFigureWebp2400 from "./assets/screenshots/multi-figure-2400.webp";
import { AddArrowCard } from "./feature-demos/cards/AddArrowCard";
import { AddRectCard } from "./feature-demos/cards/AddRectCard";
import { NodeMoveCard } from "./feature-demos/cards/NodeMoveCard";
import { SelectionAlignCard } from "./feature-demos/cards/SelectionAlignCard";
import { SnapGuidesCard } from "./feature-demos/cards/SnapGuidesCard";
import { landingBuildDate } from "./generated/build-info";
import { releaseDownloadMetadata } from "./generated/release-downloads";
import { LANDING_TOOL_SVGS } from "./generated/tool-svgs";

type CodeLine = {
  id: string;
  number: string;
  content: ReactNode;
  active?: boolean;
  folded?: boolean;
  foldControl?: "open" | "closed";
};

type ToolPreviewMode = keyof typeof LANDING_TOOL_SVGS;
type ReleaseDownload = typeof releaseDownloadMetadata.downloads[number];
type DownloadPlatform = ReleaseDownload["platform"];
type MacArch = Extract<ReleaseDownload, { platform: "mac" }>["arch"];
type DesktopDownloadSelection = {
  platform: DownloadPlatform;
  macArch: MacArch;
};
type MagnifyCenter = {
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
};

type ResponsiveScreenshot = {
  png: string;
  pngSrcSet: string;
  webpSrcSet: string;
  width: number;
  height: number;
};

const MAGNIFY_REST_VIEW_BOX = {
  minX: -62.345,
  minY: -22.3934,
  width: 130.9992,
  height: 43.3935
};

const MAGNIFY_REST_POINT = {
  x: -31.8671,
  y: -6.2596
};

const APP_SCREENSHOT: ResponsiveScreenshot = responsiveScreenshot({
  png: [[appScreenshotPng960, 960], [appScreenshotPng1600, 1600], [appScreenshotPng2400, 2400]],
  webp: [[appScreenshotWebp960, 960], [appScreenshotWebp1600, 1600], [appScreenshotWebp2400, 2400]],
  fallback: appScreenshotPng2400,
  width: 2400,
  height: 1393
});

const MULTI_FIGURE_SCREENSHOT: ResponsiveScreenshot = responsiveScreenshot({
  png: [[multiFigurePng960, 960], [multiFigurePng1600, 1600], [multiFigurePng2400, 2400]],
  webp: [[multiFigureWebp960, 960], [multiFigureWebp1600, 1600], [multiFigureWebp2400, 2400]],
  fallback: multiFigurePng2400,
  width: 2400,
  height: 1148
});

const CODEX_SCREENSHOT: ResponsiveScreenshot = responsiveScreenshot({
  png: [[codexScreenshotPng960, 960], [codexScreenshotPng1600, 1600], [codexScreenshotPng2400, 2400]],
  webp: [[codexScreenshotWebp960, 960], [codexScreenshotWebp1600, 1600], [codexScreenshotWebp2400, 2400]],
  fallback: codexScreenshotPng2400,
  width: 2400,
  height: 1345
});

const tooltipLines: CodeLine[] = [
  line("1", "7", <>
    {"  "}<Tok kind="keyword">\node</Tok>{"["}<Tok kind="type">draw</Tok>{", "}<span className="landingHoverToken">rounded corners</span>{", "}
  </>),
  line("2", "8", <>
    {"    "}<Tok kind="type">fill</Tok>{"="}<Tok kind="number">blue!12</Tok>{", "}
    <Tok kind="type">minimum width</Tok>{"="}<Tok kind="number">18mm</Tok>{"]"}
  </>, true),
  line("3", "9", <>
    {"    "}<Tok kind="punctuation">(start)</Tok>{" at (0,0) "}
    <Tok kind="string">{"{Draft}"}</Tok><Tok kind="punctuation">;</Tok>
  </>)
];

const TOOL_COPY: Record<ToolPreviewMode, { name?: string; description: ReactNode }> = {
  select: {
    description: "Move, resize, and rotate objects, edit paths, and multi-select to edit multiple elements at once."
  },
  magnify: {
    description: <>A virtual magnifying glass to look at details in the figure, similar to <a href='https://www.texstudio.org/'>TeXstudio</a>.</>
  },
  addNode: {
    description: <>Add text to the figure using a TikZ <code>\node</code>.</>
  },
  addShape: {
    description: "Add a node using the shape library. Can add text. Examples: diamonds, polygons, stars, clouds, arrows."
  },
  addMatrix: {
    description: "Insert a matrix of nodes with a chosen number of rows and columns."
  },
  addLine: {
    description: <>Draw a straight TikZ <code>\draw</code> path.</>
  },
  addArrow: {
    description: <>Draw a straight TikZ <code>\draw[-&gt;]</code> arrow.</>
  },
  addBezier: {
    description: "Draw a curved path between two points."
  },
  addPath: {
    description: "Build multi-segment paths with straight and curved parts."
  },
  addFreehand: {
    description: "Draw a freehand path with smoothing."
  },
  addGrid: {
    description: "Draw a grid path."
  },
  addRect: {
    name: "Rectangle",
    description: "Draw a rectangle path."
  },
  addEllipse: {
    description: "Draw an ellipse path."
  },
  addCircle: {
    description: "Draw a circle path."
  },
  addBucket: {
    description: "Apply a fill color to an existing closed region."
  }
};

const TOOL_CATALOG = TOOL_BUTTONS.map((button) => {
  const mode: ToolPreviewMode = button.mode;
  return {
    ...button,
    name: TOOL_COPY[mode].name ?? button.label,
    description: TOOL_COPY[mode].description,
    preview: LANDING_TOOL_SVGS[mode]
  };
});

const FEATURE_GROUPS = [
  {
    title: "Files and export",
    icon: RiFileListLine,
    items: [
      <Fragment key="open-source-files">Open and edit <code>.tex</code> and <code>.tikz</code> files.</Fragment>,
      <Fragment key="import-figures">Import figures from SVG, Ipe <code>.ipe</code>, and PowerPoint <code>.pptx</code>.</Fragment>,
      <Fragment key="export-formats">Export to SVG, PNG, PDF, or standalone LaTeX.</Fragment>,
      "Work across multiple open documents with tabs."
    ]
  },
  {
    title: "Papers and figures",
    icon: RiSlideshowLine,
    items: [
      "Open a full paper with multiple figures, and navigate between figures using thumbnail previews.",
      "Draw nodes, shapes, matrices, arrows, paths, curves, grids, rectangles, ellipses, and circles.",
      "Edit text and equations directly in the figure."
    ]
  },
  {
    title: "Direct editing",
    icon: RiEdit2Line,
    items: [
      "Move, resize, rotate, duplicate, group, align, distribute, flip, and reorder objects.",
      "Edit paths with point handles, split/join, reverse, open/close, corner, and smooth point commands.",
      "Use snapping to grids, guides, object points, and object gaps."
    ]
  },
  {
    title: "Loops and structures",
    icon: RiNodeTree,
    items: [
      <Fragment key="repeat-dialog">Use the Repeat dialog to add a <code>\foreach</code> loop, copying the selection into multiple rows and columns.</Fragment>,
      <Fragment key="edit-foreach">Open and edit figures that already use <code>\foreach</code>, including nested loops.</Fragment>,
      "Add labels and pins to nodes.",
      "Edit tree diagrams by adding children and edit matrices with row/column and transpose commands."
    ]
  },
  {
    title: "Panels",
    icon: RiSideBarLine,
    items: [
      "Inspect and edit stroke, fill, arrows, text, transforms, shapes, and styling in the Inspector.",
      "Manage object visibility, grouping, renaming, and layer order in the Objects panel.",
      "Edit TikZ styles in the Styles panel, similar to CSS editing in browser devtools."
    ]
  },
  {
    title: "Source and assistant",
    icon: RiCodeLine,
    items: [
      "Use the source editor with syntax highlighting, autocomplete, folding, search, diagnostics, inline color swatches.",
      "Auto-format your code (fixing indentation).",
      "On desktop, ask the Codex assistant to help edit figures, including with image attachments."
    ],
    secondaryIcon: RiRobot2Line
  }
] as const;

const LANDING_DEMO_VIEW_BOXES = {
  nodeMove: "-51.215 -34.1433 130.8827 56",
  addRect: "-62.5961 -34 147.9543 53",
  snapGuides: "-82 -39 164 78",
  addArrow: "-68.2866 -27 156.4902 53"
} as const;

export function App() {
  return (
    <div className="landingTikzDevPage">
      <TikzDevHeader />
      <main className="landingPage">
        <Hero />
        <EditorStory />
      </main>
      <TikzDevFooter />
    </div>
  );
}

function TikzDevHeader() {
  return (
    <header className="landingTikzDevHeader">
      <div className="landingTikzDevHamburger" aria-hidden="true">☰</div>
      <strong className="landingTikzDevTitle">
        <a href="https://tikz.dev" className="landingTikzDevParentLink">tikz.dev / </a>
        <a href="/editor">TikZ Editor</a>
      </strong>
      <nav className="landingTikzDevLinks" aria-label="TikZ Editor links">
        <a className="landingTikzDevGithubLink" href="https://github.com/DominikPeters/tikz-editor">
          <RiGithubFill aria-hidden="true" size={18} />
          <span>GitHub</span>
        </a>
      </nav>
    </header>
  );
}

function TikzDevFooter() {
  return (
    <footer className="landingTikzDevFooter">
      <div className="landingFooterLinks">
        <a href="https://github.com/DominikPeters/tikz-editor/blob/master/LICENSE">License</a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/DominikPeters/tikz-editor">GitHub</a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/DominikPeters/tikz-editor/issues">Feedback and issues</a>
        <span aria-hidden="true">·</span>
        <a href="https://tikz.dev">PGF/<span className="landingTikzName">TikZ</span> Manual</a>
      </div>
      <div className="landingFooterMeta"><em>Last updated: {landingBuildDate}</em></div>
    </footer>
  );
}

function Hero() {
  const desktopDownloadSelection = useDesktopDownloadSelection();
  const desktopDownload = getDesktopDownload(desktopDownloadSelection);
  const DesktopDownloadIcon = desktopDownload.icon;

  return (
    <section className="landingHero" aria-labelledby="landing-title">
      <div className="landingHeroCopy">
        <h1 id="landing-title" className="landingTitle">
          <span>TikZ Editor</span>
          <span className="landingTitleVersion">v{releaseDownloadMetadata.version}</span>
        </h1>
        <p className="landingHeroLead">WYSIWYG editor for TikZ diagrams in LaTeX</p>
        <p className="landingHeroText">
          You can start from scratch or edit an existing TikZ figure, or even directly open your paper tex file to edit its images. The TikZ code gets instantly updated as you move around elements, without disturbing existing formatting such as line breaks and spaces.
        </p>
        <p className="landingHeroText">
          The app makes fine-tuning the positions of elements easy and instant, without needing to recompile. It supports all common TikZ features including \foreach loops.
        </p>
        <p className="landingHeroText">
          The app is free and open source (MIT licensed, code on <a href="https://github.com/DominikPeters/tikz-editor">GitHub</a>). It works on the web or as a lightweight desktop app with some extra features.
        </p>
        <div className="landingHeroActions" aria-label="Landing page links">
          <a href="https://tikz.dev/editor/web" className="landingPrimaryLink">
            <RiExternalLinkLine className="landingCtaIcon" aria-hidden="true" size={17} />
            <span className="landingCtaLabel">Open TikZ Editor Web</span>
          </a>
          <div className="landingDownloadBlock">
            <a href={desktopDownload.primary.url} className="landingDownloadLink">
              <span className="landingDownloadIcons" aria-hidden="true">
                <DesktopDownloadIcon className="landingCtaIcon" size={17} />
              </span>
              <span className="landingCtaLabel">{desktopDownload.primary.label}</span>
              <span className="landingDownloadSize">{formatDownloadSize(desktopDownload.primary.sizeBytes)}</span>
            </a>
            <div className="landingDownloadAlternates">
              {desktopDownload.alternatePrefix}
              {desktopDownload.alternates.map((alternate, index) => (
                <Fragment key={alternate.label}>
                  {index > 0 ? <span aria-hidden="true"> · </span> : null}
                  <a href={alternate.url}>{alternate.label}</a>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figure className="landingHeroScreenshot" aria-label="TikZ Editor interface screenshot">
        <ScreenshotImage
          image={APP_SCREENSHOT}
          alt="TikZ Editor interface with source, canvas, and inspector"
          sizes="min(1180px, 100vw)"
        />
      </figure>
    </section>
  );
}

function useDesktopDownloadSelection(): DesktopDownloadSelection {
  const [selection, setSelection] = useState<DesktopDownloadSelection>(() => getDesktopDownloadSelection());

  useEffect(() => {
    const userAgentData = getUserAgentData();
    if (!userAgentData?.getHighEntropyValues) {
      return;
    }

    void userAgentData.getHighEntropyValues(["architecture", "platform"]).then((values) => {
      setSelection((current) => {
        const next = selectionFromPlatformText(`${values.platform ?? ""} ${navigator.platform} ${navigator.userAgent}`);

        if (next.platform === "mac") {
          const detectedMacArch = macArchFromChromiumArchitecture(values.architecture);
          next.macArch = detectedMacArch ?? current.macArch;
        }

        return next.platform === current.platform && next.macArch === current.macArch ? current : next;
      });
    }).catch(() => {
      // User-agent high entropy values are only a hint; the default macOS choice is still valid.
    });
  }, []);

  return selection;
}

type BrowserUserAgentData = {
  getHighEntropyValues?: (hints: string[]) => Promise<{
    architecture?: string;
    platform?: string;
  }>;
};

function getUserAgentData(): BrowserUserAgentData | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return (navigator as Navigator & { userAgentData?: BrowserUserAgentData }).userAgentData;
}

function getDesktopDownloadSelection(): DesktopDownloadSelection {
  if (typeof navigator === "undefined") {
    return { platform: "mac", macArch: "arm64" };
  }

  return selectionFromPlatformText(`${navigator.platform} ${navigator.userAgent}`);
}

function selectionFromPlatformText(platformText: string): DesktopDownloadSelection {
  if (/win/i.test(platformText)) {
    return { platform: "windows", macArch: "arm64" };
  }
  if (/linux|x11|ubuntu|fedora|debian/i.test(platformText)) {
    return { platform: "linux", macArch: "arm64" };
  }
  return { platform: "mac", macArch: "arm64" };
}

function macArchFromChromiumArchitecture(architecture: string | undefined): MacArch | null {
  if (!architecture) {
    return null;
  }

  if (/arm|aarch64/i.test(architecture)) {
    return "arm64";
  }
  if (/x86|x64|amd64|ia32/i.test(architecture)) {
    return "x64";
  }
  return null;
}

function getDesktopDownload(selection: DesktopDownloadSelection) {
  if (selection.platform === "windows") {
    return {
      icon: RiWindowsFill,
      primary: downloadLink("Download for Windows", mustFindDownload((download) => download.platform === "windows" && download.format === "exe")),
      alternatePrefix: "",
      alternates: [releaseLink("Other platforms")]
    };
  }

  if (selection.platform === "linux") {
    return {
      icon: RiUbuntuFill,
      primary: downloadLink("Download AppImage for Linux", mustFindDownload((download) => download.platform === "linux" && download.format === "appimage")),
      alternatePrefix: "or choose ",
      alternates: [
        downloadLink("deb", mustFindDownload((download) => download.platform === "linux" && download.format === "deb")),
        downloadLink("rpm", mustFindDownload((download) => download.platform === "linux" && download.format === "rpm")),
        releaseLink("other platforms")
      ]
    };
  }

  const primaryArch = selection.macArch;
  const alternateArch: MacArch = primaryArch === "arm64" ? "x64" : "arm64";

  return {
    icon: RiAppleFill,
    primary: downloadLink(`Download for Mac (${macArchLabel(primaryArch)})`, mustFindDownload((download) => download.platform === "mac" && download.arch === primaryArch)),
    alternatePrefix: "or choose ",
    alternates: [
      downloadLink(`Mac (${macArchLabel(alternateArch)})`, mustFindDownload((download) => download.platform === "mac" && download.arch === alternateArch)),
      releaseLink("other platforms")
    ]
  };
}

function downloadLink(label: string, download: ReleaseDownload) {
  return {
    label,
    url: download.url,
    sizeBytes: download.sizeBytes
  };
}

function releaseLink(label: string) {
  return {
    label,
    url: releaseDownloadMetadata.url,
    sizeBytes: 0
  };
}

function mustFindDownload(predicate: (download: ReleaseDownload) => boolean): ReleaseDownload {
  const download = releaseDownloadMetadata.downloads.find(predicate);
  if (!download) {
    return releaseDownloadMetadata.downloads[0];
  }
  return download;
}

function macArchLabel(arch: MacArch): string {
  return arch === "arm64" ? "Apple Silicon" : "Intel";
}

function formatDownloadSize(sizeBytes: number): string {
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function EditorStory() {
  return (
    <>
      <section className="landingEditorStory" aria-label="TikZ Editor feature walkthrough">
        <SyncedDemo
          title="Drag elements to update or finetune locations"
          body="Instead of manually changing code coordinates, you can now just drag paths or nodes to where you want them, and the code updates instantly."
        >
          <NodeMoveCard sceneViewBox={LANDING_DEMO_VIEW_BOXES.nodeMove} />
        </SyncedDemo>

        <SyncedDemo
          title="Add new elements to figures"
          body="Tools are provided to add new paths (lines, arrows, multi-segment paths) as well as nodes, rectangles, and circles. New elements get inserted at the end of your code. And of course you can immediately move or resize those elements."
        >
          <AddRectCard sceneViewBox={LANDING_DEMO_VIEW_BOXES.addRect} />
        </SyncedDemo>

        <EditorRow
          code={<CodePanel title="tooltip-hover.tex" lines={tooltipLines} overlay={<DocsTooltipMock />} variant="editor" />}
          title="Full-featured source editor tailored to TikZ"
          body=<>The source panel always shows the current source. It has syntax highlighting for TikZ, allows code folding to hide the details of a scope, and shows snippets from the TikZ manual on hover. 
          <br/><br/> 
          It highlights errors with clear explanations of what's wrong (which is possible because the app does not use a tex compiler to understand your code). 
          <br/><br/>
          You can also edit colors and numbers directly in the source view without typing, using a color picker and number scrubbing.</>
        />

        <SyncedDemo
          title="Many convenience features are provided"
          body="The app supports snapping which easily allows you to align elements vertically or horizontally, and make sure they are spaced at equal distances. It also features rulers and customizable guide lines, as well as zoom and a magnifying glass tool."
        >
          <SnapGuidesCard sceneViewBox={LANDING_DEMO_VIEW_BOXES.snapGuides} />
        </SyncedDemo>

        <SyncedDemo
          title="Native support for common TikZ features"
          body="The app allows you to produce idiomatic TikZ figures. For example, paths can easily be drawn so they attach to node anchors. The app also has support for editing node labels and pins, as well as edge labels."
        >
          <AddArrowCard sceneViewBox={LANDING_DEMO_VIEW_BOXES.addArrow} />
        </SyncedDemo>

        <SyncedDemo
          title="Multi-selection for grouping and aligning"
          body="You can select multiple objects and group them (implement using TikZ scopes) as well as use layout features including align and distribute."
        >
          <SelectionAlignCard />
        </SyncedDemo>
      </section>
      <PaperFileSection />
      <AiAssistSection />
      <ToolCatalogSection />
      <FeatureChecklistSection />
      <HowItWorksSection />
    </>
  );
}

function PaperFileSection() {
  return (
    <section className="landingPaperSection" aria-labelledby="paper-workflow-title">
      <div className="landingPaperSectionInner">
        <div className="landingPaperCopy">
          <h2 id="paper-workflow-title">Multi-figure support so you can open the full paper</h2>
          <p>
            Open a full <code>.tex</code> paper file and directly edit its figures. Figure previews
            at the bottom of the app make it easy to switch between the different <code>tikzpicture</code> environments in your paper. The app understands many of your custom macros.
          </p>
        </div>
        <figure className="landingPaperScreenshot">
          <ScreenshotImage
            image={MULTI_FIGURE_SCREENSHOT}
            alt="TikZ Editor showing a multi-figure TeX paper with figure previews"
            sizes="min(1000px, 100vw)"
            loading="lazy"
          />
        </figure>
      </div>
    </section>
  );
}

function AiAssistSection() {
  return (
    <section className="landingPaperSection landingAiSection" aria-labelledby="ai-workflow-title">
      <div className="landingPaperSectionInner">
        <div className="landingPaperCopy">
          <h2 id="ai-workflow-title">Ask AI for help editing your figures</h2>
          <p>
            On the desktop version, if OpenAI Codex is installed, you can ask GPT to edit your figure directly
            in the app. The assistant has access to several TikZ-specific tools. Usage draws from your ChatGPT
            account.
          </p>
        </div>
        <figure className="landingPaperScreenshot">
          <ScreenshotImage
            image={CODEX_SCREENSHOT}
            alt="TikZ Editor desktop assistant editing a figure with Codex"
            sizes="min(1000px, 100vw)"
            loading="lazy"
          />
        </figure>
      </div>
    </section>
  );
}

function ToolCatalogSection() {
  return (
    <section className="landingToolCatalog" aria-labelledby="tool-catalog-title">
      <div className="landingToolCatalogInner">
        <div className="landingToolCatalogIntro">
          <h2 id="tool-catalog-title">Available tools</h2>
        </div>
        <div className="landingToolRows">
          {TOOL_CATALOG.map((tool) => {
            const ToolIcon = tool.icon;
            return (
              <article className="landingToolRow" key={tool.mode}>
                <div className="landingToolIcon" aria-hidden="true">
                  <ToolIcon size={22} />
                </div>
                <div className="landingToolDescription">
                  <h3>{tool.name}</h3>
                  <p>{tool.description}</p>
                </div>
                {tool.mode === "magnify" ? (
                  <MagnifyToolPreview svg={tool.preview.svg} label={`${tool.name} example`} />
                ) : (
                  <div className="landingToolExample" data-tool-mode={tool.mode} aria-label={`${tool.name} example`}>
                    <div className="landingToolPreviewSvg" dangerouslySetInnerHTML={{ __html: tool.preview.svg }} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FeatureChecklistSection() {
  return (
    <section className="landingFeatureChecklist" aria-labelledby="feature-checklist-title">
      <div className="landingFeatureChecklistInner">
        <div className="landingFeatureChecklistIntro">
          <h2 id="feature-checklist-title">List of editor features</h2>
        </div>
        <div className="landingFeatureGroups">
          {FEATURE_GROUPS.map((group) => {
            const GroupIcon = group.icon;
            const SecondaryIcon = "secondaryIcon" in group ? group.secondaryIcon : null;
            return (
              <article className="landingFeatureGroup" key={group.title}>
                <h3>
                  <span className="landingFeatureGroupIcon" aria-hidden="true">
                    <GroupIcon size={17} />
                    {SecondaryIcon ? <SecondaryIcon className="landingFeatureGroupSecondaryIcon" size={13} /> : null}
                  </span>
                  <span>{group.title}</span>
                </h3>
                <ul>
                  {group.items.map((item, index) => (
                    <li key={index}>
                      <RiCheckLine aria-hidden="true" size={14} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section className="landingHowItWorks" aria-labelledby="how-it-works-title">
      <div className="landingHowItWorksInner">
        <h2 id="how-it-works-title">How the app works</h2>
        <p>
          The app is written in TypeScript and the desktop version is using <a href="https://tauri.app/">Tauri</a> with a light Rust backend. The initial code base was written by Codex using gpt-5-3-codex, gpt-5-4, gpt-5-4-mini, and gpt-5-5 over a three-month period, with some contributions from Claude. It was built by <a href="https://dominik-peters.de/">Dominik Peters</a>.
        </p>
        <p>
          Parsing TeX code is famously near impossible, which probably explains why prior to this project, no WYSIWYG editor for TikZ existed (with some exceptions like <a href="https://tikzit.github.io/">TikZiT</a> but which doesn't allow you to bring your pre-existing TikZ code). With the arrival of competent LLM coding agents, this parsing task has now become kind of feasible thanks to their inhuman patience to attack this problem by brute force.
        </p>
        <p>
          Now, the app does not parse arbitrary TeX code; it only parses commands that are frequently used in the process of making TikZ figures. Thus, code that is very "hacky" will likely not be interpreted correctly. Still, coverage is pretty good and increasing over time. The app parses the given TikZ code and builds an internal representation of it which becomes a semantic layer that resolves coordinates, styles, transforms, loops, nodes, paths, and text into editable scene elements. This representation is closely linked to the syntactic input, by tagging it with line and character ranges. This allows the app to change parts of the code using small patches, without having to re-write the TikZ code in some canonical format. This way, the user's indentation and line breaks are preserved faithfully. The scene is then rendered using SVG.
        </p>
        <p>
          Text and math rendering are done via <a href="https://www.mathjax.org/">MathJax</a>. To support multi-line text, the app re-implements the TeX algorithm for hyphenation and the <a href="https://en.wikipedia.org/wiki/Knuth%E2%80%93Plass_line-breaking_algorithm">Knuth-Plass line-breaking algorithm</a>. This was a major effort, but it means that the way that multi-line text is displayed in the app usually exactly mirrors the way that TeX renders the same text.
        </p>
        <p>
          The app includes a custom color picker that internally converts RGB colors to the closest color representable by short xcolor strings, so that #409a40 becomes violet!88!white!45!green. The code for this is available as the npm package <a href="https://www.npmjs.com/package/xcolor-rgb-convert">xcolor-rgb-convert</a>.
        </p>
        <p>
          The app supports importing a variety of file formats based on converters that I developed for this purpose; these converters are available as standalone npm packages: <a href="https://www.npmjs.com/package/svg2tikz">svg2tikz</a>, <a href="https://www.npmjs.com/package/pptx2tikz">pptx2tikz</a> built on top of <a href="https://github.com/pipipi-pikachu/pptxtojson">pptxtojson</a>, and <a href="https://www.npmjs.com/package/ipe2tikz">ipe2tikz</a>. The desktop app also supports directly pasting objects from PowerPoint and Keynote; for the latter feature I built an interpreter for the keynote clipboard format, available as npm package <a href="https://www.npmjs.com/package/keynote-clipboard">keynote-clipboard</a>. The desktop app also includes support for AI assistance via the <a href="https://developers.openai.com/codex/app-server">Codex App Server</a>. The app's source editor is built on top of <a href="https://codemirror.net/">CodeMirror</a>.
        </p>
      </div>
    </section>
  );
}

function MagnifyToolPreview({ svg, label }: { svg: string; label: string }) {
  const lensRadiusPx = 46;
  const magnifyScale = 2.25;
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [center, setCenter] = useState<MagnifyCenter>({
    x: 0,
    y: 0,
    frameWidth: 0,
    frameHeight: 0
  });
  const style = {
    "--landingMagnifyX": `${center.x}px`,
    "--landingMagnifyY": `${center.y}px`,
    "--landingMagnifyFrameWidth": `${center.frameWidth}px`,
    "--landingMagnifyFrameHeight": `${center.frameHeight}px`,
    "--landingMagnifyContentX": `${lensRadiusPx - center.x * magnifyScale}px`,
    "--landingMagnifyContentY": `${lensRadiusPx - center.y * magnifyScale}px`,
    "--landingMagnifyScale": magnifyScale
  } as CSSProperties;

  const setCenterFromFrame = useCallback((xPx: number, yPx: number, frameWidth: number, frameHeight: number): void => {
    setCenter({
      x: xPx,
      y: yPx,
      frameWidth,
      frameHeight
    });
  }, []);

  const resetCenter = useCallback((): void => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const viewBoxAspect = MAGNIFY_REST_VIEW_BOX.width / MAGNIFY_REST_VIEW_BOX.height;
    const frameAspect = rect.width / rect.height;
    const fittedWidth = frameAspect > viewBoxAspect ? rect.height * viewBoxAspect : rect.width;
    const fittedHeight = frameAspect > viewBoxAspect ? rect.height : rect.width / viewBoxAspect;
    const fittedLeft = (rect.width - fittedWidth) / 2;
    const fittedTop = (rect.height - fittedHeight) / 2;
    const xRatio = (MAGNIFY_REST_POINT.x - MAGNIFY_REST_VIEW_BOX.minX) / MAGNIFY_REST_VIEW_BOX.width;
    const yRatio = (MAGNIFY_REST_POINT.y - MAGNIFY_REST_VIEW_BOX.minY) / MAGNIFY_REST_VIEW_BOX.height;
    setCenterFromFrame(fittedLeft + xRatio * fittedWidth, fittedTop + yRatio * fittedHeight, rect.width, rect.height);
  }, [setCenterFromFrame]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) {
      return;
    }
    resetCenter();

    const observer = new ResizeObserver(resetCenter);
    observer.observe(preview);
    return () => {
      observer.disconnect();
    };
  }, [resetCenter]);

  const updateCenter = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const xPx = event.clientX - rect.left;
    const yPx = event.clientY - rect.top;
    if (xPx < 0 || xPx > rect.width || yPx < 0 || yPx > rect.height) {
      setIsActive(false);
      resetCenter();
      return;
    }
    setIsActive(true);
    setCenterFromFrame(xPx, yPx, rect.width, rect.height);
  };

  return (
    <div
      className="landingToolExample landingMagnifyToolExample"
      data-tool-mode="magnify"
      data-magnify-active={isActive ? "true" : "false"}
      aria-label={label}
      style={style}
      onPointerMove={updateCenter}
    >
      <div
        ref={previewRef}
        className="landingToolPreviewSvg"
        dangerouslySetInnerHTML={{ __html: svg }}
        onPointerEnter={updateCenter}
        onPointerMove={updateCenter}
        onPointerLeave={() => {
          setIsActive(false);
          resetCenter();
        }}
      />
      <div className="landingMagnifyOverlayFrame" aria-hidden="true">
        <div className="landingMagnifyLensLayer">
          <div className="landingMagnifyLensSvg" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
        <div className="landingMagnifyLensRing" />
      </div>
    </div>
  );
}

function ScreenshotImage({
  image,
  alt,
  sizes,
  loading = "eager"
}: {
  image: ResponsiveScreenshot;
  alt: string;
  sizes: string;
  loading?: "eager" | "lazy";
}) {
  return (
    <picture>
      <source type="image/webp" srcSet={image.webpSrcSet} sizes={sizes} />
      <source type="image/png" srcSet={image.pngSrcSet} sizes={sizes} />
      <img src={image.png} alt={alt} width={image.width} height={image.height} loading={loading} decoding="async" />
    </picture>
  );
}

function responsiveScreenshot({
  png,
  webp,
  fallback,
  width,
  height
}: {
  png: Array<[string, number]>;
  webp: Array<[string, number]>;
  fallback: string;
  width: number;
  height: number;
}): ResponsiveScreenshot {
  return {
    png: fallback,
    pngSrcSet: png.map(([src, candidateWidth]) => `${src} ${candidateWidth}w`).join(", "),
    webpSrcSet: webp.map(([src, candidateWidth]) => `${src} ${candidateWidth}w`).join(", "),
    width,
    height
  };
}

function EditorRow({
  code,
  title,
  body,
  children
}: {
  code: ReactNode;
  title: string;
  body: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="landingEditorRow">
      <div className="landingCodeRail">{code}</div>
      <div className="landingFeatureColumn">
        <div className="landingFeatureCopy">
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        {children ? <div className="landingFeatureVisual">{children}</div> : null}
      </div>
    </article>
  );
}

function SyncedDemo({
  title,
  body,
  children
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <article className="landingEditorRow landingSyncedRow">
      <div className="landingCodeRail landingCodeRailEmpty" aria-hidden="true" />
      <div className="landingFeatureColumn landingDemoCopy">
        <div className="landingFeatureCopy">
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
      </div>
      <div className="landingSyncedDemo">
        {children}
      </div>
    </article>
  );
}

function CodePanel({
  title,
  lines,
  overlay,
  variant
}: {
  title: string;
  lines: CodeLine[];
  overlay?: ReactNode;
  variant?: "editor";
}) {
  return (
    <div className={["landingCodePanel", overlay ? "landingCodePanelWithOverlay" : "", variant === "editor" ? "landingCodePanelEditor" : ""].filter(Boolean).join(" ")}>
      <div className="landingCodeTitle">{title}</div>
      <pre className="landingCodePreview" aria-label={title}>
        <code>
          {lines.map((codeLine) => (
            <span
              className={[
                "landingCodeLine",
                codeLine.active ? "isActive" : "",
                codeLine.folded ? "isFolded" : ""
              ].filter(Boolean).join(" ")}
              key={codeLine.id}
            >
              <span className="landingFoldGutter">
                {codeLine.foldControl ? (
                  <span title={codeLine.foldControl === "closed" ? "Unfold line" : "Fold line"}>
                    {codeLine.foldControl === "closed" ? "›" : "⌄"}
                  </span>
                ) : null}
              </span>
              <span className="landingLineNumber">{codeLine.number}</span>
              <span className="landingLineContent">{codeLine.content}</span>
            </span>
          ))}
        </code>
      </pre>
      {overlay}
    </div>
  );
}

function DocsTooltipMock() {
  return (
    <div className="cm-editor-docs-tooltip landingDocsTooltipMock" role="note">
      <div className="cm-editor-docs-tooltip-meta">
        <div className="cm-editor-docs-tooltip-signature">
          <code>rounded corners</code>
        </div>
        <div className="cm-editor-docs-tooltip-default">default <code>4pt</code></div>
      </div>
      <div className="cm-editor-docs-tooltip-snippet">
        <p>Rounds corners on rectangle and path joins.</p>
        <p>Can be combined with <code>rounded corners=2pt</code>.</p>
      </div>
      <div className="cm-editor-docs-tooltip-link-row">
        <a className="cm-editor-docs-tooltip-link" href="https://tikz.dev/tikz-actions" target="_blank" rel="noreferrer">Open docs</a>
      </div>
    </div>
  );
}

function Tok({ kind, children }: { kind: "keyword" | "type" | "string" | "number" | "punctuation" | "comment" | "meta"; children: ReactNode }) {
  return <span className={`landingTok landingTok-${kind}`}>{children}</span>;
}

function line(id: string, number: string, content: ReactNode, active = false, folded = false, foldControl?: "open" | "closed"): CodeLine {
  return { id, number, content, active, folded, foldControl };
}
