
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

function getDatabaseUrl() {
    try {
        const envPath = path.resolve(__dirname, '../.env.local');
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/DATABASE_URL=(.*)/);
        if (match && match[1]) {
            let url = match[1].trim();
            // Remove quotes if present
            if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
                url = url.slice(1, -1);
            }
            // Force IPv4
            return url.replace('localhost', '127.0.0.1');
        }
    } catch (e) {
        console.error("Could not read .env.local", e);
    }
    return process.env.DATABASE_URL;
}

function generateProjectKey(title) {
    const clean = title.replace(/[^a-zA-Z0-9\s]/g, "").trim().toUpperCase();
    const words = clean.split(/\s+/);
    if (words.length === 1) {
        const word = words[0];
        return word.length <= 2 ? word : word.substring(0, 2);
    } else {
        let key = "";
        for (let i = 0; i < Math.min(words.length, 3); i++) {
            key += words[i][0];
        }
        return key;
    }
}

async function main() {
    const url = getDatabaseUrl();
    if (!url) {
        console.error("No DATABASE_URL found");
        process.exit(1);
    }
    console.log("Connecting to:", url.replace(/:[^:]+@/, ':***@'));

    const sql = postgres(url, { max: 1 });

    try {
        console.log("Fetching projects...");
        const projects = await sql`SELECT id, title, key FROM projects`;
        
        for (const project of projects) {
            let key = project.key;
            if (!key) {
                key = generateProjectKey(project.title);
                console.log(`Assigning key ${key} to project ${project.title}`);
                await sql`UPDATE projects SET key = ${key} WHERE id = ${project.id}`;
            }

            // Backfill tasks
            const tasks = await sql`SELECT id, task_number FROM tasks WHERE project_id = ${project.id} ORDER BY created_at ASC`;
            console.log(`Project ${project.title}: Processing ${tasks.length} tasks...`);
            
            let counter = 1;
            for (const task of tasks) {
                if (!task.task_number) {
                    await sql`UPDATE tasks SET task_number = ${counter} WHERE id = ${task.id}`;
                } else {
                    // Update counter to continue from highest existing if mixed
                    // But we want to ensure current_task_number is correct at end
                    // Just strictly re-numbering nulls:
                }
                // To be safe, we track the max counter
                counter++;
            }
             
            // Update project counter
            await sql`UPDATE projects SET current_task_number = ${counter - 1} WHERE id = ${project.id}`;
        }
        
        console.log("Done!");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await sql.end();
    }
}

main();
