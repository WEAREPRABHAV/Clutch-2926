export const PHOTO_FOLDER = "clutch/team-photos";
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTO_FORMATS = Object.freeze(["jpg", "png", "webp"]);
export const PHOTO_ADMIN_UID = "gNlNvVcDE5SfRCgK5eeFCK8dnaL2";

export function isValidMemberId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function isAuthorizedAdminUid(uid) {
  return uid === PHOTO_ADMIN_UID;
}

export function managedCloudinaryId(memberId, uploadId) {
  if (!isValidMemberId(memberId) || !isUuidV4(uploadId)) throw new Error("Invalid managed photo identity.");
  return `${PHOTO_FOLDER}/${memberId}/${uploadId}`;
}

export function isManagedCloudinaryId(value, memberId) {
  if (typeof value !== "string" || !isValidMemberId(memberId)) return false;
  const escapedId = memberId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${PHOTO_FOLDER}/${escapedId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(value);
}

export function isManagedBlobPath(value, memberId) {
  if (typeof value !== "string" || !isValidMemberId(memberId)) return false;
  const escapedId = memberId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^team-photos/${escapedId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png|webp)$`, "i").test(value);
}

export function isAllowedImageMetadata(format, bytes) {
  const normalized = String(format || "").toLowerCase();
  return ["jpg", "jpeg", "png", "webp"].includes(normalized)
    && Number.isInteger(bytes) && bytes > 0 && bytes <= PHOTO_MAX_BYTES;
}

export function buildSignedUploadParams(memberId, uploadId, timestamp) {
  if (!isValidMemberId(memberId) || !isUuidV4(uploadId) || !Number.isInteger(timestamp) || timestamp <= 0) {
    throw new Error("Invalid signed upload parameters.");
  }
  return {
    asset_folder: PHOTO_FOLDER,
    allowed_formats: PHOTO_FORMATS.join(","),
    overwrite: false,
    public_id: managedCloudinaryId(memberId, uploadId),
    timestamp,
  };
}

function isUuidV4(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
