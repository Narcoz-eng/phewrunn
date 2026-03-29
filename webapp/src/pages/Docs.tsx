import { LegalPageLayout, LegalSection } from "@/components/public/LegalPageLayout";

const toc = [
  { id: "overview", label: "1. Platform Overview" },
  { id: "accounts", label: "2. Accounts and Authentication" },
  { id: "posting", label: "3. Posting Rules and Token Calls" },
  { id: "settlement", label: "4. Settlement and Level System" },
  { id: "limits", label: "5. Rate Limits and Posting Lock" },
  { id: "social", label: "6. Social Features and Notifications" },
  { id: "leaderboard", label: "7. Leaderboards and Metrics" },
  { id: "wallets", label: "8. Wallet Linking and Verification" },
  { id: "data", label: "9. Market Data Sources and Limits" },
  { id: "moderation", label: "10. Moderation and Admin Tools" },
  { id: "api", label: "11. API and Operational Notes" },
  { id: "disclosures", label: "12. Important Disclosures" },
];

export default function Docs() {
  return (
    <LegalPageLayout
      page="docs"
      title="Platform Docs and Methodology"
      subtitle="Operational documentation for how Phew.run works today, including posting requirements, settlement windows, level calculations, rate limits, social features, and key limitations."
      effectiveDate="February 24, 2026"
      lastUpdated="February 24, 2026"
      toc={toc}
    >
      <LegalSection id="overview" title="1. Platform Overview">
        <p>
          Phew.run is a SocialFi-style reputation platform for documenting crypto calls and
          measuring outcomes over time. Users can publish token calls, interact with other users,
          and build a public performance record through accuracy metrics, XP, levels, and
          leaderboard rankings.
        </p>
        <p>
          The platform is designed as a publishing and reputation system, not a trade execution
          platform. It does not custody assets, execute trades, or provide investment advice.
        </p>
      </LegalSection>

      <LegalSection id="accounts" title="2. Accounts and Authentication">
        <p>
          The current implementation supports Privy-based sign-in (including email verification
          flows through Privy). On successful sign-in, the backend syncs the Privy identity to a
          local application account and issues session credentials used by the platform.
        </p>
        <p>
          The application uses server-issued HttpOnly session cookies for browser authentication.
          Users are responsible for their own account security and device hygiene.
        </p>
      </LegalSection>

      <LegalSection id="posting" title="3. Posting Rules and Token Calls">
        <p>
          Posts are short-form "Alpha Calls" that are expected to include a valid token contract
          address. The platform extracts and structures token-related metadata (e.g., symbol, name,
          image, market-cap references) where available.
        </p>
        <p>
          The platform enforces post-length and anti-abuse limits and may reject content that is too
          short, too long, malformed, or non-compliant with validation and moderation rules. Token
          metadata and market-cap values are sourced from third-party services and may be missing or
          inaccurate.
        </p>
      </LegalSection>

      <LegalSection id="settlement" title="4. Settlement and Level System">
        <p>
          Phew.run tracks performance through a settlement-based model. Posts may be evaluated at
          approximately 1-hour and 6-hour checkpoints using market-cap snapshots and platform
          rules. The current implementation supports XP and level adjustments based on these
          outcomes.
        </p>
        <p>
          The documented level range is from LVL -5 (liquidation threshold) to LVL +10 (upper cap).
          The current rules include immediate 1H wins/losses, a recovery path for certain softer
          1H losses, and a possible additional 6H bonus or delayed penalty depending on outcome.
        </p>
        <p>
          Platform logic may evolve, including scoring weights, thresholds, settlement timing
          tolerances, XP adjustments, and anti-abuse corrections. Historical data may be recalculated
          or corrected if needed.
        </p>
      </LegalSection>

      <LegalSection id="limits" title="5. Rate Limits and Posting Lock">
        <p>
          The platform enforces rate limits for core actions (including posts, comments, reposts,
          and wallet connect/disconnect operations) to preserve service quality and reduce abuse.
          Exact values may change over time.
        </p>
        <p>
          Users at or below the liquidation threshold (LVL -5 in the current rules) may be blocked
          from creating new posts until their reputation state improves under platform rules or
          administrative action.
        </p>
      </LegalSection>

      <LegalSection id="social" title="6. Social Features and Notifications">
        <p>
          Social features include likes, comments, reposts, follows, and notifications. The system
          may generate notifications for social interactions and settlement/level events (e.g., win,
          loss, recovery, level-up, or follow/like/repost events).
        </p>
        <p>
          Notification timing and delivery are best-effort. A missed or delayed notification does
          not change the underlying record of the event.
        </p>
      </LegalSection>

      <LegalSection id="leaderboard" title="7. Leaderboards and Metrics">
        <p>
          Leaderboards and profile metrics may rank or summarize users by level, activity, win rate,
          or other platform-defined indicators. These metrics are intended to reflect platform
          activity and methodology, not investment suitability, trustworthiness, or legal/compliance
          status.
        </p>
        <p>
          Displayed statistics (including accuracy, streaks, and top gainers) depend on available
          data and platform rules. They may change due to recalculation, moderation, delayed
          settlement, corrections, or data provider issues.
        </p>
      </LegalSection>

      <LegalSection id="wallets" title="8. Wallet Linking and Verification">
        <p>
          Users may link a wallet to their profile. Where verification flows are enabled, the
          platform may request a signed message to confirm wallet ownership. Wallet linking improves
          profile attribution but does not create custody, execution authority, or fiduciary duties.
        </p>
        <p>
          Users remain solely responsible for wallet security, seed phrases, private keys, and
          transaction decisions. Never share private keys or recovery phrases with the platform or
          any third party.
        </p>
      </LegalSection>

      <LegalSection id="data" title="9. Market Data Sources and Limits">
        <p>
          The platform uses third-party market data and token metadata sources (including
          DexScreener) to populate token cards, estimate market capitalization, and perform
          settlement calculations. Third-party data may be delayed, unavailable, incomplete, or
          inconsistent across chains or liquidity pools.
        </p>
        <p>
          The platform may retry, cache, or rate-limit market data requests. If the source data is
          unavailable or unreliable at the relevant checkpoint, the displayed results may be delayed
          or corrected later.
        </p>
      </LegalSection>

      <LegalSection id="moderation" title="10. Moderation and Admin Tools">
        <p>
          Administrative tools may be used to manage users, content, announcements, verification
          status, and abuse controls. Actions may include bans/unbans, post deletion, announcement
          pinning, and user-level moderation.
        </p>
        <p>
          Moderation decisions are made to protect platform integrity, user safety, and compliance.
          Platform operators may change moderation standards and enforcement thresholds over time.
        </p>
      </LegalSection>

      <LegalSection id="api" title="11. API and Operational Notes">
        <p>
          The backend exposes API endpoints for posts, users, notifications, leaderboard views,
          announcements, admin functions, and auth/session sync. Some maintenance processes may run
          asynchronously (including settlement and scheduled maintenance tasks).
        </p>
        <p>
          API behavior, schemas, and endpoints may change without notice unless the operator
          publishes versioning guarantees. Rate limits and anti-abuse checks may apply to any
          endpoint and may vary by account/session context.
        </p>
      </LegalSection>

      <LegalSection id="disclosures" title="12. Important Disclosures">
        <p>
          This documentation describes platform behavior and methodology as implemented at the time
          of drafting. It is not legal advice, investment advice, tax advice, or an audit report.
        </p>
        <p>
          Users should independently verify any market information and should not rely on platform
          metrics, levels, or social signals as the sole basis for financial decisions.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
