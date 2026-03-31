import React from 'react';
import { useAuthStore } from '@/stores/auth-store';

interface AuthGuardProps {
    children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
    const status = useAuthStore((state) => state.status);
    const error = useAuthStore((state) => state.error);

    if (status === 'pending' || status === 'loading') {
        return (
            <div 
                data-testid="auth-loading"
                className="flex h-screen w-screen items-center justify-center bg-background"
            >
                <div className="flex flex-col items-center gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    <p className="text-sm text-muted-foreground">Initializing application...</p>
                </div>
            </div>
        );
    }

    if (status === 'blocked') {
        return (
            <div 
                data-testid="auth-blocked"
                className="flex h-screen w-screen items-center justify-center bg-background"
            >
                <div className="max-w-md space-y-4 p-6 text-center">
                    <h1 className="text-2xl font-bold text-destructive">Access Blocked</h1>
                    <p className="text-muted-foreground">
                        {error || 'Your license is invalid or has expired. Please contact support.'}
                    </p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};
