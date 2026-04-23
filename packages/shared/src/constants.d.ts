export declare const SHOPIFY_TEMPLATES: readonly ["index", "product", "collection", "cart", "page", "blog", "article", "search", "404"];
export type ShopifyTemplate = (typeof SHOPIFY_TEMPLATES)[number];
export declare const APP_CDN_PATTERNS: Array<{
    pattern: RegExp;
    appName: string;
}>;
export declare const QUEUE_NAMES: {
    readonly AUDIT: "audit";
    readonly PURGE: "purge";
    readonly NOTIFICATION: "notification";
};
export declare const COVERAGE_THRESHOLDS: {
    readonly HIGH_CONFIDENCE: 2;
    readonly MEDIUM_CONFIDENCE: 10;
};
//# sourceMappingURL=constants.d.ts.map