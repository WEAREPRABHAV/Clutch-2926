const { randomUUID } = require("node:crypto");
const Busboy = require("busboy");
const { put, del } = require("@vercel/blob");
const { getApps, initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const ADMIN_UID = "gNlNvVcDE5SfRCgK5eeFCK8dnaL2";
const FIREBASE_PROJECT_ID = "clutch-esports-2026";
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Leaves over 200 KB for multipart fields, boundaries, and headers below Vercel's 4.5 MB limit.
const MAX_REQUEST_BYTES = 4_400_000;
const PHOTO_PREFIX = "team-photos";
const ALLOWED_FIELDS = new Set(["memberId", "name", "role", "instagram", "linkedin"]);

class RequestError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function logFailure(operation, error) {
  const redact = (value) => {
    if (typeof value !== "string") return "unknown";
    let safe = value
      .replace(/[\r\n\t]+/g, " ")
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
      .replace(/(?:team-photos|diagnostics)\/[^\s"'<>]+/gi, "[OBJECT_PATH]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[TOKEN]");
    for (const secret of [
      process.env.BLOB_READ_WRITE_TOKEN,
      process.env.FIREBASE_PRIVATE_KEY,
      process.env.FIREBASE_CLIENT_EMAIL,
      process.env.VERCEL_OIDC_TOKEN,
    ]) {
      if (typeof secret === "string" && secret.length > 0) safe = safe.split(secret).join("[REDACTED]");
    }
    return safe.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 240);
  };

  // Never log credentials, request data, filenames, object paths, or URLs.
  console.error("team-photo API failure", {
    operation,
    name: redact(error?.name),
    code: typeof error?.code === "string" ? error.code : "unknown",
    message: redact(error?.message),
  });
}

function getFirebaseApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId !== FIREBASE_PROJECT_ID || !clientEmail || !privateKey) {
    throw new RequestError(503, "Photo uploads are not configured on this deployment.");
  }

  const appName = "clutch-team-photo-api";
  const existing = getApps().find((app) => app.name === appName);
  if (existing) return existing;

  return initializeApp(
    {
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    },
    appName,
  );
}

async function requireAdmin(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new RequestError(401, "Sign in with the CLUTCH admin account to manage photos.");

  let app;
  try {
    app = getFirebaseApp();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    logFailure("initialize-firebase-admin", error);
    throw new RequestError(503, "Photo uploads are not configured on this deployment.");
  }

  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(match[1]);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    logFailure("verify-firebase-token", error);
    throw new RequestError(401, "Your admin session could not be verified. Sign in again.");
  }
  if (decoded.uid !== ADMIN_UID) {
    throw new RequestError(403, "This Firebase account is not authorized to manage team photos.");
  }
  return app;
}

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        // Busboy reports partsLimit at the configured boundary; allow one sentinel part so
        // the five expected text fields plus image can complete, while other limits reject extras.
        limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5, parts: 7, fieldSize: 1024 },
      });
    } catch {
      reject(new RequestError(400, "The upload request is not valid multipart form data."));
      return;
    }

    const fields = Object.create(null);
    const chunks = [];
    let fileCount = 0;
    let fileMimeType = "";
    let fileBytes = 0;
    let failure = null;
    let settled = false;
    let requestBytes = 0;
    const fail = (error) => {
      if (!failure) failure = error;
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    req.once("aborted", () => {
      logFailure("read-upload-request-aborted", { code: "request_aborted" });
      rejectOnce(new RequestError(400, "The upload request was interrupted. Please retry."));
    });
    req.once("error", (error) => {
      logFailure("read-upload-request-stream", error);
      rejectOnce(new RequestError(400, "The upload request could not be read. Please retry."));
    });
    req.on("data", (chunk) => {
      if (settled) return;
      requestBytes += chunk.length;
      if (requestBytes > MAX_REQUEST_BYTES) {
        req.unpipe(parser);
        rejectOnce(new RequestError(413, "The upload request exceeds the 4 MB image limit."));
        parser.destroy();
        req.resume();
      }
    });
    parser.on("error", (error) => {
      if (settled) return;
      logFailure("parse-upload-multipart", error);
      rejectOnce(new RequestError(400, "The upload request could not be parsed."));
    });
    parser.on("field", (name, value, info) => {
      if (!ALLOWED_FIELDS.has(name) || Object.hasOwn(fields, name) || info.valueTruncated) {
        fail(new RequestError(400, "The upload form contains invalid fields."));
        return;
      }
      fields[name] = value;
    });
    parser.on("file", (name, stream, info) => {
      fileCount += 1;
      if (name !== "photo" || fileCount !== 1) {
        fail(new RequestError(400, "Provide one image in the photo field."));
        stream.resume();
        return;
      }
      fileMimeType = info.mimeType;
      stream.on("data", (chunk) => {
        fileBytes += chunk.length;
        if (fileBytes <= MAX_FILE_BYTES) chunks.push(Buffer.from(chunk));
      });
      stream.on("limit", () => fail(new RequestError(413, "Images must be 4 MB or smaller.")));
      stream.on("error", () => fail(new RequestError(400, "The image upload could not be read.")));
    });
    parser.on("filesLimit", () => fail(new RequestError(400, "Provide one image in the photo field.")));
    parser.on("fieldsLimit", () => fail(new RequestError(400, "The upload form contains too many fields.")));
    parser.on("partsLimit", () => fail(new RequestError(400, "The upload form contains too many parts.")));
    parser.on("finish", () => {
      if (settled) return;
      if (failure) {
        rejectOnce(failure);
        return;
      }
      settled = true;
      resolve({ fields, file: Buffer.concat(chunks), fileBytes, fileMimeType });
    });

    // Pipe the runtime request stream directly to Busboy. Vercel's local Node adapter
    // can end a chained Transform before forwarding buffered body chunks; the direct
    // pipe avoids that intermediate writable lifecycle while the data tap enforces
    // the total request limit without buffering the request.
    req.pipe(parser);
  });
}

async function readJson(req, maxBytes = 16 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new RequestError(413, "The request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "The request body must be valid JSON.");
  }
}

function getProfileFields(fields) {
  const memberId = typeof fields.memberId === "string" ? fields.memberId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(memberId)) {
    throw new RequestError(400, "The organizer record is not valid.");
  }

  const values = {};
  for (const key of ["name", "role", "instagram", "linkedin"]) {
    const value = typeof fields[key] === "string" ? fields[key].trim() : "";
    const maxLength = key === "instagram" || key === "linkedin" ? 500 : 120;
    if (value.length > maxLength || ((key === "name" || key === "role") && !value)) {
      throw new RequestError(400, "Enter a valid organizer name and role.");
    }
    values[key] = value;
  }
  return { memberId, values };
}

function detectImageMimeType(buffer) {
  if (
    buffer.length >= 16 &&
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff &&
    buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
  ) {
    let offset = 2;
    let hasFrame = false;
    while (offset < buffer.length - 2) {
      if (buffer[offset] !== 0xff) return null;
      while (buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length - 2) return null;
      const marker = buffer[offset++];
      if (offset + 2 > buffer.length - 2) return null;
      if (marker === 0xda) {
        const scanLength = buffer.readUInt16BE(offset);
        const scanStart = offset + scanLength;
        return hasFrame && scanLength >= 6 && scanStart < buffer.length - 2 ? "image/jpeg" : null;
      }
      const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
      if (isStartOfFrame) {
        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 8 || offset + segmentLength > buffer.length - 2) return null;
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        if (!width || !height) return null;
        hasFrame = true;
      } else if ([0xd8, 0xd9, 0x00, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(marker)) {
        return null;
      } else if (marker === 0x01) {
        continue;
      }
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length - 2) return null;
      offset += segmentLength;
    }
    return null;
  }
  if (
    buffer.length >= 45 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    let offset = 8;
    let hasHeader = false;
    let hasImageData = false;
    while (offset + 12 <= buffer.length) {
      const chunkLength = buffer.readUInt32BE(offset);
      const chunkEnd = offset + 12 + chunkLength;
      if (chunkEnd > buffer.length) return null;
      const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
      if (!hasHeader) {
        if (chunkType !== "IHDR" || chunkLength !== 13) return null;
        if (!buffer.readUInt32BE(offset + 8) || !buffer.readUInt32BE(offset + 12)) return null;
        hasHeader = true;
      } else if (chunkType === "IHDR") {
        return null;
      }
      if (chunkType === "IDAT") hasImageData = true;
      if (chunkType === "IEND") {
        return chunkLength === 0 && chunkEnd === buffer.length && hasHeader && hasImageData ? "image/png" : null;
      }
      offset = chunkEnd;
    }
    return null;
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    if (buffer.readUInt32LE(4) + 8 !== buffer.length) return null;
    let offset = 12;
    let hasImageData = false;
    while (offset + 8 <= buffer.length) {
      const chunkType = buffer.toString("ascii", offset, offset + 4);
      const chunkLength = buffer.readUInt32LE(offset + 4);
      const chunkEnd = offset + 8 + chunkLength + (chunkLength % 2);
      if (chunkEnd > buffer.length) return null;
      if ((chunkType === "VP8 " && chunkLength >= 10) || (chunkType === "VP8L" && chunkLength >= 5) || (chunkType === "ANMF" && chunkLength >= 16)) {
        hasImageData = true;
      }
      offset = chunkEnd;
    }
    return offset === buffer.length && hasImageData ? "image/webp" : null;
  }
  return null;
}

function isManagedBlobPath(path, memberId) {
  if (typeof path !== "string" || path.includes("\\") || path.includes("..")) return false;
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === PHOTO_PREFIX && parts[1] === memberId && /^[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(parts[2]);
}

function getBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new RequestError(503, "Photo uploads are not configured on this deployment.");
  return token;
}

async function uploadPhoto(req, res, app) {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RequestError(413, "The upload request exceeds the 4 MB image limit.");
  }

  const { fields, file, fileBytes, fileMimeType } = await readMultipart(req);
  const { memberId, values } = getProfileFields(fields);
  if (!fileBytes) throw new RequestError(400, "Select an image to upload.");
  const actualMimeType = detectImageMimeType(file);
  if (!actualMimeType || actualMimeType !== fileMimeType) {
    throw new RequestError(415, "Upload a valid JPEG, PNG, or WebP image.");
  }
  const extensionByMime = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const blobToken = getBlobToken();
  const db = getFirestore(app);
  const teamRef = db.collection("team").doc(memberId);
  let existing;
  try {
    const snapshot = await teamRef.get();
    existing = snapshot.exists ? snapshot.data() : {};
  } catch (error) {
    logFailure("read-team-before-upload", error);
    throw new RequestError(503, "Organizer data is unavailable. The existing profile was left unchanged.");
  }

  const pathname = `${PHOTO_PREFIX}/${memberId}/${randomUUID()}.${extensionByMime[actualMimeType]}`;
  let blob;
  try {
    blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: false,
      contentType: actualMimeType,
      token: blobToken,
    });
  } catch (error) {
    logFailure("upload-to-vercel-blob", error);
    // An authorization rejection happens before a Blob can be created. Avoid a
    // guaranteed failing delete request with the same invalid credential; for
    // other failures, keep the compensating cleanup in case the upload committed
    // before its response was interrupted.
    const authorizationRejected = /access denied, please provide a valid token/i.test(
      typeof error?.message === "string" ? error.message : "",
    );
    let cleanupFailed = false;
    if (!authorizationRejected) {
      try {
        await del(pathname, { token: blobToken });
      } catch (cleanupError) {
        cleanupFailed = true;
        logFailure("cleanup-failed-photo-upload", cleanupError);
      }
    }
    throw new RequestError(
      502,
      cleanupFailed
        ? "The photo upload failed. The existing profile was left unchanged; the image may need cleanup."
        : "The photo upload failed. The existing profile was left unchanged.",
    );
  }

  try {
    await teamRef.set({ ...values, photo: blob.url, photoPath: blob.pathname }, { merge: true });
  } catch (error) {
    logFailure("save-team-photo-reference", error);
    let cleanupFailed = false;
    try {
      await del(blob.pathname, { token: blobToken });
    } catch (cleanupError) {
      cleanupFailed = true;
      logFailure("cleanup-unsaved-photo", cleanupError);
    }
    throw new RequestError(
      503,
      cleanupFailed
        ? "The profile could not be saved. The uploaded image may need cleanup; the existing profile was not changed."
        : "The profile could not be saved. The existing profile was left unchanged.",
    );
  }

  let oldPhotoCleanupFailed = false;
  if (isManagedBlobPath(existing.photoPath, memberId) && existing.photoPath !== blob.pathname) {
    try {
      await del(existing.photoPath, { token: blobToken });
    } catch (error) {
      oldPhotoCleanupFailed = true;
      logFailure("cleanup-replaced-photo", error);
    }
  }
  sendJson(res, 200, {
    ok: true,
    photo: blob.url,
    photoPath: blob.pathname,
    oldPhotoCleanupFailed,
  });
}

async function removePhoto(body, res, app) {
  if (!body || body.action !== "removePhoto") throw new RequestError(400, "The photo removal request is not valid.");
  const { memberId, values } = getProfileFields(body);
  const db = getFirestore(app);
  const teamRef = db.collection("team").doc(memberId);
  let blobToken = null;
  let existing;
  try {
    const snapshot = await teamRef.get();
    if (!snapshot.exists) throw new RequestError(404, "The organizer record was not found.");
    existing = snapshot.data();
    if (isManagedBlobPath(existing.photoPath, memberId)) blobToken = getBlobToken();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    logFailure("read-team-before-photo-removal", error);
    throw new RequestError(503, "Organizer data is unavailable. The existing profile was left unchanged.");
  }

  try {
    await teamRef.update({
      ...values,
      photo: FieldValue.delete(),
      photoPath: FieldValue.delete(),
    });
  } catch (error) {
    logFailure("remove-team-photo-reference", error);
    throw new RequestError(503, "The profile could not be saved. The existing photo was left unchanged.");
  }

  let cleanupFailed = false;
  if (isManagedBlobPath(existing.photoPath, memberId)) {
    try {
      await del(existing.photoPath, { token: blobToken });
    } catch (error) {
      cleanupFailed = true;
      logFailure("cleanup-removed-photo", error);
    }
  }
  sendJson(res, 200, { ok: true, cleanupFailed });
}

async function deleteOrganizer(body, res, app) {
  if (!body || body.action !== "deleteOrganizer") throw new RequestError(400, "The organizer removal request is not valid.");
  const { memberId } = getProfileFields({ ...body, name: "Organizer", role: "Organizer" });
  const db = getFirestore(app);
  const teamRef = db.collection("team").doc(memberId);
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN || null;
  let existing;
  try {
    const snapshot = await teamRef.get();
    if (!snapshot.exists) throw new RequestError(404, "The organizer record was not found.");
    existing = snapshot.data();
    if (isManagedBlobPath(existing.photoPath, memberId) && !blobToken) {
      throw new RequestError(503, "Photo storage is not configured; the organizer was not removed.");
    }
    await teamRef.delete();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    logFailure("delete-team-record", error);
    throw new RequestError(503, "The organizer could not be removed.");
  }

  let cleanupFailed = false;
  if (isManagedBlobPath(existing.photoPath, memberId)) {
    try {
      await del(existing.photoPath, { token: blobToken });
    } catch (error) {
      cleanupFailed = true;
      logFailure("cleanup-deleted-organizer-photo", error);
    }
  }
  sendJson(res, 200, { ok: true, cleanupFailed });
}

module.exports = async function teamPhotoHandler(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    sendJson(res, 405, { error: "Use POST to upload a photo or DELETE to remove a photo or organizer." });
    return;
  }

  try {
    const app = await requireAdmin(req);
    if (req.method === "POST") {
      await uploadPhoto(req, res, app);
      return;
    }
    const body = await readJson(req);
    if (body?.action === "deleteOrganizer") {
      await deleteOrganizer(body, res, app);
      return;
    }
    await removePhoto(body, res, app);
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    logFailure("request", error);
    sendJson(res, 500, { error: "The photo request could not be completed." });
  }
};

module.exports.config = { api: { bodyParser: false } };
