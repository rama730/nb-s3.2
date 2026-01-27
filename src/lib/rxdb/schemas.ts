export const projectSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100 // Primary key needs maxLength
        },
        title: {
            type: 'string'
        },
        description: {
            type: 'string'
        },
        short_description: {
            type: 'string'
        },
        status: {
            type: 'string'
        },
        visibility: {
            type: 'string'
        },
        created_at: {
            type: 'string',
            format: 'date-time'
        },
        updated_at: {
            type: 'string',
            format: 'date-time'
        },
        // Relational fields stored as flattened data or specific objects for offline view
        owner_id: {
            type: 'string'
        },
        json_data: {
            type: 'object' // Store complex/nested data here to simplify schema
        }
    },
    required: ['id', 'title']
} as const;

export const profileSchema = {
    version: 1,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        username: {
            type: 'string'
        },
        full_name: {
            type: 'string'
        },
        avatar_url: {
            type: 'string'
        },
        headline: {
            type: 'string'
        },
        bio: {
            type: 'string'
        },
        location: {
            type: 'string'
        },
        website: {
            type: 'string'
        },
        banner_url: {
            type: 'string'
        },
        json_data: {
            type: 'object'
        },
        updated_at: {
            type: 'string',
            format: 'date-time'
        }
    },
    required: ['id', 'username']
} as const;
