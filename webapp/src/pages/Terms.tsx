import { LegalPageLayout, LegalSection } from "@/components/public/LegalPageLayout";

const toc = [
  { id: "agreement", label: "1. Agreement to Terms" },
  { id: "eligibility", label: "2. Eligibility and Accounts" },
  { id: "service", label: "3. Service Description" },
  { id: "risks", label: "4. Trading and Market Risk Disclosure" },
  { id: "content", label: "5. User Content and License" },
  { id: "conduct", label: "6. Acceptable Use and Prohibited Conduct" },
  { id: "moderation", label: "7. Moderation and Enforcement" },
  { id: "data-scores", label: "8. Scoring, Levels, and Data Accuracy" },
  { id: "third-parties", label: "9. Third-Party Services" },
  { id: "ip", label: "10. Intellectual Property" },
  { id: "termination", label: "11. Suspension and Termination" },
  { id: "disclaimers", label: "12. Disclaimers" },
  { id: "liability", label: "13. Limitation of Liability" },
  { id: "indemnity", label: "14. Indemnification" },
  { id: "changes", label: "15. Changes to Terms" },
  { id: "general", label: "16. General Legal Terms" },
  { id: "contact", label: "17. Contact" },
];

export default function Terms() {
  return (
    <LegalPageLayout
      page="terms"
      title="Terms of Use"
      subtitle="These Terms govern access to and use of Phew.run, including posting crypto calls, account profiles, level/ranking systems, notifications, and related APIs and interfaces."
      effectiveDate="February 24, 2026"
      lastUpdated="February 24, 2026"
      toc={toc}
    >
      <LegalSection id="agreement" title="1. Agreement to Terms">
        <p>
          These Terms of Use (the "Terms") are a binding agreement between you and the operator of
          Phew.run (the "Service," "Phew.run," "we," "us," or "our"). By accessing or using the
          Service, you agree to these Terms and to our Privacy Policy.
        </p>
        <p>
          If you do not agree, do not use the Service. If you use the Service on behalf of an
          organization, you represent that you are authorized to bind that organization to these
          Terms.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" title="2. Eligibility and Accounts">
        <p>
          You must be legally capable of entering into a binding agreement in your jurisdiction to
          use the Service. You are responsible for maintaining the confidentiality of your account
          credentials and for activity that occurs under your account.
        </p>
        <p>
          The Service currently supports account access and identity workflows through third-party
          authentication providers, including Privy. You agree to provide accurate registration and
          profile information, including email and username information where requested.
        </p>
        <p>
          We may refuse registration, reclaim usernames, or suspend accounts where reasonably
          necessary for security, legal compliance, impersonation prevention, or enforcement of
          these Terms.
        </p>
      </LegalSection>

      <LegalSection id="service" title="3. Service Description">
        <p>
          Phew.run is a social publishing and reputation platform that allows users to post crypto
          market calls ("Alpha Calls"), track outcomes over defined settlement windows, maintain a
          public performance record, and interact with other users through likes, comments, follows,
          reposts, notifications, and leaderboards.
        </p>
        <p>
          The Service includes automated scoring and level systems (including XP, level changes,
          liquidation thresholds, and ranking logic), which may change over time. The Service may
          also include administrative announcements, moderation tools, and anti-abuse controls.
        </p>
      </LegalSection>

      <LegalSection id="risks" title="4. Trading and Market Risk Disclosure">
        <p>
          The Service is provided for informational, social, and record-keeping purposes only. We
          do not provide investment advice, brokerage services, portfolio management, or execution
          services. Content on the Service may be incomplete, inaccurate, misleading, untimely, or
          manipulative.
        </p>
        <p>
          Digital asset markets are highly volatile and may result in substantial or total loss.
          You are solely responsible for your investment decisions, tax reporting, legal compliance,
          and due diligence. Do not treat rankings, levels, win rates, or social signals as a
          recommendation or guarantee of future performance.
        </p>
      </LegalSection>

      <LegalSection id="content" title="5. User Content and License">
        <p>
          You retain ownership of the content you submit, post, or display through the Service,
          including text, profile information, and linked wallet identifiers ("User Content").
          However, by submitting User Content, you grant us a worldwide, non-exclusive,
          royalty-free license to host, store, reproduce, process, adapt, publish, display, and
          distribute that content as needed to operate, secure, improve, and promote the Service.
        </p>
        <p>
          This license includes displaying your content to other users, indexing and ranking it,
          associating it with performance metrics, and retaining reasonable backups. You represent
          and warrant that you have all rights necessary to grant this license and that your User
          Content does not violate law or third-party rights.
        </p>
      </LegalSection>

      <LegalSection id="conduct" title="6. Acceptable Use and Prohibited Conduct">
        <p>You may not use the Service to:</p>
        <p>
          (a) violate any law or regulation; (b) impersonate another person or entity; (c) post
          fraudulent, defamatory, abusive, or infringing content; (d) manipulate rankings, levels,
          or engagement metrics; (e) spam, scrape, or automate access in an abusive manner; (f)
          interfere with platform security; (g) attempt to reverse engineer or circumvent rate
          limits, access controls, or moderation systems; or (h) use the Service to promote market
          manipulation, coordinated pump-and-dump behavior, or other unlawful conduct.
        </p>
        <p>
          We may impose technical limits, rate limits, or verification requirements to protect the
          Service and users.
        </p>
      </LegalSection>

      <LegalSection id="moderation" title="7. Moderation and Enforcement">
        <p>
          We may monitor, review, remove, de-rank, restrict, or disable content or accounts where
          we reasonably determine it is necessary to enforce these Terms, respond to complaints,
          comply with law, protect users, or preserve platform integrity.
        </p>
        <p>
          Administrative actions may include content removal, feature restrictions, temporary
          suspension, permanent bans, announcement controls, and adjustments to visibility or
          access. We are not obligated to preserve or restore content after enforcement action.
        </p>
      </LegalSection>

      <LegalSection id="data-scores" title="8. Scoring, Levels, and Data Accuracy">
        <p>
          The Service uses automated calculations (including settlement windows, market-cap
          snapshots, XP, level changes, liquidation thresholds, and leaderboard rankings) based on
          platform logic and third-party market data. These metrics are informational only and may
          be revised to correct errors, improve methodology, or respond to abuse.
        </p>
        <p>
          We do not guarantee the completeness, availability, or accuracy of token metadata, market
          capitalization values, timing, settlement outcomes, notification delivery, or leaderboard
          positions. Delays, outages, API failures, and data mismatches may affect displayed
          results.
        </p>
      </LegalSection>

      <LegalSection id="third-parties" title="9. Third-Party Services">
        <p>
          The Service relies on third-party providers for certain functionality, including identity
          and authentication services (such as Privy) and market/token data services (such as
          DexScreener). Your use of third-party functionality may also be subject to those
          providers' terms and privacy policies.
        </p>
        <p>
          We are not responsible for third-party service performance, availability, security,
          content, or data accuracy. Links to third-party sites are provided for convenience only.
        </p>
      </LegalSection>

      <LegalSection id="ip" title="10. Intellectual Property">
        <p>
          Except for User Content and third-party materials, the Service and its software, design,
          trademarks, logos, text, graphics, interfaces, and underlying technology are owned by us
          or our licensors and are protected by intellectual property laws.
        </p>
        <p>
          Subject to your compliance with these Terms, we grant you a limited, revocable,
          non-exclusive, non-transferable right to access and use the Service for its intended
          purpose. No other rights are granted.
        </p>
      </LegalSection>

      <LegalSection id="termination" title="11. Suspension and Termination">
        <p>
          We may suspend or terminate your access to all or part of the Service at any time, with
          or without notice, if we believe you have violated these Terms, created legal or security
          risk, or if continued access is no longer commercially or technically feasible.
        </p>
        <p>
          You may stop using the Service at any time. Certain provisions of these Terms survive
          termination, including licenses, disclaimers, limitations of liability, indemnity, and
          dispute-related provisions.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" title="12. Disclaimers">
        <p>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER
          EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS
          FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
        </p>
        <p>
          WITHOUT LIMITING THE FOREGOING, WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED,
          SECURE, ERROR-FREE, ACCURATE, OR FREE OF HARMFUL COMPONENTS, OR THAT ANY CONTENT OR DATA
          WILL BE CORRECT, COMPLETE, OR CURRENT.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="13. Limitation of Liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE AND OUR AFFILIATES, OFFICERS, EMPLOYEES,
          CONTRACTORS, AND LICENSORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
          CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA,
          GOODWILL, OR TRADING LOSSES, ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS.
        </p>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR AGGREGATE LIABILITY FOR ALL CLAIMS ARISING OUT
          OF OR RELATING TO THE SERVICE OR THESE TERMS WILL NOT EXCEED THE GREATER OF (A) USD $100
          OR (B) THE AMOUNT YOU PAID US (IF ANY) FOR THE SERVICE IN THE 12 MONTHS BEFORE THE EVENT
          GIVING RISE TO THE CLAIM.
        </p>
      </LegalSection>

      <LegalSection id="indemnity" title="14. Indemnification">
        <p>
          You agree to defend, indemnify, and hold harmless us and our affiliates, personnel, and
          service providers from and against claims, liabilities, damages, losses, and expenses
          (including reasonable legal fees) arising out of or related to your User Content, your
          use of the Service, your violation of these Terms, or your violation of applicable law or
          third-party rights.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="15. Changes to Terms">
        <p>
          We may revise these Terms from time to time. If we make material changes, we may provide
          notice through the Service (including announcements or updated pages). Your continued use
          of the Service after revised Terms become effective constitutes acceptance of the revised
          Terms.
        </p>
      </LegalSection>

      <LegalSection id="general" title="16. General Legal Terms">
        <p>
          These Terms constitute the entire agreement between you and us regarding the Service,
          except as otherwise expressly stated. If any provision is held unenforceable, the
          remaining provisions will remain in effect.
        </p>
        <p>
          These Terms will be governed by the laws applicable to the jurisdiction in which the
          Service operator is established, without regard to conflict-of-laws principles, except as
          otherwise required by mandatory law. Disputes shall be brought in the competent courts of
          that jurisdiction unless applicable law requires otherwise.
        </p>
        <p>
          Our failure to enforce any provision is not a waiver. You may not assign these Terms
          without our prior written consent. We may assign these Terms in connection with a merger,
          acquisition, or asset transfer.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="17. Contact">
        <p>
          For questions regarding these Terms, use the contact channel made available on the
          Service. If a legal notice email or mailing address is published by the Service operator,
          that published contact information controls for formal notices.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
