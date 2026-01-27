/**
 * Files Migration Script
 * Moves data from task_files (legacy) to project_nodes (hierarchical)
 */

import postgres from 'postgres'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not found')
    process.exit(1)
}

const sql = postgres(DATABASE_URL, { prepare: false, ssl: 'require' })

async function migrateFiles() {
    console.log('🚀 Starting files migration...')

    try {
        // 1. Fetch all legacy files with task project context
        const files = await sql`
            SELECT 
                tf.*,
                t.project_id,
                t.title as task_title
            FROM task_files tf
            JOIN tasks t ON tf.task_id = t.id
            WHERE t.project_id IS NOT NULL
        `

        console.log(`found ${files.length} files to migrate`)

        // Cache for Folder IDs: key = "projectId" -> folderId, and "taskId" -> folderId
        const projectRootFolders = new Map<string, string>() // ProjectId -> "Task Attachments" Folder ID
        const taskFolders = new Map<string, string>() // TaskId -> Task Folder ID

        for (const file of files) {
            const projectId = file.project_id
            const taskId = file.task_id

            // A. Ensure "Task Attachments" folder exists for Project
            if (!projectRootFolders.has(projectId)) {
                // Check DB first
                const [existing] = await sql`
                    SELECT id FROM project_nodes 
                    WHERE project_id = ${projectId} AND parent_id IS NULL AND name = 'Task Attachments' AND type = 'folder'
                `
                if (existing) {
                    projectRootFolders.set(projectId, existing.id)
                } else {
                    const [created] = await sql`
                        INSERT INTO project_nodes (project_id, parent_id, type, name, created_at, updated_at)
                        VALUES (${projectId}, NULL, 'folder', 'Task Attachments', now(), now())
                        RETURNING id
                    `
                    projectRootFolders.set(projectId, created.id)
                }
            }
            const rootId = projectRootFolders.get(projectId)!

            // B. Ensure Task-specific folder exists
            if (!taskFolders.has(taskId)) {
                const [existing] = await sql`
                    SELECT id FROM project_nodes 
                    WHERE project_id = ${projectId} AND parent_id = ${rootId} AND name = ${file.task_title} AND type = 'folder'
                `
                if (existing) {
                    taskFolders.set(taskId, existing.id)
                } else {
                    const [created] = await sql`
                        INSERT INTO project_nodes (project_id, parent_id, type, name, created_at, updated_at)
                        VALUES (${projectId}, ${rootId}, 'folder', ${file.task_title}, now(), now())
                        RETURNING id
                    `
                    taskFolders.set(taskId, created.id)
                }
            }
            const folderId = taskFolders.get(taskId)!

            // C. Insert File Node
            await sql`
                INSERT INTO project_nodes (
                    project_id, 
                    parent_id, 
                    type, 
                    name, 
                    s3_key, 
                    size, 
                    mime_type, 
                    metadata, 
                    created_by, 
                    created_at, 
                    updated_at
                )
                VALUES (
                    ${projectId},
                    ${folderId},
                    'file',
                    ${file.custom_name || file.file_name},
                    ${file.file_path},
                    ${file.file_size},
                    ${file.file_type},
                    ${JSON.stringify({ description: file.description, original_name: file.file_name, tags: file.tags })},
                    ${file.uploaded_by},
                    ${file.created_at},
                    now()
                )
            `
            process.stdout.write('.')
        }

        console.log('\n✅ Migration complete!')

    } catch (e) {
        console.error('Migration failed:', e)
    } finally {
        await sql.end()
    }
}

migrateFiles()
