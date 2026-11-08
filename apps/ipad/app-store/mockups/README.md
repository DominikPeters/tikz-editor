# App Store screenshots

Five 2752×2064 frames for the 13" iPad listing, in `screenshots/`, in upload order.

- `frames.html` lays out the frames from the simulator screenshots in `shots/`.
- `node render.mjs` (from this folder, needs Playwright) writes `screenshots/<frame id>.png`.

## Captures

`shots/` are iPad Pro 13-inch (M5) simulator captures in landscape, with this
folder's documents open: `deck/voting.tex` (Majority Voting.tex) and the
figures in `showcase/` (saved as `.tikz` files under On My iPad).

`06b-beamer-source-raised.png` is edited: the slide was moved 360px up inside
the canvas (the app keeps a fitted slide vertically centred) to make room for
the presentation device in frame 02. Everything else is as captured.

`deck-preview.mjs` renders each slide of a deck through the web app
(the dev server on port 5802, the `web` entry in `.claude/launch.json`) for checking a deck before capturing:
`node deck-preview.mjs deck/voting.tex deck/preview`.
