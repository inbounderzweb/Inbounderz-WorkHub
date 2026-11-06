"use client";

import { ErrorState } from "@/components/shared/states";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border bg-card">
      <ErrorState
        title="Something went wrong"
        message={error.digest ? `Reference: ${error.digest}` : "An unexpected error occurred while loading this page."}
        onRetry={reset}
      />
    </div>
  );
}
