import { z } from "zod";
import { passwordSchema } from "./common";

export const loginSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
  password: z.string().min(1, "Password is required").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase(),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(32).max(128),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "New password must differ from the current one",
  });
