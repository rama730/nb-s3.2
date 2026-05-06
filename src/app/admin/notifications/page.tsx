import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { isAdminUser } from "@/lib/security/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ChannelRollup = {
    channel: string;
    status: string;
    count: number;
};

type ErrorRollup = {
    channel: string;
    errorCode: string | null;
    count: number;
};

type RetentionSnapshot = {
    total: number;
    dismissedBacklog: number;
    readBacklog: number;
    pushSubs: number;
    stalePushSubs: number;
};

async function fetchChannelRollup(hours: number): Promise<ChannelRollup[]> {
    const rows = await db.execute<{ channel: string; status: string; count: string }>(sql`
        SELECT channel, status, COUNT(*)::text AS count
        FROM notification_deliveries
        WHERE attempted_at >= now() - (${hours}::int * INTERVAL '1 hour')
        GROUP BY channel, status
        ORDER BY channel, status
    `);
    return (rows as unknown as Array<{ channel: string; status: string; count: string }>).map((r) => ({
        channel: r.channel,
        status: r.status,
        count: Number(r.count),
    }));
}

async function fetchErrorRollup(hours: number): Promise<ErrorRollup[]> {
    const rows = await db.execute<{ channel: string; error_code: string | null; count: string }>(sql`
        SELECT channel, error_code, COUNT(*)::text AS count
        FROM notification_deliveries
        WHERE attempted_at >= now() - (${hours}::int * INTERVAL '1 hour')
          AND status IN ('failed', 'dropped')
        GROUP BY channel, error_code
        ORDER BY COUNT(*) DESC
        LIMIT 15
    `);
    return (rows as unknown as Array<{ channel: string; error_code: string | null; count: string }>).map((r) => ({
        channel: r.channel,
        errorCode: r.error_code,
        count: Number(r.count),
    }));
}

async function fetchRetentionSnapshot(): Promise<RetentionSnapshot> {
    const rows = await db.execute<{
        total: string;
        dismissed_backlog: string;
        read_backlog: string;
        push_subs: string;
        stale_push_subs: string;
    }>(sql`
        SELECT
            (SELECT COUNT(*)::text FROM user_notifications) AS total,
            (SELECT COUNT(*)::text FROM user_notifications
                WHERE dismissed_at IS NOT NULL
                  AND dismissed_at < now() - INTERVAL '30 days') AS dismissed_backlog,
            (SELECT COUNT(*)::text FROM user_notifications
                WHERE read_at IS NOT NULL
                  AND dismissed_at IS NULL
                  AND read_at < now() - INTERVAL '90 days') AS read_backlog,
            (SELECT COUNT(*)::text FROM push_subscriptions) AS push_subs,
            (SELECT COUNT(*)::text FROM push_subscriptions
                WHERE last_seen_at < now() - INTERVAL '60 days'
                   OR failure_count >= 5) AS stale_push_subs
    `);
    const list = rows as unknown as Array<{
        total: string;
        dismissed_backlog: string;
        read_backlog: string;
        push_subs: string;
        stale_push_subs: string;
    }>;
    const row = list[0];
    return {
        total: Number(row?.total ?? 0),
        dismissedBacklog: Number(row?.dismissed_backlog ?? 0),
        readBacklog: Number(row?.read_backlog ?? 0),
        pushSubs: Number(row?.push_subs ?? 0),
        stalePushSubs: Number(row?.stale_push_subs ?? 0),
    };
}

function formatRate(successes: number, total: number): string {
    if (total === 0) return "—";
    const pct = (successes / total) * 100;
    return `${pct.toFixed(1)}%`;
}

function aggregateByChannel(rollup: ChannelRollup[]): Map<string, { delivered: number; failed: number; dropped: number; total: number }> {
    const map = new Map<string, { delivered: number; failed: number; dropped: number; total: number }>();
    for (const row of rollup) {
        const entry = map.get(row.channel) ?? { delivered: 0, failed: 0, dropped: 0, total: 0 };
        if (row.status === "delivered") entry.delivered += row.count;
        else if (row.status === "failed") entry.failed += row.count;
        else if (row.status === "dropped") entry.dropped += row.count;
        entry.total += row.count;
        map.set(row.channel, entry);
    }
    return map;
}

export default async function AdminNotificationsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!isAdminUser(user)) {
        notFound();
    }

    const [rollup24h, rollup7d, errorRollup, retention] = await Promise.all([
        fetchChannelRollup(24),
        fetchChannelRollup(24 * 7),
        fetchErrorRollup(24 * 7),
        fetchRetentionSnapshot(),
    ]);

    const by24h = aggregateByChannel(rollup24h);
    const by7d = aggregateByChannel(rollup7d);
    const channels = Array.from(new Set([...by24h.keys(), ...by7d.keys()])).sort();

    return (
        <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
            <header>
                <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Notifications ops</h1>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Per-channel throughput, failure rate, and retention backlog.
                </p>
            </header>

            <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Throughput & success rate
                </h2>
                <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                            <tr>
                                <th className="px-4 py-2">Channel</th>
                                <th className="px-4 py-2">Window</th>
                                <th className="px-4 py-2">Total</th>
                                <th className="px-4 py-2">Delivered</th>
                                <th className="px-4 py-2">Failed</th>
                                <th className="px-4 py-2">Dropped</th>
                                <th className="px-4 py-2">Success rate</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {channels.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                                        No delivery attempts logged yet.
                                    </td>
                                </tr>
                            ) : null}
                            {channels.flatMap((channel) => {
                                const w24 = by24h.get(channel) ?? { delivered: 0, failed: 0, dropped: 0, total: 0 };
                                const w7 = by7d.get(channel) ?? { delivered: 0, failed: 0, dropped: 0, total: 0 };
                                return [
                                    <tr key={`${channel}-24h`}>
                                        <td className="px-4 py-2 font-medium">{channel}</td>
                                        <td className="px-4 py-2 text-zinc-500">24h</td>
                                        <td className="px-4 py-2">{w24.total}</td>
                                        <td className="px-4 py-2 text-emerald-600 dark:text-emerald-400">{w24.delivered}</td>
                                        <td className="px-4 py-2 text-red-600 dark:text-red-400">{w24.failed}</td>
                                        <td className="px-4 py-2 text-amber-600 dark:text-amber-400">{w24.dropped}</td>
                                        <td className="px-4 py-2 font-mono">{formatRate(w24.delivered, w24.total)}</td>
                                    </tr>,
                                    <tr key={`${channel}-7d`} className="text-zinc-500">
                                        <td className="px-4 py-2"></td>
                                        <td className="px-4 py-2">7d</td>
                                        <td className="px-4 py-2">{w7.total}</td>
                                        <td className="px-4 py-2">{w7.delivered}</td>
                                        <td className="px-4 py-2">{w7.failed}</td>
                                        <td className="px-4 py-2">{w7.dropped}</td>
                                        <td className="px-4 py-2 font-mono">{formatRate(w7.delivered, w7.total)}</td>
                                    </tr>,
                                ];
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Top failure / drop reasons (7d)
                </h2>
                <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-sm">
                        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                            <tr>
                                <th className="px-4 py-2">Channel</th>
                                <th className="px-4 py-2">Error code</th>
                                <th className="px-4 py-2">Count</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {errorRollup.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                                        No failures or drops in last 7 days.
                                    </td>
                                </tr>
                            ) : errorRollup.map((row) => (
                                <tr key={`${row.channel}:${row.errorCode ?? "null"}`}>
                                    <td className="px-4 py-2 font-medium">{row.channel}</td>
                                    <td className="px-4 py-2 font-mono text-xs">{row.errorCode ?? "—"}</td>
                                    <td className="px-4 py-2">{row.count}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    Retention backlog
                </h2>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <dt className="text-xs uppercase tracking-wide text-zinc-500">Total notifications</dt>
                        <dd className="mt-1 text-2xl font-semibold">{retention.total.toLocaleString()}</dd>
                    </div>
                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <dt className="text-xs uppercase tracking-wide text-zinc-500">Dismissed &gt; 30d (pending purge)</dt>
                        <dd className={`mt-1 text-2xl font-semibold ${retention.dismissedBacklog > 10000 ? "text-red-600 dark:text-red-400" : ""}`}>
                            {retention.dismissedBacklog.toLocaleString()}
                        </dd>
                    </div>
                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <dt className="text-xs uppercase tracking-wide text-zinc-500">Read &gt; 90d (pending purge)</dt>
                        <dd className={`mt-1 text-2xl font-semibold ${retention.readBacklog > 10000 ? "text-red-600 dark:text-red-400" : ""}`}>
                            {retention.readBacklog.toLocaleString()}
                        </dd>
                    </div>
                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <dt className="text-xs uppercase tracking-wide text-zinc-500">Push subscriptions</dt>
                        <dd className="mt-1 text-2xl font-semibold">{retention.pushSubs.toLocaleString()}</dd>
                    </div>
                    <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                        <dt className="text-xs uppercase tracking-wide text-zinc-500">Stale subs (pending prune)</dt>
                        <dd className={`mt-1 text-2xl font-semibold ${retention.stalePushSubs > 500 ? "text-amber-600 dark:text-amber-400" : ""}`}>
                            {retention.stalePushSubs.toLocaleString()}
                        </dd>
                    </div>
                </dl>
                <p className="mt-3 text-xs text-zinc-500">
                    Backlog should be near-zero if the nightly retention job is running. Large numbers mean the job is failing — check Inngest.
                </p>
            </section>
        </div>
    );
}
