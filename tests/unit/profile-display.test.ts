import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  availabilityStatusLabel,
  buildOwnerProfileTitle,
  buildProfileMetadataDescription,
  buildPublicProfileTitle,
  normalizeProjectTitle,
} from "../../src/lib/profile/display";

describe("profile display helpers", () => {
  it("builds fallback metadata when bio is too short", () => {
    const description = buildProfileMetadataDescription({
      fullName: "Rama",
      username: "rama",
      headline: "Builder",
      location: "Hyderabad",
      bio: "working",
    });

    assert.equal(description, "Rama is a Builder from Hyderabad on Edge. View their work and connect.");
  });

  it("uses trimmed bio when it is descriptive enough", () => {
    const description = buildProfileMetadataDescription({
      fullName: "Rama",
      bio: "  Building collaborative tools for developers across teams.  ",
    });

    assert.equal(description, "Building collaborative tools for developers across teams.");
  });

  it("uses a location fallback without awkward grammar", () => {
    const description = buildProfileMetadataDescription({
      fullName: "Rama",
      location: "Hyderabad",
      bio: "short",
    });

    assert.equal(description, "Rama is based in Hyderabad on Edge. View their work and connect.");
  });

  it("normalizes availability labels and titles", () => {
    assert.equal(availabilityStatusLabel("available"), "Available");
    assert.equal(buildOwnerProfileTitle({ fullName: "Rama ", username: "rama" }), "Rama (@rama) | Edge");
    assert.equal(buildPublicProfileTitle({ username: "rama" }), "@rama | Edge");
    assert.equal(normalizeProjectTitle(" Network for builders "), "Network for builders");
  });
});
