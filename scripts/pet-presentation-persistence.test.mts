import assert from "node:assert/strict";
import test from "node:test";
import { createPetPresentationPersistence } from "../src/main/services/config/pet-presentation-persistence.ts";

test("wheel persistence saves only the final idle scale", async () => {
  const saved: number[] = [];
  const savedAccessories: string[] = [];
  const persistence = createPetPresentationPersistence({
    savePreferences(preferences) {
      saved.push(preferences.petScale);
      savedAccessories.push(preferences.accessoryPresetId);
      return preferences;
    }
  }, 20);

  persistence.schedule({ petScale: 1.05, accessoryPresetId: "glasses" });
  persistence.schedule({ petScale: 1.1, accessoryPresetId: "glasses" });
  persistence.schedule({ petScale: 1.15, accessoryPresetId: "glasses" });
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.deepEqual(saved, [1.15]);
  assert.deepEqual(savedAccessories, ["glasses"]);
});

test("explicit save replaces pending wheel persistence and flush saves pending data once", () => {
  const saved: number[] = [];
  const persistence = createPetPresentationPersistence({
    savePreferences(preferences) {
      saved.push(preferences.petScale);
      return preferences;
    }
  }, 1000);

  persistence.schedule({ petScale: 1.05, accessoryPresetId: "none" });
  persistence.saveNow({ petScale: 1.1, accessoryPresetId: "glasses" });
  assert.equal(persistence.flush(), null);
  persistence.schedule({ petScale: 1.15, accessoryPresetId: "none" });
  assert.deepEqual(persistence.flush(), { petScale: 1.15, accessoryPresetId: "none" });
  assert.deepEqual(saved, [1.1, 1.15]);
});
