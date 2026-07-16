import assert from "node:assert/strict";
import test from "node:test";
import { createPetPresentationPersistence } from "../src/main/services/config/pet-presentation-persistence.ts";

test("wheel persistence saves only the final schema-v2 preferences", async () => {
  const saved: Array<{ petScale: number; accessoryIds: readonly string[] }> = [];
  const persistence = createPetPresentationPersistence({
    savePreferences(preferences) {
      saved.push({ petScale: preferences.petScale, accessoryIds: preferences.accessoryIds });
      return preferences;
    }
  }, 20);

  persistence.schedule({ schemaVersion: 2, petScale: 1.05, accessoryIds: ["glasses"] });
  persistence.schedule({ schemaVersion: 2, petScale: 1.1, accessoryIds: ["glasses"] });
  persistence.schedule({ schemaVersion: 2, petScale: 1.15, accessoryIds: ["glasses", "hat"] });
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.deepEqual(saved, [{ petScale: 1.15, accessoryIds: ["glasses", "hat"] }]);
});

test("explicit save replaces pending wheel persistence and flush saves pending data once", () => {
  const saved: number[] = [];
  const persistence = createPetPresentationPersistence({
    savePreferences(preferences) {
      saved.push(preferences.petScale);
      return preferences;
    }
  }, 1000);

  persistence.schedule({ schemaVersion: 2, petScale: 1.05, accessoryIds: [] });
  persistence.saveNow({ schemaVersion: 2, petScale: 1.1, accessoryIds: ["glasses"] });
  assert.equal(persistence.flush(), null);
  persistence.schedule({ schemaVersion: 2, petScale: 1.15, accessoryIds: ["ghost"] });
  assert.deepEqual(persistence.flush(), { schemaVersion: 2, petScale: 1.15, accessoryIds: ["ghost"] });
  assert.deepEqual(saved, [1.1, 1.15]);
});
