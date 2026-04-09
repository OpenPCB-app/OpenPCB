import { CheckCircle2, AlertCircle, Info, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProviderStatusVariant = "active" | "missing" | "optional" | "oauth-active" | "oauth-expired" | "oauth-pending";

interface ProviderStatusBadgeProps {
    variant: ProviderStatusVariant;
    className?: string;
}

export function ProviderStatusBadge({ variant, className }: ProviderStatusBadgeProps) {
    const config = {
        active: {
            icon: CheckCircle2,
            label: "Active",
            className: "bg-green-500/10 text-green-500 border-green-500/20",
        },
        missing: {
            icon: AlertCircle,
            label: "Setup Required",
            className: "bg-amber-500/10 text-amber-500 border-amber-500/20",
        },
        optional: {
            icon: Info,
            label: "No key required",
            className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        },
        "oauth-active": {
            icon: CheckCircle2,
            label: "OAuth Connected",
            className: "bg-green-500/10 text-green-500 border-green-500/20",
        },
        "oauth-expired": {
            icon: AlertTriangle,
            label: "OAuth Expired",
            className: "bg-amber-500/10 text-amber-500 border-amber-500/20",
        },
        "oauth-pending": {
            icon: Clock,
            label: "OAuth Pending",
            className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        },
    }[variant];

    const Icon = config.icon;

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
                config.className,
                className
            )}
        >
            <Icon className="h-3 w-3" />
            {config.label}
        </span>
    );
}
