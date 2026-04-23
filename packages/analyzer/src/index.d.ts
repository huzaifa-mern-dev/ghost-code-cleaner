import type { AssetAttribution, SelectorCoverage } from "@ghost/shared";
/**
 * Parses a CSS file string using css-tree and extracts all selectors
 * along with their source file attribution.
 */
export declare function parseCSS(cssContent: string, fileUrl: string): Promise<SelectorCoverage[]>;
/**
 * Analyses a JavaScript file using acorn AST parsing to identify
 * potential orphan script blocks (e.g. app-specific globals).
 */
export declare function analyzeJS(jsContent: string, fileUrl: string): Promise<{
    fileUrl: string;
    identifiers: string[];
}>;
/**
 * Attributes a CSS/JS asset to a Shopify app based on known CDN patterns.
 */
export declare function attributeAsset(fileUrl: string): AssetAttribution;
//# sourceMappingURL=index.d.ts.map