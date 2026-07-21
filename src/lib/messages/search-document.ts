import { sql, type SQLWrapper } from 'drizzle-orm';

export function buildMessageSearchDocumentSql(params: {
    content: SQLWrapper;
    metadata: SQLWrapper;
}) {
    return sql<string>`trim(regexp_replace(
        concat_ws(
            ' ',
            trim(regexp_replace(coalesce(${params.content}, ''), '\\s+', ' ', 'g')),
            trim(regexp_replace(coalesce(${params.metadata} #>> '{structured,title}', ''), '\\s+', ' ', 'g')),
            trim(regexp_replace(coalesce(${params.metadata} #>> '{structured,summary}', ''), '\\s+', ' ', 'g'))
        ),
        '\\s+',
        ' ',
        'g'
    ))`;
}
