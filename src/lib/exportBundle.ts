// Export a project's research+gig as a Markdown bundle the user can save.
export function buildMarkdownBundle(project: any, result: any): string {
  const gig = result?.gig_optimization || {};
  const profile = result?.profile_optimization || {};
  const insights = result?.insights || {};
  const lines: string[] = [];
  const h = (s: string) => lines.push(`\n## ${s}\n`);
  const kv = (k: string, v: any) => v && lines.push(`- **${k}:** ${typeof v === "string" ? v : JSON.stringify(v)}`);

  lines.push(`# ${project?.name || "Fiverr Project"}`);
  lines.push(`> Niche: ${project?.niche || "—"} · Generated: ${new Date().toLocaleString()}`);

  h("Gig Title");
  lines.push(gig.gig_title || "—");

  h("Gig Description");
  lines.push(gig.description || "—");

  if (gig.search_tags?.length) {
    h("Search Tags");
    lines.push(gig.search_tags.map((t: string) => `\`${t}\``).join(" "));
  }

  if (gig.packages) {
    h("Packages");
    for (const [key, p] of Object.entries<any>(gig.packages)) {
      lines.push(`\n### ${key.toUpperCase()} — ${p?.name || ""}`);
      kv("Price", p?.price);
      kv("Delivery", p?.delivery_days && `${p.delivery_days} days`);
      kv("Description", p?.description);
      if (p?.features?.length) lines.push(`- Features:\n${p.features.map((f: string) => `  - ${f}`).join("\n")}`);
    }
  }

  if (gig.faqs?.length) {
    h("FAQs");
    gig.faqs.forEach((f: any) => lines.push(`\n**Q: ${f.question}**\n\n${f.answer}`));
  }

  if (profile.profile_title || profile.short_bio || profile.about) {
    h("Profile");
    kv("Profile Title", profile.profile_title);
    kv("Short Bio", profile.short_bio);
    if (profile.about) lines.push(`\n${profile.about}`);
  }

  if (insights.gap_analysis) {
    h("Gap Analysis");
    lines.push("```json\n" + JSON.stringify(insights.gap_analysis, null, 2) + "\n```");
  }
  if (insights.originality) {
    h("Originality");
    lines.push("```json\n" + JSON.stringify(insights.originality, null, 2) + "\n```");
  }

  return lines.join("\n");
}

export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
