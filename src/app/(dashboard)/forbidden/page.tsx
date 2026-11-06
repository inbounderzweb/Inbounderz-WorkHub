import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border bg-card px-6 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <ShieldX className="size-6" />
      </span>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">You don’t have access to this page</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your role doesn’t include permission for this area. If you think this is a mistake, contact a Super Admin.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
