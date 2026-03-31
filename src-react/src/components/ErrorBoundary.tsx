/**
 * Error Boundary Component
 *
 * Catches React errors in the component tree and displays a fallback UI
 * Useful for gracefully handling unexpected errors in the chat interface
 */

import React from "react";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { AlertTriangleIcon } from "lucide-react";

interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    override render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
                    <ConversationEmptyState
                        icon={<AlertTriangleIcon className="size-12" />}
                        title="Something went wrong"
                        description={
                            this.state.error?.message ||
                            "An unexpected error occurred. Please try reloading the page."
                        }
                    />
                    <Button onClick={this.handleReset} variant="outline">
                        Reload Page
                    </Button>
                </div>
            );
        }

        return this.props.children;
    }
}
