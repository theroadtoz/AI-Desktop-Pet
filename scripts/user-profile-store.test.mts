import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  parseUserProfile,
  parseUserProfileInput,
  createUserProfilePromptContext
} = require("../dist/shared/user-profile.js") as typeof import("../src/shared/user-profile");
const {
  createUserProfileStore
} = require("../dist/main/services/config/user-profile-store.js") as typeof import("../src/main/services/config/user-profile-store");

test("user profile parser accepts valid local nickname", () => {
  assert.deepEqual(parseUserProfile({
    displayName: " 小夏 ",
    preferredName: " 夏夏 ",
    completedAt: "2026-06-27T00:00:00.000Z"
  }), {
    displayName: "小夏",
    preferredName: "夏夏",
    completedAt: "2026-06-27T00:00:00.000Z"
  });

  assert.deepEqual(parseUserProfileInput({
    displayName: "小夏",
    preferredName: ""
  }, "2026-06-27T00:00:00.000Z"), {
    displayName: "小夏",
    completedAt: "2026-06-27T00:00:00.000Z"
  });
});

test("user profile parser rejects empty, long and non-string values", () => {
  assert.equal(parseUserProfileInput({ displayName: "" }), null);
  assert.equal(parseUserProfileInput({ displayName: "一".repeat(33) }), null);
  assert.equal(parseUserProfileInput({ displayName: 42 }), null);
  assert.equal(parseUserProfileInput({ displayName: "小夏", preferredName: "坏\n称呼" }), null);
  assert.equal(parseUserProfile({
    displayName: "小夏",
    completedAt: "not-a-date"
  }), null);
});

test("user profile store persists profile and falls back on corrupted file", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-user-profile-"));

  try {
    const store = createUserProfileStore({ userDataPath });
    assert.equal(store.getProfile(), null);

    const savedProfile = store.saveProfile({ displayName: "小夏", preferredName: "夏夏" });
    assert.equal(savedProfile.displayName, "小夏");
    assert.equal(createUserProfileStore({ userDataPath }).getProfile()?.preferredName, "夏夏");

    await writeFile(store.getProfilePath(), "not-json", "utf8");
    assert.equal(createUserProfileStore({ userDataPath }).getProfile(), null);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("user profile store safely falls back on invalid stored shape", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-user-profile-"));

  try {
    const profileDirectory = join(userDataPath, "config");
    await mkdir(profileDirectory, { recursive: true });
    await writeFile(join(profileDirectory, "user-profile.json"), JSON.stringify({
      displayName: "一".repeat(33),
      completedAt: "2026-06-27T00:00:00.000Z"
    }), "utf8");

    assert.equal(createUserProfileStore({ userDataPath }).getProfile(), null);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("user profile prompt context only keeps the sanitized preferred name", () => {
  const context = createUserProfilePromptContext({
    displayName: "小夏",
    preferredName: "夏夏",
    completedAt: "2026-06-27T00:00:00.000Z"
  });

  assert.deepEqual(context, { preferredName: "夏夏" });
});
