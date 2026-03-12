'use client';

import React from 'react';

export function ProfileShell({
    header,
    tabs,
    main,
    rail,
}: {
    header: React.ReactNode;
    tabs: React.ReactNode;
    main: React.ReactNode;
    rail: React.ReactNode;
}) {
    return (
        <div className="min-h-full bg-zinc-50 dark:bg-black">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
                <div className="space-y-6">
                    {header}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
                        <div className="lg:col-span-8 space-y-6">
                            {tabs}
                            {main}
                        </div>
                        <div className="hidden lg:block lg:col-span-4">
                            <div
                                className="sticky space-y-6"
                                style={{
                                    top: "24px",
                                }}
                            >
                                {rail}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
