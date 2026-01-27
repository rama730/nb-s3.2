"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Button from "@/components/ui-custom/Button";
import { Github, Twitter, Linkedin } from "lucide-react";

export default function IntegrationsSettings() {
    const [connected, setConnected] = React.useState({
        github: false,
        twitter: false,
        linkedin: false,
    });

    const toggleConnection = (service: keyof typeof connected) => {
        // In a real app, this would initiate OAuth flow
        setConnected(prev => ({ ...prev, [service]: !prev[service] }));
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-bold tracking-tight mb-4">Integrations</h2>
                <p className="text-slate-500 dark:text-zinc-400">
                    Connect your account with other services to enhance your experience.
                </p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle>Connected Services</CardTitle>
                    <CardDescription>Manage your connected accounts and services.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors">
                        <div className="flex items-center gap-3">
                            <Github className="w-6 h-6" />
                            <div>
                                <div className="font-medium">GitHub</div>
                                <div className="text-sm text-slate-500">Connect to show your repositories and activity</div>
                            </div>
                        </div>
                        <Button
                            variant={connected.github ? "outline" : "primary"}
                            onClick={() => toggleConnection('github')}
                        >
                            {connected.github ? "Disconnect" : "Connect"}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors">
                        <div className="flex items-center gap-3">
                            <Twitter className="w-6 h-6 text-blue-400" />
                            <div>
                                <div className="font-medium">Twitter / X</div>
                                <div className="text-sm text-slate-500">Share your projects and achievements</div>
                            </div>
                        </div>
                        <Button
                            variant={connected.twitter ? "outline" : "primary"}
                            onClick={() => toggleConnection('twitter')}
                        >
                            {connected.twitter ? "Disconnect" : "Connect"}
                        </Button>
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors">
                        <div className="flex items-center gap-3">
                            <Linkedin className="w-6 h-6 text-blue-700" />
                            <div>
                                <div className="font-medium">LinkedIn</div>
                                <div className="text-sm text-slate-500">Display your professional profile</div>
                            </div>
                        </div>
                        <Button
                            variant={connected.linkedin ? "outline" : "primary"}
                            onClick={() => toggleConnection('linkedin')}
                        >
                            {connected.linkedin ? "Disconnect" : "Connect"}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
