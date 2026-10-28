import { FieldValue } from "firebase-admin/firestore";
import { deleteManagedPhoto, jsonError, PhotoApiError, requireAdmin, readJson, validateMemberId, validateProfileFields } from "../../../../lib/photo-server.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const db = await requireAdmin(request);
    const body = await readJson(request);
    const memberId = validateMemberId(body.memberId);
    const action = body.action === "deleteOrganizer" ? "deleteOrganizer" : body.action === "removePhoto" ? "removePhoto" : null;
    if (!action) throw new PhotoApiError(400, "The photo removal request is not valid.");
    const ref = db.collection("team").doc(memberId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new PhotoApiError(404, "The organizer record was not found.");
    const previousPath = snapshot.get("photoPath");
    try {
      if (action === "deleteOrganizer") await ref.delete();
      else await ref.update({ ...validateProfileFields(body), photo: FieldValue.delete(), photoPath: FieldValue.delete() });
    } catch {
      throw new PhotoApiError(503, "The organizer could not be updated.");
    }
    const cleanupFailed = previousPath ? await deleteManagedPhoto(previousPath, memberId) : false;
    return Response.json({ ok: true, cleanupFailed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
