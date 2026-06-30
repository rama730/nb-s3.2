import { config } from "dotenv";
config({ path: ".env.local" });
import { createAdminClient } from "../src/lib/supabase/server";

async function main() {
    const admin = await createAdminClient();
    const bucketName = "project-files";
    const testKey = "test-debug-info.txt";
    
    console.log("Uploading dummy file...");
    const { error: uploadError } = await admin.storage
        .from(bucketName)
        .upload(testKey, Buffer.from("hello world"), {
            contentType: "text/plain",
            upsert: true,
            metadata: {
                "checksum-sha256": "expected_checksum_here"
            }
        });

    if (uploadError) {
        console.error("Upload failed:", uploadError);
        return;
    }

    console.log("Calling info()...");
    const { data: infoData, error: infoError } = await admin.storage
        .from(bucketName)
        .info(testKey);

    if (infoError) {
        console.error("info() failed:", infoError);
    } else {
        console.log("info() returned:", JSON.stringify(infoData, null, 2));
    }

    // Clean up
    await admin.storage.from(bucketName).remove([testKey]);
}

main().catch(console.error);
