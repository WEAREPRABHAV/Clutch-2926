import test from "node:test";
import assert from "node:assert/strict";
import { v2 as cloudinary } from "cloudinary";
import {
  buildSignedUploadParams,
  isAllowedImageMetadata,
  isAuthorizedAdminUid,
  isManagedBlobPath,
  isManagedCloudinaryId,
  isValidMemberId,
} from "../lib/photo-policy.mjs";

const memberId = "member_42";
const uploadId = "123e4567-e89b-42d3-a456-426614174000";

test("only the configured Firebase administrator UID is authorized", () => {
  assert.equal(isAuthorizedAdminUid("gNlNvVcDE5SfRCgK5eeFCK8dnaL2"), true);
  assert.equal(isAuthorizedAdminUid("another-user"), false);
  assert.equal(isAuthorizedAdminUid(undefined), false);
});

test("member IDs are constrained to existing Firestore document ID syntax", () => {
  assert.equal(isValidMemberId(memberId), true);
  assert.equal(isValidMemberId("../other-member"), false);
  assert.equal(isValidMemberId("a/b"), false);
  assert.equal(isValidMemberId(""), false);
});

test("Cloudinary public IDs are limited to one member's UUID photo namespace", () => {
  const id = `clutch/team-photos/${memberId}/${uploadId}`;
  assert.equal(isManagedCloudinaryId(id, memberId), true);
  assert.equal(isManagedCloudinaryId(id, "other-member"), false);
  assert.equal(isManagedCloudinaryId(`https://res.cloudinary.com/demo/${id}`, memberId), false);
  assert.equal(isManagedCloudinaryId(`clutch/team-photos/${memberId}/not-a-uuid`, memberId), false);
});

test("legacy Blob paths are recognized separately from Cloudinary IDs", () => {
  const path = `team-photos/${memberId}/${uploadId}.webp`;
  assert.equal(isManagedBlobPath(path, memberId), true);
  assert.equal(isManagedBlobPath(path, "other-member"), false);
  assert.equal(isManagedBlobPath(`clutch/team-photos/${memberId}/${uploadId}`, memberId), false);
  assert.equal(isManagedBlobPath(`team-photos/${memberId}/../photo.png`, memberId), false);
});

test("image format and byte limits accept the 4 MB boundary and reject invalid uploads", () => {
  assert.equal(isAllowedImageMetadata("jpg", 4 * 1024 * 1024), true);
  assert.equal(isAllowedImageMetadata("jpeg", 1), true);
  assert.equal(isAllowedImageMetadata("png", 4 * 1024 * 1024 + 1), false);
  assert.equal(isAllowedImageMetadata("gif", 120), false);
  assert.equal(isAllowedImageMetadata("webp", 0), false);
});

test("signed upload parameters constrain the folder, ID, formats, and timestamp", () => {
  const params = buildSignedUploadParams(memberId, uploadId, 1_800_000_000);
  assert.deepEqual(Object.keys(params).sort(), ["allowed_formats", "asset_folder", "overwrite", "public_id", "timestamp"]);
  assert.equal(params.asset_folder, "clutch/team-photos");
  assert.equal(params.allowed_formats, "jpg,png,webp");
  assert.equal(params.overwrite, false);
  assert.equal(params.public_id, `clutch/team-photos/${memberId}/${uploadId}`);
  assert.equal(params.timestamp, 1_800_000_000);
  const signature = cloudinary.utils.api_sign_request(params, "unit-test-only-secret");
  assert.match(signature, /^[a-f0-9]{40,128}$/i);
  assert.notEqual(signature, cloudinary.utils.api_sign_request({ ...params, public_id: "another-member/photo" }, "unit-test-only-secret"));
  assert.throws(() => buildSignedUploadParams("../other", uploadId, 1_800_000_000));
});
