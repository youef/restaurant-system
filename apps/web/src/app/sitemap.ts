import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const now = new Date();
  return ["", "/menu", "/about", "/location"].map((path) => ({
    url: new URL(path || "/", base).toString(),
    lastModified: now,
  }));
}
