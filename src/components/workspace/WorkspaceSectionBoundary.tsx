"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
    children: ReactNode;
    sectionName: string;
}

interface State {
    hasError: boolean;
}

export class WorkspaceSectionBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error) {
        console.error(`[Workspace] Error in ${this.props.sectionName}:`, error);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-full bg-white dark:bg-zinc-900 rounded-xl border border-rose-200 dark:border-rose-900/50 p-4 flex flex-col items-center justify-center text-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                    <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                        Failed to load {this.props.sectionName}
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false })}
                        className="flex items-center gap-1 text-[10px] font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                    >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
