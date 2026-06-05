import { ShieldCheck, ShieldAlert, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

type Flag = {
  field: string;
  category: string;
  original: string;
  replacement: string;
};

type Report = {
  applied_at?: string;
  total_fixes?: number;
  flags?: Flag[];
  notes?: string[];
};

const CATEGORY_LABEL: Record<string, string> = {
  guarantee: "Guarantee claim",
  external_contact: "External contact",
  payment_offsite: "Off-Fiverr payment",
  spam_claim: "Spammy wording",
  restricted: "Restricted service",
  keyword_stuffing: "Keyword stuffing",
};

const CATEGORY_COLOR: Record<string, string> = {
  guarantee: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  external_contact: "bg-red-500/15 text-red-300 border-red-500/30",
  payment_offsite: "bg-red-500/15 text-red-300 border-red-500/30",
  spam_claim: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  restricted: "bg-red-500/15 text-red-300 border-red-500/30",
  keyword_stuffing: "bg-blue-500/15 text-blue-300 border-blue-500/30",
};

export function SafetyReportPanel({
  profile,
  gig,
}: {
  profile?: Report;
  gig?: Report;
}) {
  const [open, setOpen] = useState(false);
  const combined: Flag[] = [
    ...(profile?.flags || []).map((f) => ({ ...f, field: `profile.${f.field}` })),
    ...(gig?.flags || []).map((f) => ({ ...f, field: `gig.${f.field}` })),
  ];
  const total = combined.length;
  const notes = Array.from(new Set([...(profile?.notes || []), ...(gig?.notes || [])]));
  const clean = total === 0;

  return (
    <div
      className={`rounded-xl border p-4 ${
        clean
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3">
          {clean ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
          )}
          <div>
            <div className="font-semibold text-sm">
              Fiverr Policy Safety Filter{" "}
              <span className="text-muted-foreground font-normal">
                — {clean ? "no risky content found" : `${total} fix${total === 1 ? "" : "es"} applied`}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {clean
                ? "Your generated content passed all Fiverr ToS checks."
                : "We auto-sanitized content before showing it. Review what changed below."}
            </div>
          </div>
        </div>
        {!clean && (
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {!clean && open && (
        <div className="mt-4 space-y-3">
          {notes.length > 0 && (
            <ul className="text-xs text-foreground/80 space-y-1 list-disc pl-5">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {combined.map((f, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/60 bg-background/40 p-2.5 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${CATEGORY_COLOR[f.category] || ""}`}
                  >
                    {CATEGORY_LABEL[f.category] || f.category}
                  </Badge>
                  <span className="text-muted-foreground font-mono text-[10px] truncate">
                    {f.field}
                  </span>
                </div>
                <div className="text-foreground/70">
                  <span className="text-red-300/80 line-through decoration-red-500/40">
                    {f.original.slice(0, 140)}
                  </span>
                  {f.replacement && (
                    <>
                      <span className="text-muted-foreground"> → </span>
                      <span className="text-emerald-300/90">{f.replacement.slice(0, 140)}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
