import type {
  BreakDecision,
  GreedyLine,
  AnyWrapper,
  ParagraphRun,
  SpaceRun,
} from './types.js';
import type { ParagraphAlignment } from '../alignment.js';
import { TEX_INTERWORD_SPACE_EM } from '../alignment.js';
import type { WrappedTextGap } from '../install.js';

export interface AppliedBreak extends BreakDecision {
  lineIndex: number;
}

export interface ApplyBreaksOptions {
  originalMtextTextByWrapper?: WeakMap<object, string[]>;
  originalMspaceWidthByWrapper?: WeakMap<object, string | undefined>;
  alignment?: ParagraphAlignment;
  targetWidth?: number;
  paragraphId?: string;
  wrappedTextGaps?: WrappedTextGap[];
}

export interface ApplyBreaksResult {
  appliedBreaks: AppliedBreak[];
  canProceed: boolean;
  errors: string[];
}

interface WrapperMutationPlan {
  childWordSplits: Map<number, Map<number, SplitMutation[]>>;
  wordPrefixTrim: Map<number, Map<number, number>>;
}

interface SplitMutation {
  splitOffset: number;
  insertKind: 'hyphen' | 'space';
}

interface TextMutationToken {
  kind: 'space' | 'word';
  text: string;
}

interface MtextBreakAction {
  lineIndex: number;
  kind: 'space' | 'hyphen';
  runIndex: number;
  sourceOffset: number;
  visibleHyphen: boolean;
  wrapper: AnyWrapper;
  childIndex: number;
  wordIndex: number;
  splitOffset?: number;
}

const MTEXT_INDENT_PATCHED = Symbol('kp-mtext-indent-patched');
const MTEXT_INDENT_PATCH_ORIGINAL = Symbol('kp-mtext-indent-original');
function alignmentToHorizontalAlign(alignment: ParagraphAlignment): 'left' | 'right' | 'center' {
  if (alignment === 'ragged-left') {
    return 'right';
  }
  if (alignment === 'center') {
    return 'center';
  }
  return 'left';
}

function safeInvalidate(wrapper: AnyWrapper | undefined) {
  if (wrapper && typeof wrapper.invalidateBBox === 'function') {
    wrapper.invalidateBBox();
  }
}

type TextChildWrapper = AnyWrapper & { node: NonNullable<AnyWrapper['node']> };

function isTextChild(child: AnyWrapper | null | undefined): child is TextChildWrapper {
  return !!child?.node?.isKind?.('text');
}

function getTextChildren(wrapper: AnyWrapper | null | undefined): AnyWrapper[] {
  return Array.isArray(wrapper?.childNodes) ? wrapper.childNodes : [];
}

function normalizeSplitMutations(values: SplitMutation[]): SplitMutation[] {
  const byOffset = new Map<number, SplitMutation>();
  for (const value of values) {
    const existing = byOffset.get(value.splitOffset);
    if (!existing) {
      byOffset.set(value.splitOffset, value);
      continue;
    }
    if (existing.insertKind === 'space' && value.insertKind === 'hyphen') {
      byOffset.set(value.splitOffset, value);
    }
  }

  return [...byOffset.values()].sort((a, b) => a.splitOffset - b.splitOffset);
}

function restoreMtextWrapper(
  wrapper: AnyWrapper | null | undefined,
  originalMap?: WeakMap<object, string[]>
): void {
  if (!wrapper || typeof wrapper !== 'object') return;
  if (!originalMap) return;
  const snapshot = originalMap.get(wrapper);
  if (!snapshot) return;

  const children = getTextChildren(wrapper);
  for (let i = 0; i < children.length; i++) {
    const child = children.at(i);
    if (!isTextChild(child)) continue;
    const text = snapshot.at(i);
    if (text === undefined) continue;
    if (typeof child.node.setText === 'function') {
      child.node.setText(text);
      safeInvalidate(child);
    }
  }

  if (typeof wrapper.clearBreakPoints === 'function') {
    wrapper.clearBreakPoints();
  }

  safeInvalidate(wrapper);
}

function formatEmLength(value: number): string {
  return `${Number(value.toFixed(6))}em`;
}

function restoreMspaceWrapper(
  wrapper: AnyWrapper | null | undefined,
  originalMap?: WeakMap<object, string | undefined>
): void {
  if (!wrapper || typeof wrapper !== 'object') return;
  if (!originalMap) return;
  const attrs = wrapper.node?.attributes;
  if (!attrs || typeof attrs.set !== 'function') return;
  const originalWidth = originalMap.get(wrapper);
  attrs.set('width', originalWidth ?? '');
  if (typeof wrapper.setBreakStyle === 'function') {
    wrapper.setBreakStyle('');
  }
  safeInvalidate(wrapper);
}

function readMspaceWidth(wrapper: AnyWrapper | null | undefined): number {
  if (!wrapper || typeof wrapper !== 'object') {
    return 0;
  }
  const bbox =
    typeof wrapper.getBBox === 'function'
      ? wrapper.getBBox()
      : typeof wrapper.getOuterBBox === 'function'
        ? wrapper.getOuterBBox()
        : null;
  const width = Number(bbox?.w);
  return Number.isFinite(width) ? width : 0;
}

function setMspaceWidth(wrapper: AnyWrapper | null | undefined, width: number): void {
  if (!wrapper || typeof wrapper !== 'object') {
    return;
  }
  const attrs = wrapper.node?.attributes;
  if (!attrs || typeof attrs.set !== 'function') {
    return;
  }
  attrs.set('width', formatEmLength(Math.max(0, width)));
  safeInvalidate(wrapper);
}

function formatGapWidthEm(widthEm: number): string {
  return `${Number(widthEm.toFixed(6))}em`;
}

function applyWrappedTextGapWidths(
  runs: ParagraphRun[],
  wrappedTextGaps: WrappedTextGap[] | undefined
): void {
  const gapBySourceStart = new Map<number, WrappedTextGap>();
  for (const gap of wrappedTextGaps ?? []) {
    if (Number.isFinite(gap.widthEm) && gap.widthEm >= 0) {
      gapBySourceStart.set(gap.sourceStart, gap);
    }
  }

  for (const run of runs) {
    if (!isAdjustableMspaceRun(run)) {
      continue;
    }
    const gap = gapBySourceStart.get(run.sourceStart);
    const widthEm = gap?.widthEm ?? TEX_INTERWORD_SPACE_EM;
    run.texGlue = {
      width: widthEm,
      stretch: gap?.stretchEm ?? 0,
      shrink: gap?.shrinkEm ?? 0,
      spaceFactor: gap?.spaceFactor,
    };
    const wrapper = (run.breakRef as { wrapper?: AnyWrapper | null }).wrapper;
    if (!wrapper) {
      continue;
    }
    const attrs = wrapper.node?.attributes;
    if (!attrs || typeof attrs.set !== 'function') {
      continue;
    }
    attrs.set('width', formatGapWidthEm(widthEm));
    if (typeof wrapper.setBreakStyle === 'function') {
      wrapper.setBreakStyle('');
    }
    safeInvalidate(wrapper);
  }
}

function isAdjustableMspaceRun(run: ParagraphRun | undefined): run is SpaceRun & {
  breakRef: Extract<SpaceRun['breakRef'], { kind: 'mspace' }>;
} {
  return (
    !!run &&
    run.kind === 'space' &&
    run.breakRef.kind === 'mspace' &&
    !run.breakRef.isForcedLineBreak
  );
}

function ensureWrapperPlan(
  plans: Map<AnyWrapper, WrapperMutationPlan>,
  wrapper: AnyWrapper
): WrapperMutationPlan {
  let plan = plans.get(wrapper);
  if (!plan) {
    plan = {
      childWordSplits: new Map<number, Map<number, SplitMutation[]>>(),
      wordPrefixTrim: new Map<number, Map<number, number>>(),
    };
    plans.set(wrapper, plan);
  }
  return plan;
}

function pushSplit(
  plans: Map<AnyWrapper, WrapperMutationPlan>,
  wrapper: AnyWrapper,
  childIndex: number,
  wordIndex: number,
  splitOffset: number,
  insertKind: 'hyphen' | 'space'
): void {
  const plan = ensureWrapperPlan(plans, wrapper);
  let wordMap = plan.childWordSplits.get(childIndex);
  if (!wordMap) {
    wordMap = new Map<number, SplitMutation[]>();
    plan.childWordSplits.set(childIndex, wordMap);
  }
  const current = wordMap.get(wordIndex) ?? [];
  current.push({ splitOffset, insertKind });
  wordMap.set(wordIndex, current);
}

function pushWordPrefixTrim(
  plans: Map<AnyWrapper, WrapperMutationPlan>,
  wrapper: AnyWrapper,
  childIndex: number,
  wordIndex: number,
  consumed: number
): void {
  if (!Number.isFinite(consumed) || consumed <= 0) {
    return;
  }

  const plan = ensureWrapperPlan(plans, wrapper);
  let childMap = plan.wordPrefixTrim.get(childIndex);
  if (!childMap) {
    childMap = new Map<number, number>();
    plan.wordPrefixTrim.set(childIndex, childMap);
  }

  const prior = childMap.get(wordIndex) ?? 0;
  childMap.set(wordIndex, Math.max(prior, Math.floor(consumed)));
}

function normalizePlans(plans: Map<AnyWrapper, WrapperMutationPlan>): void {
  for (const plan of plans.values()) {
    for (const [childIndex, wordSplits] of plan.childWordSplits.entries()) {
      for (const [wordIndex, splits] of wordSplits.entries()) {
        wordSplits.set(wordIndex, normalizeSplitMutations(splits));
      }
      plan.childWordSplits.set(childIndex, wordSplits);
    }
  }
}

function patchMtextIndentBehavior(wrapper: AnyWrapper | null | undefined): void {
  if (!wrapper || typeof wrapper !== 'object') {
    return;
  }
  if ((wrapper as Record<symbol, unknown>)[MTEXT_INDENT_PATCHED]) {
    return;
  }
  if (typeof wrapper.computeLineBBox !== 'function') {
    return;
  }

  const original = wrapper.computeLineBBox.bind(wrapper);
  (wrapper as Record<symbol, unknown>)[MTEXT_INDENT_PATCH_ORIGINAL] = original;
  (wrapper as Record<symbol, unknown>)[MTEXT_INDENT_PATCHED] = true;

  wrapper.computeLineBBox = function patchedComputeLineBBox(this: AnyWrapper, i: number) {
    const bbox = original(i);
    if (
      bbox &&
      typeof bbox.getIndentData === 'function' &&
      this.node?.attributes
    ) {
      bbox.getIndentData(this.node);
    }
    return bbox;
  };
}

function applyMtextAlignment(wrapper: AnyWrapper, alignment: ParagraphAlignment): void {
  if (!wrapper.node?.attributes || typeof wrapper.node.attributes.set !== 'function') {
    return;
  }

  const align = alignmentToHorizontalAlign(alignment);
  wrapper.node.attributes.set('indentalign', align);
  wrapper.node.attributes.set('indentalignfirst', align);
  wrapper.node.attributes.set('indentalignlast', align);
  wrapper.node.attributes.set('indentshift', '0');
  wrapper.node.attributes.set('indentshiftfirst', '0');
  wrapper.node.attributes.set('indentshiftlast', '0');
}

function countSplitsBeforeWord(
  wordSplits: Map<number, SplitMutation[]>,
  wordIndex: number
): number {
  let total = 0;
  for (const [index, splits] of wordSplits.entries()) {
    if (index < wordIndex) {
      total += splits.length;
    }
  }
  return total;
}

function tokenizeForMutation(text: string): TextMutationToken[] {
  const tokens = text.match(/\s+|[^\s]+/g) ?? [];
  return tokens.map((token) => ({
    kind: /^\s+$/.test(token) ? 'space' : 'word',
    text: token,
  }));
}

function wordTokenIndices(tokens: TextMutationToken[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === 'word') {
      indices.push(i);
    }
  }
  return indices;
}

function normalizeWhitespaceToken(text: string): string {
  return /^[\t\n\r\f ]+$/.test(text) ? ' ' : text;
}

function mutateWrapperText(
  wrapper: AnyWrapper,
  plan: WrapperMutationPlan,
  errors: string[]
): boolean {
  const children = getTextChildren(wrapper);
  const allChildIndices = new Set<number>([
    ...plan.childWordSplits.keys(),
    ...plan.wordPrefixTrim.keys(),
  ]);

  for (const childIndex of allChildIndices) {
    const wordSplits = plan.childWordSplits.get(childIndex) ?? new Map<number, SplitMutation[]>();
    const wordPrefixTrim = plan.wordPrefixTrim.get(childIndex) ?? new Map<number, number>();
    const child = children.at(childIndex);
    if (!child || !isTextChild(child)) {
      errors.push(
        `Mutation failed: mtext child ${childIndex} is missing or not text.`
      );
      return false;
    }

    if (typeof child.node.getText !== 'function') {
      errors.push(`Mutation failed: child ${childIndex} does not expose getText().`);
      return false;
    }

    if (typeof child.node.setText !== 'function') {
      errors.push(`Mutation failed: child ${childIndex} does not expose setText().`);
      return false;
    }

    const originalText = String(child.node.getText());
    const tokens = tokenizeForMutation(originalText);
    const wordIndices = wordTokenIndices(tokens);

    for (const [wordIndex, consumed] of wordPrefixTrim.entries()) {
      if (wordIndex < 0 || wordIndex >= wordIndices.length) {
        errors.push(
          `Mutation failed: line-leading trim wordIndex ${wordIndex} out of range for child ${childIndex}.`
        );
        return false;
      }

      const tokenIndex = wordIndices[wordIndex];
      const word = tokens[tokenIndex].text;
      if (consumed > word.length) {
        errors.push(
          `Mutation failed: line-leading trim length ${consumed} exceeds word '${word}'.`
        );
        return false;
      }
      tokens[tokenIndex].text = word.slice(consumed);
    }

    for (const [wordIndex, splitsAscending] of wordSplits.entries()) {
      if (wordIndex < 0 || wordIndex >= wordIndices.length) {
        errors.push(
          `Mutation failed: wordIndex ${wordIndex} out of range for child ${childIndex}.`
        );
        return false;
      }

      const tokenIndex = wordIndices[wordIndex];
      let word = tokens[tokenIndex].text;
      const splitsDescending = [...splitsAscending].sort(
        (a, b) => b.splitOffset - a.splitOffset
      );
      for (const mutation of splitsDescending) {
        const split = mutation.splitOffset;
        if (split <= 0 || split >= word.length) {
          errors.push(
            `Mutation failed: splitOffset ${split} invalid for word '${word}'.`
          );
          return false;
        }
        const insertion = mutation.insertKind === 'hyphen' ? '- ' : ' ';
        word = `${word.slice(0, split)}${insertion}${word.slice(split)}`;
      }

      tokens[tokenIndex].text = word;
    }

    child.node.setText(
      tokens
        .map((token) =>
          token.kind === 'space' ? normalizeWhitespaceToken(token.text) : token.text
        )
        .join('')
    );
    safeInvalidate(child);
  }

  if (typeof wrapper.clearBreakPoints === 'function') {
    wrapper.clearBreakPoints();
  }
  safeInvalidate(wrapper);
  return true;
}

function mappedIndexForSpace(
  wordSplits: Map<number, SplitMutation[]>,
  wordIndex: number
): number {
  return wordIndex + countSplitsBeforeWord(wordSplits, wordIndex);
}

function mappedIndexForHyphen(
  wordSplits: Map<number, SplitMutation[]>,
  wordIndex: number,
  splitOffset: number
): number | null {
  const splits = wordSplits.get(wordIndex) ?? [];
  const rank = splits.findIndex((split) => split.splitOffset === splitOffset);
  if (rank < 0) {
    return null;
  }

  return wordIndex + countSplitsBeforeWord(wordSplits, wordIndex) + rank + 1;
}

function clearExistingBreakStyles(
  runs: ParagraphRun[],
  touchedMtextWrappers: Set<AnyWrapper | null | undefined>,
  touchedMspaceWrappers: Set<AnyWrapper | null | undefined>,
  originalMspaceWidthByWrapper?: WeakMap<object, string | undefined>
): void {
  for (const run of runs) {
    if (run.kind === 'text') {
      touchedMtextWrappers.add(run.wrapper);
      continue;
    }

    if (run.kind === 'space') {
      if (run.breakRef.kind === 'mtext-space') {
        touchedMtextWrappers.add(run.breakRef.wrapper);
      } else {
        touchedMspaceWrappers.add(run.breakRef.wrapper);
      }
    }
  }

  for (const wrapper of touchedMtextWrappers) {
    if (!wrapper) {
      continue;
    }
    if (typeof wrapper.clearBreakPoints === 'function') {
      wrapper.clearBreakPoints();
      safeInvalidate(wrapper);
    }
  }

  for (const wrapper of touchedMspaceWrappers) {
    restoreMspaceWrapper(wrapper, originalMspaceWidthByWrapper);
  }
}

function applyParagraphAlignment(
  paragraphWrapper: AnyWrapper,
  alignment: ParagraphAlignment,
  paragraphId?: string
): void {
  const parentNode = paragraphWrapper.parent?.node;
  const attrs = parentNode?.attributes;
  if (!attrs || typeof attrs.set !== 'function') {
    return;
  }

  const align = alignmentToHorizontalAlign(alignment);
  attrs.set('data-align', align);
  attrs.set('indentalign', align);
  attrs.set('indentalignfirst', align);
  attrs.set('indentalignlast', align);
  attrs.set('indentshift', '0');
  attrs.set('indentshiftfirst', '0');
  attrs.set('indentshiftlast', '0');
  if (paragraphId) {
    attrs.set('data-paragraph-id', paragraphId);
  }
}

export function applyBreaks(
  paragraphWrapper: AnyWrapper,
  runs: ParagraphRun[],
  lines: GreedyLine[],
  options: ApplyBreaksOptions = {}
): ApplyBreaksResult {
  const errors: string[] = [];
  const appliedBreaks: AppliedBreak[] = [];
  const alignment = options.alignment ?? 'ragged-right';

  applyParagraphAlignment(paragraphWrapper, alignment, options.paragraphId);

  const touchedMtextWrappers = new Set<AnyWrapper | null | undefined>();
  const touchedMspaceWrappers = new Set<AnyWrapper | null | undefined>();
  clearExistingBreakStyles(
    runs,
    touchedMtextWrappers,
    touchedMspaceWrappers,
    options.originalMspaceWidthByWrapper
  );
  applyWrappedTextGapWidths(runs, options.wrappedTextGaps);

  for (const wrapper of touchedMtextWrappers) {
    if (!wrapper) {
      continue;
    }
    patchMtextIndentBehavior(wrapper);
    applyMtextAlignment(wrapper, alignment);
  }

  const plans = new Map<AnyWrapper, WrapperMutationPlan>();
  const mtextActionsInLineOrder: MtextBreakAction[] = [];
  const justifiedSpaceWidths = new Map<number, number>();

  if (alignment === 'justified') {
    for (const line of lines) {
      const delta = Number(line.spaceDeltaPerGap ?? 0);
      if (!Number.isFinite(delta) || delta === 0) {
        continue;
      }

      for (let runIndex = line.startRun; runIndex <= line.endRun; runIndex++) {
        const run = runs.at(runIndex);
        if (
          run?.kind !== 'space' ||
          run.breakRef.kind !== 'mspace' ||
          run.breakRef.isForcedLineBreak
        ) {
          continue;
        }
        justifiedSpaceWidths.set(
          runIndex,
          Math.max(0, readMspaceWidth(run.breakRef.wrapper) + delta)
        );
      }
    }
  }

  for (const [runIndex, width] of justifiedSpaceWidths.entries()) {
    const run = runs.at(runIndex);
    if (run?.kind === 'space' && run.breakRef.kind === 'mspace') {
      setMspaceWidth(run.breakRef.wrapper, width);
    }
  }

  for (const line of lines) {
    if (!line.break) continue;
    const breakDecision = line.break;

    if (breakDecision.kind === 'hyphen') {
      const run = runs.at(breakDecision.runIndex);
      if (run?.kind !== 'text') {
        errors.push(
          `Hyphen break points to non-text run index ${breakDecision.runIndex}.`
        );
        continue;
      }

      if (typeof breakDecision.splitOffset !== 'number') {
        errors.push(
          `Hyphen break at run ${breakDecision.runIndex} is missing splitOffset.`
        );
        continue;
      }

      pushSplit(
        plans,
        run.wrapper,
        run.childIndex,
        run.wordIndex,
        breakDecision.splitOffset,
        breakDecision.visibleHyphen ? 'hyphen' : 'space'
      );

      mtextActionsInLineOrder.push({
        lineIndex: line.lineIndex,
        kind: 'hyphen',
        runIndex: breakDecision.runIndex,
        sourceOffset: breakDecision.sourceOffset,
        visibleHyphen: breakDecision.visibleHyphen,
        wrapper: run.wrapper,
        childIndex: run.childIndex,
        wordIndex: run.wordIndex,
        splitOffset: breakDecision.splitOffset,
      });
      continue;
    }

    const run = runs.at(breakDecision.runIndex);
    if (run?.kind !== 'space') {
      appliedBreaks.push({
        lineIndex: line.lineIndex,
        kind: 'forced',
        runIndex: breakDecision.runIndex,
        sourceOffset: breakDecision.sourceOffset,
        visibleHyphen: false,
        lineLeading: breakDecision.lineLeading,
      });
      continue;
    }

    if (run.breakRef.kind === 'mtext-space') {
      mtextActionsInLineOrder.push({
        lineIndex: line.lineIndex,
        kind: 'space',
        runIndex: run.runIndex,
        sourceOffset: run.sourceEnd,
        visibleHyphen: false,
        wrapper: run.breakRef.wrapper,
        childIndex: run.breakRef.childIndex,
        wordIndex: run.breakRef.wordIndex,
      });
      continue;
    }

    if (!run.breakRef.isForcedLineBreak && !run.breakRef.lineLeading) {
      setMspaceWidth(run.breakRef.wrapper, 0);
    }

    if (run.breakRef.lineLeading) {
      if (typeof run.breakRef.wrapper.node?.attributes?.set === 'function') {
        run.breakRef.wrapper.node.attributes.set(
          'data-lineleading',
          run.breakRef.lineLeading
        );
      }
    }

    if (run.breakRef.lineLeadingTrim) {
      pushWordPrefixTrim(
        plans,
        run.breakRef.lineLeadingTrim.wrapper,
        run.breakRef.lineLeadingTrim.childIndex,
        run.breakRef.lineLeadingTrim.wordIndex,
        run.breakRef.lineLeadingTrim.consumed
      );
    }

    if (typeof run.breakRef.wrapper.setBreakStyle === 'function') {
      run.breakRef.wrapper.setBreakStyle('before');
      safeInvalidate(run.breakRef.wrapper);
    }

    const appliedKind = breakDecision.kind === 'forced' ? 'forced' : 'space';
    appliedBreaks.push({
      lineIndex: line.lineIndex,
      kind: appliedKind,
      runIndex: run.runIndex,
      sourceOffset: run.sourceEnd,
      visibleHyphen: false,
      lineLeading: run.breakRef.lineLeading,
    });
  }

  normalizePlans(plans);

  const mutatedWrappers = new Set<AnyWrapper>();
  let canProceed = errors.length === 0;

  if (canProceed) {
    for (const [wrapper, plan] of plans.entries()) {
      const ok = mutateWrapperText(wrapper, plan, errors);
      if (!ok) {
        canProceed = false;
        break;
      }
      mutatedWrappers.add(wrapper);
    }
  }

  if (canProceed) {
    for (const action of mtextActionsInLineOrder) {
      const plan = plans.get(action.wrapper);
      const childSplits =
        plan?.childWordSplits.get(action.childIndex) ??
        new Map<number, SplitMutation[]>();

      const mutatedWordIndex = action.kind === 'space'
        ? mappedIndexForSpace(childSplits, action.wordIndex)
        : mappedIndexForHyphen(
          childSplits,
          action.wordIndex,
          action.splitOffset as number
        );

      if (mutatedWordIndex === null) {
        errors.push(
          `Failed to map mutated break index for line ${action.lineIndex}, run ${action.runIndex}.`
        );
        canProceed = false;
        break;
      }

      if (typeof action.wrapper.setBreakAt !== 'function') {
        errors.push('Target mtext wrapper does not expose setBreakAt().');
        canProceed = false;
        break;
      }

      action.wrapper.setBreakAt([action.childIndex, mutatedWordIndex]);
      safeInvalidate(action.wrapper);

      appliedBreaks.push({
        lineIndex: action.lineIndex,
        kind: action.kind,
        runIndex: action.runIndex,
        sourceOffset: action.sourceOffset,
        visibleHyphen: action.visibleHyphen,
        splitOffset: action.splitOffset,
      });
    }
  }

  if (!canProceed) {
    const wrappersToRestore = new Set<AnyWrapper>(mutatedWrappers);
    for (const wrapper of plans.keys()) {
      wrappersToRestore.add(wrapper);
    }

    for (const wrapper of wrappersToRestore) {
      restoreMtextWrapper(wrapper, options.originalMtextTextByWrapper);
    }

    for (const wrapper of touchedMspaceWrappers) {
      restoreMspaceWrapper(wrapper, options.originalMspaceWidthByWrapper);
    }
  }

  safeInvalidate(paragraphWrapper);

  return {
    appliedBreaks: canProceed ? appliedBreaks : [],
    canProceed,
    errors,
  };
}
