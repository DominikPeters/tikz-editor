# Presentation mode

The presentation uses the existing Beamer/SVG renderer, a shared TypeScript
controller, Tauri events on desktop, and BroadcastChannel on the web. It owns a
document ID and a live cursor independently of editor tabs, selection, and build
navigation. There is one audience output and an optional presenter window.

## User interface

Beamer tabs have a Present split button and a Present app menu. There is no Slide
menu. Launch choices are from the beginning/current slide, on a display, in a
window, and rehearsal. Rehearsal opens the presenter without audience output.
New tabs inherit the active document kind; File also offers the other kind.
Drawing tools remain available inside embedded TikZ pictures.
A projector-screen button immediately left of the status-bar zoom slider starts
from the current slide, or shows the presenter view when a session is running.

Presentation controls reuse the editor's toolbar/split-button and app-menu styles.
Options use the shared Modal header, body, footer, and action buttons together
with the Settings dialog's grouped rows and input styles. Presenter controls use
the same secondary buttons, selectors, and slide cards as the editor. All chrome
text follows the UI font-size preference, including popup menus and auxiliary
windows; slide content keeps its authored typography.

TikZ and Beamer have separate remembered panel arrangements. Nested diagrams use
their parent deck's arrangement. A running presentation keeps its controls when
the editor switches to another document.

The presenter has current and next build/page previews, source-backed speaker
notes, a filmstrip of logical frames, three layout presets, and resizable panes.
A thumbnail immediately shows that frame's first build. Editor browsing remains
independent. Keyboard/clicker navigation includes build/page steps, separate frame
skips, Home/End jumps, black/white screens, and Escape to end.

Elapsed time, an optional countdown budget, and wall-clock time share one session
timer. It auto-starts on the first forward build/page action. Start/Pause/Reset
remain available; advancing after an explicit pause does not resume the timer.
Reset restores the initial timer state. Output loss preserves running/paused
state. Rendering queues, readiness, cache settings, and development phasing are
never product options or status indicators.

## Rendering and live edits

Each source/asset revision prepares a shared Beamer context. Ready SVG pages use
a bounded lookahead cache (48 entries / 24 MiB); published filmstrip previews are
also bounded (32 entries / 8 MiB). SVG/image decoding completes before commitment.
Current content remains visible while replacement work is pending or fails.
Preview SVG IDs are scoped to their individual DOM slots.
Audience output uses an SVG image to make fullscreen page replacement atomic
in WKWebView; the content remains vector SVG.

Next/previous inputs retain deliberate build ordering. Jumps supersede obsolete
pending targets. Source revisions fence asynchronous work so stale results cannot
replace a newer page. Reordering retains the authored frame where possible;
removed builds clamp to an available build, and deletion falls back to the nearest
surviving frame at its first build. Temporarily invalid decks retain the last
valid deck and its navigation.

Standard literal Beamer notes support overlay specifications, accumulated prose
and [item] entries, the last outside-frame note on the final build, and unscoped
AtBeginNote/AtEndNote hooks. Notes, including macro-expanded note invocations, are
excluded from audience content. Private frames/diagrams do not enter the public
root inventory. The text engine formats presenter notes with macros and math;
custom note-page templates and scoped hooks remain outside the supported subset.

The Notes panel (View > Notes Panel, docked under the slide) edits the active
slide's notes as the `\note` commands that write them, one LaTeX field per note,
labelled by its builds, `[item]`, or a note page after the frame when the slide has
more than a plain note. Typing into an empty slide's field writes `\note{…}` on its
own line at the end of the frame: inside, so it moves with the frame in the slide
manager (a note after `\end{frame}` does not), and without an overlay
specification, so it shows with every build, like the notes of presentation
software. A note emptied and left is removed with its line. Text TeX would not read
as the note's argument (unbalanced braces, a `%` or `\` that would hide the closing
brace, `\end{frame}`) stays in the field, unsaved, with the reason; a `%` elsewhere
gets a hint, as TeX skips the rest of its line. Hooks and notes from macros are not
listed.

## Platforms and lifecycle

Desktop placement uses Tauri monitor/window APIs, simple fullscreen on macOS, and
ordinary fullscreen on Windows. Optional role choices are remembered and checked
against connected displays. Unique display names survive resolution/scale
changes; ambiguous names use size/position matching. Identify and Swap actions
help configure outputs. With no explicit presenter preference, a single-screen
fullscreen launch is audience-only; separate displays and windowed launches have
a presenter, and rehearsal always has one.

macOS has an app-wide menu. Native focused-window events select its command
context; closing a presenter/audience window closes that view, while closing an
editor tab targets its document. Auxiliary webviews do not initialize file-open
queues, assistant connections, or independent menu owners. Fullscreen restores
webview/content focus for keyboard input.
The desktop webviews disable background suspension so the controller can render
and receive commands while the editor is covered or minimized (Tauri supports
this policy on modern macOS).

macOS screen notifications and Tauri move/scale events trigger display checks,
with periodic checks as a fallback. Output disappearance leaves fullscreen,
retains cursor/timer, and offers another output. A window heartbeat cannot clear
that recovery state. Late-opening/reconnected views receive a snapshot; ordinary
heartbeats carry only a sequence number.

Presentation sessions prevent display sleep through IOKit assertions on macOS,
SetThreadExecutionState on Windows, and browser Wake Lock where available. Native
assertions acquire/release on the UI thread, including controller-window cleanup.
An older session's cleanup finishes before a newer session acquires its assertion.

Web output uses manually placed popups and ordinary browser fullscreen. It does
not request Window Management API permission. If a browser permits only one popup
per gesture, Show Presenter View supplies a separate gesture.

Presenter note editing, laser pointers, and capture exclusion have no controls
until implemented. Media playback is not planned currently. Annotation tools,
remote-device control, recording, camera overlays, projector filters, and pacing
feedback are excluded from this scope.

## Verification

Focused controller/rendering/lifecycle tests cover ordering, supersession,
continuations, timer semantics, source remapping, privacy, cache reuse, scoped SVG
IDs, output recovery, and power-assertion ordering. Desktop adapter tests cover
placement, simple fullscreen, hotplug recovery, display identity, role swapping,
and native menu focus. Browser workflows run in Chromium, Firefox, and WebKit.

The macOS smoke test uses a disposable app bundle with separate WebKit preferences:
two windows, notes visible only in the presenter, build stepping, auto-start/pause,
presenter close, audience fullscreen, session exit, and assertion acquire/release.
Physical projector hotplug and Windows runtime behavior require on-device checks.
