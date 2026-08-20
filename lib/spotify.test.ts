import { describe, expect, it } from "vitest";
import { choosePlaybackDevice } from "./spotify";

const device = (id: string, overrides: Partial<{ type: string; is_active: boolean; is_restricted: boolean }> = {}) => ({
  id, type: "Smartphone", is_active: false, is_restricted: false, ...overrides,
});

describe("choosePlaybackDevice", () => {
  it("keeps the originally selected phone while Spotify still reports it", () => {
    expect(choosePlaybackDevice([device("phone"), device("laptop", { type: "Computer", is_active: true })], "phone")?.id).toBe("phone");
  });

  it("recovers a changed mobile device id by selecting the active device", () => {
    expect(choosePlaybackDevice([device("new-phone", { is_active: true }), device("laptop", { type: "Computer" })], "old-phone")?.id).toBe("new-phone");
  });

  it("does not guess between multiple inactive devices", () => {
    expect(choosePlaybackDevice([device("phone"), device("laptop", { type: "Computer" })], "missing")).toBeNull();
  });

  it("ignores restricted and unsupported devices", () => {
    expect(choosePlaybackDevice([
      device("speaker", { type: "Speaker", is_active: true }),
      device("restricted", { is_restricted: true, is_active: true }),
    ], "missing")).toBeNull();
  });
});
