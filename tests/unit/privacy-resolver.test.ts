import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { derivePrivacyRelationshipState } from "@/lib/privacy/relationship-state";

describe("privacy resolver", () => {
    it("allows owners to view their own profile without interaction actions", () => {
        const state = derivePrivacyRelationshipState({
            viewerId: "user-1",
            targetUserId: "user-1",
            profileVisibility: "private",
            messagePrivacy: "connections",
            connectionPrivacy: "nobody",
        });

        assert.equal(state.isSelf, true);
        assert.equal(state.canViewProfile, true);
        assert.equal(state.visibilityReason, "self");
        assert.equal(state.canSendConnectionRequest, false);
        assert.equal(state.canSendMessage, false);
    });

    it("treats blocked relationships as highest precedence", () => {
        const state = derivePrivacyRelationshipState({
            viewerId: "viewer",
            targetUserId: "target",
            profileVisibility: "public",
            messagePrivacy: "everyone",
            connectionPrivacy: "everyone",
            latestConnection: {
                id: "conn-1",
                requesterId: "viewer",
                addresseeId: "target",
                status: "blocked",
                blockedBy: "viewer",
            },
        });

        assert.equal(state.blockedByViewer, true);
        assert.equal(state.canViewProfile, false);
        assert.equal(state.canSendConnectionRequest, false);
        assert.equal(state.canSendMessage, false);
        assert.equal(state.visibilityReason, "blocked");
        assert.equal(state.shouldHideFromDiscovery, true);
    });

    it("enforces mutual-only connection request rules", () => {
        const denied = derivePrivacyRelationshipState({
            viewerId: "viewer",
            targetUserId: "target",
            profileVisibility: "private",
            messagePrivacy: "connections",
            connectionPrivacy: "mutuals_only",
            mutualAcceptedCount: 0,
        });
        const allowed = derivePrivacyRelationshipState({
            viewerId: "viewer",
            targetUserId: "target",
            profileVisibility: "private",
            messagePrivacy: "connections",
            connectionPrivacy: "mutuals_only",
            mutualAcceptedCount: 2,
        });

        assert.equal(denied.canSendConnectionRequest, false);
        assert.equal(allowed.canSendConnectionRequest, true);
        assert.equal(allowed.canViewProfile, false);
        assert.equal(allowed.visibilityReason, "private");
    });

    it("lets everyone-message accounts receive DMs from non-connections", () => {
        const state = derivePrivacyRelationshipState({
            viewerId: "viewer",
            targetUserId: "target",
            profileVisibility: "connections",
            messagePrivacy: "everyone",
            connectionPrivacy: "everyone",
        });

        assert.equal(state.canViewProfile, false);
        assert.equal(state.canSendMessage, true);
        assert.equal(state.canSendConnectionRequest, true);
        assert.equal(state.connectionState, "none");
    });

    it("unlocks full profile access for accepted connections", () => {
        const state = derivePrivacyRelationshipState({
            viewerId: "viewer",
            targetUserId: "target",
            profileVisibility: "connections",
            messagePrivacy: "connections",
            connectionPrivacy: "nobody",
            latestConnection: {
                id: "conn-2",
                requesterId: "viewer",
                addresseeId: "target",
                status: "accepted",
                blockedBy: null,
            },
        });

        assert.equal(state.isConnected, true);
        assert.equal(state.canViewProfile, true);
        assert.equal(state.canSendMessage, true);
        assert.equal(state.canSendConnectionRequest, false);
        assert.equal(state.visibilityReason, "connected");
    });
});
