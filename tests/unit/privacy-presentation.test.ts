import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrivacyPresentation, buildProjectOwnerPresentation } from "@/lib/privacy/presentation";
import { derivePrivacyRelationshipState } from "@/lib/privacy/relationship-state";

describe("privacy presentation", () => {
    it("maps locked-shell relationships to stable display copy", () => {
        const relationship = derivePrivacyRelationshipState({
            viewerId: "viewer",
            targetUserId: "target",
            profileVisibility: "connections",
            messagePrivacy: "connections",
            connectionPrivacy: "everyone",
        });

        const presentation = buildPrivacyPresentation(relationship);

        assert.equal(presentation.relationshipBadgeText, "Connections only");
        assert.equal(presentation.ownerDisplayMode, "masked");
        assert.equal(presentation.canOpenProfile, false);
    });

    it("masks project owner attribution for non-eligible viewers", () => {
        const relationship = derivePrivacyRelationshipState({
            viewerId: "viewer",
            targetUserId: "target",
            profileVisibility: "private",
            messagePrivacy: "connections",
            connectionPrivacy: "everyone",
        });

        const owner = buildProjectOwnerPresentation({
            id: "target",
            username: "private-user",
            fullName: "Private User",
            avatarUrl: "https://example.com/a.png",
        }, relationship);

        assert.equal(owner?.displayName, "Private creator");
        assert.equal(owner?.isMasked, true);
        assert.equal(owner?.canOpenProfile, false);
        assert.equal(owner?.username, null);
        assert.equal(owner?.avatarUrl, null);
    });
});
