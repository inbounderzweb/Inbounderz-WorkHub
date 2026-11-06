import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export function FormRow({
  label,
  htmlFor,
  error,
  description,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  description?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Field data-invalid={!!error || undefined} className={cn("gap-1.5", className)}>
      <FieldLabel htmlFor={htmlFor} className="text-sm">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </FieldLabel>
      {children}
      {description && !error ? <FieldDescription className="text-xs">{description}</FieldDescription> : null}
      {error ? <FieldError className="text-xs">{error}</FieldError> : null}
    </Field>
  );
}
