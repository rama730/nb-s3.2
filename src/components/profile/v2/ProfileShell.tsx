'use client';

import React from 'react';

export function ProfileShell({
    header,
    tabs,
    main,
    mainBottom,
    highlights,
    rail,
}: {
    header: React.ReactNode;
    tabs: React.ReactNode;
    main: React.ReactNode;
    mainBottom?: React.ReactNode;
    highlights?: React.ReactNode;
    rail: React.ReactNode;
}) {
    return (
        <div className="min-h-full bg-zinc-50 dark:bg-black">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
                <div className="space-y-6">
                    {header}
                    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:gap-8 lg:items-start">
                        <div className="contents lg:col-span-8 lg:block lg:space-y-6">
                            {/* ponytail: the tab card sticks without taking a separate page row from the right rail. */}
                            <div
                                data-testid="profile-tabs-shell"
                                className="order-1 sticky z-30 -mx-4 px-4 transition-all duration-200 sm:mx-0 sm:px-0"
                                style={{ top: "12px" }}
                            >
                                {tabs}
                            </div>
                            <div className="order-2">{main}</div>
                            {mainBottom ? <div className="order-4">{mainBottom}</div> : null}
                        </div>
                        <aside className="contents lg:col-span-4 lg:block" aria-label="Profile details">
                            <div
                                className="contents lg:sticky lg:block lg:space-y-6"
                                style={{
                                    top: "24px",
                                }}
                            >
                                {highlights ? <div className="order-3 space-y-6">{highlights}</div> : null}
                                {rail ? <div className="order-5 space-y-6">{rail}</div> : null}
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
