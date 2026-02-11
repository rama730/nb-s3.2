"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui-custom/Button";
import { Loader2, Trash2 } from "lucide-react";

import { parseUserAgent } from "@/lib/utils/device";
import type { Session as SessionType } from "@/lib/types/settingsTypes";

interface Session {
    id: string;
    device_info: { userAgent: string };
    ip_address: string;
    last_active: string;
    is_current?: boolean;
}

interface SessionsListProps {
    initialSessions?: SessionType[];
}

export function SessionsList({ initialSessions }: SessionsListProps) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(!initialSessions);
    const [revoking, setRevoking] = useState<string | null>(null);

    useEffect(() => {
        fetchSessions();
    }, []);

    const fetchSessions = async () => {
        try {
            const res = await fetch('/api/v1/sessions');
            const json = await res.json();
            if (json.success) {
                setSessions(json.data.sessions);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleRevoke = async (id: string) => {
        setRevoking(id);
        try {
            await fetch(`/api/v1/sessions/${id}`, { method: 'DELETE' });
            setSessions(prev => prev.filter(s => s.id !== id));
        } catch {
            alert("Failed to revoke");
        } finally {
            setRevoking(null);
        }
    };

    const handleRevokeAll = async () => {
        if (!confirm("Are you sure you want to log out of all devices?")) return;
        setRevoking('all');
        try {
            await fetch('/api/v1/sessions/all', { method: 'DELETE' });
            setSessions([]);
        } finally {
            setRevoking(null);
        }
    };

    if (loading) return <div>Loading sessions...</div>;

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h4 className="font-medium">Active Sessions</h4>
                {sessions.length > 0 && (
                    <Button variant="outline" size="sm" onClick={handleRevokeAll} disabled={!!revoking}>
                        {revoking === 'all' ? <Loader2 className="h-3 w-3 animate-spin" /> : "Log Out All Devices"}
                    </Button>
                )}
            </div>

            {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active sessions found.</p>
            ) : (
                <div className="space-y-2">
                    {sessions.map(session => {
                        const { browser, os, icon: Icon } = parseUserAgent(session.device_info.userAgent);
                        return (
                            <div key={session.id} className="flex items-center justify-between p-3 border rounded-md">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                                        <Icon className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium flex items-center gap-2">
                                            {browser} on {os}
                                            {session.is_current && (
                                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                                                    This Device
                                                </span>
                                            )}
                                        </p>
                                        <p className="text-xs text-muted-foreground w-full truncate max-w-[200px] sm:max-w-md">
                                            {session.ip_address} • Last active: {new Date(session.last_active).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRevoke(session.id)}
                                    disabled={!!revoking}
                                >
                                    {revoking === session.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-500" />}
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
