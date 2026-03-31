import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UsageSummaryResponse } from "@shared/types/usage.types";
import { Coins, Zap, Activity } from "lucide-react";

interface UsageSummaryCardProps {
  summary: UsageSummaryResponse | null;
  loading: boolean;
  period: "day" | "week" | "month" | "all";
  onPeriodChange: (period: "day" | "week" | "month" | "all") => void;
}

export function UsageSummaryCard({
  summary,
  loading,
  period,
  onPeriodChange,
}: UsageSummaryCardProps) {
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Usage Summary</CardTitle>
        <Select
          value={period}
          onValueChange={(val) =>
            onPeriodChange(val as "day" | "week" | "month" | "all")
          }
        >
          <SelectTrigger className="w-[120px] h-8 text-xs">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col space-y-1.5 p-4 border rounded-lg bg-card/50">
            <div className="flex items-center space-x-2 text-muted-foreground mb-1">
              <Coins className="w-4 h-4" />
              <span className="text-sm font-medium">Total Cost</span>
            </div>
            <div className="text-2xl font-bold">
              {loading
                ? "..."
                : summary
                  ? formatCurrency(summary.totalCostCents)
                  : "$0.00"}
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated cost for period
            </p>
          </div>

          <div className="flex flex-col space-y-1.5 p-4 border rounded-lg bg-card/50">
            <div className="flex items-center space-x-2 text-muted-foreground mb-1">
              <Zap className="w-4 h-4" />
              <span className="text-sm font-medium">Total Tokens</span>
            </div>
            <div className="text-2xl font-bold">
              {loading
                ? "..."
                : summary
                  ? formatNumber(summary.totalTokens)
                  : "0"}
            </div>
            <p className="text-xs text-muted-foreground">
              {loading
                ? "— in / — out"
                : `${summary ? formatNumber(summary.promptTokens) : "0"} in / ${summary ? formatNumber(summary.completionTokens) : "0"} out`}
            </p>
          </div>

          <div className="flex flex-col space-y-1.5 p-4 border rounded-lg bg-card/50">
            <div className="flex items-center space-x-2 text-muted-foreground mb-1">
              <Activity className="w-4 h-4" />
              <span className="text-sm font-medium">Requests</span>
            </div>
            <div className="text-2xl font-bold">
              {loading
                ? "..."
                : summary
                  ? formatNumber(summary.requestCount)
                  : "0"}
            </div>
            <p className="text-xs text-muted-foreground">Total API calls</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
