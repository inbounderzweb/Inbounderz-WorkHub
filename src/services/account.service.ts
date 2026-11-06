import "server-only";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { CurrentUser } from "@/lib/auth/current-user";
import { badRequest, notFound, unprocessable } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { User } from "@/models";

const RESET_TTL_MINUTES = 30;
const RESET_THROTTLE_MS = 2 * 60_000;
const BCRYPT_ROUNDS = 12;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function updateOwnProfile(user: CurrentUser, input: { name?: string; phone?: string }) {
  const update: Record<string, string> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.phone !== undefined) update.phone = input.phone;
  if (!Object.keys(update).length) return;
  await User.updateOne({ _id: user.id }, { $set: update }, { runValidators: true });
  await recordAudit({
    actorId: user.id,
    action: "profile.update",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} updated their profile`,
  });
}

/** Verifies the current password, sets the new one and revokes every session (including this one). */
export async function changeOwnPassword(user: CurrentUser, currentPassword: string, newPassword: string) {
  const doc = await User.findById(user.id).select("+passwordHash sessionVersion");
  if (!doc) throw notFound("User not found");
  if (!(await bcrypt.compare(currentPassword, doc.passwordHash))) {
    throw unprocessable("Current password is incorrect", { currentPassword: "Current password is incorrect" });
  }
  await User.updateOne(
    { _id: doc._id },
    {
      $set: {
        passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
        sessionVersion: (doc.sessionVersion ?? 0) + 1,
      },
    }
  );
  await recordAudit({
    actorId: user.id,
    action: "auth.password_change",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} changed their password`,
  });
}

/**
 * Issues a single-use reset token (only its SHA-256 hash is stored). Always
 * succeeds from the caller's point of view to avoid account enumeration.
 * Returns the reset URL so the caller can deliver it (email integration point).
 */
export async function requestPasswordReset(email: string, baseUrl: string): Promise<string | null> {
  const user = await User.findOne({ email, status: "ACTIVE" }).select("+passwordResetExpires name email");
  if (!user) return null;

  // Throttle: don't issue a new token if one was issued in the last 2 minutes.
  const issuedAt = user.passwordResetExpires
    ? user.passwordResetExpires.getTime() - RESET_TTL_MINUTES * 60_000
    : 0;
  if (Date.now() - issuedAt < RESET_THROTTLE_MS) return null;

  const token = crypto.randomBytes(32).toString("hex");
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: sha256(token),
        passwordResetExpires: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      },
    }
  );
  await recordAudit({
    actorId: user._id,
    action: "auth.password_reset_requested",
    entityType: "User",
    entityId: user._id,
    summary: `Password reset requested for ${user.email}`,
  });
  return `${baseUrl.replace(/\/$/, "")}/reset-password?token=${token}`;
}

export async function resetPasswordWithToken(token: string, password: string) {
  const user = await User.findOne({
    passwordResetTokenHash: sha256(token),
    passwordResetExpires: { $gt: new Date() },
    status: "ACTIVE",
  }).select("name sessionVersion");
  if (!user) throw badRequest("This reset link is invalid or has expired. Please request a new one.");

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        passwordResetTokenHash: null,
        passwordResetExpires: null,
        failedLoginAttempts: 0,
        lockUntil: null,
        sessionVersion: (user.sessionVersion ?? 0) + 1,
      },
    }
  );
  await recordAudit({
    actorId: user._id,
    action: "auth.password_reset",
    entityType: "User",
    entityId: user._id,
    summary: `${user.name} reset their password via email link`,
  });
}
