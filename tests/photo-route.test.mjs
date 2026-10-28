import test from "node:test";
import assert from "node:assert/strict";
import { POST as signaturePost } from "../app/api/team-photo/signature/route.ts";
import { POST as commitPost } from "../app/api/team-photo/commit/route.ts";
import { POST as removePost } from "../app/api/team-photo/remove/route.ts";
import { savePhotoReference } from "../lib/photo-server.ts";

test("signature route rejects requests without a Firebase ID token", async () => {
  const response = await signaturePost(new Request("http://localhost/api/team-photo/signature", { method: "POST", body: "{}" }));
  assert.equal(response.status, 401);
});

test("commit route rejects requests without a Firebase ID token", async () => {
  const response = await commitPost(new Request("http://localhost/api/team-photo/commit", { method: "POST", body: "{}" }));
  assert.equal(response.status, 401);
});

test("remove route rejects requests without a Firebase ID token", async () => {
  const response = await removePost(new Request("http://localhost/api/team-photo/remove", { method: "POST", body: "{}" }));
  assert.equal(response.status, 401);
});

test("saving a photo updates only the selected organizer document's approved profile/photo fields", async () => {
  const record = { name: "Before", role: "Coordinator", extraField: "preserve me", photoPath: "legacy-value" };
  let writes = 0;
  const ref = {
    async get() { return { exists: true, get: (key) => record[key] }; },
    async update(fields) { writes += 1; Object.assign(record, fields); },
  };
  const db = { collection: (name) => ({ doc: (id) => {
    assert.equal(name, "team");
    assert.equal(id, "member_42");
    return ref;
  } }) };
  const result = await savePhotoReference(
    db,
    "member_42",
    "https://res.cloudinary.com/clutch/image/upload/clutch/team-photos/member_42/photo.webp",
    "clutch/team-photos/member_42/123e4567-e89b-42d3-a456-426614174000",
    { name: "After", role: "Event Head", instagram: "", linkedin: "" },
  );
  assert.equal(writes, 1);
  assert.equal(result.photoPath, "clutch/team-photos/member_42/123e4567-e89b-42d3-a456-426614174000");
  assert.equal(record.name, "After");
  assert.equal(record.role, "Event Head");
  assert.equal(record.extraField, "preserve me");
  assert.equal(record.photo, result.photo);
});
