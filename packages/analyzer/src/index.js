"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCSS = parseCSS;
exports.analyzeJS = analyzeJS;
exports.attributeAsset = attributeAsset;
/**
 * Parses a CSS file string using css-tree and extracts all selectors
 * along with their source file attribution.
 */
async function parseCSS(cssContent, fileUrl) {
    const csstree = await Promise.resolve().then(() => __importStar(require("css-tree")));
    const ast = csstree.parse(cssContent, {
        parseAtrulePrelude: false,
        parseRulePrelude: false,
        parseValue: false,
    });
    const selectors = [];
    csstree.walk(ast, (node) => {
        if (node.type === "Rule" && node.prelude.type === "SelectorList") {
            const selector = csstree.generate(node.prelude);
            const rawBytes = Buffer.byteLength(csstree.generate(node), "utf8");
            selectors.push({
                selector,
                usedBytes: 0,
                totalBytes: rawBytes,
                coveragePercent: 0,
                fileUrl,
            });
        }
    });
    return selectors;
}
/**
 * Analyses a JavaScript file using acorn AST parsing to identify
 * potential orphan script blocks (e.g. app-specific globals).
 */
async function analyzeJS(jsContent, fileUrl) {
    const acorn = await Promise.resolve().then(() => __importStar(require("acorn")));
    const walk = await Promise.resolve().then(() => __importStar(require("acorn-walk")));
    const ast = acorn.parse(jsContent, {
        ecmaVersion: "latest",
        sourceType: "module",
    });
    const identifiers = [];
    walk.simple(ast, {
        Identifier(node) {
            identifiers.push(node.name);
        },
    });
    return { fileUrl, identifiers };
}
/**
 * Attributes a CSS/JS asset to a Shopify app based on known CDN patterns.
 */
function attributeAsset(fileUrl) {
    // TODO: match against APP_CDN_PATTERNS from @ghost/shared
    return {
        fileUrl,
        type: fileUrl.endsWith(".css") ? "css" : "js",
        isKnownAppCdn: false,
    };
}
//# sourceMappingURL=index.js.map