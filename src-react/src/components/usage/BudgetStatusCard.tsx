import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Settings } from "lucide-react";
import type { BudgetStatusResponse } from "@shared/types/usage.types";
import { cn } from "@/lib/utils";

interface BudgetStatusCardProps {
  status: BudgetStatusResponse | null;
  loading: boolean;
  onManageBudget: () => void;
}

export function BudgetStatusCard({
  status,
  loading,
  onManageBudget,
}: BudgetStatusCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Budget Status</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!status || !status.budget) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Budget Status</CardTitle>
          <CardDescription>
            No budget configured for this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onManageBudget} variant="outline" size="sm">
            Set Budget
          </Button>
        </CardContent>
      </Card>
    );
  }

  const {
    budget,
    usedCents,
    remainingCents,
    usedPercent,
    isWarning,
    isExceeded,
    periodEnd,
  } = status;

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const getDaysRemaining = (endStr: string) => {
    const end = new Date(endStr);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days < 0) return "expired";
    if (days === 0) return "ends today";
    return `resets in ${days} days`;
  };

  return (
    <Card className={cn(isExceeded && "border-destructive/50")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base font-medium">Budget Status</CardTitle>
          <CardDescription>
            {budget.period.charAt(0).toUpperCase() + budget.period.slice(1)}{" "}
            budget · {getDaysRemaining(periodEnd)}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onManageBudget}
          aria-label="Manage budget"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Used</span>
            <span
              className={cn("font-medium", isExceeded && "text-destructive")}
            >
              {formatCurrency(usedCents)} / {formatCurrency(budget.limitCents)}
            </span>
          </div>
          <Progress
            value={Math.min(usedPercent, 100)}
            className={cn(
              "h-2",
              isExceeded
                ? "[&>div]:bg-destructive"
                : isWarning
                  ? "[&>div]:bg-amber-500"
                  : "",
            )}
          />
        </div>

        <div className="flex items-start gap-2 text-sm">
          {isExceeded ? (
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
          ) : isWarning ? (
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
          ) : (
            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
          )}
          <div className="flex-1">
            {isExceeded ? (
              <p className="text-destructive font-medium">
                Budget exceeded.{" "}
                {budget.actionOnLimit === "block"
                  ? "Requests are blocked."
                  : "You will be notified."}
              </p>
            ) : isWarning ? (
              <p className="text-amber-500 font-medium">
                Warning threshold ({budget.warnAtPercent}%) reached.
              </p>
            ) : (
              <p className="text-muted-foreground">
                You have {formatCurrency(remainingCents)} remaining.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
