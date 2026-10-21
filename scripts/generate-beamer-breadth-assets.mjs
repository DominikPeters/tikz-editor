#!/usr/bin/env node
// Original deterministic teaching image: SVG source plus a TeX-compatible PNG.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const directory = new URL("../test/fixtures/beamer/breadth-decks/assets/", import.meta.url);
const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240"><rect width="720" height="240" fill="#f8faf7"/>'];
for (let row = 0; row < 2; row++) {
  for (let time = 0; time < 3; time++) {
    const x = 95 + 205 * time, y = 35 + 90 * row;
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 8; j++) {
        const value = .2 + .22 * time + (row === 0 ? .08 * time : 0) + .08 * Math.sin(i * 1.7 + j * 2.1);
        const r = Math.round(220 - 150 * value), g = Math.round(225 - 70 * value), b = Math.round(180 - 130 * value);
        parts.push(`<rect x="${x + i * 9}" y="${y + j * 8}" width="9" height="8" fill="rgb(${r},${g},${b})"/>`);
      }
    }
    parts.push(`<path d="M${x + 50},${y} C${x + 120},${y + 18} ${x + 40},${y + 42} ${x + 110},${y + 64}" fill="none" stroke="#4f92b4" stroke-width="8"/>`);
    parts.push(`<rect x="${x}" y="${y}" width="180" height="64" fill="none" stroke="#445744"/>`);
  }
}
parts.push('<g font-family="sans-serif" font-size="13" fill="#243524"><text x="8" y="70">Treated</text><text x="8" y="160">Control</text><text x="150" y="22">Before</text><text x="355" y="22">After</text><text x="550" y="22">Follow-up</text><text x="95" y="215">SYNTHETIC MAP — green intensity: illustrative index, not field data</text></g></svg>');
const svg = fileURLToPath(new URL("river-transects.svg", directory));
const png = fileURLToPath(new URL("river-transects.png", directory));
writeFileSync(svg, parts.join("\n") + "\n");
execFileSync("rsvg-convert", ["--output", png, svg]);
console.log("Wrote deterministic river-transects.svg and river-transects.png");
