/**
 * Attribute-value hygiene — SPA re-export of the single shared module.
 * Source of truth: infra/lambda/attrNormalize.js (also shipped in the Lambda zip).
 */
import attrNormalize from "../../infra/lambda/attrNormalize.js";

export const MAX_ATTR_LEN = attrNormalize.MAX_ATTR_LEN;
export const BRAND_ALIASES = attrNormalize.BRAND_ALIASES;
export const lightNormalize = attrNormalize.lightNormalize;
export const normalizeAttrValue = attrNormalize.normalizeAttrValue;
export const foldForMatch = attrNormalize.foldForMatch;
export const levenshtein = attrNormalize.levenshtein;
export const matchAttrOption = attrNormalize.matchAttrOption;
export const canonicalizeAttrValue = attrNormalize.canonicalizeAttrValue;
