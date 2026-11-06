/**
 * Bootstraps the system:
 *   1. Syncs the 5 system roles + permissions into the `roles` collection.
 *   2. Creates the initial Super Admin from SUPER_ADMIN_* environment variables.
 *
 * There is intentionally no public registration. This script is the only way to
 * create the first Super Admin; afterwards admins are created inside the app.
 *
 *   npm run seed
 *   npm run seed -- --reset-admin-password   # rotate the bootstrap admin's password
 */
import "./_env";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { getRoleByKey, syncRoles } from "@/lib/roles";
import { passwordSchema } from "@/lib/validations/common";
import { User } from "@/models";

async function main() {
  const name = process.env.SUPER_ADMIN_NAME?.trim() || "Super Admin";
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const employeeId = (process.env.SUPER_ADMIN_EMPLOYEE_ID?.trim() || "IBZ-0001").toUpperCase();
  const resetPassword = process.argv.includes("--reset-admin-password");

  if (!email || !password) {
    throw new Error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set (see .env.example).");
  }
  const strength = passwordSchema.safeParse(password);
  if (!strength.success) {
    throw new Error(`SUPER_ADMIN_PASSWORD is too weak: ${strength.error.issues.map((i) => i.message).join("; ")}`);
  }

  await connectDB();
  await syncRoles();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  console.log("✓ Roles and indexes synced");

  const role = await getRoleByKey("SUPER_ADMIN");
  const existing = await User.findOne({ email });

  if (existing) {
    if (resetPassword) {
      await User.updateOne(
        { _id: existing._id },
        {
          $set: {
            passwordHash: await bcrypt.hash(password, 12),
            sessionVersion: (existing.sessionVersion ?? 0) + 1,
            status: "ACTIVE",
            failedLoginAttempts: 0,
            lockUntil: null,
          },
        }
      );
      console.log(`✓ Password reset for ${email}`);
    } else {
      console.log(`• Super Admin ${email} already exists — nothing to do.`);
    }
    return;
  }

  if (await User.exists({ employeeId })) {
    throw new Error(`Employee ID ${employeeId} is already used by another account. Set SUPER_ADMIN_EMPLOYEE_ID.`);
  }

  await User.create({
    name,
    email,
    employeeId,
    designation: "System Administrator",
    passwordHash: await bcrypt.hash(password, 12),
    role: role.id,
    status: "ACTIVE",
    joiningDate: new Date(),
  });
  console.log(`✓ Super Admin created: ${email}`);
  console.log("  Sign in and change the password from your profile page.");
}

main()
  .catch((err) => {
    console.error("✗ Seed failed:", err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
