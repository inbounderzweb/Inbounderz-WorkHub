import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/layout/logo";

const POINTS = [
  "Employees, departments and reporting lines in one place",
  "Projects, tasks and reviews with clear ownership",
  "Role-based access for every level of the team",
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Inbounderz. Internal use only.</p>
      </div>
      <div className="relative hidden overflow-hidden bg-[oklch(0.3_0.07_160)] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,oklch(0.56_0.15_152/0.55),transparent_55%),radial-gradient(circle_at_85%_80%,oklch(0.7_0.14_150/0.35),transparent_50%)]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <p className="text-sm font-medium tracking-wide text-emerald-200 uppercase">Inbounderz WorkHub</p>
          <h2 className="mt-3 max-w-md text-3xl leading-tight font-semibold tracking-tight">
            One workspace for how Inbounderz plans, delivers and grows.
          </h2>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm text-emerald-50/90">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
