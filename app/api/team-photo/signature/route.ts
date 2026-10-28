import { createUploadSignature, jsonError, requireAdmin, readJson, validateMemberId, PhotoApiError } from "../../../../lib/photo-server.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const db = await requireAdmin(request);
    const body = await readJson(request);
    const memberId = validateMemberId(body.memberId);
    const member = await db.collection("team").doc(memberId).get();
    if (!member.exists) throw new PhotoApiError(404, "Save the organizer profile before uploading a photo.");
    const data = member.data();
    if (typeof data?.name !== "string" || !data.name.trim() || typeof data?.role !== "string" || !data.role.trim()) {
      throw new PhotoApiError(400, "The selected Firestore record is not a valid organizer profile.");
    }
    return Response.json(createUploadSignature(memberId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
