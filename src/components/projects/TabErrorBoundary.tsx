"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface TabErrorBoundaryProps {
    children: ReactNode;
    tabName: string;
}

interface TabErrorBoundaryState {
    hasError: boolean;
    error?: Error;
}

export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
    constructor(props: TabErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error(`Error in ${this.props.tabName} tab:`, error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 p-8 text-center">
                    <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-red-900 dark:text-red-200 mb-2">
                        Something went wrong in {this.props.tabName}
                    </h3>
                    <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                        {this.state.error?.message || "An unexpected error occurred"}
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: undefined })}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors text-sm font-medium"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default TabErrorBoundary;
