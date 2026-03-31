import { useState } from "react";
import {
  useUsageSummary,
  useBudgetStatus,
  useBudgetMutations,
} from "@/hooks/useUsage";
import { UsageSummaryCard } from "@/components/usage/UsageSummaryCard";
import { UsageByProviderChart } from "@/components/usage/UsageByProviderChart";
import { BudgetStatusCard } from "@/components/usage/BudgetStatusCard";
import { BudgetSettingsDialog } from "@/components/usage/BudgetSettingsDialog";
import { useToast } from "@/components/ui/use-toast";
import type { CreateUsageBudgetInput } from "@shared/types/usage.types";
import { BarChart3 } from "lucide-react";

export function UsagePanel() {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "all">(
    "month",
  );
  const [showBudgetDialog, setShowBudgetDialog] = useState(false);

  const { summary, loading: summaryLoading } = useUsageSummary(period);

  const {
    status: budgetStatus,
    loading: budgetLoading,
    refetch: refetchBudget,
  } = useBudgetStatus();

  const { createBudget, updateBudget, deleteBudget } = useBudgetMutations();
  const { toast } = useToast();

  const handleSaveBudget = async (
    input: Omit<CreateUsageBudgetInput, "workspaceId">,
  ) => {
    try {
      if (budgetStatus?.budget) {
        await updateBudget(budgetStatus.budget.id, input);
        toast({
          title: "Budget updated",
          description: "Your usage limits have been updated.",
        });
      } else {
        await createBudget(input);
        toast({
          title: "Budget created",
          description: "Your usage limits have been set.",
        });
      }
      await refetchBudget();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to save budget",
      });
      throw error;
    }
  };

  const handleDeleteBudget = async () => {
    if (!budgetStatus?.budget) return;
    try {
      await deleteBudget(budgetStatus.budget.id);
      toast({
        title: "Budget removed",
        description: "Usage limits have been removed.",
      });
      await refetchBudget();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to remove budget",
      });
      throw error;
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Usage & Billing</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Track your API usage and manage spending limits.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <UsageSummaryCard
            summary={summary}
            loading={summaryLoading}
            period={period}
            onPeriodChange={setPeriod}
          />
          <UsageByProviderChart summary={summary} loading={summaryLoading} />
        </div>

        <div className="space-y-6">
          <BudgetStatusCard
            status={budgetStatus}
            loading={budgetLoading}
            onManageBudget={() => setShowBudgetDialog(true)}
          />
        </div>
      </div>

      <BudgetSettingsDialog
        open={showBudgetDialog}
        onOpenChange={setShowBudgetDialog}
        currentBudget={budgetStatus?.budget || null}
        onSave={handleSaveBudget}
        onDelete={budgetStatus?.budget ? handleDeleteBudget : undefined}
      />
    </div>
  );
}
