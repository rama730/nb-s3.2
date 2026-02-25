import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reservedUsernames } from '@/lib/db/schema'
import { isAdminUser } from '@/lib/security/admin'
import { createClient } from '@/lib/supabase/server'
import { RESERVED_USERNAMES, normalizeUsername } from '@/lib/validations/username'
import { asc, eq } from 'drizzle-orm'

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/
const CORE_RESERVED_SET = new Set<string>(RESERVED_USERNAMES)

async function requireAdmin() {
    const supabase = await createClient()
    const { data: authData } = await supabase.auth.getUser()
    const user = authData.user
    if (!user) return { ok: false as const, response: NextResponse.json({ message: 'Not authenticated' }, { status: 401 }) }
    if (!isAdminUser(user)) return { ok: false as const, response: NextResponse.json({ message: 'Forbidden' }, { status: 403 }) }
    return { ok: true as const, user }
}

export async function GET() {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    const rows = await db
        .select({
            username: reservedUsernames.username,
            reason: reservedUsernames.reason,
            createdAt: reservedUsernames.createdAt,
        })
        .from(reservedUsernames)
        .orderBy(asc(reservedUsernames.username))

    return NextResponse.json({ items: rows })
}

export async function POST(request: Request) {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    let body: { username?: string; reason?: string }
    try {
        body = (await request.json()) as { username?: string; reason?: string }
    } catch {
        return NextResponse.json({ message: 'Malformed JSON' }, { status: 400 })
    }

    const username = normalizeUsername(body.username || '')
    if (!USERNAME_PATTERN.test(username)) {
        return NextResponse.json(
            { message: 'Username must be 3-20 chars with lowercase letters, numbers, or underscores' },
            { status: 400 }
        )
    }

    const reason = (body.reason || '').trim().slice(0, 120) || 'admin'

    await db
        .insert(reservedUsernames)
        .values({ username, reason })
        .onConflictDoUpdate({
            target: reservedUsernames.username,
            set: { reason },
        })

    return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
    const admin = await requireAdmin()
    if (!admin.ok) return admin.response

    let body: { username?: string }
    try {
        body = (await request.json()) as { username?: string }
    } catch {
        return NextResponse.json({ message: 'Malformed JSON' }, { status: 400 })
    }

    const username = normalizeUsername(body.username || '')
    if (!username) {
        return NextResponse.json({ message: 'Username is required' }, { status: 400 })
    }
    if (CORE_RESERVED_SET.has(username)) {
        return NextResponse.json({ message: 'Core reserved usernames cannot be removed' }, { status: 400 })
    }

    await db.delete(reservedUsernames).where(eq(reservedUsernames.username, username))
    return NextResponse.json({ success: true })
}
