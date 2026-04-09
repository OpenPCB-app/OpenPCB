export function HomeScreen() {
  return (
    <div className="h-full w-full overflow-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Home</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Core workspace</p>

        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-medium text-slate-900 dark:text-slate-100">Quick actions</h2>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              disabled
            >
              New design (disabled)
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              disabled
            >
              New note (disabled)
            </button>
            <button
              type="button"
              className="rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              disabled
            >
              New chat (disabled)
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
