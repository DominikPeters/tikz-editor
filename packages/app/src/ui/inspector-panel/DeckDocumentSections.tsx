import { useRef, useState, type JSX } from "react";
import { Actions } from "flexlayout-react";
import type {
  BeamerThemeCatalogEntry,
  BeamerThemeGroup,
  DeckDocumentInspectorModel,
  DeckSlideContext,
  DeckThemeCard,
  DeckInspectorCommand,
} from "@tikz-editor/core/beamer/index";
import { SidePanel } from "../SidePanel";
import { getDockLayoutHandle } from "../DockLayout";
import { ThemeGalleryPopover } from "../theme-gallery/ThemeGalleryPopover";
import { DeckField, DeckReadOnlyNote, type DeckFieldCommit } from "./deck-fields";
import css from "./InspectorPanel.module.css";

/**
 * The deck inspector's two scopes when nothing is selected: the active slide,
 * then the whole presentation. Scope headers stay pinned while their scope
 * scrolls, so a color edit can never be mistaken for a per-slide one.
 */
export function DeckScopeHeader(props: { title: string; detail?: string | null }): JSX.Element {
  return (
    <div className={css.deckScopeHeader} data-select="chrome">
      <span className={css.deckScopeTitle}>{props.title}</span>
      {props.detail ? <span className={css.deckScopeDetail}>{props.detail}</span> : null}
    </div>
  );
}

function revealDockPanel(id: "builds" | "notes"): void {
  const dock = getDockLayoutHandle();
  if (!dock) return;
  if (!dock.getModel().getNodeById(id)) dock.togglePanel(id);
  dock.getModel().doAction(Actions.selectTab(id));
}

export function DeckSlideInfoSection(props: {
  context: DeckSlideContext;
  stepCount: number;
}): JSX.Element {
  const { context, stepCount } = props;
  return (
    <SidePanel.Section collapseId="deck-inspector:slide-info">
      <SidePanel.SectionHeader>Info</SidePanel.SectionHeader>
      <SidePanel.SectionBody>
        <div className={css.deckFields}>
          <InfoRow label="Section" value={context.section ?? "None"} dim={context.section == null} />
          {context.subsection != null ? <InfoRow label="Subsection" value={context.subsection} /> : null}
          <InfoRow
            label="Steps"
            value={stepCount === 1 ? "1 step" : `${stepCount} steps`}
            action={{ label: "Overlays", run: () => { revealDockPanel("builds"); } }}
          />
          <InfoRow
            label="Notes"
            value={context.noteCount === 0 ? "None" : context.noteCount === 1 ? "1 note" : `${context.noteCount} notes`}
            dim={context.noteCount === 0}
            action={{ label: "Notes", run: () => { revealDockPanel("notes"); } }}
          />
          {context.issues.length > 0 ? (
            <ul className={css.deckIssues}>
              {context.issues.map((issue) => (
                <li key={issue.message} className={css.deckIssue}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </SidePanel.SectionBody>
    </SidePanel.Section>
  );
}

function InfoRow(props: {
  label: string;
  value: string;
  dim?: boolean;
  action?: { label: string; run: () => void };
}): JSX.Element {
  const { label, value, dim, action } = props;
  return (
    <div className={css.property}>
      <div className={css.propertyLabel}>{label}</div>
      <div className={css.deckInfoValue}>
        <span className={dim ? `${css.deckInfoText} ${css.deckInfoTextDim}` : css.deckInfoText} title={value}>{value}</span>
        {action ? (
          <button type="button" className={css.deckInfoLink} onClick={action.run}>
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const GROUP_LABELS: Record<BeamerThemeGroup, string> = {
  "no-navigation": "No navigation bar",
  tree: "Tree navigation",
  sidebar: "Sidebar",
  "mini-frames": "Mini frames",
  "section-tables": "Section tables",
  modern: "Modern",
};

function ThemeCard(props: { card: DeckThemeCard; onApplyTheme: (entry: BeamerThemeCatalogEntry) => void }): JSX.Element {
  const { card, onApplyTheme } = props;
  const changeRef = useRef<HTMLButtonElement>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Metropolis and moloch name every component after themselves; only parts
  // that differ from the theme's own name say anything.
  const components = [...new Set(card.components
    .map((component) => component.name)
    .filter((name) => name.toLocaleLowerCase() !== card.name.toLocaleLowerCase()))]
    .join(" · ");
  return (
    <div className={css.deckThemeCard}>
      <div className={css.deckThemePalette} aria-hidden="true">
        {card.palette.map((color) => (
          <span key={color} className={css.deckThemePaletteChip} style={{ background: color }} />
        ))}
      </div>
      <div className={css.deckThemeRow}>
        <div className={css.deckThemeText}>
          <div className={css.deckThemeName}>{card.name}</div>
          <div className={css.deckThemeMeta}>
            {card.supported
              ? [card.group ? GROUP_LABELS[card.group] : null, components || null].filter(Boolean).join(" — ")
              : "Not previewed: the preview uses Beamer's default look."}
          </div>
        </div>
        <button
          ref={changeRef}
          type="button"
          className={css.deckThemeChange}
          aria-haspopup="dialog"
          aria-expanded={galleryOpen}
          disabled={card.readOnly != null}
          title={card.readOnly?.reason}
          onClick={() => { setGalleryOpen((open) => !open); }}
        >
          Change…
        </button>
      </div>
      {galleryOpen && changeRef.current ? (
        <ThemeGalleryPopover
          anchor={changeRef.current}
          currentThemeId={card.catalogId}
          onApply={onApplyTheme}
          onClose={() => { setGalleryOpen(false); }}
        />
      ) : null}
    </div>
  );
}

export function DeckDocumentSections(props: {
  model: DeckDocumentInspectorModel;
  onCommit: DeckFieldCommit;
  onApplyTheme: (entry: BeamerThemeCatalogEntry) => void;
  onCommand: (command: DeckInspectorCommand) => void;
}): JSX.Element {
  const { model, onCommit, onApplyTheme, onCommand } = props;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // One blocker (a grouped \usetheme, say) disables many fields; its reason
  // shows once, under the first of them.
  const noted = new Set<string>();
  const firstNote = (readOnly: DeckThemeCard["readOnly"]): boolean => {
    const key = readOnly ? `${readOnly.span.from}:${readOnly.reason}` : null;
    if (key === null || noted.has(key)) return false;
    noted.add(key);
    return true;
  };
  const fields = (list: DeckDocumentInspectorModel["page"]) => (
    <div className={css.deckFields}>
      {list.map((field) => (
        <DeckField key={field.id} field={field} onCommit={onCommit} onCommand={onCommand} showReadOnlyNote={firstNote(field.readOnly)} />
      ))}
    </div>
  );
  return (
    <>
      <SidePanel.Section collapseId="deck-inspector:theme">
        <SidePanel.SectionHeader
          accessory={
            <button
              type="button"
              className={css.moreOptionsToggle}
              aria-expanded={advancedOpen}
              onClick={() => { setAdvancedOpen((open) => !open); }}
            >
              {advancedOpen ? "Show Less" : "Show More"}
            </button>
          }
        >
          Theme
        </SidePanel.SectionHeader>
        <SidePanel.SectionBody>
          <ThemeCard card={model.theme} onApplyTheme={onApplyTheme} />
          {model.theme.readOnly && firstNote(model.theme.readOnly) ? (
            <DeckReadOnlyNote reason={model.theme.readOnly.reason} span={model.theme.readOnly.span} onCommand={onCommand} />
          ) : null}
          {model.themeOptions.length > 0 ? fields(model.themeOptions) : null}
          {advancedOpen ? <div className={css.deckAdvanced}>{fields(model.components)}</div> : null}
        </SidePanel.SectionBody>
      </SidePanel.Section>
      <SidePanel.Section collapseId="deck-inspector:colors">
        <SidePanel.SectionHeader>Colors</SidePanel.SectionHeader>
        <SidePanel.SectionBody>{fields(model.colors)}</SidePanel.SectionBody>
      </SidePanel.Section>
      <SidePanel.Section collapseId="deck-inspector:page">
        <SidePanel.SectionHeader>Page</SidePanel.SectionHeader>
        <SidePanel.SectionBody>{fields(model.page)}</SidePanel.SectionBody>
      </SidePanel.Section>
      {model.headerFooter.length > 0 ? (
        <SidePanel.Section collapseId="deck-inspector:header-footer">
          <SidePanel.SectionHeader>Header &amp; Footer</SidePanel.SectionHeader>
          <SidePanel.SectionBody>
            <div className={css.deckFallbackFields}>{fields(model.headerFooter)}</div>
          </SidePanel.SectionBody>
        </SidePanel.Section>
      ) : null}
    </>
  );
}
