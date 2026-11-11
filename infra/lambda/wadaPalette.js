"use strict";

/**
 * DressMe Wada Vol. 1 palette twin (validation + resolve).
 * Generated from mattdesl/dictionary-of-colour-combinations@1.0.2 (MIT).
 * Keep in sync with web/src/data/wada-colors.v1.json — regenerate via scripts/vendor-wada-colors.mjs.
 */

var BY_ID = {
  "wada:v1:0": { name: "Hermosa Pink", hex: "#f9c1ce" },
  "wada:v1:1": { name: "Corinthian Pink", hex: "#f8b6ba" },
  "wada:v1:2": { name: "Cameo Pink", hex: "#e0b3b6" },
  "wada:v1:3": { name: "Fawn", hex: "#d1b0a7" },
  "wada:v1:4": { name: "Light Brown Drab", hex: "#b59392" },
  "wada:v1:5": { name: "Coral Red", hex: "#f58e84" },
  "wada:v1:6": { name: "Fresh Color", hex: "#f6917e" },
  "wada:v1:7": { name: "Grenadine Pink", hex: "#f48067" },
  "wada:v1:8": { name: "Eosine Pink", hex: "#f37f94" },
  "wada:v1:9": { name: "Spinel Red", hex: "#f27291" },
  "wada:v1:10": { name: "Old Rose", hex: "#d46d7a" },
  "wada:v1:11": { name: "Eugenia Red | A", hex: "#e2625e" },
  "wada:v1:12": { name: "Eugenia Red | B", hex: "#da525d" },
  "wada:v1:13": { name: "Raw Sienna", hex: "#bb7125" },
  "wada:v1:14": { name: "Vinaceous Tawny", hex: "#c56127" },
  "wada:v1:15": { name: "Jasper Red", hex: "#eb5324" },
  "wada:v1:16": { name: "Spectrum Red", hex: "#e31f26" },
  "wada:v1:17": { name: "Red Orange", hex: "#dd4027" },
  "wada:v1:18": { name: "Etruscan Red", hex: "#c55347" },
  "wada:v1:19": { name: "Burnt Sienna", hex: "#ae5224" },
  "wada:v1:20": { name: "Ochre Red", hex: "#ab544d" },
  "wada:v1:21": { name: "Scarlet", hex: "#cb2f43" },
  "wada:v1:22": { name: "Carmine", hex: "#cc1236" },
  "wada:v1:23": { name: "Indian Lake", hex: "#c53c69" },
  "wada:v1:24": { name: "Rosolanc Purple", hex: "#b73f74" },
  "wada:v1:25": { name: "Pomegranite Purple", hex: "#b71f57" },
  "wada:v1:26": { name: "Hydrangea Red", hex: "#a94151" },
  "wada:v1:27": { name: "Brick Red", hex: "#a84222" },
  "wada:v1:28": { name: "Carmine Red", hex: "#a62c37" },
  "wada:v1:29": { name: "Pompeian Red", hex: "#ab2439" },
  "wada:v1:30": { name: "Red", hex: "#a72144" },
  "wada:v1:31": { name: "Brown", hex: "#7c4226" },
  "wada:v1:32": { name: "Hay's Russet", hex: "#793327" },
  "wada:v1:33": { name: "Vandyke Red", hex: "#82241f" },
  "wada:v1:34": { name: "Pansy Purple", hex: "#7d133a" },
  "wada:v1:35": { name: "Pale Burnt Lake", hex: "#802626" },
  "wada:v1:36": { name: "Violet Red", hex: "#642d5e" },
  "wada:v1:37": { name: "Vistoris Lake", hex: "#6d4145" },
  "wada:v1:38": { name: "Sulpher Yellow", hex: "#f5ecc2" },
  "wada:v1:39": { name: "Pale Lemon Yellow", hex: "#ffefae" },
  "wada:v1:40": { name: "Naples Yellow", hex: "#fbe6a0" },
  "wada:v1:41": { name: "Ivory Buff", hex: "#ebd3a2" },
  "wada:v1:42": { name: "Seashell Pink", hex: "#fdd4bd" },
  "wada:v1:43": { name: "Light Pinkish Cinnamon", hex: "#fcc79b" },
  "wada:v1:44": { name: "Pinkish Cinnamon", hex: "#eeb480" },
  "wada:v1:45": { name: "Cinnamon Buff", hex: "#fdc57e" },
  "wada:v1:46": { name: "Cream Yellow", hex: "#fdbf68" },
  "wada:v1:47": { name: "Golden Yellow", hex: "#f3a257" },
  "wada:v1:48": { name: "Vinaceous Cinnamon", hex: "#eea78c" },
  "wada:v1:49": { name: "Ochraceous Salmon", hex: "#d8a37b" },
  "wada:v1:50": { name: "Isabella Color", hex: "#c5a56e" },
  "wada:v1:51": { name: "Maple", hex: "#c59f6b" },
  "wada:v1:52": { name: "Olive Buff", hex: "#c1c494" },
  "wada:v1:53": { name: "Ecru", hex: "#c2ae93" },
  "wada:v1:54": { name: "Yellow", hex: "#fff200" },
  "wada:v1:55": { name: "Lemon Yellow", hex: "#f8ed43" },
  "wada:v1:56": { name: "Apricot Yellow", hex: "#ffdd00" },
  "wada:v1:57": { name: "Pyrite Yellow", hex: "#cab356" },
  "wada:v1:58": { name: "Olive Ocher", hex: "#d6b43e" },
  "wada:v1:59": { name: "Yellow Ocher", hex: "#e2b540" },
  "wada:v1:60": { name: "Orange Yellow", hex: "#fcb315" },
  "wada:v1:61": { name: "Yellow Orange", hex: "#f99d1b" },
  "wada:v1:62": { name: "Apricot Orange", hex: "#f68c50" },
  "wada:v1:63": { name: "Orange", hex: "#f37420" },
  "wada:v1:64": { name: "Peach Red", hex: "#f15a30" },
  "wada:v1:65": { name: "English Red", hex: "#d96629" },
  "wada:v1:66": { name: "Cinnamon Rufous", hex: "#c27544" },
  "wada:v1:67": { name: "Orange Rufous", hex: "#c16b27" },
  "wada:v1:68": { name: "Sulphine Yellow", hex: "#c19f2c" },
  "wada:v1:69": { name: "Khaki", hex: "#bc892b" },
  "wada:v1:70": { name: "Citron Yellow", hex: "#b2b73e" },
  "wada:v1:71": { name: "Citrine", hex: "#b09f36" },
  "wada:v1:72": { name: "Buffy Citrine", hex: "#96874d" },
  "wada:v1:73": { name: "Dark Citrine", hex: "#8b835b" },
  "wada:v1:74": { name: "Light Grayish Olive", hex: "#848061" },
  "wada:v1:75": { name: "Krongbergs Green", hex: "#84875e" },
  "wada:v1:76": { name: "Olive", hex: "#837e31" },
  "wada:v1:77": { name: "Orange Citrine", hex: "#986f2d" },
  "wada:v1:78": { name: "Sudan Brown", hex: "#a36752" },
  "wada:v1:79": { name: "Olive Green", hex: "#6b7140" },
  "wada:v1:80": { name: "Light Brownish Olive", hex: "#806e4b" },
  "wada:v1:81": { name: "Deep Grayish Olive", hex: "#635a3a" },
  "wada:v1:82": { name: "Pale Raw Umber", hex: "#71502f" },
  "wada:v1:83": { name: "Sepia", hex: "#644b1e" },
  "wada:v1:84": { name: "Madder Brown", hex: "#762c19" },
  "wada:v1:85": { name: "Mars Brown Tobacco", hex: "#653514" },
  "wada:v1:86": { name: "Vandyke Brown", hex: "#4b3317" },
  "wada:v1:87": { name: "Turquoise Green", hex: "#b5decc" },
  "wada:v1:88": { name: "Glaucous Green", hex: "#b4cdc2" },
  "wada:v1:89": { name: "Dark Greenish Glaucous", hex: "#b7c2a9" },
  "wada:v1:90": { name: "Yellow Green", hex: "#afd472" },
  "wada:v1:91": { name: "Light Green Yellow", hex: "#c7d14f" },
  "wada:v1:92": { name: "Night Green", hex: "#87c540" },
  "wada:v1:93": { name: "Olive Yellow", hex: "#a6a159" },
  "wada:v1:94": { name: "Artemesia Green", hex: "#709390" },
  "wada:v1:95": { name: "Andover Green", hex: "#6d7e77" },
  "wada:v1:96": { name: "Rainette Green", hex: "#8fa071" },
  "wada:v1:97": { name: "Chromium Green", hex: "#719470" },
  "wada:v1:98": { name: "Pistachio Green", hex: "#648f7b" },
  "wada:v1:99": { name: "Sea Green", hex: "#00b49b" },
  "wada:v1:100": { name: "Benzol Green", hex: "#00978d" },
  "wada:v1:101": { name: "Light Porcelain Green", hex: "#00908a" },
  "wada:v1:102": { name: "Green", hex: "#489b6e" },
  "wada:v1:103": { name: "Dull Viridian Green", hex: "#009465" },
  "wada:v1:104": { name: "Oil Green", hex: "#819238" },
  "wada:v1:105": { name: "Diamine Green", hex: "#1a7444" },
  "wada:v1:106": { name: "Cossack Green", hex: "#437742" },
  "wada:v1:107": { name: "Lincoln Green", hex: "#555832" },
  "wada:v1:108": { name: "Blackish Olive", hex: "#42533e" },
  "wada:v1:109": { name: "Deep Slate Olive", hex: "#253122" },
  "wada:v1:110": { name: "Nile Blue", hex: "#bce4e5" },
  "wada:v1:111": { name: "Pale King's Blue", hex: "#a7d4e4" },
  "wada:v1:112": { name: "Light Glaucous Blue", hex: "#a5c8d1" },
  "wada:v1:113": { name: "Salvia Blue", hex: "#97acc8" },
  "wada:v1:114": { name: "Cobalt Green", hex: "#96d1aa" },
  "wada:v1:115": { name: "Calamine BLue", hex: "#78cdd0" },
  "wada:v1:116": { name: "Venice Green", hex: "#62c6bf" },
  "wada:v1:117": { name: "Cerulian Blue", hex: "#0093a5" },
  "wada:v1:118": { name: "Peacock Blue", hex: "#00939b" },
  "wada:v1:119": { name: "Green Blue", hex: "#099197" },
  "wada:v1:120": { name: "Olympic Blue", hex: "#5a82b3" },
  "wada:v1:121": { name: "Blue", hex: "#006eb8" },
  "wada:v1:122": { name: "Antwarp Blue", hex: "#007190" },
  "wada:v1:123": { name: "Helvetia Blue", hex: "#005b8d" },
  "wada:v1:124": { name: "Dark Medici Blue", hex: "#547076" },
  "wada:v1:125": { name: "Dusky Green", hex: "#004f46" },
  "wada:v1:126": { name: "Deep Lyons Blue", hex: "#1c4286" },
  "wada:v1:127": { name: "Violet Blue", hex: "#40456a" },
  "wada:v1:128": { name: "Vandar Poel's Blue", hex: "#064f6e" },
  "wada:v1:129": { name: "Dark Tyrian Blue", hex: "#12354e" },
  "wada:v1:130": { name: "Dull Violet Black", hex: "#1e0e3f" },
  "wada:v1:131": { name: "Deep Indigo", hex: "#051230" },
  "wada:v1:132": { name: "Deep Slate Green", hex: "#112f2c" },
  "wada:v1:133": { name: "Grayish Lavender - A", hex: "#b5b1d8" },
  "wada:v1:134": { name: "Grayish Lavender - B", hex: "#c0a9b3" },
  "wada:v1:135": { name: "Laelia Pink", hex: "#ca92a8" },
  "wada:v1:136": { name: "Lilac", hex: "#b984af" },
  "wada:v1:137": { name: "Eupatorium Purple", hex: "#bf5892" },
  "wada:v1:138": { name: "Light Mauve", hex: "#9a72aa" },
  "wada:v1:139": { name: "Aconite Violet", hex: "#a36aa5" },
  "wada:v1:140": { name: "Dull Blue Violet", hex: "#80719e" },
  "wada:v1:141": { name: "Dark Soft Violet", hex: "#66629c" },
  "wada:v1:142": { name: "Blue Violet", hex: "#6450a1" },
  "wada:v1:143": { name: "Purple Drab", hex: "#84565b" },
  "wada:v1:144": { name: "Deep Violet / Plumbeous", hex: "#70727c" },
  "wada:v1:145": { name: "Veronia Purple", hex: "#8c4c62" },
  "wada:v1:146": { name: "Dark Slate Purple", hex: "#704357" },
  "wada:v1:147": { name: "Taupe Brown", hex: "#7a4456" },
  "wada:v1:148": { name: "Violet Carmine", hex: "#713b4c" },
  "wada:v1:149": { name: "Violet", hex: "#4f4086" },
  "wada:v1:150": { name: "Red Violet", hex: "#59256a" },
  "wada:v1:151": { name: "Cotinga Purple", hex: "#501345" },
  "wada:v1:152": { name: "Dusky Madder Violet", hex: "#4e1d4c" },
  "wada:v1:153": { name: "White", hex: "#ffffff" },
  "wada:v1:154": { name: "Neutral Gray", hex: "#b6bfc1" },
  "wada:v1:155": { name: "Mineral Gray", hex: "#a2b0ad" },
  "wada:v1:156": { name: "Warm Gray", hex: "#a1a39a" },
  "wada:v1:157": { name: "Slate Color", hex: "#34454c" },
  "wada:v1:158": { name: "Black", hex: "#111314" }
};

var KNOWN_WADA_IDS = new Set(Object.keys(BY_ID));
var MAX_WADA_COLORS = 4;

/**
 * Normalize create/update body.wadaColorIds.
 * @returns {string[]}
 * @throws {Error} statusCode 400 invalid_wada_color | too_many_wada_colors
 */
function normalizeWadaColorIds(value) {
  if (value == null) {
    return null; // omitted — caller decides create vs partial update
  }
  if (!Array.isArray(value)) {
    var err = new Error("invalid_wada_color");
    err.statusCode = 400;
    throw err;
  }
  if (value.length > MAX_WADA_COLORS) {
    var tooMany = new Error("too_many_wada_colors");
    tooMany.statusCode = 400;
    throw tooMany;
  }
  var out = [];
  var seen = Object.create(null);
  for (var i = 0; i < value.length; i++) {
    var id = value[i] == null ? "" : String(value[i]);
    if (!KNOWN_WADA_IDS.has(id)) {
      var bad = new Error("invalid_wada_color");
      bad.statusCode = 400;
      throw bad;
    }
    if (seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out;
}

function resolveWadaColor(id) {
  return BY_ID[id] || null;
}

function wadaNamesForSearch(ids) {
  if (!ids || !ids.length) return "";
  var names = [];
  for (var i = 0; i < ids.length; i++) {
    var row = BY_ID[ids[i]];
    if (row && row.name) names.push(row.name);
  }
  return names.join(" ");
}

exports.KNOWN_WADA_IDS = KNOWN_WADA_IDS;
exports.MAX_WADA_COLORS = MAX_WADA_COLORS;
exports.BY_ID = BY_ID;
exports.normalizeWadaColorIds = normalizeWadaColorIds;
exports.resolveWadaColor = resolveWadaColor;
exports.wadaNamesForSearch = wadaNamesForSearch;
