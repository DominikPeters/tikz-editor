import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { getActiveEditorPlatform } from "../platform/current";
import { useSettingsStore } from "../settings/useSettingsStore";
import { createBrowserPresentationApi } from "./browser-platform";
import { presentationElapsed } from "./controller";
import { presentationKeyCommand } from "./keyboard";
import type { PresentationCommand, PresentationCursor, PresentationRole, PresentationSnapshot, PresentationTransport } from "./types";
import css from "./PresentationWindow.module.css";
import { usePresentationSvg } from "./svg";

function Slide({ svg, cursor, label }: { svg: string | null; cursor?: PresentationCursor; label: string }) {
  const markup = usePresentationSvg(svg);
  return <div className={css.slide} role="img" aria-label={label} data-frame={cursor?.frame} data-step={cursor?.step} data-continuation={cursor?.continuation}
    dangerouslySetInnerHTML={{ __html: markup }} />;
}
function SpeakerNotes({ svg }: { svg: string }) { const markup = usePresentationSvg(svg); return <div dangerouslySetInnerHTML={{ __html: markup }} />; }
export function PresentationDisplayIdentifier({ number, name }: { number: string; name: string }) {
  return <main className={css.identifier}><strong>{number}</strong><span>{name}</span></main>;
}
function formatTime(milliseconds: number): string {
  const seconds = Math.floor(Math.abs(milliseconds) / 1000), minutes = Math.floor(seconds / 60);
  return `${milliseconds < 0 ? "−" : ""}${Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)}:` : ""}${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function FilmstripItem({ frame, title, svg, active, revision, send }: { frame: number; title: string; svg: string | undefined; active: boolean; revision: number; send: (command: PresentationCommand) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || svg) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { send({ type: "thumbnail", frame }); observer.disconnect(); }
    }, { root: element.closest(`.${css.filmstrip}`), rootMargin: "300px" });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [frame, svg, revision, send]);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [active]);
  return <button type="button" ref={ref} className={css.thumbnail} aria-label={`Show slide ${frame + 1}: ${title}`} aria-current={active ? "true" : undefined}
    data-testid="presenter-thumbnail" data-frame={frame} onClick={() => { send({ type: "jump", frame }); }}>
    <Slide svg={svg ?? null} label={title} /><span>{frame + 1}. {title}</span>
  </button>;
}

type Arrangement = { preset: "balanced" | "notes" | "compact"; notesRatio: number; previewRatio: number };
const ARRANGEMENT_KEY = "tikz-editor:presenter-arrangement";
function loadArrangement(): Arrangement {
  try {
    const raw = getActiveEditorPlatform().persistence.load(ARRANGEMENT_KEY);
    const saved = raw ? JSON.parse(raw) as Partial<Arrangement> : {};
    return { preset: saved.preset === "notes" || saved.preset === "compact" ? saved.preset : "balanced",
      notesRatio: typeof saved.notesRatio === "number" ? Math.max(20, Math.min(70, saved.notesRatio)) : 34,
      previewRatio: typeof saved.previewRatio === "number" ? Math.max(25, Math.min(75, saved.previewRatio)) : 60 };
  } catch { return { preset: "balanced", notesRatio: 34, previewRatio: 60 }; }
}
function Splitter({ value, onChange, label, orientation = "vertical" }: { value: number; onChange: (value: number) => void; label: string; orientation?: "vertical" | "horizontal" }) {
  return <div className={css.splitter} role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation} aria-valuemin={20} aria-valuemax={75} aria-valuenow={Math.round(value)}
    onKeyDown={event => {
      if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        onChange(Math.max(20, Math.min(75, value + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -2 : 2))));
      }
    }} onPointerDown={event => {
      const element = event.currentTarget;
      const box = element.parentElement!.getBoundingClientRect();
      event.preventDefault(); element.setPointerCapture(event.pointerId);
      const horizontal = orientation === "horizontal";
      const move = (pointer: PointerEvent) => {
        const percent = horizontal ? (pointer.clientY - box.top) / box.height : (pointer.clientX - box.left) / box.width;
        onChange(Math.max(20, Math.min(75, percent * 100)));
      };
      const end = () => { element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", end); element.removeEventListener("lostpointercapture", end); };
      element.addEventListener("pointermove", move); element.addEventListener("pointerup", end); element.addEventListener("lostpointercapture", end);
    }} />;
}

export function PresentationWindow({ role, sessionId }: { role: PresentationRole; sessionId: string }) {
  const [snapshot, setSnapshot] = useState<PresentationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [controlsVisible, setControlsVisible] = useState(!getActiveEditorPlatform().id.startsWith("desktop"));
  const [arrangement, setArrangement] = useState(loadArrangement);
  const audienceRoot = useRef<HTMLElement | null>(null);
  const scheme = useSettingsStore(s => s.settings.general.colorScheme);
  const transport = useRef<PresentationTransport | null>(null);
  const snapshotRef = useRef(snapshot);
  const lastSeen = useRef(Date.now());
  const hideControls = useRef<ReturnType<typeof setTimeout> | null>(null);
  snapshotRef.current = snapshot;
  const apiRef = useRef(getActiveEditorPlatform().presentation ?? createBrowserPresentationApi());
  const send = useCallback((command: PresentationCommand) => {
    void Promise.resolve(transport.current?.send({ type: "command", sessionId, command })).catch(() => {});
  }, [sessionId]);
  const enterFullscreen = () => {
    void apiRef.current.enterFullscreen?.().then(() => { audienceRoot.current?.focus({ preventScroll: true }); }).catch(() => { setError("Couldn’t enter fullscreen. Use the window’s fullscreen control."); });
  };
  useEffect(() => { if (role === "audience") audienceRoot.current?.focus({ preventScroll: true }); }, [role]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.colorScheme = scheme === "dark" || (scheme === "system" && media.matches) ? "dark" : "light"; delete document.documentElement.dataset.canvasInvert; };
    apply(); media.addEventListener("change", apply);
    return () => { media.removeEventListener("change", apply); };
  }, [scheme]);
  useEffect(() => {
    let disposed = false;
    const api = apiRef.current;
    let unbindFocus: (() => void) | undefined;
    let channel: PresentationTransport | undefined;
    const hello = () => { void Promise.resolve(channel?.send({ type: "hello", sessionId, role, sequence: snapshotRef.current?.sequence ?? -1 })).catch(() => {}); };
    void api.connect(sessionId, message => {
      if (disposed) return;
      if (message.type === "alive") { lastSeen.current = Date.now(); setError(null); return; }
      if (message.type !== "snapshot") return;
      if (message.snapshot.sequence < (snapshotRef.current?.sequence ?? -1)) return;
      lastSeen.current = Date.now(); setError(null); setSnapshot(message.snapshot);
      document.title = `${message.snapshot.title} — ${role === "presenter" ? "Presenter" : "Presentation"}`;
    }).then(value => {
      if (disposed) { value.close(); return; }
      channel = value; transport.current = value; hello();
      if (!getActiveEditorPlatform().id.startsWith("desktop") && document.hasFocus()) void Promise.resolve(channel.send({ type: "focus", sessionId, role })).catch(() => {});
    }).catch(() => { if (!disposed) setError("This presentation is no longer available."); });
    const focus = () => {
      if (!getActiveEditorPlatform().id.startsWith("desktop") && document.hasFocus()) void Promise.resolve(channel?.send({ type: "focus", sessionId, role })).catch(() => {});
      hello();
    };
    void api.onFocus?.(focus).then(unbind => { if (disposed) unbind(); else unbindFocus = unbind; });
    const timer = window.setInterval(() => {
      if (snapshotRef.current?.ended) return;
      hello();
      if (Date.now() - lastSeen.current > 12_000) setError("The presentation controller is disconnected.");
    }, 2000);
    const closed = () => { void Promise.resolve(channel?.send({ type: "closed", sessionId, role })).catch(() => {}); };
    window.addEventListener("pagehide", closed);
    if (!getActiveEditorPlatform().id.startsWith("desktop")) void api.keepAwake?.(true);
    return () => {
      disposed = true; window.clearInterval(timer); unbindFocus?.();
      window.removeEventListener("pagehide", closed); channel?.close(); transport.current = null;
      if (!getActiveEditorPlatform().id.startsWith("desktop")) void api.keepAwake?.(false);
    };
  }, [role, sessionId]);
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()); }, 250);
    hideControls.current = setTimeout(() => { setControlsVisible(false); }, 1800);
    return () => { window.clearInterval(timer); if (hideControls.current) clearTimeout(hideControls.current); };
  }, []);
  useEffect(() => {
    const change = () => { setFullscreen(Boolean(document.fullscreenElement)); };
    document.addEventListener("fullscreenchange", change);
    return () => { document.removeEventListener("fullscreenchange", change); };
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !snapshotRef.current || snapshotRef.current.ended) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=separator]")) return;
      if (target?.closest("button") && (event.key === " " || event.key === "Enter")) return;
      if (role === "audience" && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "f" || event.key === "F")) { event.preventDefault(); enterFullscreen(); return; }
      const command = presentationKeyCommand(event, snapshotRef.current);
      if (command) { event.preventDefault(); send(command); }
    };
    window.addEventListener("keydown", keyboard);
    return () => { window.removeEventListener("keydown", keyboard); };
  }, [role, send]);
  useEffect(() => {
    try { getActiveEditorPlatform().persistence.save(ARRANGEMENT_KEY, JSON.stringify(arrangement)); }
    catch { /* Layout changes work without persistent storage. */ }
  }, [arrangement]);

  if (role === "audience") return <main ref={audienceRoot} tabIndex={0} className={css.audience} data-testid="audience-window" data-blank={snapshot?.blank ?? "none"}
    onPointerMove={() => { setControlsVisible(true); if (hideControls.current) clearTimeout(hideControls.current); hideControls.current = setTimeout(() => { setControlsVisible(false); }, 1800); }}
    onClick={event => { if (!(event.target as Element).closest("button,a") && !snapshot?.ended) send({ type: "next" }); }}>
    {snapshot?.blank === "none" && !snapshot.ended ? <Slide svg={snapshot.current?.svg ?? null} cursor={snapshot.current?.cursor} label="Audience slide" /> : null}
    {snapshot?.ended ? <div className={css.ended}>Presentation ended</div> : null}
    {controlsVisible && !snapshot?.ended ? <div className={css.audienceControls}>
      {!fullscreen && !getActiveEditorPlatform().id.startsWith("desktop") ? <button type="button" onClick={enterFullscreen}>Enter Fullscreen</button> : null}
      <button type="button" onClick={() => { send({ type: "show-presenter" }); }}>Show Presenter View</button>
      <button type="button" onClick={() => { send({ type: "stop" }); }}>End Presentation</button>
    </div> : null}
    {error && !snapshot ? <div className={css.ended}>{error}</div> : null}
  </main>;

  const elapsed = snapshot ? presentationElapsed(snapshot.timer, now) : 0;
  const current = snapshot?.current;
  const frame = current ? snapshot?.frames[current.cursor.frame] : null;
  const vertical = arrangement.preset !== "balanced";
  const mainStyle = { gridTemplateColumns: `minmax(0, ${100 - arrangement.notesRatio}fr) 6px minmax(0, ${arrangement.notesRatio}fr)` };
  const previewsStyle: CSSProperties = vertical ? { gridTemplateRows: `minmax(0, ${arrangement.previewRatio}fr) 6px minmax(0, ${100 - arrangement.previewRatio}fr)` } : { gridTemplateColumns: `minmax(0, ${arrangement.previewRatio}fr) 6px minmax(0, ${100 - arrangement.previewRatio}fr)` };
  return <main className={css.presenter} data-testid="presenter-window" data-preset={arrangement.preset}>
    <header className={css.header}>
      <strong className={css.title}>{snapshot?.title ?? "Presenter View"}</strong>
      <div className={css.clocks}>
        <span><small>Elapsed</small><output data-testid="presentation-elapsed">{formatTime(elapsed)}</output></span>
        {snapshot?.timer.budgetMs != null ? <span><small>Remaining</small><output>{formatTime(snapshot.timer.budgetMs - elapsed)}</output></span> : null}
        <span><small>Clock</small><output>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</output></span>
      </div>
      <button type="button" onClick={() => { send({ type: "timer", action: snapshot?.timer.runningSince == null ? "start" : "pause" }); }}>{snapshot?.timer.runningSince != null ? "Pause" : "Start"}</button>
      <button type="button" onClick={() => { send({ type: "timer", action: "reset" }); }}>Reset</button>
      <button type="button" onClick={() => { send({ type: "stop" }); }}>End Presentation</button>
    </header>
    {(snapshot?.error || error) ? <div className={css.notice} role="status">{snapshot?.error ?? error}</div> : null}
    {snapshot && !snapshot.outputAvailable && !snapshot.ended ? <div className={css.notice}><span>Audience output is closed.</span><button type="button" onClick={() => { send({ type: "recover-output" }); }}>Show Audience Window</button></div> : null}
    <div className={css.main} style={mainStyle}>
      <div className={css.previews} data-vertical={vertical || undefined} style={previewsStyle}>
        <section className={css.preview}><h2>Current <span>{current ? `Slide ${current.cursor.frame + 1} / ${snapshot?.frames.length ?? 0} · Build ${current.cursor.step} / ${frame?.steps ?? 1}${current.cursor.continuation > 1 ? ` · Page ${current.cursor.continuation}` : ""}` : ""}</span></h2>
          <Slide svg={current?.svg ?? null} cursor={current?.cursor} label="Current slide" />
        </section>
        <Splitter label="Resize current and next previews" orientation={vertical ? "horizontal" : "vertical"} value={arrangement.previewRatio} onChange={previewRatio => { setArrangement(value => ({ ...value, previewRatio })); }} />
        <section className={css.preview}><h2>Next</h2>{snapshot?.next ? <Slide svg={snapshot.next.svg} cursor={snapshot.next.cursor} label="Next build or page" /> : <div className={css.empty} />}</section>
      </div>
      <Splitter label="Resize slide previews and notes" value={100 - arrangement.notesRatio} onChange={ratio => { setArrangement(value => ({ ...value, notesRatio: 100 - ratio })); }} />
      <section className={css.notes}><h2>Speaker Notes</h2><div className={css.notesContent}>
        {current?.notesSvg ? <SpeakerNotes svg={current.notesSvg} /> : <span className={css.empty}>No speaker notes for this build.</span>}
      </div></section>
    </div>
    <div className={css.controls}>
      <button type="button" onClick={() => { send({ type: "previous-frame" }); }} title="Previous slide (Shift+Left)">Previous Slide</button>
      <button type="button" onClick={() => { send({ type: "previous" }); }} title="Previous build/page (Left or Page Up)">Previous</button>
      <button type="button" onClick={() => { send({ type: "next" }); }} title="Next build/page (Right, Space, or Page Down)">Next</button>
      <button type="button" onClick={() => { send({ type: "next-frame" }); }} title="Next slide (Shift+Right)">Next Slide</button>
      <span className={css.spacer} />
      <button type="button" aria-pressed={snapshot?.blank === "black"} onClick={() => { send({ type: "blank", value: snapshot?.blank === "black" ? "none" : "black" }); }} title="Black screen (B)">Black</button>
      <button type="button" aria-pressed={snapshot?.blank === "white"} onClick={() => { send({ type: "blank", value: snapshot?.blank === "white" ? "none" : "white" }); }} title="White screen (W)">White</button>
      {getActiveEditorPlatform().id.startsWith("desktop") ? <button type="button" onClick={() => { send({ type: "swap-displays" }); }}>Swap Displays</button> : null}
      <select aria-label="Presenter layout" value={arrangement.preset} onChange={event => { const preset = event.target.value as Arrangement["preset"]; setArrangement({ preset, notesRatio: preset === "notes" ? 52 : 34, previewRatio: preset === "compact" ? 75 : 60 }); }}>
        <option value="balanced">Balanced</option><option value="notes">Notes</option><option value="compact">Compact</option>
      </select>
    </div>
    <nav className={css.filmstrip} aria-label="Presentation slides" onKeyDown={event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
      const index = buttons.indexOf(event.target as HTMLButtonElement), next = buttons[index + (event.key === "ArrowRight" ? 1 : -1)];
      event.preventDefault(); event.stopPropagation(); next?.focus();
    }}>
      {snapshot?.frames.map(item => <FilmstripItem key={`${snapshot.revision}:${item.index}`} frame={item.index} title={item.title} svg={snapshot.thumbnails[item.index]} active={current?.cursor.frame === item.index} revision={snapshot.revision} send={send} />)}
    </nav>
  </main>;
}
