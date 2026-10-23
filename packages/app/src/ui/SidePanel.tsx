import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import css from "./SidePanel.module.css";
import { useSectionCollapseStore, useSectionCollapsed } from "./section-collapse-store";

export type SidePanelProps = {
  children: ReactNode;
  className?: string;
};

export function SidePanel({ children, className }: SidePanelProps) {
  return <div className={[css.panel, className].filter(Boolean).join(" ")}>{children}</div>;
}

export type SidePanelHeaderProps = {
  children: ReactNode;
  className?: string;
};

SidePanel.Header = function SidePanelHeader({ children, className }: SidePanelHeaderProps) {
  return <div className={[css.header, className].filter(Boolean).join(" ")} data-select="chrome">{children}</div>;
};

export type SidePanelContentProps = {
  children: ReactNode;
  className?: string;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
};

SidePanel.Content = React.forwardRef<HTMLDivElement, SidePanelContentProps>(
  function SidePanelContent({ children, className, onScroll }, ref) {
    return (
      <div
        ref={ref}
        className={[css.content, className].filter(Boolean).join(" ")}
        onScroll={onScroll}
      >
        {children}
      </div>
    );
  }
);

type SectionCollapseContextValue = {
  sectionId: string;
  collapsed: boolean;
};

const SectionCollapseContext = createContext<SectionCollapseContextValue | null>(null);

export type SidePanelSectionProps = {
  children: ReactNode;
  className?: string;
  /** Stable id that makes the section collapsible and remembers its state. */
  collapseId?: string;
};

SidePanel.Section = function SidePanelSection({ children, className, collapseId }: SidePanelSectionProps) {
  const collapsed = useSectionCollapsed(collapseId);
  const collapseContext = useMemo(
    () => (collapseId === undefined ? null : { sectionId: collapseId, collapsed }),
    [collapseId, collapsed]
  );
  return (
    <section
      className={[css.section, collapsed ? css.sectionCollapsed : "", className].filter(Boolean).join(" ")}
    >
      <SectionCollapseContext.Provider value={collapseContext}>{children}</SectionCollapseContext.Provider>
    </section>
  );
};

export type SidePanelSectionHeaderProps = {
  children: ReactNode;
  className?: string;
  /** Controls placed at the trailing end of the header, outside the disclosure button. */
  accessory?: ReactNode;
};

SidePanel.SectionHeader = function SidePanelSectionHeader({ children, className, accessory }: SidePanelSectionHeaderProps) {
  const collapse = useContext(SectionCollapseContext);
  const toggle = useSectionCollapseStore((state) => state.toggle);
  const headerClassName = [css.sectionHeader, className].filter(Boolean).join(" ");
  if (!collapse) {
    return (
      <div className={headerClassName} data-select="chrome">
        {children}
        {accessory}
      </div>
    );
  }
  return (
    <div className={headerClassName} data-select="chrome">
      <button
        type="button"
        className={css.sectionDisclosure}
        aria-expanded={!collapse.collapsed}
        onClick={() => { toggle(collapse.sectionId); }}
      >
        <span className={css.sectionTitle}>{children}</span>
        <svg className={css.sectionChevron} viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path d={collapse.collapsed ? "M3.5 2 L6.5 5 L3.5 8" : "M2 3.5 L5 6.5 L8 3.5"} />
        </svg>
      </button>
      {collapse.collapsed ? null : accessory}
    </div>
  );
};

export type SidePanelSectionBodyProps = {
  children: ReactNode;
  className?: string;
};

SidePanel.SectionBody = function SidePanelSectionBody({ children, className }: SidePanelSectionBodyProps) {
  const collapse = useContext(SectionCollapseContext);
  if (collapse?.collapsed) {
    return null;
  }
  return <div className={[css.sectionBody, className].filter(Boolean).join(" ")}>{children}</div>;
};

export type SidePanelFooterProps = {
  children: ReactNode;
  className?: string;
};

SidePanel.Footer = function SidePanelFooter({ children, className }: SidePanelFooterProps) {
  return <div className={[css.footer, className].filter(Boolean).join(" ")} data-select="chrome">{children}</div>;
};
