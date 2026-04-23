// ─────────────────────────────────────────────
// @ghost/theme-editor — Public API
// ─────────────────────────────────────────────

export { duplicateTheme, assertNotMainTheme } from "./duplicator";
export type { DuplicationProgress } from "./duplicator";

export {
  commentOutCSSSelectors,
  commentOutScriptTag,
  commentOutJSBlock,
  applyFindingsToTheme,
} from "./commenter";
export type { CommentResult } from "./commenter";

export { generateDiff, generatePurgeDiff, formatDiffForDisplay } from "./diff-engine";
export type { FileDiff, DiffHunk } from "./diff-engine";

export { rollbackPurge } from "./rollback";
