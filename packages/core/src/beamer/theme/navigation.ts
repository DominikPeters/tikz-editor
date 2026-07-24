import type { BeamerDocumentModel } from "../types.js";
import type {
  BeamerFrameNavigationSnapshot,
  BeamerNavigationModel,
  BeamerNavigationSectionEntry,
  BeamerNavigationSubsectionEntry,
} from "./types.js";

/**
 * Build the document-wide entry stream consumed by Beamer navigation
 * templates.
 *
 * This mirrors the architectural role of Beamer's `.nav` file and
 * `\sectionentry`/`\slideentry` commands, while retaining source-backed
 * models for native rendering and future editor hit maps.
 */
export function createBeamerNavigationModel(
  document: BeamerDocumentModel
): BeamerNavigationModel {
  const frames = document.frames.map((frame, frameIndex) =>
    Object.freeze({ frame, frameIndex })
  );
  const sectionModels = document.sections.filter(
    (section) => section.level === 1
  );
  const subsectionModels = document.sections.filter(
    (section) => section.level === 2
  );

  const sections = sectionModels.map((section, sectionIndex) => {
    const sectionFrames = frames.filter(
      (entry) => entry.frame.sectionId === section.id
    );
    const subsections = subsectionModels
      .filter((subsection) => subsection.parentSectionId === section.id)
      .map((subsection, subsectionIndex) =>
        freezeSubsectionEntry({
          subsection,
          subsectionIndex,
          title: subsection.shortTitle ?? subsection.title,
          frames: frames.filter(
            (entry) => entry.frame.subsectionId === subsection.id
          ),
        })
      );
    return freezeSectionEntry({
      section,
      sectionIndex,
      title: section.shortTitle ?? section.title,
      frames: sectionFrames,
      directFrames: sectionFrames.filter(
        (entry) => entry.frame.subsectionId === null
      ),
      subsections,
    });
  });

  const orphanSubsections = subsectionModels
    .filter((subsection) => subsection.parentSectionId === null)
    .map((subsection, subsectionIndex) =>
      freezeSubsectionEntry({
        subsection,
        subsectionIndex,
        title: subsection.shortTitle ?? subsection.title,
        frames: frames.filter(
          (entry) => entry.frame.subsectionId === subsection.id
        ),
      })
    );

  return Object.freeze({
    frames: Object.freeze(frames),
    sections: Object.freeze(sections),
    unsectionedFrames: Object.freeze(
      frames.filter((entry) => entry.frame.sectionId === null)
    ),
    orphanSubsections: Object.freeze(orphanSubsections),
  });
}

/** Select the current section/subsection state for one rendered frame. */
export function createBeamerFrameNavigationSnapshot(
  document: BeamerDocumentModel,
  frameIndex: number,
  model = createBeamerNavigationModel(document)
): BeamerFrameNavigationSnapshot {
  const currentFrame = model.frames[frameIndex];
  if (!currentFrame) {
    throw new RangeError(
      `Beamer frame index ${frameIndex} is outside the navigation model's ${model.frames.length} frames.`
    );
  }
  const currentSection = currentFrame.frame.sectionId === null
    ? null
    : model.sections.find(
        (entry) => entry.section.id === currentFrame.frame.sectionId
      ) ?? null;
  const subsectionPool = currentSection?.subsections ??
    model.orphanSubsections;
  const currentSubsection = currentFrame.frame.subsectionId === null
    ? null
    : subsectionPool.find(
        (entry) => entry.subsection.id === currentFrame.frame.subsectionId
      ) ?? null;

  return Object.freeze({
    model,
    currentFrame,
    currentSection,
    currentSubsection,
    frameIndexInSection: currentSection
      ? currentSection.frames.indexOf(currentFrame)
      : null,
    frameIndexInSubsection: currentSubsection
      ? currentSubsection.frames.indexOf(currentFrame)
      : null,
  });
}

function freezeSectionEntry(
  entry: BeamerNavigationSectionEntry
): BeamerNavigationSectionEntry {
  return Object.freeze({
    ...entry,
    frames: Object.freeze([...entry.frames]),
    directFrames: Object.freeze([...entry.directFrames]),
    subsections: Object.freeze([...entry.subsections]),
  });
}

function freezeSubsectionEntry(
  entry: BeamerNavigationSubsectionEntry
): BeamerNavigationSubsectionEntry {
  return Object.freeze({
    ...entry,
    frames: Object.freeze([...entry.frames]),
  });
}
