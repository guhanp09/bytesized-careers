export type MarketingClaimSource = {
  label: string;
  href: string;
  publisher: string;
  published: string;
};

export type HomeMarketSignal = {
  value: string;
  label: string;
  caption: string;
  source?: MarketingClaimSource;
};

/**
 * Public quantitative market claims live here so a number cannot reach the
 * homepage without its exact source travelling with it. Product-capability
 * scenes deliberately use words rather than invented adoption or outcome
 * figures.
 */
export const HOME_MARKET_SIGNALS: readonly HomeMarketSignal[] = [
  {
    value: "2–2.5M",
    label: "monetized content creators in India",
    caption: "BCG estimate published in 2025.",
    source: {
      label: "BCG · From Content to Commerce (2025)",
      href: "https://www.bcg.com/publications/2025/india-from-content-to-commerce-mapping-indias-creator-economy",
      publisher: "Boston Consulting Group",
      published: "2025-05-03",
    },
  },
  {
    value: "25%",
    label: "projected 2025 growth in India’s influencer marketing industry",
    caption: "A report projection, not CreatorJobs performance.",
    source: {
      label: "IBEF · India Influencer Marketing Report coverage (2025)",
      href: "https://www.ibef.org/news/india-s-influencer-marketing-industry-to-grow-by-25-in-2025-report",
      publisher: "India Brand Equity Foundation",
      published: "2025-06-12",
    },
  },
  {
    value: "Jobs + talent",
    label: "two discovery paths",
    caption: "Browse open roles or published talent listings.",
  },
  {
    value: "One profile",
    label: "for both sides of the marketplace",
    caption: "Use the same CreatorJobs profile to look for work and to hire.",
  },
  {
    value: "Draft first",
    label: "review before publishing",
    caption: "Listing forms and AI-assisted imports stay editable before publication.",
  },
];
