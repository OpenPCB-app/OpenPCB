import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  UsageBudgetData,
  CreateUsageBudgetInput,
} from "@shared/types/usage.types";
import { Loader2 } from "lucide-react";

interface BudgetSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentBudget: UsageBudgetData | null;
  onSave: (input: Omit<CreateUsageBudgetInput, "workspaceId">) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function BudgetSettingsDialog({
  open,
  onOpenChange,
  currentBudget,
  onSave,
  onDelete,
}: BudgetSettingsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState("5.00");
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">(
    "monthly",
  );
  const [warnAt, setWarnAt] = useState("80");
  const [action, setAction] = useState<"warn" | "block" | "notify">("warn");

  useEffect(() => {
    if (currentBudget) {
      setLimit((currentBudget.limitCents / 100).toFixed(2));
      setPeriod(currentBudget.period);
      setWarnAt(currentBudget.warnAtPercent.toString());
      setAction(currentBudget.actionOnLimit);
    } else {
      setLimit("5.00");
      setPeriod("monthly");
      setWarnAt("80");
      setAction("warn");
    }
    setError(null);
  }, [currentBudget, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const limitCents = Math.round(parseFloat(limit) * 100);
      if (isNaN(limitCents) || limitCents <= 0) {
        throw new Error("Limit must be a positive number");
      }

      const warnAtPercent = parseInt(warnAt);
      if (isNaN(warnAtPercent) || warnAtPercent < 1 || warnAtPercent > 100) {
        throw new Error("Warning percentage must be between 1 and 100");
      }

      await onSave({
        limitCents,
        period,
        warnAtPercent,
        actionOnLimit: action,
      });
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save budget";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm("Are you sure you want to remove this budget limit?")) return;

    setLoading(true);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete budget";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px]"
        aria-describedby="budget-dialog-desc"
      >
        <DialogHeader>
          <DialogTitle>
            {currentBudget ? "Edit Budget" : "Set Budget Limit"}
          </DialogTitle>
          <DialogDescription id="budget-dialog-desc">
            Control your AI spending. Limits are checked before each request.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">
              {error}
            </div>
          )}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="limit" className="text-right">
              Limit ($)
            </Label>
            <Input
              id="limit"
              type="number"
              step="0.01"
              min="0.01"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="period" className="text-right">
              Period
            </Label>
            <Select
              value={period}
              onValueChange={(val: "daily" | "weekly" | "monthly") =>
                setPeriod(val)
              }
            >
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="warnAt" className="text-right">
              Warn at %
            </Label>
            <Input
              id="warnAt"
              type="number"
              min="1"
              max="100"
              value={warnAt}
              onChange={(e) => setWarnAt(e.target.value)}
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="action" className="text-right">
              Action
            </Label>
            <Select
              value={action}
              onValueChange={(val: "warn" | "block" | "notify") =>
                setAction(val)
              }
            >
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warn">Warn only</SelectItem>
                <SelectItem value="block">Block requests</SelectItem>
                <SelectItem value="notify">Notify only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between w-full">
            {currentBudget && onDelete ? (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={loading}
              >
                Remove
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
