const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const SITE_URL = new URL(configuredSiteUrl || "http://localhost:3000").origin;
