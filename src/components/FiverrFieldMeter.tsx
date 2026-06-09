import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { validateField, type FiverrFieldKey } from "@/lib/fiverrLimits";
import { cn } from "@/lib/utils";

export const FiverrFieldMeter = ({ fieldKey, value, className }: { fieldKey: FiverrFieldKey; value: string; className?: string }) => {
  const r = validateField(fieldKey, value || "");
  const color =
    r.status === "error" ? "text-destructive border-destructive/40 bg-destructive/5" :
    r.status === "warn" ? "text-warning border-warning/40 bg-warning/5" :
    "text-success border-success/40 bg-success/5";
  const Icon = r.status === "error" ? XCircle : r.status === "warn" ? AlertTriangle : CheckCircle2;
  const pct = r.max ? Math.min(100, (r.length / r.max) * 100) : 0;
  const barColor = r.status === "error" ? "bg-destructive" : r.status === "warn" ? "bg-warning" : "bg-success";
  return (
    <div className={cn("flex items-center gap-2 text-xs font-mono rounded-md border px-2 py-1.5", color, className)}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="tabular-nums">{r.length}{r.max ? `/${r.max}` : ""}</span>
      {r.max && (
        <div className="flex-1 h-1 rounded-full bg-background/60 overflow-hidden min-w-[40px] max-w-[120px]">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <span className="truncate">{r.message}</span>
    </div>
  );
};
