import { createRxDatabase, RxDatabase, RxCollection, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { wrappedValidateAjvStorage } from 'rxdb/plugins/validate-ajv';
import { RxDBQueryBuilderPlugin } from 'rxdb/plugins/query-builder';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { projectSchema, profileSchema } from './schemas';

// Enable dev mode for better error messages
if (process.env.NODE_ENV === 'development') {
    addRxPlugin(RxDBDevModePlugin);
}

// Add query builder plugin for complex queries (sort, etc.)
addRxPlugin(RxDBQueryBuilderPlugin);
// Add update plugin for document updates
addRxPlugin(RxDBUpdatePlugin);
// Add migration plugin to handle schema version changes
addRxPlugin(RxDBMigrationSchemaPlugin);

import { replicateSupabase, replicateSupabaseProfiles } from './replication';

// Define types for TypeScript support
export type ProjectDoc = {
    id: string;
    title: string;
    description?: string;
    short_description?: string;
    status?: string;
    visibility?: string;
    created_at?: string;
    updated_at?: string;
    owner_id?: string;
    json_data?: any;
};

export type ProfileDoc = {
    id: string;
    username: string;
    full_name?: string;
    avatar_url?: string;
    headline?: string;
    updated_at?: string;
};

export type MyDatabaseCollections = {
    projects: RxCollection<ProjectDoc>;
    profiles: RxCollection<ProfileDoc>;
};

export type MyDatabase = RxDatabase<MyDatabaseCollections>;

let dbPromise: Promise<MyDatabase> | null = null;

export const createDatabase = async (): Promise<MyDatabase> => {
    // Return existing promise if already initializing (Singleton pattern)
    if (dbPromise) return dbPromise;

    dbPromise = (async () => {
        console.log('RxDB: Initializing database...');

        const storage = process.env.NODE_ENV === 'development'
            ? wrappedValidateAjvStorage({ storage: getRxStorageDexie() })
            : getRxStorageDexie();

        const db = await createRxDatabase<MyDatabaseCollections>({
            name: 'edgesync_db',
            storage,
            ignoreDuplicate: true // Helpful for React HMR
        });

        console.log('RxDB: Creating collections...');
        await db.addCollections({
            projects: {
                schema: projectSchema
            },
            profiles: {
                schema: profileSchema,
                migrationStrategies: {
                    // Simple migration: Just return the old doc, new fields will be undefined
                    1: function (oldDoc) {
                        return oldDoc;
                    }
                }
            }
        });

        console.log('RxDB: Database ready.');

        // Start replication
        await replicateSupabase(db.projects);
        await replicateSupabaseProfiles(db.profiles);

        return db;
    })();

    return dbPromise;
};

export const getDatabase = () => {
    if (!dbPromise) return createDatabase();
    return dbPromise;
};
