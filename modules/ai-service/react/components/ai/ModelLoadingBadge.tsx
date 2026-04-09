import type { ModelLoadingState } from '@/stores/model-loading-store';
import { cn } from '@/lib/utils';

interface ModelLoadingBadgeProps {
    modelName: string;
    loadingState: ModelLoadingState | null;
    className?: string;
}

/**
 * Model badge with loading indicator
 *
 * Visual states:
 * - IDLE/READY: Static badge with model name
 * - CHECKING/LOADING: Badge with animated underline
 * - ERROR: Badge with error styling (triggers modal via parent)
 */
export function ModelLoadingBadge({
    modelName,
    loadingState,
    className,
}: ModelLoadingBadgeProps) {
    const status = loadingState?.status || 'idle';
    const isLoading = status === 'checking' || status === 'loading';
    const isError = status === 'error';

    // Format model name for display
    const displayName = modelName.split(':')[0] || modelName;

    return (
        <div className={cn('relative inline-flex flex-col', className)}>
            {/* Badge */}
            <div
                className={cn(
                    'px-2 py-1 text-xs font-medium rounded-md transition-colors',
                    isError
                        ? 'bg-destructive/10 text-destructive'
                        : isLoading
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                )}
            >
                {isLoading ? (
                    <span className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                        </span>
                        {status === 'checking' ? 'Checking...' : `Loading ${displayName}...`}
                    </span>
                ) : isError ? (
                    <span className="flex items-center gap-1.5">
                        <svg
                            className="h-3 w-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                            />
                        </svg>
                        {displayName}
                    </span>
                ) : (
                    displayName
                )}
            </div>

            {/* Indeterminate progress bar (thin line below badge) */}
            {isLoading && (
                <div className="relative h-0.5 w-full overflow-hidden bg-primary/20 rounded-full mt-0.5">
                    <div className="absolute h-full w-1/3 animate-indeterminate bg-primary rounded-full" />
                </div>
            )}
        </div>
    );
}
