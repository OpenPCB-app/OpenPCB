import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { UsageSummaryResponse } from "@shared/types/usage.types";

interface UsageByProviderChartProps {
  summary: UsageSummaryResponse | null;
  loading: boolean;
}

export function UsageByProviderChart({
  summary,
  loading,
}: UsageByProviderChartProps) {
  if (loading || !summary?.byProvider) {
    return null;
  }

  const providers = Object.entries(summary.byProvider).sort(
    (a, b) => b[1].costCents - a[1].costCents,
  );

  if (providers.length === 0) {
    return null;
  }

  const maxCost = Math.max(...providers.map(([, data]) => data.costCents));

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">
          Usage by Provider
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {providers.map(([provider, data]) => (
            <div key={provider} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium capitalize">{provider}</span>
                <span className="text-muted-foreground">
                  {formatCurrency(data.costCents)}
                </span>
              </div>
              <div
                className="h-2 w-full rounded-full bg-secondary overflow-hidden"
                role="progressbar"
                aria-valuenow={
                  maxCost > 0 ? Math.round((data.costCents / maxCost) * 100) : 0
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${provider} cost proportion`}
              >
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${maxCost > 0 ? (data.costCents / maxCost) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {new Intl.NumberFormat("en-US").format(data.tokens)} tokens
                </span>
                <span>{data.requests} reqs</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
