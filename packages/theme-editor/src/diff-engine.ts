import { structuredPatch } from "diff";
import type { CommentResult } from "./commenter";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface DiffHunk {
  lineStart: number;
  lineEnd: number;
  type: "added" | "removed" | "context";
  lines: string[];
}

export interface FileDiff {
  assetKey: string;
  linesAdded: number;
  linesRemoved: number;
  hunks: DiffHunk[];
}

// ─────────────────────────────────────────────
// Diff Generation
// ─────────────────────────────────────────────

/**
 * Generates a structured diff between two versions of a file.
 * Uses the `diff` package's structuredPatch to produce hunk-level information.
 */
export function generateDiff(
  assetKey: string,
  original: string,
  modified: string
): FileDiff {
  const patch = structuredPatch(
    assetKey,          // oldFileName
    assetKey,          // newFileName
    original,
    modified,
    "",                // oldHeader
    "",                // newHeader
    { context: 3 }    // lines of context around each change
  );

  const hunks: DiffHunk[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const hunk of patch.hunks) {
    let lineNumber = hunk.oldStart;

    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        linesAdded++;
        hunks.push({
          lineStart: lineNumber,
          lineEnd: lineNumber,
          type: "added",
          lines: [line.slice(1)], // strip the + prefix
        });
      } else if (line.startsWith("-")) {
        linesRemoved++;
        hunks.push({
          lineStart: lineNumber,
          lineEnd: lineNumber,
          type: "removed",
          lines: [line.slice(1)], // strip the - prefix
        });
        lineNumber++;
      } else {
        // Context line
        hunks.push({
          lineStart: lineNumber,
          lineEnd: lineNumber,
          type: "context",
          lines: [line.slice(1)],
        });
        lineNumber++;
      }
    }
  }

  return { assetKey, linesAdded, linesRemoved, hunks };
}

// ─────────────────────────────────────────────
// Batch Diff from CommentResults
// ─────────────────────────────────────────────

/**
 * Converts an array of CommentResults (from applyFindingsToTheme)
 * into a structured diff per file.
 */
export function generatePurgeDiff(commentResults: CommentResult[]): FileDiff[] {
  return commentResults.map((result) =>
    generateDiff(result.assetKey, result.originalContent, result.modifiedContent)
  );
}

// ─────────────────────────────────────────────
// Human-Readable Unified Diff
// ─────────────────────────────────────────────

/**
 * Formats an array of FileDiffs as a human-readable unified diff string.
 * Output is compatible with `patch` and most code review tools.
 */
export function formatDiffForDisplay(diffs: FileDiff[]): string {
  if (diffs.length === 0) return "(no changes)\n";

  return diffs
    .map((diff) => {
      const header = [
        `--- a/${diff.assetKey}`,
        `+++ b/${diff.assetKey}`,
        `@@ -0,0 +0,0 @@ ${diff.assetKey} (+${diff.linesAdded} -${diff.linesRemoved})`,
      ].join("\n");

      const body = diff.hunks
        .map((hunk) => {
          const prefix =
            hunk.type === "added" ? "+" :
            hunk.type === "removed" ? "-" :
            " ";
          return hunk.lines.map((l) => `${prefix}${l}`).join("\n");
        })
        .join("\n");

      return `${header}\n${body}`;
    })
    .join("\n\n");
}
