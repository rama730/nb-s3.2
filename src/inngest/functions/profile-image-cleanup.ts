import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/server";

export const cleanupSupersededProfileImage = inngest.createFunction(
  { id: "profile-image-cleanup", name: "Delete superseded profile image" },
  { event: "storage/profile-image.cleanup" },
  async ({ event, step }) => step.run("delete-avatar-object", async () => {
    const { userId, storageKey } = event.data;
    if (!storageKey.startsWith(`${userId}/`) || storageKey.includes("..")) {
      throw new Error("Invalid profile image cleanup key");
    }

    const admin = await createAdminClient();
    const { error } = await admin.storage.from("avatars").remove([storageKey]);
    if (error) throw new Error(`Profile image cleanup failed: ${error.message}`);
    return { deleted: true };
  }),
);
