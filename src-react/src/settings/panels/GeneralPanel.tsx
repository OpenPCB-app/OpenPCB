import { ThemeToggle } from "@/components/ThemeToggle.tsx"

export function GeneralPanel() {
  return (
    <div className="space-y-8 pb-24">
      <p className="text-sm text-muted-foreground">General Settings</p>

      <div className="space-y-3">
          <ThemeToggle />
      </div>

    </div>
  )
}
