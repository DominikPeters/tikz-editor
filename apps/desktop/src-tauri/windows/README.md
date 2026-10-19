# Windows installers

## File associations

Only `.tikz` and `.tex` are registered. The Windows config replaces the shared
`fileAssociations` array with `.tikz` only, so Tauri's built-in association
handling fully associates `.tikz`. The shared `.tex` rank of `Alternate` applies
only to macOS and does not prevent Windows installers from claiming the default.

For `.tex`, `installer.nsi` and `file-associations.wxs` instead register the
app-specific `TikZEditor.TeX` ProgID in `.tex\OpenWithProgids`. They never write
the `.tex` default value or Windows' `UserChoice`. The EXE uses the installer's
shell context (currently per-user); the MSI uses its per-machine scope. Uninstall
removes our Open with value and ProgID, without removing other handlers. There is
no automatic restoration or migration of defaults set by previous releases.

On Windows, verify fresh EXE and MSI installs with an existing `.tex` default:
the default app and icon should stay the same, TikZ Editor should appear in
Open with, and a file with spaces in its path should open correctly. Verify that
`.tikz` is associated normally, then repeat after an upgrade and uninstall. Also
test without an existing `.tex` association and after explicitly choosing TikZ
Editor as the default through Windows.

## Update preferences

Both installers offer a checked automatic-update checkbox on new installs.
They store the choice as a string in `HKCU\Software\TikZEditor\Preferences`,
value `AutomaticUpdateChecks`: `1` enables checks, `0` disables them. The app
reads this before any startup check and Settings writes the same value. A missing
value defaults to on everywhere. Reset to Defaults restores on; otherwise an
explicit installer or Settings choice takes precedence. Manual update checks remain available.

Silent and passive NSIS installs leave this value alone. MSI searches the existing
value before writing it, so upgrades preserve preferences; new silent MSI installs
default to on. The MSI preference component is permanent so an uninstall during
a major upgrade cannot delete the preference.

`installer.nsi` is the upstream Tauri CLI 2.11.2 template from
https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.2/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
with a custom page inserted before the installation page and `.tex` Open with
registration and cleanup. When upgrading Tauri, refresh this template and retain
these changes. `update-checks.nsh` provides the
page and post-install persistence. The MSI uses a WiX fragment rather than a copy
of the upstream template.

On Windows, verify a fresh EXE and MSI install with the checkbox on and off, then
change the preference in Settings and perform interactive and silent upgrades.
Confirm the preference survives and manual checks still work. For an MSI silent
install, `TIKZ_UPDATE_CHOICE_MADE=1 TIKZ_AUTOMATIC_UPDATE_CHECKS=1` explicitly
enables checks; `TIKZ_UPDATE_CHOICE_MADE=1 TIKZ_AUTOMATIC_UPDATE_CHECKS=""`
disables them.
