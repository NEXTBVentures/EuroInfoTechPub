import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { phoneNumber } from "better-auth/plugins";
import { prisma } from "@workspace/database";
import { deliverAuthMessage } from "./auth-delivery";
import { consumeProtectedPhoneOtp } from "./phone-otp";
import { resolveTenant } from "./tenant";
import { getSessionFromCtx } from "better-auth/api";

const secret = process.env.BETTER_AUTH_SECRET ?? process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET or SESSION_SECRET must contain at least 32 characters");
}

const production = process.env.NODE_ENV === "production";
const trustedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  ...(process.env.REPLIT_DEV_DOMAIN ? [`https://${process.env.REPLIT_DEV_DOMAIN}`] : []),
  ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
  ...(process.env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

export const auth = betterAuth({
  appName: "Euro Infotech",
  ...(process.env.BETTER_AUTH_URL ? { baseURL: process.env.BETTER_AUTH_URL } : {}),
  secret,
  logger: { disabled: true },
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins: [...trustedOrigins],
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: production,
      path: "/",
    },
  },
  user: {
    additionalFields: {
      twoFactorEnabled: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    additionalFields: {
      mfaVerifiedAt: {
        type: "date",
        required: false,
        input: false,
      },
      mfaMethod: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await deliverAuthMessage("password-reset", user.email, url);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      await deliverAuthMessage("email-verification", user.email, url);
    },
  },
  plugins: [
    phoneNumber({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      requireVerification: true,
      phoneNumberValidator: (value) => /^\+[1-9]\d{7,14}$/.test(value),
      sendOTP: async () => { throw new Error("Use the protected phone request endpoint"); },
      verifyOTP: async ({ phoneNumber: phone, code }, context) => {
        const request = context?.request;
        if (!request) return false;
        const tenant = await resolveTenant(request.headers.get("host"));
        if (!tenant) return false;
        const link = Boolean(context?.body?.updatePhoneNumber);
        const session = link && context ? await getSessionFromCtx(context) : null;
        return consumeProtectedPhoneOtp(tenant.id, phone, code, link ? "LINK" : "LOGIN", session?.user.id);
      },
    }),
  ],
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimit",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/phone-number": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 4 },
      "/phone-number/send-otp": { window: 60, max: 3 },
      "/phone-number/verify": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
