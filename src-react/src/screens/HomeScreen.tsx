import { ScrollArea } from "@/components/ui/scroll-area";

export function HomeScreen() {
  return (
    <div className="flex h-full w-full flex-col bg-bg-primary min-h-0">
      <ScrollArea className="flex-1 h-full">
        <div className="mx-auto max-w-[960px] px-8 py-8">
          <h1 className="text-2xl font-medium text-text-primary">Home</h1>
          <p className="mt-1 text-sm text-text-secondary">Core workspace</p>

          <section className="mt-8">
            <h2 className="text-sm font-medium text-text-primary mb-3">
              Quick actions
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="h-9 rounded-md bg-bg-input px-4 text-sm font-medium text-brand-light"
                disabled
              >
                New design (disabled)
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-bg-input px-4 text-sm font-medium text-brand-light"
                disabled
              >
                New note (disabled)
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-bg-input px-4 text-sm font-medium text-brand-light"
                disabled
              >
                New chat (disabled)
              </button>
            </div>
          </section>

          <div className="mt-8 grid grid-cols-2 gap-6">
            <section>
              <h2 className="text-sm font-medium text-text-primary mb-3">
                Recent notes
              </h2>
              <div className="space-y-0.5">
                <p className="text-xs text-text-muted py-2">Disabled in core mode</p>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-medium text-text-primary mb-3">
                Recent chats
              </h2>
              <div className="space-y-0.5">
                <p className="text-xs text-text-muted py-2">Disabled in core mode</p>
              </div>
            </section>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
