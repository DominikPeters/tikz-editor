# iPad WebView patch

Upstream: wry 0.55.1 from crates.io, git a5bf203a1c8dbb3583588382538d6521655222a8.
The original MIT/Apache-2.0 licenses are retained.

The sole source change guards the `allowsPictureInPictureMediaPlayback` KVC
assignment on WKPreferences with `cfg(target_os = "macos")`. The editor does not
need PiP on iOS. This call is unconditional upstream and has no opt-out feature.
The public iOS property lives on WKWebViewConfiguration, not WKPreferences.

The patch is scoped to the iPad Cargo manifest; desktop dependencies are unchanged.
Do not enable Wry's `fullscreen`, `transparent`, or release `devtools` features
without auditing their additional private API calls. Debug builds retain devtools.

When updating Tauri/Wry, compare against upstream and remove this vendor override
once the iOS initialization no longer uses private preferences. Verify a release
archive, not the simulator debug executable, for private API strings.
