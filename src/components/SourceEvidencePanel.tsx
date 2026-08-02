import { CheckCircle2, HelpCircle, FileSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type EvidenceItem = {
  field: string;
  used_for?: string;
  quote?: string;
  status?: string;
  note?: string;
  source_url?: string | null;
};

export const SourceEvidencePanel = ({ evidence }: { evidence?: EvidenceItem[] }) => {
  if (!evidence || evidence.length === 0) return null;
  const verified = evidence.filter((e) => e.status === "verified");
  const manual = evidence.filter((e) => e.status !== "verified");
  const ordered = [...verified, ...manual];

  return (
    <div>
      <div className="font-mono text-xs uppercase text-primary mb-2 flex items-center gap-2">
        <FileSearch className="w-4 h-4" /> Source evidence
        <Badge variant="outline" className="bg-success/10 text-success border-success/30">{verified.length} verified</Badge>
        <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">{manual.length} to confirm</Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        Exactly which scraped Fiverr fields each check was based on. Verified items were read word-for-word from your live page.
      </p>
      <div className="space-y-2">
        {ordered.map((e, i) => {
          const ok = e.status === "verified";
          const Icon = ok ? CheckCircle2 : HelpCircle;
          return (
            <div
              key={i}
              className={`border rounded-lg p-3 ${ok ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"}`}
            >
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Icon className={`w-3.5 h-3.5 shrink-0 ${ok ? "text-success" : "text-warning"}`} />
                <span className="font-semibold text-sm">{e.field}</span>
                <Badge
                  variant="outline"
                  className={ok
                    ? "bg-success/15 text-success border-success/30"
                    : "bg-warning/15 text-warning border-warning/30"}
                >
                  {ok ? "verified" : "needs manual confirmation"}
                </Badge>
              </div>
              {e.used_for && <div className="text-xs text-muted-foreground">Used for: {e.used_for}</div>}
              {e.quote
                ? <pre className="text-xs whitespace-pre-wrap bg-muted/40 p-2 rounded mt-1.5 font-mono leading-relaxed">{e.quote}</pre>
                : <div className="text-xs italic text-muted-foreground mt-1.5">No readable text captured for this field.</div>}
              {e.note && <div className="text-xs text-muted-foreground mt-1.5">{e.note}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
