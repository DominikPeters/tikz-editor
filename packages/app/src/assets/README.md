# App icon

These are unchanged copies of the desktop bundle's real icon, shared by the
editor shells:

- `app-icon-32.png`: `apps/desktop/src-tauri/icons/32x32.png`, displayed at
  16 CSS pixels in the Windows title bar (2× resolution).
- `app-icon-256.png`: `apps/desktop/src-tauri/icons/128x128@2x.png`, used for
  the About dialog and alert headers, with enough resolution for Retina displays.

When replacing the desktop icon, update these copies as well. Import them from
the shared app so Vite bundles their URLs correctly for web and native shells.
