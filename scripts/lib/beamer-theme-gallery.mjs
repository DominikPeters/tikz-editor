function serializedPayload(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/**
 * Render a self-contained comparison browser. Image/report assets remain
 * external and are addressed relative to the generated HTML file, so the
 * artifact works directly from disk without a web server.
 */
export function renderBeamerThemeGallery(report) {
  const payload = serializedPayload(report);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Beamer theme fidelity gallery</title>
<style>
  :root {
    color-scheme: light;
    --ink: #17202a;
    --muted: #66717e;
    --line: #dce2e8;
    --panel: #ffffff;
    --wash: #f4f6f8;
    --accent: #3157d5;
    --accent-soft: #e8edff;
    --pass: #19733c;
    --pass-soft: #e7f5ec;
    --fail: #ae3c2c;
    --fail-soft: #fff0ed;
    --shadow: 0 12px 36px rgb(31 42 55 / 9%);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-width: 920px;
    color: var(--ink);
    background: var(--wash);
    font: 14px/1.45 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
  }
  button, select, input { font: inherit; }
  button { color: inherit; }
  .shell {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    min-height: 100vh;
  }
  aside {
    position: sticky;
    top: 0;
    height: 100vh;
    overflow: auto;
    padding: 22px 16px;
    border-right: 1px solid var(--line);
    background: #fbfcfd;
  }
  .brand {
    margin: 0 8px 4px;
    font-size: 17px;
    letter-spacing: -.01em;
  }
  .subtitle {
    margin: 0 8px 18px;
    color: var(--muted);
    font-size: 12px;
  }
  .theme-list { display: grid; gap: 4px; }
  .theme-button {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .theme-button:hover { background: #f0f3f6; }
  .theme-button:disabled { opacity: .45; cursor: default; }
  .theme-button:disabled:hover { background: transparent; }
  .theme-button.active {
    border-color: #c7d1f9;
    background: var(--accent-soft);
    color: #1e3fae;
  }
  .count {
    min-width: 34px;
    color: var(--muted);
    font-size: 11px;
    text-align: right;
  }
  main { min-width: 0; padding: 22px 26px 32px; }
  .toolbar {
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .identity h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -.02em;
  }
  .identity p { margin: 2px 0 0; color: var(--muted); }
  .controls { display: flex; gap: 8px; align-items: center; }
  select, .segmented button, .nav-button {
    border: 1px solid var(--line);
    background: var(--panel);
    border-radius: 8px;
  }
  select { padding: 7px 30px 7px 10px; }
  .segmented {
    display: flex;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #edf0f3;
  }
  .segmented button {
    padding: 5px 9px;
    border-color: transparent;
    background: transparent;
    cursor: pointer;
  }
  .segmented button.active {
    border-color: var(--line);
    background: white;
    box-shadow: 0 1px 3px rgb(31 42 55 / 9%);
  }
  .status-row {
    display: flex;
    gap: 10px;
    align-items: center;
    min-height: 30px;
    margin-bottom: 12px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 650;
  }
  .badge.pass { color: var(--pass); background: var(--pass-soft); }
  .badge.fail { color: var(--fail); background: var(--fail-soft); }
  .metrics { color: var(--muted); font-variant-numeric: tabular-nums; }
  .stage {
    min-height: 420px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--shadow);
  }
  .split {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  figure { min-width: 0; margin: 0; }
  figure + figure { border-left: 1px solid var(--line); }
  figcaption {
    display: flex;
    justify-content: space-between;
    padding: 9px 12px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 12px;
    font-weight: 650;
    letter-spacing: .04em;
    text-transform: uppercase;
  }
  .slide-image {
    display: block;
    width: 100%;
    height: auto;
    background: white;
  }
  .single-image { width: 100%; }
  .wipe {
    position: relative;
    overflow: hidden;
    background: white;
  }
  .wipe img { display: block; width: 100%; }
  .wipe .oracle-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    width: 50%;
    border-right: 2px solid var(--accent);
  }
  .wipe .oracle-layer img {
    width: calc(100vw - 292px);
    max-width: none;
  }
  .wipe-control {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    border-top: 1px solid var(--line);
  }
  .wipe-control input { width: 100%; accent-color: var(--accent); }
  .empty {
    display: grid;
    min-height: 420px;
    place-content: center;
    padding: 30px;
    color: var(--muted);
    text-align: center;
  }
  .empty strong { color: var(--ink); font-size: 16px; }
  .diagnostics {
    margin: 12px 0 0;
    padding: 10px 12px;
    border: 1px solid #f0d1cc;
    border-radius: 8px;
    color: #7f3328;
    background: #fff8f6;
  }
  .diagnostics:empty { display: none; }
  .frame-nav {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    margin-top: 16px;
  }
  .nav-button {
    width: 36px;
    height: 36px;
    cursor: pointer;
  }
  .nav-button:disabled { opacity: .35; cursor: default; }
  .frames {
    display: flex;
    gap: 7px;
    overflow-x: auto;
    padding: 3px;
  }
  .frame-button {
    flex: 0 0 auto;
    min-width: 42px;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: white;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .frame-button.active {
    border-color: var(--accent);
    color: #1e3fae;
    background: var(--accent-soft);
  }
  .frame-button.failed { box-shadow: inset 0 -3px var(--fail); }
  .details {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    margin-top: 10px;
    color: var(--muted);
    font-size: 12px;
  }
  .details a { color: var(--accent); }
</style>
</head>
<body>
<div class="shell">
  <aside>
    <h2 class="brand">Beamer themes</h2>
    <p class="subtitle" id="run-summary"></p>
    <nav class="theme-list" id="theme-list" aria-label="Themes"></nav>
  </aside>
  <main>
    <header class="toolbar">
      <div class="identity">
        <h1 id="theme-title"></h1>
        <p id="slide-title"></p>
      </div>
      <div class="controls">
        <select id="deck-select" aria-label="Deck"></select>
        <div class="segmented" id="mode-select" aria-label="Comparison mode">
          <button data-mode="split" class="active">Split</button>
          <button data-mode="wipe">Wipe</button>
          <button data-mode="overlay">Overlay</button>
          <button data-mode="difference">Difference</button>
        </div>
      </div>
    </header>
    <div class="status-row">
      <span class="badge" id="status-badge"></span>
      <span class="metrics" id="metrics"></span>
    </div>
    <section class="stage" id="stage"></section>
    <div class="diagnostics" id="diagnostics"></div>
    <nav class="frame-nav" aria-label="Slides">
      <button class="nav-button" id="previous-frame" aria-label="Previous slide">←</button>
      <div class="frames" id="frames"></div>
      <button class="nav-button" id="next-frame" aria-label="Next slide">→</button>
    </nav>
    <footer class="details">
      <span id="position"></span>
      <a id="report-link">Open structural report</a>
    </footer>
  </main>
</div>
<script>
const report = ${payload};
const resultByKey = new Map(
  report.results.map((item) => [
    [item.variant, item.deck, item.frame].join("\\u0000"),
    item,
  ])
);
const labels = new Map(
  (report.variantCatalog || []).map((item) => [item.id, item.label])
);
const state = {
  theme: report.variants[0],
  deck: report.decks[0],
  frame: 1,
  mode: "split",
};

function key(theme, deck, frame) {
  return [theme, deck, frame].join("\\u0000");
}
function themeLabel(theme) {
  return labels.get(theme) || theme;
}
function resultsFor(theme, deck) {
  return report.results
    .filter((item) => item.variant === theme && item.deck === deck)
    .sort((left, right) => left.frame - right.frame);
}
function currentResults() {
  return resultsFor(state.theme, state.deck);
}
function firstThemeForDeck(deck) {
  return report.variants.find((theme) => resultsFor(theme, deck).length > 0);
}
function currentResult() {
  const frames = currentResults();
  return resultByKey.get(key(state.theme, state.deck, state.frame)) || frames[0];
}
function statusText(result) {
  if (result.status === "passed") return "Structural match";
  if (result.status === "error") return "Comparison error";
  return result.diagnostics?.some((item) =>
    item.code === "beamer-unknown-theme-component"
  ) ? "Renderer theme unsupported" : "Structural differences";
}
function image(path, label, className = "slide-image") {
  return path
    ? '<img class="' + className + '" src="' + path + '" alt="' + label + '">'
    : "";
}
function renderThemes() {
  const container = document.querySelector("#theme-list");
  container.replaceChildren();
  for (const theme of report.variants) {
    const items = resultsFor(theme, state.deck);
    const passed = items.filter((item) => item.status === "passed").length;
    const button = document.createElement("button");
    button.className = "theme-button" + (theme === state.theme ? " active" : "");
    button.innerHTML =
      "<span>" + themeLabel(theme) + "</span>" +
      '<span class="count">' +
      (items.length > 0 ? passed + "/" + items.length : "—") +
      "</span>";
    button.disabled = items.length === 0;
    button.addEventListener("click", () => {
      state.theme = theme;
      state.frame = resultsFor(state.theme, state.deck)[0]?.frame || 1;
      render();
    });
    container.append(button);
  }
}
function renderDecks() {
  const select = document.querySelector("#deck-select");
  select.replaceChildren();
  for (const deck of report.decks) {
    const option = document.createElement("option");
    option.value = deck;
    option.textContent = deck === "kkt" ? "KKT deck" : "Conformance deck";
    option.selected = deck === state.deck;
    select.append(option);
  }
}
function renderFrames(result) {
  const items = currentResults();
  const container = document.querySelector("#frames");
  container.replaceChildren();
  for (const item of items) {
    const button = document.createElement("button");
    button.className =
      "frame-button" +
      (item.frame === result.frame ? " active" : "") +
      (item.status === "passed" ? "" : " failed");
    button.textContent = String(item.frame);
    button.title = item.frameTitle || "Slide " + item.frame;
    button.addEventListener("click", () => {
      state.frame = item.frame;
      render();
    });
    container.append(button);
    if (item.frame === result.frame) {
      requestAnimationFrame(() =>
        button.scrollIntoView({ block: "nearest", inline: "nearest" })
      );
    }
  }
  const index = items.findIndex((item) => item.frame === result.frame);
  document.querySelector("#previous-frame").disabled = index <= 0;
  document.querySelector("#next-frame").disabled =
    index < 0 || index >= items.length - 1;
  document.querySelector("#position").textContent =
    "Slide " + (index + 1) + " of " + items.length;
}
function renderStage(result) {
  const stage = document.querySelector("#stage");
  const visuals = result.visuals || {};
  if (!visuals.renderer || !visuals.oracle) {
    stage.innerHTML =
      '<div class="empty"><strong>No visual assets for this run</strong>' +
      "<span>The structural report remains available below.</span></div>";
    return;
  }
  if (state.mode === "split") {
    stage.innerHTML =
      '<div class="split"><figure><figcaption><span>Renderer</span><span>SVG</span></figcaption>' +
      image(visuals.renderer, "Native renderer") +
      '</figure><figure><figcaption><span>Oracle</span><span>LuaLaTeX</span></figcaption>' +
      image(visuals.oracle, "LuaLaTeX oracle") + "</figure></div>";
    return;
  }
  if (state.mode === "wipe") {
    stage.innerHTML =
      '<figure><figcaption><span>Renderer ←</span><span>→ Oracle</span></figcaption>' +
      '<div class="wipe">' +
      image(visuals.renderer, "Native renderer") +
      '<div class="oracle-layer" id="oracle-layer">' +
      image(visuals.oracle, "LuaLaTeX oracle") +
      '</div></div><label class="wipe-control">Renderer ' +
      '<input id="wipe-range" type="range" min="0" max="100" value="50">' +
      " Oracle</label></figure>";
    document.querySelector("#wipe-range").addEventListener("input", (event) => {
      document.querySelector("#oracle-layer").style.width =
        event.target.value + "%";
    });
    return;
  }
  const source =
    state.mode === "overlay" ? visuals.overlay : visuals.difference;
  stage.innerHTML =
    '<figure><figcaption><span>' +
    (state.mode === "overlay" ? "50% overlay" : "Pixel difference") +
    "</span><span>Renderer ↔ Oracle</span></figcaption>" +
    image(source, state.mode, "slide-image single-image") +
    "</figure>";
}
function renderMetadata(result) {
  document.querySelector("#theme-title").textContent = themeLabel(state.theme);
  document.querySelector("#slide-title").textContent =
    result.frameTitle || "Untitled slide";
  const badge = document.querySelector("#status-badge");
  badge.textContent = statusText(result);
  badge.className =
    "badge " + (result.status === "passed" ? "pass" : "fail");
  const summary = result.summary;
  document.querySelector("#metrics").textContent = summary
    ? "Δx " + summary.maxAbsoluteGlyphDxPt.toFixed(4) + "pt · " +
      "Δy " + summary.maxAbsoluteGlyphDyPt.toFixed(4) + "pt · " +
      summary.comparedGlyphs + " glyphs"
    : "No structural report";
  document.querySelector("#diagnostics").textContent =
    (result.diagnostics || []).map((item) => item.message).join(" · ");
  const link = document.querySelector("#report-link");
  link.href = result.report || "#";
  link.hidden = !result.report;
}
function syncHash() {
  const params = new URLSearchParams({
    theme: state.theme,
    deck: state.deck,
    frame: String(state.frame),
    mode: state.mode,
  });
  history.replaceState(null, "", "#" + params);
}
function render() {
  if (currentResults().length === 0) {
    state.theme = firstThemeForDeck(state.deck) || state.theme;
  }
  const result = currentResult();
  if (!result) return;
  if (
    (state.mode === "overlay" && !result.visuals?.overlay) ||
    (state.mode === "difference" && !result.visuals?.difference)
  ) {
    state.mode = "split";
  }
  state.frame = result.frame;
  renderThemes();
  renderDecks();
  renderFrames(result);
  renderStage(result);
  renderMetadata(result);
  document.querySelectorAll("#mode-select button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
    button.disabled =
      (button.dataset.mode === "overlay" && !result.visuals?.overlay) ||
      (button.dataset.mode === "difference" && !result.visuals?.difference);
  });
  syncHash();
}
function stepFrame(direction) {
  const items = currentResults();
  const index = items.findIndex((item) => item.frame === state.frame);
  const next = items[index + direction];
  if (next) {
    state.frame = next.frame;
    render();
  }
}

const hash = new URLSearchParams(location.hash.slice(1));
if (report.variants.includes(hash.get("theme"))) state.theme = hash.get("theme");
if (report.decks.includes(hash.get("deck"))) state.deck = hash.get("deck");
if (/^\\d+$/.test(hash.get("frame") || "")) state.frame = Number(hash.get("frame"));
if (["split", "wipe", "overlay", "difference"].includes(hash.get("mode"))) {
  state.mode = hash.get("mode");
}
document.querySelector("#run-summary").textContent =
  report.passed + " of " + report.results.length + " comparisons pass";
document.querySelector("#deck-select").addEventListener("change", (event) => {
  state.deck = event.target.value;
  if (resultsFor(state.theme, state.deck).length === 0) {
    state.theme = firstThemeForDeck(state.deck) || state.theme;
  }
  state.frame = resultsFor(state.theme, state.deck)[0]?.frame || 1;
  render();
});
document.querySelector("#mode-select").addEventListener("click", (event) => {
  const mode = event.target.dataset.mode;
  if (mode) {
    state.mode = mode;
    render();
  }
});
document.querySelector("#previous-frame").addEventListener("click", () => stepFrame(-1));
document.querySelector("#next-frame").addEventListener("click", () => stepFrame(1));
document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") stepFrame(-1);
  if (event.key === "ArrowRight") stepFrame(1);
});
render();
</script>
</body>
</html>
`;
}
