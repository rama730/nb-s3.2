import 'dotenv/config';
import { getProjectDetails } from '../src/lib/data/project';

async function main() {
    const slug = 'smart-queue-management-system-b0165';
    console.log(`Testing lookup for slug: "${slug}"`);

    try {
        const project = await getProjectDetails(slug);

        if (project) {
            console.log("SUCCESS: Project found.");
            console.log("ID:", project.id);
            console.log("Title:", project.title);
            console.log("Slug:", project.slug);
        } else {
            console.error("FAILURE: Project returned null (404).");
        }
    } catch (error) {
        console.error("ERROR: Function threw exception:", error);
    }
    process.exit(0);
}

main().catch(console.error);
