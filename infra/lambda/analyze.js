"use strict";

/**
 * Add-time catalog assist (UC-25 / DM-43).
 * One Bedrock multimodal Converse call → proposed attrs + aiContext.
 * Never writes Dynamo — Frank confirms on the SPA before save.
 */

var {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");
var items = require("./items");
var attributeOptions = require("./attributeOptions");

var ATTR_KEYS = items.ATTR_KEYS;
var MAX_HINTS = 500;
var MAX_ANSWERS = 800;
var MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
var DEFAULT_MODEL_ID =
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

var deps = {
  bedrock: null,
  converse: null,
};

function resetDepsForTests(next) {
  deps.bedrock = next && next.bedrock ? next.bedrock : null;
  deps.converse = next && typeof next.converse === "function" ? next.converse : null;
}

function bedrockClient() {
  if (!deps.bedrock) {
    deps.bedrock = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION || process.env.AWS_REGION || "eu-north-1",
    });
  }
  return deps.bedrock;
}

function modelId() {
  return (
    String(process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID).trim() ||
    DEFAULT_MODEL_ID
  );
}

function clampText(value, max) {
  if (value == null) return "";
  return String(value).trim().slice(0, max || MAX_HINTS);
}

function emptyAttrs() {
  var out = {};
  for (var i = 0; i < ATTR_KEYS.length; i++) {
    out[ATTR_KEYS[i]] = "";
  }
  return out;
}

function sanitizeAttrs(raw) {
  var src = raw && typeof raw === "object" ? raw : {};
  var out = emptyAttrs();
  for (var i = 0; i < ATTR_KEYS.length; i++) {
    var key = ATTR_KEYS[i];
    if (src[key] == null) continue;
    out[key] = String(src[key]).trim().slice(0, 120);
  }
  return out;
}

function seedVocabulary() {
  var seeds = attributeOptions.SEED_OPTIONS || {};
  var lines = [];
  for (var i = 0; i < ATTR_KEYS.length; i++) {
    var key = ATTR_KEYS[i];
    var list = seeds[key] || [];
    if (!list.length) {
      lines.push("- " + key + ": free text (no fixed seeds)");
      continue;
    }
    lines.push("- " + key + ": prefer [" + list.slice(0, 24).join(", ") + "]");
  }
  return lines.join("\n");
}

function systemPrompt() {
  return [
    "You are a classic menswear wardrobe assistant for a personal catalog app.",
    "Analyze the garment photo and any user hints. Propose catalog attributes.",
    "Prefer the seed vocabulary when it fits; otherwise short free text.",
    "Never invent a brand/model you cannot see. Leave brandModel empty if unsure.",
    "aiContext: 1–3 short sentences for later outfit recommendations (when worn, formality cues, pairing notes). No markdown.",
    "followUpQuestions: 0–3 short questions Frank might answer to improve the record.",
    "Return ONLY valid JSON matching the schema. No prose outside JSON.",
    "Attribute fields: " + ATTR_KEYS.join(", ") + ".",
    "Seed vocabulary:\n" + seedVocabulary(),
  ].join("\n");
}

function userTextBlock(input) {
  var parts = [
    "Propose catalog fields for this wardrobe item.",
    "JSON schema:",
    JSON.stringify({
      label: "short item name e.g. dress shirt",
      attributes: emptyAttrs(),
      aiContext: "string",
      followUpQuestions: ["string"],
      notes: "optional caveats",
    }),
  ];
  var typed = sanitizeAttrs(input.attributes);
  var hasTyped = ATTR_KEYS.some(function (key) {
    return Boolean(typed[key]);
  });
  if (hasTyped) {
    parts.push("Already typed (prefer unless photo clearly contradicts):");
    parts.push(JSON.stringify(typed));
  }
  if (input.hints) {
    parts.push("Hints: " + input.hints);
  }
  if (input.answers) {
    parts.push("Answers to follow-ups: " + input.answers);
  }
  return parts.join("\n");
}

function parseJsonObject(text) {
  var raw = String(text || "").trim();
  if (!raw) {
    throw Object.assign(new Error("analyze_empty_model_response"), {
      statusCode: 502,
    });
  }
  var fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    raw = fenced[1].trim();
  }
  var start = raw.indexOf("{");
  var end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw Object.assign(new Error("analyze_invalid_model_json"), {
      statusCode: 502,
    });
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (_err) {
    throw Object.assign(new Error("analyze_invalid_model_json"), {
      statusCode: 502,
    });
  }
}

function normalizeProposal(parsed) {
  var src = parsed && typeof parsed === "object" ? parsed : {};
  var attrs = sanitizeAttrs(src.attributes || src);
  var questions = Array.isArray(src.followUpQuestions)
    ? src.followUpQuestions
    : [];
  var followUpQuestions = [];
  for (var i = 0; i < questions.length && followUpQuestions.length < 3; i++) {
    var q = clampText(questions[i], 160);
    if (q) followUpQuestions.push(q);
  }
  return {
    label: clampText(src.label || attrs.type || "item", 120) || "item",
    attributes: attrs,
    aiContext: clampText(src.aiContext, 2000),
    followUpQuestions: followUpQuestions,
    notes: clampText(src.notes, 400),
  };
}

function decodeImageBase64(imageBase64, contentType) {
  var raw = String(imageBase64 || "").trim();
  if (!raw) {
    throw Object.assign(new Error("image_required"), { statusCode: 400 });
  }
  var match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  var ct = contentType;
  if (match) {
    ct = ct || match[1];
    raw = match[2];
  }
  var buf;
  try {
    buf = Buffer.from(raw, "base64");
  } catch (_err) {
    throw Object.assign(new Error("invalid_image_base64"), { statusCode: 400 });
  }
  if (!buf.length) {
    throw Object.assign(new Error("image_required"), { statusCode: 400 });
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("image_too_large"), { statusCode: 413 });
  }
  var mime = String(ct || "image/jpeg").toLowerCase();
  if (
    mime !== "image/jpeg" &&
    mime !== "image/png" &&
    mime !== "image/webp" &&
    mime !== "image/gif"
  ) {
    // HEIC rarely works with Bedrock vision; ask client to recompress to JPEG.
    throw Object.assign(new Error("unsupported_image_type"), { statusCode: 400 });
  }
  return { bytes: buf, contentType: mime };
}

async function loadItemPhotoBytes(user, itemId, photoId) {
  var item = await items.getItemRecord(user.sub, itemId);
  if (!item) {
    throw Object.assign(new Error("not_found"), { statusCode: 404 });
  }
  var photos = item.photos || [];
  var chosen = null;
  if (photoId) {
    for (var i = 0; i < photos.length; i++) {
      if (photos[i].photoId === photoId) {
        chosen = photos[i];
        break;
      }
    }
    if (!chosen) {
      throw Object.assign(new Error("photo_not_found"), { statusCode: 404 });
    }
  } else {
    for (var j = 0; j < photos.length; j++) {
      if (photos[j].status === "ready" && (photos[j].thumbKey || photos[j].key)) {
        chosen = photos[j];
        break;
      }
    }
  }
  if (!chosen || chosen.status !== "ready" || !chosen.key) {
    throw Object.assign(new Error("photo_not_ready"), { statusCode: 400 });
  }
  // Prefer thumb when present (lower cost); fall back to primary.
  var key = chosen.thumbKey || chosen.key;
  var buf = await items.loadPhotoBuffer({ key: key });
  if (!buf || !buf.length) {
    throw Object.assign(new Error("photo_load_failed"), { statusCode: 502 });
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("image_too_large"), { statusCode: 413 });
  }
  var contentType = chosen.thumbKey
    ? "image/jpeg"
    : chosen.contentType || "image/jpeg";
  if (contentType === "image/heic") {
    throw Object.assign(new Error("unsupported_image_type"), { statusCode: 400 });
  }
  return { bytes: buf, contentType: contentType, photoId: chosen.photoId };
}

function formatForBedrock(contentType) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpeg";
}

async function invokeBedrock(image, text) {
  var commandInput = {
    modelId: modelId(),
    system: [{ text: systemPrompt() }],
    messages: [
      {
        role: "user",
        content: [
          {
            image: {
              format: formatForBedrock(image.contentType),
              source: { bytes: image.bytes },
            },
          },
          { text: text },
        ],
      },
    ],
    inferenceConfig: {
      maxTokens: 1024,
      temperature: 0.2,
    },
  };

  var response;
  if (deps.converse) {
    response = await deps.converse(commandInput);
  } else {
    response = await bedrockClient().send(new ConverseCommand(commandInput));
  }

  var blocks = (response && response.output && response.output.message
    ? response.output.message.content
    : null) || [];
  var textOut = "";
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i] && blocks[i].text) {
      textOut += blocks[i].text;
    }
  }
  var usage = (response && response.usage) || {};
  return {
    text: textOut,
    modelId: commandInput.modelId,
    inputTokens:
      typeof usage.inputTokens === "number" ? usage.inputTokens : null,
    outputTokens:
      typeof usage.outputTokens === "number" ? usage.outputTokens : null,
  };
}

async function analyzeItem(user, body) {
  var input = body || {};
  var hints = clampText(input.hints, MAX_HINTS);
  var answers = clampText(input.answers, MAX_ANSWERS);
  var attributes = sanitizeAttrs(input.attributes);

  var image;
  var source;
  if (input.imageBase64) {
    image = decodeImageBase64(input.imageBase64, input.contentType);
    source = "upload";
  } else if (input.itemId) {
    image = await loadItemPhotoBytes(user, String(input.itemId), input.photoId);
    source = "item_photo";
  } else {
    throw Object.assign(new Error("image_or_item_required"), { statusCode: 400 });
  }

  var bedrockResult;
  try {
    bedrockResult = await invokeBedrock(image, userTextBlock({
      hints: hints,
      answers: answers,
      attributes: attributes,
    }));
  } catch (err) {
    if (err && err.statusCode) throw err;
    console.error(
      "bedrock_analyze_failed",
      err && err.name,
      err && err.message ? err.message : err
    );
    // AccessDenied (often missing CRIS destination region in IAM) → clear 503.
    if (err && err.name === "AccessDeniedException") {
      throw Object.assign(new Error("analyze_unavailable"), { statusCode: 503 });
    }
    throw Object.assign(new Error("bedrock_analyze_failed"), { statusCode: 502 });
  }

  var proposal = normalizeProposal(parseJsonObject(bedrockResult.text));
  // Cost / Log Insights only — never log prompts, images, or aiContext.
  console.log(
    JSON.stringify({
      event: "analyze_success",
      modelId: bedrockResult.modelId,
      inputTokens: bedrockResult.inputTokens,
      outputTokens: bedrockResult.outputTokens,
    })
  );

  return {
    statusCode: 200,
    body: {
      proposal: proposal,
      modelId: bedrockResult.modelId,
      source: source,
      photoId: image.photoId || null,
    },
  };
}

exports.analyzeItem = analyzeItem;
exports.normalizeProposal = normalizeProposal;
exports.parseJsonObject = parseJsonObject;
exports.decodeImageBase64 = decodeImageBase64;
exports.resetDepsForTests = resetDepsForTests;
exports.DEFAULT_MODEL_ID = DEFAULT_MODEL_ID;
exports.ATTR_KEYS = ATTR_KEYS;
