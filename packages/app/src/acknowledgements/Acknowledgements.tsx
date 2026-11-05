import { useEffect, useState } from "react";
import { getActiveEditorPlatform } from "../platform/current";
import { isRecord } from "../validation";
import dataUrl from "./third-party.generated.json?url";
import css from "./Acknowledgements.module.css";

export const PRIVACY_POLICY_URL = "https://tikz.dev/editor/#privacy";

type Entry = { name: string; version?: string; license: string; text: number[] };
type Data = { fonts: Entry[]; npm: Entry[]; crates: Entry[]; texts: string[] };

function isData(value: unknown): value is Data {
  return isRecord(value) && Array.isArray(value.fonts) && Array.isArray(value.npm) &&
    Array.isArray(value.crates) && Array.isArray(value.texts);
}

let loaded: Promise<Data> | null = null;
// Written by scripts/generate-acknowledgements.mjs; fetched only when shown.
function load(): Promise<Data> {
  loaded ??= fetch(dataUrl)
    .then((response) => response.json() as Promise<unknown>)
    .then((value) => {
      if (!isData(value)) throw new Error("Malformed acknowledgements");
      return value;
    });
  loaded.catch(() => { loaded = null; });
  return loaded;
}

function openPrivacyPolicy(): void {
  const open = getActiveEditorPlatform().window?.openExternalUrl;
  if (open) void open(PRIVACY_POLICY_URL);
  else window.open(PRIVACY_POLICY_URL, "_blank", "noopener");
}

export function Acknowledgements() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    load().then((value) => { if (current) setData(value); }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, []);

  return (
    <div className={css.acknowledgements} data-testid="acknowledgements">
      <button type="button" className={css.link} onClick={openPrivacyPolicy}>Privacy Policy</button>
      {failed ? <p className={css.status} role="alert">The acknowledgements could not be loaded.</p>
        : !data ? null
          : <>
            <Group title="Fonts" entries={data.fonts} texts={data.texts} />
            <Group title="JavaScript Packages" entries={data.npm} texts={data.texts} />
            <Group title="Rust Crates" entries={data.crates} texts={data.texts} />
          </>}
    </div>
  );
}

function Group({ title, entries, texts }: { title: string; entries: Entry[]; texts: string[] }) {
  return (
    <section className={css.group}>
      <h3 className={css.groupTitle}>{title}</h3>
      <ul className={css.list}>
        {entries.map((entry) => <Item key={`${entry.name}@${entry.version ?? ""}`} entry={entry} texts={texts} />)}
      </ul>
    </section>
  );
}

function Item({ entry, texts }: { entry: Entry; texts: string[] }) {
  // Hundreds of entries: render a license text only once it is opened.
  const [open, setOpen] = useState(false);
  return (
    <li>
      <details className={css.item} onToggle={(event) => { setOpen(event.currentTarget.open); }}>
        <summary className={css.summary}>
          <span className={css.name}>{entry.name}</span>
          {entry.version ? <span className={css.version}>{entry.version}</span> : null}
          <span className={css.license}>{entry.license}</span>
        </summary>
        {open ? entry.text.map((index) => <pre key={index} className={css.text}>{texts[index]}</pre>) : null}
      </details>
    </li>
  );
}
