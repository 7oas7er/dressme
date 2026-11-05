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
var thumbs = require("./thumbs");

var ATTR_KEYS = [
  "type",
  "color",
  "fabric",
  "brandModel",
  "formality",
  "pattern",
  "season",
  "outfitRole",
];

var MAX_PHOTOS = 8;
var MAX_ATTR_LEN = 120;
var PRESIGN_PUT_SECONDS = 900;
var PRESIGN_GET_SECONDS = 3600;

var deps = {
  doc: null,
  s3: null,
  sign: getSignedUrl,
  makeThumb: thumbs.makeThumbWithSharp,
};

function resetDepsForTests(next) {
  deps.doc = next && next.doc ? next.doc : null;
  deps.s3 = next && next.s3 ? next.s3 : null;
  deps.sign = next && next.sign ? next.sign : getSignedUrl;
  deps.makeThumb =
    next && next.makeThumb ? next.makeThumb : thumbs.makeThumbWithSharp;
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

function clampString(value, fallback) {
  if (value == null) {
    return fallback;
  }
  var text = String(value).trim();
  if (!text) {
    return fallback;
  }
  return text.slice(0, MAX_ATTR_LEN);
}

function normalizeAttributes(input, partial) {
  var src = input || {};
  var out = {};
  for (var i = 0; i < ATTR_KEYS.length; i++) {
    var key = ATTR_KEYS[i];
    if (partial && !Object.prototype.hasOwnProperty.call(src, key)) {
      continue;
    }
    out[key] = clampString(src[key], partial ? undefined : "");
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

function buildSearchText(item) {
  return ATTR_KEYS.map(function (key) {
    return item[key] || "";
  })
    .concat([item.itemId || ""])
    .join(" ")
    .toLowerCase();
}

function publicItem(item, photoUrls, thumbUrls) {
  return {
    itemId: item.itemId,
    type: item.type,
    color: item.color,
    fabric: item.fabric,
    brandModel: item.brandModel,
    formality: item.formality,
    pattern: item.pattern,
    season: item.season,
    outfitRole: item.outfitRole,
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
      return row;
    }),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
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

async function ensureThumbForPhoto(photo) {
  if (!photo || photo.status !== "ready" || !photo.key) {
    return photo;
  }
  if (photo.thumbKey) {
    return photo;
  }
  try {
    var obj = await s3Client().send(
      new GetObjectCommand({
        Bucket: mediaBucket(),
        Key: photo.key,
      })
    );
    var input = await thumbs.streamToBuffer(obj.Body);
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

async function ensureThumbsForPhotos(photos) {
  var out = [];
  for (var i = 0; i < (photos || []).length; i++) {
    out.push(await ensureThumbForPhoto(photos[i]));
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
    // Overview cards use thumb URLs (full-res still available on get/edit).
    var thumbUrls = await signedThumbUrls(rows[i]);
    out.push(publicItem(rows[i], null, thumbUrls));
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
  return { statusCode: 200, body: { item: publicItem(item, urls, thumbUrls) } };
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
  var attrs = normalizeAttributes(body, false);
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

  var attrs = normalizeAttributes(body, true);
  var next = Object.assign({}, existing, attrs, { updatedAt: nowIso() });
  var uploads = [];

  // Removals first so a single PUT can drop photos and request new upload slots.
  var removePhotoIds = Array.isArray(body.removePhotoIds) ? body.removePhotoIds : [];
  if (removePhotoIds.length) {
    var keep = [];
    var removed = [];
    for (var i = 0; i < (next.photos || []).length; i++) {
      var photo = next.photos[i];
      if (removePhotoIds.indexOf(photo.photoId) >= 0) {
        removed.push(photo);
      } else {
        keep.push(photo);
      }
    }
    next.photos = keep;
    for (var r = 0; r < removed.length; r++) {
      await deleteMediaKey(removed[r].key);
      await deleteMediaKey(removed[r].thumbKey);
    }
  }

  var addPhotos = Array.isArray(body.addPhotos) ? body.addPhotos : [];
  if (addPhotos.length) {
    var currentCount = (next.photos || []).length;
    if (currentCount + addPhotos.length > MAX_PHOTOS) {
      throw Object.assign(new Error("too_many_photos"), { statusCode: 400 });
    }
    var slot = await buildUploadSlots(user.sub, itemId, addPhotos);
    next.photos = (next.photos || []).concat(slot.photos);
    uploads = slot.uploads;
  }

  next.searchText = buildSearchText(next);
  await docClient().send(new PutCommand({ TableName: tableName(), Item: next }));

  if (Object.keys(attrs).length) {
    await attributeOptions.rememberCustomValues(user, attrs);
  }

  var responseBody = {
    item: publicItem(next, await signedFullUrls(next), await signedThumbUrls(next)),
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
  // UC-20: generate overview thumbnails for newly ready photos.
  photos = await ensureThumbsForPhotos(photos);
  var next = Object.assign({}, existing, {
    photos: photos,
    updatedAt: nowIso(),
  });
  next.searchText = buildSearchText(next);
  await docClient().send(new PutCommand({ TableName: tableName(), Item: next }));
  return {
    statusCode: 200,
    body: {
      item: publicItem(next, await signedFullUrls(next), await signedThumbUrls(next)),
    },
  };
}

async function backfillThumbs(user) {
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
      if (photo.thumbKey) {
        nextPhotos.push(photo);
        skipped += 1;
        continue;
      }
      var withThumb = await ensureThumbForPhoto(photo);
      if (withThumb.thumbKey && withThumb.thumbKey !== photo.thumbKey) {
        processed += 1;
        changed = true;
        nextPhotos.push(withThumb);
      } else if (!withThumb.thumbKey) {
        failed += 1;
        nextPhotos.push(photo);
      } else {
        skipped += 1;
        nextPhotos.push(withThumb);
      }
    }
    if (changed) {
      var next = Object.assign({}, item, {
        photos: nextPhotos,
        updatedAt: nowIso(),
      });
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
    },
  };
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
exports.getItem = getItem;
exports.createItem = createItem;
exports.updateItem = updateItem;
exports.confirmPhotos = confirmPhotos;
exports.backfillThumbs = backfillThumbs;
exports.deleteItem = deleteItem;
exports.publicItem = publicItem;
exports.signedFullUrls = signedFullUrls;
exports.signedThumbUrls = signedThumbUrls;
exports.ATTR_KEYS = ATTR_KEYS;
exports.resetDepsForTests = resetDepsForTests;
