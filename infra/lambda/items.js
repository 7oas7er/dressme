"use strict";

var crypto = require("crypto");
var { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
var {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
var {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
var { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
var attributeOptions = require("./attributeOptions");
var attrNormalize = require("./attrNormalize");
var cutouts = require("./cutouts");
var thumbs = require("./thumbs");
var wadaPalette = require("./wadaPalette");

var ATTR_KEYS = [
  "type",
  "fabric",
  "brandModel",
  "formality",
  "pattern",
  "season",
  "outfitRole",
];

/**
 * Option D spike: stop generating / backfilling cutouts.
 * Existing *.cutout.webp + Dynamo cutoutKey values are left in place (no delete).
 * SPA prefers originals/thumbs; may revisit cutouts later for AI categorization.
 */
var CUTOUTS_ENABLED = false;

var MAX_PHOTOS = 8;
/** Durable free-text context for later Bedrock text suggest (UC-25). */
var MAX_AI_CONTEXT = 2000;
var PRESIGN_PUT_SECONDS = 900;
var PRESIGN_GET_SECONDS = 3600;

var deps = {
  doc: null,
  s3: null,
  sign: getSignedUrl,
  makeThumb: thumbs.makeThumbWithSharp,
  makeCutout: cutouts.makeCutoutWithSharp,
};

function resetDepsForTests(next) {
  deps.doc = next && next.doc ? next.doc : null;
  deps.s3 = next && next.s3 ? next.s3 : null;
  deps.sign = next && next.sign ? next.sign : getSignedUrl;
  deps.makeThumb =
    next && next.makeThumb ? next.makeThumb : thumbs.makeThumbWithSharp;
  deps.makeCutout =
    next && next.makeCutout ? next.makeCutout : cutouts.makeCutoutWithSharp;
  attributeOptions.resetDepsForTests(next);
}

function docClient() {
  if (!deps.doc) {
    deps.doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return deps.doc;
}

function s3Client() {
  if (!deps.s3) {
    deps.s3 = new S3Client({});
  }
  return deps.s3;
}

function tableName() {
  var name = process.env.ITEMS_TABLE;
  if (!name) {
    throw Object.assign(new Error("items_table_not_configured"), { statusCode: 500 });
  }
  return name;
}

function mediaBucket() {
  var name = process.env.MEDIA_BUCKET;
  if (!name) {
    throw Object.assign(new Error("media_bucket_not_configured"), { statusCode: 500 });
  }
  return name;
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function pkForUser(userId) {
  return "USER#" + userId;
}

function skForItem(itemId) {
  return "ITEM#" + itemId;
}

/**
 * Phase 1 hygiene: rules 1–4 + silent fold rewrite to seed/custom spelling.
 * brandModel also auto-applies Levenshtein-1 / approved aliases; other fields
 * keep typo matches as SPA chips only.
 */
async function normalizeAttributes(user, input, partial) {
  var src = input || {};
  var catalog = { options: {}, custom: {} };
  try {
    catalog = await attributeOptions.getOptionsForUser(user.sub);
  } catch (_err) {
    // Still apply deterministic normalize without option fold-match.
  }
  var out = {};
  for (var i = 0; i < ATTR_KEYS.length; i++) {
    var key = ATTR_KEYS[i];
    if (partial && !Object.prototype.hasOwnProperty.call(src, key)) {
      continue;
    }
    if (src[key] == null || String(src[key]).trim() === "") {
      out[key] = partial ? undefined : "";
    } else {
      out[key] = attrNormalize.canonicalizeAttrValue(
        src[key],
        (catalog.options && catalog.options[key]) || [],
        (catalog.custom && catalog.custom[key]) || [],
        key
      );
    }
    if (out[key] === undefined) {
      delete out[key];
    }
  }
  if (!partial) {
    for (var j = 0; j < ATTR_KEYS.length; j++) {
      if (!out[ATTR_KEYS[j]]) {
        throw Object.assign(new Error("missing_attribute:" + ATTR_KEYS[j]), { statusCode: 400 });
      }
    }
  }
  return out;
}

function normalizeAiContext(value) {
  if (value == null) return "";
  return String(value).trim().slice(0, MAX_AI_CONTEXT);
}

function applyAiContext(target, body, partial) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "aiContext")) {
    if (!partial) {
      // Create without aiContext: leave unset.
      return target;
    }
    return target;
  }
  var text = normalizeAiContext(body.aiContext);
  if (text) {
    target.aiContext = text;
  } else {
    delete target.aiContext;
  }
  return target;
}

/**
 * Apply optional wadaColorIds from create/update body.
 * Create: omitted → []; Update: omitted → leave existing; [] clears.
 */
function applyWadaColorIds(target, body, partial) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, "wadaColorIds")) {
    if (!partial) {
      target.wadaColorIds = [];
    }
    return target;
  }
  var ids = wadaPalette.normalizeWadaColorIds(body.wadaColorIds);
  target.wadaColorIds = ids || [];
  return target;
}

function buildSearchText(item) {
  return ATTR_KEYS.map(function (key) {
    return item[key] || "";
  })
    .concat([
      item.aiContext || "",
      wadaPalette.wadaNamesForSearch(item.wadaColorIds),
      item.itemId || "",
    ])
    .join(" ")
    .toLowerCase();
}

function publicItem(item, photoUrls, thumbUrls, cutoutUrls) {
  var out = {
    itemId: item.itemId,
    type: item.type,
    fabric: item.fabric,
    brandModel: item.brandModel,
    formality: item.formality,
    pattern: item.pattern,
    season: item.season,
    outfitRole: item.outfitRole,
    wadaColorIds: Array.isArray(item.wadaColorIds) ? item.wadaColorIds.slice() : [],
    photos: (item.photos || []).map(function (photo) {
      var row = {
        photoId: photo.photoId,
        contentType: photo.contentType,
        status: photo.status,
      };
      if (photoUrls && photoUrls[photo.photoId]) {
        row.url = photoUrls[photo.photoId];
      }
      if (thumbUrls && thumbUrls[photo.photoId]) {
        row.thumbUrl = thumbUrls[photo.photoId];
      }
      if (cutoutUrls && cutoutUrls[photo.photoId]) {
        row.cutoutUrl = cutoutUrls[photo.photoId];
      }
      return row;
    }),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  if (item.aiContext) {
    out.aiContext = item.aiContext;
  }
  return out;
}

async function signKey(key) {
  return deps.sign(
    s3Client(),
    new GetObjectCommand({
      Bucket: mediaBucket(),
      Key: key,
    }),
    { expiresIn: PRESIGN_GET_SECONDS }
  );
}

async function signedFullUrls(item) {
  var urls = {};
  var photos = item.photos || [];
  for (var i = 0; i < photos.length; i++) {
    var photo = photos[i];
    if (photo.status !== "ready" || !photo.key) {
      continue;
    }
    urls[photo.photoId] = await signKey(photo.key);
  }
  return urls;
}

async function signedThumbUrls(item) {
  var urls = {};
  var photos = item.photos || [];
  for (var i = 0; i < photos.length; i++) {
    var photo = photos[i];
    if (photo.status !== "ready" || !photo.key) {
      continue;
    }
    var key = photo.thumbKey || photo.key;
    urls[photo.photoId] = await signKey(key);
  }
  return urls;
}

async function signedCutoutUrls(item) {
  var urls = {};
  var photos = item.photos || [];
  for (var i = 0; i < photos.length; i++) {
    var photo = photos[i];
    if (photo.status !== "ready" || !photo.cutoutKey) {
      continue;
    }
    urls[photo.photoId] = await signKey(photo.cutoutKey);
  }
  return urls;
}

async function deleteMediaKey(key) {
  if (!key) return;
  try {
    await s3Client().send(
      new DeleteObjectCommand({ Bucket: mediaBucket(), Key: key })
    );
  } catch (_err) {
    // Best-effort media cleanup; metadata remains authoritative.
  }
}

async function loadPhotoBuffer(photo) {
  var obj = await s3Client().send(
    new GetObjectCommand({
      Bucket: mediaBucket(),
      Key: photo.key,
    })
  );
  return thumbs.streamToBuffer(obj.Body);
}

async function ensureThumbForPhoto(photo, cachedBuffer) {
  if (!photo || photo.status !== "ready" || !photo.key) {
    return photo;
  }
  if (photo.thumbKey) {
    return photo;
  }
  try {
    var input = cachedBuffer || (await loadPhotoBuffer(photo));
    var thumbBuf = await deps.makeThumb(input);
    var thumbKey = thumbs.thumbKeyFor(photo.key);
    await s3Client().send(
      new PutObjectCommand({
        Bucket: mediaBucket(),
        Key: thumbKey,
        Body: thumbBuf,
        ContentType: thumbs.THUMB_CONTENT_TYPE,
      })
    );
    return Object.assign({}, photo, { thumbKey: thumbKey });
  } catch (err) {
    console.error(
      "thumb_failed",
      photo.photoId,
      err && err.message ? err.message : err
    );
    return photo;
  }
}

async function ensureCutoutForPhoto(photo, cachedBuffer, options) {
  if (!CUTOUTS_ENABLED) {
    return photo;
  }
  if (!photo || photo.status !== "ready" || !photo.key) {
    return photo;
  }
  var opts = options || {};
  var force = Boolean(opts.force);
  var currentVersion = photo.cutoutVersion || 0;
  var needs =
    force ||
    !photo.cutoutKey ||
    currentVersion !== cutouts.CUTOUT_VERSION;
  if (!needs) {
    return photo;
  }
  try {
    var input = cachedBuffer || (await loadPhotoBuffer(photo));
    var cutoutBuf = await deps.makeCutout(input);
    var cutoutKey = cutouts.cutoutKeyFor(photo.key);
    await s3Client().send(
      new PutObjectCommand({
        Bucket: mediaBucket(),
        Key: cutoutKey,
        Body: cutoutBuf,
        ContentType: cutouts.CUTOUT_CONTENT_TYPE,
      })
    );
    return Object.assign({}, photo, {
      cutoutKey: cutoutKey,
      cutoutVersion: cutouts.CUTOUT_VERSION,
    });
  } catch (err) {
    // Never block item save / confirm on matting failure (design §4a).
    console.error(
      "cutout_failed",
      photo.photoId,
      err && err.message ? err.message : err
    );
    return photo;
  }
}

function photoNeedsCutout(photo, force) {
  if (!CUTOUTS_ENABLED) return false;
  if (!photo || photo.status !== "ready" || !photo.key) return false;
  if (force) return true;
  if (!photo.cutoutKey) return true;
  return (photo.cutoutVersion || 0) !== cutouts.CUTOUT_VERSION;
}

async function ensureDerivativesForPhotos(photos, options) {
  var opts = options || {};
  var forceCutouts = Boolean(opts.forceCutouts);
  var out = [];
  for (var i = 0; i < (photos || []).length; i++) {
    var photo = photos[i];
    if (!photo || photo.status !== "ready" || !photo.key) {
      out.push(photo);
      continue;
    }
    var cached = null;
    var needsCutout = photoNeedsCutout(photo, forceCutouts);
    if (!photo.thumbKey || needsCutout) {
      try {
        cached = await loadPhotoBuffer(photo);
      } catch (err) {
        console.error(
          "photo_load_failed",
          photo.photoId,
          err && err.message ? err.message : err
        );
        out.push(photo);
        continue;
      }
    }
    var withThumb = await ensureThumbForPhoto(photo, cached);
    var withCutout = await ensureCutoutForPhoto(withThumb, cached, {
      force: forceCutouts,
    });
    out.push(withCutout);
  }
  return out;
}

async function getItemRecord(userId, itemId) {
  var result = await docClient().send(
    new GetCommand({
      TableName: tableName(),
      Key: { pk: pkForUser(userId), sk: skForItem(itemId) },
    })
  );
  return result.Item || null;
}

async function listItemRecords(userId) {
  var result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": pkForUser(userId),
        ":sk": "ITEM#",
      },
    })
  );
  return result.Items || [];
}

async function listItems(user, query) {
  var rows = await listItemRecords(user.sub);
  var q = (query.q || query.search || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(function (item) {
      return (item.searchText || buildSearchText(item)).includes(q);
    });
  }
  rows.sort(function (a, b) {
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });

  var out = [];
  for (var i = 0; i < rows.length; i++) {
    // Overview: thumbs + cutouts when present (full-res still on get/edit).
    var thumbUrls = await signedThumbUrls(rows[i]);
    var cutoutUrls = await signedCutoutUrls(rows[i]);
    out.push(publicItem(rows[i], null, thumbUrls, cutoutUrls));
  }
  return { statusCode: 200, body: { items: out } };
}

async function getItem(user, itemId) {
  var item = await getItemRecord(user.sub, itemId);
  if (!item) {
    return { statusCode: 404, body: { error: "not_found" } };
  }
  var urls = await signedFullUrls(item);
  var thumbUrls = await signedThumbUrls(item);
  var cutoutUrls = await signedCutoutUrls(item);
  return {
    statusCode: 200,
    body: { item: publicItem(item, urls, thumbUrls, cutoutUrls) },
  };
}

function photoKey(userId, itemId, photoId, contentType) {
  var ext = "bin";
  if (contentType === "image/jpeg") ext = "jpg";
  else if (contentType === "image/png") ext = "png";
  else if (contentType === "image/webp") ext = "webp";
  else if (contentType === "image/heic") ext = "heic";
  return "users/" + userId + "/items/" + itemId + "/" + photoId + "." + ext;
}

function normalizeContentType(value) {
  var ct = String(value || "image/jpeg").toLowerCase();
  if (
    ct === "image/jpeg" ||
    ct === "image/png" ||
    ct === "image/webp" ||
    ct === "image/heic"
  ) {
    return ct;
  }
  throw Object.assign(new Error("unsupported_content_type"), { statusCode: 400 });
}

async function buildUploadSlots(userId, itemId, photoSpecs) {
  var uploads = [];
  var photos = [];
  for (var i = 0; i < photoSpecs.length; i++) {
    var spec = photoSpecs[i] || {};
    var photoId = newId();
    var contentType = normalizeContentType(spec.contentType);
    var key = photoKey(userId, itemId, photoId, contentType);
    var uploadUrl = await deps.sign(
      s3Client(),
      new PutObjectCommand({
        Bucket: mediaBucket(),
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: PRESIGN_PUT_SECONDS }
    );
    photos.push({
      photoId: photoId,
      key: key,
      contentType: contentType,
      status: "pending",
    });
    uploads.push({
      photoId: photoId,
      uploadUrl: uploadUrl,
      contentType: contentType,
    });
  }
  return { photos: photos, uploads: uploads };
}

async function createItem(user, body) {
  var attrs = await normalizeAttributes(user, body, false);
  var photoSpecs = Array.isArray(body.photos) ? body.photos : [];
  if (photoSpecs.length > MAX_PHOTOS) {
    throw Object.assign(new Error("too_many_photos"), { statusCode: 400 });
  }

  var itemId = newId();
  var ts = nowIso();
  var slot = await buildUploadSlots(user.sub, itemId, photoSpecs);
  var item = Object.assign({}, attrs, {
    pk: pkForUser(user.sub),
    sk: skForItem(itemId),
    itemId: itemId,
    userId: user.sub,
    photos: slot.photos,
    createdAt: ts,
    updatedAt: ts,
  });
  applyAiContext(item, body, false);
  applyWadaColorIds(item, body, false);
  // Legacy free-text color dropped — never persist or return it.
  delete item.color;
  item.searchText = buildSearchText(item);

  await docClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: item,
      ConditionExpression: "attribute_not_exists(pk)",
    })
  );

  // UC-19: remember free-text attribute values that are not seed suggestions.
  await attributeOptions.rememberCustomValues(user, attrs);

  return {
    statusCode: 201,
    body: {
      item: publicItem(item, {}),
      uploads: slot.uploads,
    },
  };
}

async function updateItem(user, itemId, body) {
  var existing = await getItemRecord(user.sub, itemId);
  if (!existing) {
    return { statusCode: 404, body: { error: "not_found" } };
  }

  var attrs = await normalizeAttributes(user, body, true);
  var next = Object.assign({}, existing, attrs, { updatedAt: nowIso() });
  applyAiContext(next, body, true);
  applyWadaColorIds(next, body, true);
  var uploads = [];

  // Removals first so a single PUT can drop photos and request new upload slots.
  // When the same request also addPhotos, rebuild in place so replacements keep
  // the removed indices (order-preserving remove+add; UC-18 rotate uses replacePhotos).
  var originalPhotos = next.photos || [];
  var removePhotoIds = Array.isArray(body.removePhotoIds) ? body.removePhotoIds : [];
  var removeSet = {};
  for (var ri = 0; ri < removePhotoIds.length; ri++) {
    removeSet[String(removePhotoIds[ri])] = true;
  }
  var keep = [];
  var removed = [];
  if (removePhotoIds.length) {
    for (var i = 0; i < originalPhotos.length; i++) {
      var photo = originalPhotos[i];
      if (removeSet[String(photo.photoId)]) {
        removed.push(photo);
      } else {
        keep.push(photo);
      }
    }
    next.photos = keep;
    for (var r = 0; r < removed.length; r++) {
      await deleteMediaKey(removed[r].key);
      await deleteMediaKey(removed[r].thumbKey);
      await deleteMediaKey(removed[r].cutoutKey);
    }
  }

  // UC-18 rotate: same photoId rewrite — pending slot + presign PUT overwrite;
  // photos/complete regenerates thumb (thumbKey cleared below).
  var replacePhotos = Array.isArray(body.replacePhotos) ? body.replacePhotos : [];
  if (replacePhotos.length) {
    var photosNow = (next.photos || []).slice();
    for (var rp = 0; rp < replacePhotos.length; rp++) {
      var spec = replacePhotos[rp] || {};
      var replaceId = spec.photoId != null ? String(spec.photoId) : "";
      if (!replaceId) {
        throw Object.assign(new Error("photo_id_required"), { statusCode: 400 });
      }
      if (removeSet[replaceId]) {
        throw Object.assign(new Error("photo_replaced_and_removed"), {
          statusCode: 400,
        });
      }
      var replaceIndex = -1;
      for (var pi = 0; pi < photosNow.length; pi++) {
        if (String(photosNow[pi].photoId) === replaceId) {
          replaceIndex = pi;
          break;
        }
      }
      if (replaceIndex < 0) {
        return { statusCode: 404, body: { error: "photo_not_found" } };
      }
      var existingPhoto = photosNow[replaceIndex];
      var contentType = normalizeContentType(spec.contentType || "image/jpeg");
      var newKey = photoKey(user.sub, itemId, replaceId, contentType);
      if (existingPhoto.key && existingPhoto.key !== newKey) {
        await deleteMediaKey(existingPhoto.key);
      }
      await deleteMediaKey(existingPhoto.thumbKey);
      await deleteMediaKey(existingPhoto.cutoutKey);
      var uploadUrl = await deps.sign(
        s3Client(),
        new PutObjectCommand({
          Bucket: mediaBucket(),
          Key: newKey,
          ContentType: contentType,
        }),
        { expiresIn: PRESIGN_PUT_SECONDS }
      );
      photosNow[replaceIndex] = {
        photoId: replaceId,
        key: newKey,
        contentType: contentType,
        status: "pending",
      };
      uploads.push({
        photoId: replaceId,
        uploadUrl: uploadUrl,
        contentType: contentType,
      });
    }
    next.photos = photosNow;
  }

  var addPhotos = Array.isArray(body.addPhotos) ? body.addPhotos : [];
  if (addPhotos.length) {
    var currentCount = (next.photos || []).length;
    if (currentCount + addPhotos.length > MAX_PHOTOS) {
      throw Object.assign(new Error("too_many_photos"), { statusCode: 400 });
    }
    var slot = await buildUploadSlots(user.sub, itemId, addPhotos);
    uploads = uploads.concat(slot.uploads);
    if (removed.length > 0) {
      var rebuilt = [];
      var addCursor = 0;
      for (var oi = 0; oi < originalPhotos.length; oi++) {
        if (removeSet[String(originalPhotos[oi].photoId)]) {
          if (addCursor < slot.photos.length) {
            rebuilt.push(slot.photos[addCursor++]);
          }
          // Extra removals without a matching add are dropped (omit slot).
        } else {
          // Prefer post-replace photos when present (same photoId, updated slot).
          var keptId = String(originalPhotos[oi].photoId);
          var fromNext = null;
          for (var ni = 0; ni < (next.photos || []).length; ni++) {
            if (String(next.photos[ni].photoId) === keptId) {
              fromNext = next.photos[ni];
              break;
            }
          }
          rebuilt.push(fromNext || originalPhotos[oi]);
        }
      }
      while (addCursor < slot.photos.length) {
        rebuilt.push(slot.photos[addCursor++]);
      }
      next.photos = rebuilt;
    } else {
      next.photos = (next.photos || []).concat(slot.photos);
    }
  }

  // UC-18 designate catalog photo: move primaryPhotoId to index 0 (last so
  // remove/replace/add can run in the same PUT). Relative order of others kept.
  if (
    body.primaryPhotoId != null &&
    String(body.primaryPhotoId).length > 0
  ) {
    var primaryId = String(body.primaryPhotoId);
    var photosForPrimary = (next.photos || []).slice();
    var primaryIndex = -1;
    for (var pri = 0; pri < photosForPrimary.length; pri++) {
      if (String(photosForPrimary[pri].photoId) === primaryId) {
        primaryIndex = pri;
        break;
      }
    }
    if (primaryIndex < 0) {
      return { statusCode: 400, body: { error: "photo_not_found" } };
    }
    if (primaryIndex > 0) {
      var primaryPhoto = photosForPrimary.splice(primaryIndex, 1)[0];
      photosForPrimary.unshift(primaryPhoto);
      next.photos = photosForPrimary;
    }
  }

  // Strip legacy free-text color on write (ignore leftovers on read).
  delete next.color;
  next.searchText = buildSearchText(next);
  await docClient().send(new PutCommand({ TableName: tableName(), Item: next }));

  if (Object.keys(attrs).length) {
    await attributeOptions.rememberCustomValues(user, attrs);
  }

  var responseBody = {
    item: publicItem(
      next,
      await signedFullUrls(next),
      await signedThumbUrls(next),
      await signedCutoutUrls(next)
    ),
  };
  if (uploads.length) {
    responseBody.uploads = uploads;
  }
  return {
    statusCode: 200,
    body: responseBody,
  };
}

async function confirmPhotos(user, itemId, body) {
  var existing = await getItemRecord(user.sub, itemId);
  if (!existing) {
    return { statusCode: 404, body: { error: "not_found" } };
  }
  var readyIds = Array.isArray(body.photoIds) ? body.photoIds : [];
  if (!readyIds.length) {
    throw Object.assign(new Error("photo_ids_required"), { statusCode: 400 });
  }
  var photos = (existing.photos || []).map(function (photo) {
    if (readyIds.indexOf(photo.photoId) >= 0) {
      return Object.assign({}, photo, { status: "ready" });
    }
    return photo;
  });
  // UC-20 thumbs for newly ready photos. Cutout generation stopped (Option D).
  photos = await ensureDerivativesForPhotos(photos);
  var next = Object.assign({}, existing, {
    photos: photos,
    updatedAt: nowIso(),
  });
  delete next.color;
  next.searchText = buildSearchText(next);
  await docClient().send(new PutCommand({ TableName: tableName(), Item: next }));
  return {
    statusCode: 200,
    body: {
      item: publicItem(
        next,
        await signedFullUrls(next),
        await signedThumbUrls(next),
        await signedCutoutUrls(next)
      ),
    },
  };
}

async function backfillDerivative(user, kind, options) {
  var opts = options || {};
  var force = Boolean(opts.force);
  var wantThumb = kind === "thumbs" || kind === "both";
  var wantCutout = kind === "cutouts" || kind === "both";
  var result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": pkForUser(user.sub),
        ":sk": "ITEM#",
      },
    })
  );
  var rows = result.Items || [];
  var processed = 0;
  var skipped = 0;
  var failed = 0;
  var updatedItems = 0;

  for (var i = 0; i < rows.length; i++) {
    var item = rows[i];
    var photos = item.photos || [];
    var changed = false;
    var nextPhotos = [];
    for (var p = 0; p < photos.length; p++) {
      var photo = photos[p];
      if (photo.status !== "ready" || !photo.key) {
        nextPhotos.push(photo);
        skipped += 1;
        continue;
      }

      var needsThumb = wantThumb && !photo.thumbKey;
      var needsCutout = wantCutout && photoNeedsCutout(photo, force);
      if (!needsThumb && !needsCutout) {
        nextPhotos.push(photo);
        skipped += 1;
        continue;
      }

      var cached = null;
      try {
        cached = await loadPhotoBuffer(photo);
      } catch (err) {
        console.error(
          "photo_load_failed",
          photo.photoId,
          err && err.message ? err.message : err
        );
        failed += 1;
        nextPhotos.push(photo);
        continue;
      }

      var nextPhoto = photo;
      var madeProgress = false;
      var hadFailure = false;

      if (needsThumb) {
        var withThumb = await ensureThumbForPhoto(nextPhoto, cached);
        if (withThumb.thumbKey && withThumb.thumbKey !== photo.thumbKey) {
          nextPhoto = withThumb;
          madeProgress = true;
        } else if (!withThumb.thumbKey) {
          hadFailure = true;
        }
      }

      if (needsCutout) {
        var prevKey = photo.cutoutKey || null;
        var prevVersion = photo.cutoutVersion || 0;
        var withCutout = await ensureCutoutForPhoto(nextPhoto, cached, {
          force: force || prevVersion !== cutouts.CUTOUT_VERSION,
        });
        if (!withCutout.cutoutKey) {
          hadFailure = true;
        } else if (
          force ||
          withCutout.cutoutKey !== prevKey ||
          (withCutout.cutoutVersion || 0) !== prevVersion
        ) {
          // Force regenerates in place (same key); still count as processed.
          nextPhoto = withCutout;
          madeProgress = true;
        }
      }

      if (madeProgress) {
        processed += 1;
        changed = true;
        nextPhotos.push(nextPhoto);
      } else if (hadFailure) {
        failed += 1;
        nextPhotos.push(photo);
      } else {
        skipped += 1;
        nextPhotos.push(nextPhoto);
      }
    }
    if (changed) {
      var next = Object.assign({}, item, {
        photos: nextPhotos,
        updatedAt: nowIso(),
      });
      delete next.color;
      next.searchText = buildSearchText(next);
      await docClient().send(new PutCommand({ TableName: tableName(), Item: next }));
      updatedItems += 1;
    }
  }

  return {
    statusCode: 200,
    body: {
      processed: processed,
      skipped: skipped,
      failed: failed,
      updatedItems: updatedItems,
      cutoutVersion: cutouts.CUTOUT_VERSION,
    },
  };
}

async function backfillThumbs(user) {
  return backfillDerivative(user, "thumbs");
}

async function backfillCutouts(user, body) {
  if (!CUTOUTS_ENABLED) {
    // Noop: leave existing keys; SPA no longer auto-calls this.
    return {
      statusCode: 200,
      body: {
        processed: 0,
        skipped: 0,
        failed: 0,
        updatedItems: 0,
        cutoutVersion: cutouts.CUTOUT_VERSION,
        disabled: true,
      },
    };
  }
  var force = Boolean(body && (body.force || body.upgrade));
  return backfillDerivative(user, "cutouts", { force: force });
}

async function deleteItem(user, itemId) {
  var existing = await getItemRecord(user.sub, itemId);
  if (!existing) {
    return { statusCode: 404, body: { error: "not_found" } };
  }
  for (var i = 0; i < (existing.photos || []).length; i++) {
    var photo = existing.photos[i];
    await deleteMediaKey(photo.key);
    await deleteMediaKey(photo.thumbKey);
    await deleteMediaKey(photo.cutoutKey);
  }
  await docClient().send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { pk: pkForUser(user.sub), sk: skForItem(itemId) },
    })
  );
  return { statusCode: 204, body: {} };
}

exports.listItems = listItems;
exports.listItemRecords = listItemRecords;
exports.getItemRecord = getItemRecord;
exports.getItem = getItem;
exports.createItem = createItem;
exports.updateItem = updateItem;
exports.confirmPhotos = confirmPhotos;
exports.backfillThumbs = backfillThumbs;
exports.backfillCutouts = backfillCutouts;
exports.deleteItem = deleteItem;
exports.publicItem = publicItem;
exports.signedFullUrls = signedFullUrls;
exports.signedThumbUrls = signedThumbUrls;
exports.signedCutoutUrls = signedCutoutUrls;
exports.loadPhotoBuffer = loadPhotoBuffer;
exports.ATTR_KEYS = ATTR_KEYS;
exports.MAX_AI_CONTEXT = MAX_AI_CONTEXT;
exports.CUTOUTS_ENABLED = CUTOUTS_ENABLED;
exports.resetDepsForTests = resetDepsForTests;
