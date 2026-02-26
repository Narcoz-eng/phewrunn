import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, FileText, Scale, Shield } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  label: string;
}

interface LegalPageLayoutProps {
  page: "terms" | "privacy" | "docs";
  title: string;
  subtitle: string;
  effectiveDate: string;
  lastUpdated?: string;
  toc: TocItem[];
  children: ReactNode;
}

interface LegalSectionProps {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}

const pageMeta = {
  terms: {
    label: "Terms",
    icon: Scale,
    accent: "from-primary/15 via-primary/5 to-transparent",
  },
  privacy: {
    label: "Privacy",
    icon: Shield,
    accent: "from-emerald-500/15 via-emerald-500/5 to-transparent",
  },
  docs: {
    label: "Docs",
    icon: BookOpen,
    accent: "from-amber-500/15 via-amber-500/5 to-transparent",
  },
} as const;

function DocLink({
  to,
  children,
  active = false,
}: {
  to: string;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "border-border/50 bg-background/40 text-muted-foreground hover:text-foreground hover:border-border"
      )}
    >
      {children}
    </Link>
  );
}

export function LegalSection({ id, title, children, className }: LegalSectionProps) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm sm:text-[15px] leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function LegalPageLayout({
  page,
  title,
  subtitle,
  effectiveDate,
  lastUpdated,
  toc,
  children,
}: LegalPageLayoutProps) {
  const meta = pageMeta[page];
  const Icon = meta.icon;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className={cn("absolute inset-x-0 top-0 h-64 bg-gradient-to-b", meta.accent)} />
        <div className="absolute top-[-10%] right-[-10%] h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-10%] h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </Link>
              <Link to="/login" className="flex items-center gap-2 min-w-0">
                <BrandLogo size="sm" className="shrink-0" />
                <span className="rounded-full border border-border/50 bg-background/40 px-2.5 py-1 text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-muted-foreground shrink-0">
                  {meta.label}
                </span>
              </Link>
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <div className="flex-1 sm:flex-none overflow-x-auto">
                <div className="flex items-center gap-2 min-w-max pr-1">
                  <DocLink to="/terms" active={page === "terms"}>
                    Terms
                  </DocLink>
                  <DocLink to="/privacy" active={page === "privacy"}>
                    Privacy
                  </DocLink>
                  <DocLink to="/docs" active={page === "docs"}>
                    Docs
                  </DocLink>
                </div>
              </div>
              <ThemeToggle size="icon" className="h-9 w-9 shrink-0" />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px] items-start">
            <article className="rounded-2xl border border-border/60 bg-background/80 backdrop-blur-xl shadow-[0_20px_70px_-40px_hsl(var(--foreground)/0.45)] overflow-hidden">
              <div className="border-b border-border/50 px-4 sm:px-7 py-5 sm:py-6 bg-gradient-to-b from-background via-background to-transparent">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
                  <Icon className="w-3.5 h-3.5" />
                  <span>{meta.label} Document</span>
                </div>
                <h1 className="mt-4 text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight leading-tight">
                  {title}
                </h1>
                <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
                  {subtitle}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-muted-foreground">
                  <div>
                    <span className="text-foreground font-medium">Effective Date:</span> {effectiveDate}
                  </div>
                  {lastUpdated && (
                    <div>
                      <span className="text-foreground font-medium">Last Updated:</span> {lastUpdated}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-4 sm:px-7 py-5 sm:py-7 space-y-8">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs sm:text-sm text-amber-200">
                  These pages were drafted from the current codebase and feature set. Review with qualified counsel before treating them as final legal documents.
                </div>
                <div className="xl:hidden rounded-xl border border-border/50 bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <FileText className="w-3.5 h-3.5" />
                    Contents
                  </div>
                  <nav className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {toc.map((item) => (
                      <a
                        key={item.id}
                        href={`#${item.id}`}
                        className="whitespace-nowrap rounded-lg border border-border/40 bg-background/50 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
                      >
                        {item.label}
                      </a>
                    ))}
                  </nav>
                </div>
                {children}
              </div>
            </article>

            <aside className="hidden xl:block xl:sticky xl:top-24 rounded-2xl border border-border/60 bg-background/75 backdrop-blur-xl p-4 sm:p-5 shadow-[0_16px_50px_-42px_hsl(var(--foreground)/0.5)]">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <FileText className="w-3.5 h-3.5" />
                Contents
              </div>
              <nav className="mt-3 space-y-1.5">
                {toc.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="block rounded-lg border border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/40 hover:border-border/40 transition-colors"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>

              <div className="mt-4 pt-4 border-t border-border/40 text-xs text-muted-foreground leading-relaxed">
                The Service is a reputation and publishing platform for crypto call tracking. It is not an investment advisor, broker, or exchange.
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
