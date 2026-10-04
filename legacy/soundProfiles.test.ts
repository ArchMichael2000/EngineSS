import { describe, expect, it } from "vitest";
import { SOUND_PROFILE_HISTORY, normalizeSoundProfile } from "./soundProfiles";

describe("sound profile history", () => {
  it("keeps versioned profiles while accepting old saved aliases", () => {
    expect(SOUND_PROFILE_HISTORY.map((profile) => profile.value)).toEqual(["v16", "v15", "v14", "v13", "v12", "v11", "v10", "v9", "v8", "v0"]);
    expect(normalizeSoundProfile("clarity")).toBe("v9");
    expect(normalizeSoundProfile("clean")).toBe("v8");
    expect(normalizeSoundProfile("baseline")).toBe("v0");
    expect(normalizeSoundProfile(undefined)).toBe("v16");
  });
});
