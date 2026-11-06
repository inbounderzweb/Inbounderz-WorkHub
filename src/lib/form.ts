import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError } from "./http";

/** Maps server field errors onto react-hook-form fields and toasts the message. */
export function handleFormError<T extends FieldValues>(err: unknown, setError?: UseFormSetError<T>) {
  if (err instanceof ApiClientError) {
    if (err.fieldErrors && setError) {
      for (const [field, message] of Object.entries(err.fieldErrors)) {
        setError(field as Path<T>, { type: "server", message });
      }
    }
    toast.error(err.message);
    return;
  }
  toast.error("Something went wrong. Please try again.");
}
