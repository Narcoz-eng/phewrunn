import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../prisma";

/**
 * Better Auth configuration
 *
 * This replaces Privy authentication with Better Auth's email/password flow.
 * Better Auth handles sessions automatically via cookies.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  // Base URL for OAuth callbacks - use frontend URL for proper redirects
  baseURL: process.env.BACKEND_URL || "http://localhost:3000",

  // Email and password authentication
  emailAndPassword: {
    enabled: true,
    // Require email verification before login
    requireEmailVerification: false,
    // Password requirements
    minPasswordLength: 8,
    // Password reset configuration
    sendResetPassword: async ({ user, url }) => {
      // Log the reset link for development
      // In production, integrate with an email service (Resend, SendGrid, etc.)
      console.log(`[Auth] Password reset requested for ${user.email}`);
      console.log(`[Auth] Reset URL: ${url}`);
      // TODO: Send email with reset link
      // await sendEmail({
      //   to: user.email,
      //   subject: "Reset your password",
      //   html: `Click <a href="${url}">here</a> to reset your password.`,
      // });
    },
  },

  // Social providers - Google OAuth
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      // Force account selection on each login
      prompt: "select_account",
      // Redirect URI must match what's configured in Google Cloud Console
      redirectURI: `${process.env.BACKEND_URL || "http://localhost:3000"}/api/auth/callback/google`,
    },
  },

  // Session configuration
  session: {
    // Cookie-based sessions
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes cache
    },
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
  },

  // Trusted origins for CORS - Better Auth validates these for OAuth callbacks
  // List all allowed origins explicitly - also support wildcards
  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8000",
    "https://preview-vzniiddqqxtf.dev.vibecode.run",
    "https://qkopfoiaakof.dev.vibecode.run",
    "https://phew.vibecode.run",
    "https://phew.run",
    "https://www.phew.run",
    // Wildcard patterns for Vibecode domains
    "https://*.dev.vibecode.run",
    "https://*.vibecode.run",
    "https://*.vibecodeapp.com",
  ],

  // Advanced options
  advanced: {
    // Use less restrictive cookie settings for development
    cookiePrefix: "auth",
    useSecureCookies: process.env.NODE_ENV === "production",
  },

  // User configuration - map to existing User model
  user: {
    // Additional fields to store on user
    additionalFields: {
      walletAddress: {
        type: "string",
        required: false,
      },
      walletProvider: {
        type: "string",
        required: false,
      },
      walletConnectedAt: {
        type: "date",
        required: false,
      },
      username: {
        type: "string",
        required: false,
      },
      level: {
        type: "number",
        required: false,
        defaultValue: 0,
      },
      xp: {
        type: "number",
        required: false,
        defaultValue: 0,
      },
      bio: {
        type: "string",
        required: false,
      },
      isAdmin: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
      isBanned: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
      isVerified: {
        type: "boolean",
        required: false,
        defaultValue: false,
      },
      lastUsernameUpdate: {
        type: "date",
        required: false,
      },
      lastPhotoUpdate: {
        type: "date",
        required: false,
      },
    },
  },
});

// Export auth types
export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
