import { LegalPageLayout, LegalSection } from "@/components/public/LegalPageLayout";

const toc = [
  { id: "scope", label: "1. Scope" },
  { id: "collect", label: "2. Information We Collect" },
  { id: "sources", label: "3. Sources of Information" },
  { id: "use", label: "4. How We Use Information" },
  { id: "sharing", label: "5. How We Share Information" },
  { id: "public", label: "6. Public and Social Features" },
  { id: "cookies", label: "7. Cookies, Tokens, and Local Storage" },
  { id: "retention", label: "8. Retention" },
  { id: "rights", label: "9. Your Choices and Rights" },
  { id: "security", label: "10. Security" },
  { id: "transfers", label: "11. International Transfers" },
  { id: "children", label: "12. Children" },
  { id: "changes", label: "13. Changes to this Policy" },
  { id: "contact", label: "14. Contact" },
];

export default function Privacy() {
  return (
    <LegalPageLayout
      page="privacy"
      title="Privacy Policy"
      subtitle="This Privacy Policy describes how Phew.run collects, uses, stores, and shares information in connection with account access, social features, score/level calculations, and platform operations."
      effectiveDate="February 24, 2026"
      lastUpdated="February 24, 2026"
      toc={toc}
    >
      <LegalSection id="scope" title="1. Scope">
        <p>
          This Privacy Policy applies to information processed through Phew.run, including our web
          application, related APIs, authentication workflows, and platform features such as posts,
          comments, notifications, profiles, leaderboards, and administrative moderation tools.
        </p>
        <p>
          This Policy does not govern third-party services that you may use with or through the
          Service (such as identity, wallet, or market data providers), which remain subject to
          those third parties' own terms and privacy practices.
        </p>
      </LegalSection>

      <LegalSection id="collect" title="2. Information We Collect">
        <p>We may collect and store the following categories of information:</p>
        <p>
          <strong className="text-foreground">Account and identity information.</strong> This may
          include email address, display name, username, profile image, Privy-linked identifiers
          (such as a Privy user ID), and email verification state.
        </p>
        <p>
          <strong className="text-foreground">Wallet and profile information.</strong> Where you
          connect or add a wallet, we may store wallet address, provider type, wallet connection
          timestamps, and wallet verification/association data.
        </p>
        <p>
          <strong className="text-foreground">User-generated content and social graph.</strong>
          This includes posts (including token contract addresses and related token metadata),
          comments, reposts, likes, follows, profile bio, and interactions with other users.
        </p>
        <p>
          <strong className="text-foreground">Performance, reputation, and gameplay metrics.</strong>
          This includes XP, level, settlement outcomes, win/loss data, streaks, leaderboard rank,
          accuracy statistics, and related calculated values.
        </p>
        <p>
          <strong className="text-foreground">Notifications and engagement signals.</strong> This
          includes notification content, read/dismissed state, clicked timestamps, and related post
          or user references.
        </p>
        <p>
          <strong className="text-foreground">Session, security, and technical information.</strong>
          This may include session tokens, authentication cookies, IP address, user agent, request
          metadata, device/browser information, error logs, and anti-abuse / rate-limiting data.
        </p>
      </LegalSection>

      <LegalSection id="sources" title="3. Sources of Information">
        <p>We collect information from several sources:</p>
        <p>
          (a) directly from you when you sign in, update your profile, connect a wallet, post
          content, or interact with other users; (b) automatically from your browser or device when
          you use the Service; (c) from authentication and identity providers (including Privy) to
          validate sign-in state and identity claims; and (d) from market data providers (including
          DexScreener) to enrich token and market-cap tracking associated with posts.
        </p>
      </LegalSection>

      <LegalSection id="use" title="4. How We Use Information">
        <p>We use information to operate and improve the Service, including to:</p>
        <p>
          authenticate users; create and maintain accounts; display profiles and social activity;
          process posts and comments; compute settlement outcomes, XP, levels, and leaderboards;
          send notifications; enforce rate limits; detect abuse and fraud; moderate content; comply
          with legal obligations; troubleshoot issues; and analyze platform performance and
          reliability.
        </p>
        <p>
          We may also use information to communicate product updates, administrative announcements,
          policy changes, and security notices through in-app notices or other channels associated
          with your account.
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="5. How We Share Information">
        <p>We may share information in the following circumstances:</p>
        <p>
          <strong className="text-foreground">With service providers and infrastructure vendors.</strong>
          We use third parties to support hosting, authentication, database/storage, and platform
          operations. These providers process information on our behalf under contractual or
          operational controls.
        </p>
        <p>
          <strong className="text-foreground">With identity and auth providers.</strong> We rely on
          Privy and related authentication workflows to validate identity and session state.
        </p>
        <p>
          <strong className="text-foreground">With market data providers.</strong> Requests for
          token metadata and market-cap information may involve sending token identifiers (such as
          contract addresses) to providers like DexScreener.
        </p>
        <p>
          <strong className="text-foreground">For legal and safety purposes.</strong> We may
          disclose information where reasonably necessary to comply with law, respond to valid legal
          process, enforce our terms, investigate abuse, or protect rights, safety, and security.
        </p>
        <p>
          <strong className="text-foreground">Business transfers.</strong> Information may be
          transferred as part of a merger, financing, acquisition, reorganization, or sale of
          assets, subject to applicable law.
        </p>
      </LegalSection>

      <LegalSection id="public" title="6. Public and Social Features">
        <p>
          Information you choose to post or make available through social features may be visible to
          other users of the Service, including your username, profile image, bio, posts, comments,
          reposts, likes, follows, and certain performance statistics (such as level, XP-related
          status, and leaderboard placement).
        </p>
        <p>
          Even if content is later removed from public display, copies may persist in backups, logs,
          screenshots, caches, or records maintained by other users, to the extent permitted by
          law.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="7. Cookies, Tokens, and Local Storage">
        <p>
          We use cookies and similar technologies to support authentication and session management.
          The Service also uses browser local storage in some cases as a fallback token mechanism
          for cross-origin or session continuity scenarios.
        </p>
        <p>
          You can control cookies and local storage through your browser settings, but disabling
          them may prevent sign-in or break core functionality. We may also use technical storage
          for security features, rate-limiting, and user interface preferences.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="8. Retention">
        <p>
          We retain information for as long as reasonably necessary to provide the Service, maintain
          account and security records, operate leaderboards and reputation features, comply with
          legal obligations, resolve disputes, and enforce agreements.
        </p>
        <p>
          Retention periods vary by data type. Session and security logs may be retained for shorter
          periods, while account, moderation, and transaction-history-like platform records may be
          retained longer where needed for integrity, fraud prevention, or compliance.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="9. Your Choices and Rights">
        <p>
          Depending on your jurisdiction, you may have rights to request access to, correction of,
          deletion of, or restriction of certain personal information, and to object to or request
          portability of certain processing. You may also be able to update profile information
          directly within the Service.
        </p>
        <p>
          Some information may be retained despite a request where required for security, fraud
          prevention, legal obligations, dispute resolution, or system integrity. We may need to
          verify your identity before processing rights requests.
        </p>
      </LegalSection>

      <LegalSection id="security" title="10. Security">
        <p>
          We implement administrative, technical, and organizational safeguards designed to protect
          information against unauthorized access, loss, misuse, or alteration. These measures may
          include access controls, validation, security headers, rate limiting, and monitoring.
        </p>
        <p>
          No system is completely secure. You are responsible for safeguarding your own devices,
          credentials, and wallets, and for using good security hygiene (including phishing
          awareness and device protection).
        </p>
      </LegalSection>

      <LegalSection id="transfers" title="11. International Transfers">
        <p>
          The Service may be operated, hosted, or supported from multiple countries. Your
          information may be transferred to and processed in jurisdictions that may have different
          data protection laws than your home jurisdiction. Where required, we will use appropriate
          safeguards for such transfers.
        </p>
      </LegalSection>

      <LegalSection id="children" title="12. Children">
        <p>
          The Service is not directed to children under the age at which personal data processing or
          contract formation is lawful in your jurisdiction. If you believe a child has provided
          personal information in violation of applicable law, contact us so we can investigate and
          take appropriate action.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="13. Changes to this Policy">
        <p>
          We may update this Privacy Policy from time to time to reflect operational, legal, or
          product changes. When we do, we will update the "Last Updated" date and may provide
          additional notice through the Service where appropriate.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="14. Contact">
        <p>
          For privacy-related questions or requests, use the support or contact channels provided in
          the Service. If the Service operator publishes a dedicated privacy or legal contact email,
          that published contact information controls for formal requests.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
