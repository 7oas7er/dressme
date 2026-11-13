/**
 * UC-29 — pure catalog group/sort helpers (client-only).
 * Formality rank mirrors Suggest (`infra/lambda/suggest/core.js`) without importing Lambda.
 */

export const ARRANGE_STORAGE_KEY = "dressme.catalog.arrange.v1";

export const GROUP_BY_VALUES = Object.freeze([
  "none",
  "type",
  "dateAdded",
  "brandModel",
  "formality",
]);

export const SORT_BY_VALUES = Object.freeze([
  "default",
  "type",
  "dateAdded",
  "brandModel",
  "formality",
]);

export const SORT_DIR_VALUES = Object.freeze(["asc", "desc"]);

/** Client copy of Suggest FORMALITY_RANK (do not import Lambda). */
export const FORMALITY_RANK = Object.freeze({
  "black tie": 5,
  formal: 4,
  business: 3,
  "smart casual": 2,
  casual: 1,
  weekend: 1,
  athletic: 1,
});

export function defaultArrangePrefs() {
  return { groupBy: "none", sortBy: "default", sortDir: "desc" };
}

/** Dimension default direction when Sort by changes. */
export function defaultSortDir(sortBy) {
  if (sortBy === "dateAdded" || sortBy === "formality") return "desc";
  return "asc";
}

export function arrangeActive(prefs) {
  const p = normalizeArrangePrefs(prefs);
  return p.groupBy !== "none" || p.sortBy !== "default";
}

export function normalizeArrangePrefs(raw) {
  const base = defaultArrangePrefs();
  if (!raw || typeof raw !== "object") return base;
  const groupBy = GROUP_BY_VALUES.includes(raw.groupBy) ? raw.groupBy : base.groupBy;
  const sortBy = SORT_BY_VALUES.includes(raw.sortBy) ? raw.sortBy : base.sortBy;
  let sortDir = SORT_DIR_VALUES.includes(raw.sortDir) ? raw.sortDir : defaultSortDir(sortBy);
  if (sortBy === "default") sortDir = base.sortDir;
  return { groupBy, sortBy, sortDir };
}

export function readArrangePrefs(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(ARRANGE_STORAGE_KEY);
    if (!raw) return defaultArrangePrefs();
    return normalizeArrangePrefs(JSON.parse(raw));
  } catch {
    return defaultArrangePrefs();
  }
}

export function writeArrangePrefs(prefs, storage = globalThis.localStorage) {
  const normalized = normalizeArrangePrefs(prefs);
  try {
    if (storage) {
      storage.setItem(ARRANGE_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    // Private mode / quota — prefs stay in-memory only.
  }
  return normalized;
}

/** Normalize formality for rank lookup (hyphens/case like Suggest). */
export function formalityRank(value) {
  const key = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  if (!key) return 0;
  if (FORMALITY_RANK[key] != null) return FORMALITY_RANK[key];
  if (key.includes("black tie") || key.includes("blacktie")) return 5;
  if (key.includes("formal")) return 4;
  if (key.includes("business")) return 3;
  if (key.includes("smart")) return 2;
  if (key.includes("casual")) return 1;
  return 0;
}

function trimStr(value) {
  return String(value || "").trim();
}

function itemIdOf(item) {
  return String((item && item.itemId) || "");
}

function compareIds(a, b) {
  return itemIdOf(a).localeCompare(itemIdOf(b));
}

function compareUpdatedAtDesc(a, b) {
  const av = trimStr(a && a.updatedAt);
  const bv = trimStr(b && b.updatedAt);
  if (av && bv && av !== bv) return bv.localeCompare(av);
  if (av && !bv) return -1;
  if (!av && bv) return 1;
  return 0;
}

function compareText(a, b, dir) {
  const emptyA = !a;
  const emptyB = !b;
  if (emptyA && emptyB) return 0;
  // Empty always last in both directions.
  if (emptyA) return 1;
  if (emptyB) return -1;
  const cmp = a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  return dir === "desc" ? -cmp : cmp;
}

function compareCreatedAt(a, b, dir) {
  const emptyA = !a;
  const emptyB = !b;
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  const cmp = a.localeCompare(b);
  return dir === "desc" ? -cmp : cmp;
}

function compareFormality(aVal, bVal, dir) {
  const aRank = formalityRank(aVal);
  const bRank = formalityRank(bVal);
  const aUnset = aRank === 0;
  const bUnset = bRank === 0;
  if (aUnset && bUnset) {
    return compareText(trimStr(aVal), trimStr(bVal), "asc");
  }
  // Unset always last in both directions.
  if (aUnset) return 1;
  if (bUnset) return -1;
  if (aRank !== bRank) {
    return dir === "desc" ? bRank - aRank : aRank - bRank;
  }
  return compareText(trimStr(aVal), trimStr(bVal), "asc");
}

function sortItems(items, prefs) {
  if (prefs.sortBy === "default") return items;

  const dir = prefs.sortDir === "asc" ? "asc" : "desc";
  const list = items.slice();

  list.sort((a, b) => {
    let primary = 0;
    if (prefs.sortBy === "type") {
      primary = compareText(trimStr(a.type), trimStr(b.type), dir);
      if (primary) return primary;
      const updated = compareUpdatedAtDesc(a, b);
      if (updated) return updated;
      return compareIds(a, b);
    }
    if (prefs.sortBy === "dateAdded") {
      primary = compareCreatedAt(
        trimStr(a.createdAt),
        trimStr(b.createdAt),
        dir
      );
      if (primary) return primary;
      return compareIds(a, b);
    }
    if (prefs.sortBy === "brandModel") {
      primary = compareText(trimStr(a.brandModel), trimStr(b.brandModel), dir);
      if (primary) return primary;
      const typeCmp = compareText(trimStr(a.type), trimStr(b.type), "asc");
      if (typeCmp) return typeCmp;
      return compareIds(a, b);
    }
    if (prefs.sortBy === "formality") {
      primary = compareFormality(a.formality, b.formality, dir);
      if (primary) return primary;
      const typeCmp = compareText(trimStr(a.type), trimStr(b.type), "asc");
      if (typeCmp) return typeCmp;
      return compareIds(a, b);
    }
    return compareIds(a, b);
  });

  return list;
}

/** Europe/Berlin calendar day key (YYYY-MM-DD) from ISO instant. */
export function berlinDayKey(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

/** Same en-GB Europe/Berlin label as catalog `formatEntryDate`. */
export function formatBerlinDayLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function unsetLabel(groupBy) {
  if (groupBy === "type") return "No type";
  if (groupBy === "brandModel") return "No brand";
  if (groupBy === "formality") return "No formality";
  if (groupBy === "dateAdded") return "Unknown date";
  return "Other";
}

function groupMeta(item, groupBy) {
  if (groupBy === "type") {
    const label = trimStr(item.type);
    if (!label) return { key: "__unset__", label: unsetLabel(groupBy), unset: true };
    return { key: `type:${label}`, label, unset: false };
  }
  if (groupBy === "brandModel") {
    const label = trimStr(item.brandModel);
    if (!label) return { key: "__unset__", label: unsetLabel(groupBy), unset: true };
    return { key: `brand:${label.toLowerCase()}`, label, unset: false };
  }
  if (groupBy === "formality") {
    const label = trimStr(item.formality);
    if (!label) return { key: "__unset__", label: unsetLabel(groupBy), unset: true };
    return { key: `formality:${label.toLowerCase()}`, label, unset: false };
  }
  if (groupBy === "dateAdded") {
    const key = berlinDayKey(item.createdAt);
    if (!key) return { key: "__unset__", label: unsetLabel(groupBy), unset: true };
    return {
      key: `day:${key}`,
      label: formatBerlinDayLabel(item.createdAt),
      unset: false,
      dayKey: key,
    };
  }
  return { key: "__unset__", label: unsetLabel(groupBy), unset: true };
}

function orderGroups(groups, groupBy) {
  return groups.sort((a, b) => {
    if (groupBy === "dateAdded") {
      // Newest calendar day first.
      return String(b.dayKey || "").localeCompare(String(a.dayKey || ""));
    }
    if (groupBy === "formality") {
      const aRank = formalityRank(a.label);
      const bRank = formalityRank(b.label);
      if (aRank !== bRank) return bRank - aRank;
      return a.label.localeCompare(b.label, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    }
    return a.label.localeCompare(b.label, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

/**
 * Apply group + sort to an already-filtered item list.
 * @returns {{ mode: "flat", items: object[] } | { mode: "grouped", groups: { key: string, label: string, items: object[] }[] }}
 */
export function applyGroupSort(items, prefs) {
  const normalized = normalizeArrangePrefs(prefs);
  const source = Array.isArray(items) ? items : [];
  const sorted = sortItems(source, normalized);

  if (normalized.groupBy === "none") {
    return { mode: "flat", items: sorted };
  }

  const buckets = new Map();
  const unset = {
    key: "__unset__",
    label: unsetLabel(normalized.groupBy),
    items: [],
  };

  for (const item of sorted) {
    const meta = groupMeta(item, normalized.groupBy);
    if (meta.unset) {
      unset.items.push(item);
      continue;
    }
    let group = buckets.get(meta.key);
    if (!group) {
      group = {
        key: meta.key,
        label: meta.label,
        items: [],
        dayKey: meta.dayKey || "",
      };
      buckets.set(meta.key, group);
    }
    group.items.push(item);
  }

  const groups = orderGroups([...buckets.values()], normalized.groupBy);
  if (unset.items.length) groups.push(unset);
  return {
    mode: "grouped",
    groups: groups.map(({ key, label, items: groupItems }) => ({
      key,
      label,
      items: groupItems,
    })),
  };
}

/** Toggle label helper for the Arrange fold button. */
export function arrangeToggleLabel(prefs, open) {
  if (open) return "Hide arrange";
  const p = normalizeArrangePrefs(prefs);
  const grouped = p.groupBy !== "none";
  const sorted = p.sortBy !== "default";
  if (grouped && sorted) return "Arrange · grouped + sorted";
  if (grouped) return "Arrange · grouped";
  if (sorted) return "Arrange · sorted";
  return "Arrange";
}
