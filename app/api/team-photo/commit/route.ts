import { v2 as cloudinary } from "cloudinary";
import {
  getCloudinaryConfig,
  isAllowedImageMetadata,
  isManagedCloudinaryId,
  jsonError,
  MAX_PHOTO_BYTES,
  PhotoApiError,
  requireAdmin,
  readJson,
  savePhotoReference,
  validateMemberId,
  validateProfileFields,
} from "../../../../lib/photo-server.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let memberId = "";
  let publicId = "";
  try {
    const db = await requireAdmin(request);
    const body = await readJson(request);
    memberId = validateMemberId(body.memberId);
    if (typeof body.public_id !== "string" || !isManagedCloudinaryId(body.public_id, memberId)) throw new PhotoApiError(400, "The uploaded image does not belong to this organizer slot.");
    publicId = body.public_id;
    if (typeof body.secure_url !== "string" || body.secure_url.length > 2048) throw new PhotoApiError(400, "Cloudinary did not return a valid image URL.");
    const { cloudName } = getCloudinaryConfig();
    let resource;
    try {
      resource = await cloudinary.api.resource(publicId, { resource_type: "image", type: "upload" });
    } catch {
      throw new PhotoApiError(502, "Cloudinary could not verify the uploaded image. Retry the upload.");
    }
    if (resource.public_id !== publicId || resource.resource_type !== "image" || resource.type !== "upload") {
      throw new PhotoApiError(400, "The Cloudinary upload could not be verified.");
    }
    const format = String(resource.format || "").toLowerCase();
    if (!["jpg", "jpeg", "png", "webp"].includes(format)) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
      throw new PhotoApiError(415, "Upload a valid JPEG, PNG, or WebP image.");
    }
    if (!isAllowedImageMetadata(format, resource.bytes)) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
      if (resource.bytes > MAX_PHOTO_BYTES) throw new PhotoApiError(413, "Images must be 4 MB or smaller.");
      throw new PhotoApiError(415, "Upload a valid JPEG, PNG, or WebP image.");
    }
    const actualUrl = String(resource.secure_url || "");
    let parsedUrl: URL;
    try { parsedUrl = new URL(actualUrl); } catch { throw new PhotoApiError(502, "Cloudinary returned an invalid secure image URL."); }
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "res.cloudinary.com" || parsedUrl.pathname.split("/")[1] !== cloudName || body.secure_url !== actualUrl) {
      throw new PhotoApiError(400, "The Cloudinary image response did not match the signed upload.");
    }
    try {
      const fields = validateProfileFields(body);
      const result = await savePhotoReference(db, memberId, actualUrl, publicId, fields);
      return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    if (memberId && isManagedCloudinaryId(publicId, memberId)) {
      try { await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true }); } catch { /* Best-effort cleanup; never replace the actionable error. */ }
    }
    return jsonError(error);
  }
}
