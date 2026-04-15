import type { ReactElement } from "react";

interface WizardProgressBarProps {
  currentStep: number;
  steps: readonly { label: string }[];
  canOpenStep: (step: number) => boolean;
  onStepClick: (step: number) => void;
}

export function WizardProgressBar({
  currentStep,
  steps,
  canOpenStep,
  onStepClick,
}: WizardProgressBarProps): ReactElement {
  return (
    <div className="flex gap-1">
      {steps.map((step, index) => {
        const canOpen = canOpenStep(index);
        return (
          <button
            key={step.label}
            type="button"
            disabled={!canOpen}
            onClick={() => onStepClick(index)}
            className="flex flex-1 flex-col items-center gap-0.5"
          >
            <div
              className={`h-1 w-full rounded-full transition-colors ${
                index < currentStep
                  ? "bg-emerald-500"
                  : index === currentStep
                    ? "bg-violet-600"
                    : "bg-slate-200 dark:bg-slate-800"
              }`}
            />
            <span
                className={`text-[11px] leading-none ${
                  index <= currentStep
                    ? "text-slate-700 dark:text-slate-300"
                    : "text-slate-400 dark:text-slate-500"
              } ${canOpen ? "" : "opacity-70"}`}
            >
              {index + 1}. {step.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
