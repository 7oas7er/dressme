"use strict";

var http = require("./http");

var verifierPromise = null;

function getVerifier() {
  if (process.env.AUTH_DISABLED === "true") {
    return null;
  }
  if (verifierPromise) {
    return verifierPromise;
  }
  var poolId = process.env.COGNITO_USER_POOL_ID;
  var clientId = process.env.COGNITO_CLIENT_ID;
  if (!poolId || !clientId) {
    throw new Error("cognito_not_configured");
  }
  verifierPromise = import("aws-jwt-verify").then(function (mod) {
    return mod.CognitoJwtVerifier.create({
      userPoolId: poolId,
      tokenUse: "id",
      clientId: clientId,
    });
  });
  return verifierPromise;
}

/**
 * Cognito ID token from the viewer.
 * Prefer x-id-token: CloudFront OAC (always) overwrites Authorization with SigV4
 * when invoking a Lambda Function URL, so Bearer never reaches the function.
 */
function extractIdToken(event) {
  var custom = (http.getHeader(event, "x-id-token") || "").trim();
  if (custom) {
    var customLower = custom.toLowerCase();
    if (customLower.indexOf("bearer ") === 0) {
      return custom.slice(7).trim();
    }
    return custom;
  }

  var header = (http.getHeader(event, "authorization") || "").trim();
  var space = header.indexOf(" ");
  var scheme = space > 0 ? header.slice(0, space) : "";
  var token = space > 0 ? header.slice(space + 1).trim() : "";
  if (scheme.toLowerCase() === "bearer" && token && token.indexOf(" ") === -1) {
    return token;
  }
  return "";
}

/**
 * Resolve the signed-in user from the Cognito ID token.
 * When AUTH_DISABLED=true (unit tests only), returns a fixed test user.
 */
async function requireUser(event) {
  if (process.env.AUTH_DISABLED === "true") {
    return { sub: "test-user", username: "test-user", email: "test@example.com" };
  }

  var token = extractIdToken(event);
  if (!token) {
    var missing = new Error("unauthorized");
    missing.statusCode = 401;
    throw missing;
  }

  try {
    var verifier = await getVerifier();
    var payload = await verifier.verify(token);
    return {
      sub: payload.sub,
      username: payload["cognito:username"] || payload.username || payload.sub,
      email: payload.email || null,
    };
  } catch (_err) {
    var invalid = new Error("unauthorized");
    invalid.statusCode = 401;
    throw invalid;
  }
}

function publicConfig() {
  return {
    userPoolId: process.env.COGNITO_USER_POOL_ID || null,
    clientId: process.env.COGNITO_CLIENT_ID || null,
    region: process.env.COGNITO_REGION || process.env.AWS_REGION || "eu-north-1",
    authDomain: process.env.COGNITO_AUTH_DOMAIN || null,
    logoutUrl: process.env.COGNITO_LOGOUT_URL || null,
    redirectUri: process.env.COGNITO_REDIRECT_URI || null,
  };
}

exports.requireUser = requireUser;
exports.publicConfig = publicConfig;
exports.extractIdToken = extractIdToken;
