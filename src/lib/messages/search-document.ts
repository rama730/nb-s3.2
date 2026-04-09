import { sql, type SQLWrapper } from 'drizzle-orm';
import { getStructuredMessageFromMetadata } from '@/lib/messages/structured';

type SearchMetadata = Record<string, unknown> | null | undefined;

export function buildMessageSearchDocument(params: {
    content?: string | null;
    metadata?: SearchMetadata;
}) {
    const structured = getStructuredMessageFromMetadata(params.metadata);
    return [
        params.content ?? '',
        structured?.title ?? '',
        structured?.summary ?? '',
    ]
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
}

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
