import { randomUUID } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";
import { del as deleteBlob } from "@vercel/blob";
import {
  buildSignedUploadParams,
  isAllowedImageMetadata,
  isAuthorizedAdminUid,
  isManagedBlobPath as policyIsManagedBlobPath,
  isManagedCloudinaryId as policyIsManagedCloudinaryId,
  isValidMemberId,
  PHOTO_ADMIN_UID,
  PHOTO_FOLDER,
  PHOTO_MAX_BYTES,
  PHOTO_FORMATS,
} from "./photo-policy.mjs";

export const ADMIN_UID = PHOTO_ADMIN_UID;
export const MAX_PHOTO_BYTES = PHOTO_MAX_BYTES;
export const CLOUDINARY_FOLDER = PHOTO_FOLDER;
const FIREBASE_PROJECT_ID = "clutch-esports-2026";

export class PhotoApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonError(error: unknown) {
  const status = error instanceof PhotoApiError ? error.status : 500;
  const message = error instanceof PhotoApiError ? error.message : "The photo request could not be completed.";
  if (!(error instanceof PhotoApiError)) console.error("Organizer photo API failed.");
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function getAdminApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId !== FIREBASE_PROJECT_ID || !clientEmail || !privateKey) {
    throw new PhotoApiError(503, "Firebase Admin photo authorization is not configured.");
  }
  const name = "clutch-team-photo-cloudinary-api";
  return getApps().find((app) => app.name === name) ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  }, name);
}

export async function requireAdmin(request: Request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new PhotoApiError(401, "Sign in with the CLUTCH admin account to manage photos.");
  let decoded;
  try {
    decoded = await getAuth(getAdminApp()).verifyIdToken(match[1]);
  } catch (error) {
    if (error instanceof PhotoApiError) throw error;
    throw new PhotoApiError(401, "Your admin session could not be verified. Sign in again.");
  }
  if (!isAuthorizedAdminUid(decoded.uid)) throw new PhotoApiError(403, "This Firebase account is not authorized to manage team photos.");
  return getFirestore(getAdminApp());
}

export async function readJson(request: Request, maxBytes = 16 * 1024): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new PhotoApiError(413, "The request is too large.");
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > maxBytes) throw new PhotoApiError(413, "The request is too large.");
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("bad body");
    return value as Record<string, unknown>;
  } catch {
    throw new PhotoApiError(400, "The request body must be a JSON object.");
  }
}

export function validateMemberId(value: unknown): string {
  if (typeof value !== "string" || !isValidMemberId(value)) {
    throw new PhotoApiError(400, "The organizer record is not valid.");
  }
  return value;
}

export function isManagedCloudinaryId(value: unknown, memberId: string): value is string {
  return policyIsManagedCloudinaryId(value, memberId);
}

export function isManagedBlobPath(value: unknown, memberId: string): value is string {
  return policyIsManagedBlobPath(value, memberId);
}

export function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new PhotoApiError(503, "Cloudinary photo uploads are not configured.");
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  return { cloudName, apiKey, apiSecret };
}

export function createUploadSignature(memberId: string) {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const uploadId = randomUUID();
  const params = buildSignedUploadParams(memberId, uploadId, timestamp);
  return {
    cloudName,
    apiKey,
    timestamp,
    publicId: params.public_id,
    assetFolder: CLOUDINARY_FOLDER,
    allowedFormats: [...PHOTO_FORMATS],
    signature: cloudinary.utils.api_sign_request(params, apiSecret),
  };
}

export { isAllowedImageMetadata };

export async function deleteManagedPhoto(photoPath: unknown, memberId: string) {
  let cleanupFailed = false;
  if (isManagedCloudinaryId(photoPath, memberId)) {
    try {
      getCloudinaryConfig();
      const result = await cloudinary.uploader.destroy(photoPath, { resource_type: "image", invalidate: true });
      cleanupFailed = result.result !== "ok" && result.result !== "not found";
    } catch {
      cleanupFailed = true;
    }
  } else if (isManagedBlobPath(photoPath, memberId)) {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) cleanupFailed = true;
    else {
      try {
        await deleteBlob(photoPath, { token });
      } catch {
        cleanupFailed = true;
      }
    }
  }
  return cleanupFailed;
}

export function validateProfileFields(value: Record<string, unknown>) {
  const fields: Record<string, string> = {};
  for (const key of ["name", "role", "instagram", "linkedin"]) {
    const field = typeof value[key] === "string" ? value[key].trim() : "";
    const maxLength = key === "instagram" || key === "linkedin" ? 500 : 120;
    if (field.length > maxLength || ((key === "name" || key === "role") && !field)) {
      throw new PhotoApiError(400, "Enter a valid organizer name and role.");
    }
    fields[key] = field;
  }
  return fields;
}

export async function savePhotoReference(db: Firestore, memberId: string, photo: string, photoPath: string, fields: Record<string, string>) {
  const ref = db.collection("team").doc(memberId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new PhotoApiError(404, "The organizer record was not found.");
  const previousPath = snapshot.get("photoPath");
  try {
    await ref.update({ ...fields, photo, photoPath });
  } catch {
    throw new PhotoApiError(503, "The photo could not be saved to the organizer record.");
  }
  const oldPhotoCleanupFailed = previousPath && previousPath !== photoPath
    ? await deleteManagedPhoto(previousPath, memberId)
    : false;
  return { photo, photoPath, oldPhotoCleanupFailed };
}
