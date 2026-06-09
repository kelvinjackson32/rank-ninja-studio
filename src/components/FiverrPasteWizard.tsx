import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, ChevronLeft, ChevronRight, ClipboardList, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { FiverrFieldMeter } from "./FiverrFieldMeter";
import { validateField, validateSearchTags, type FiverrFieldKey } from "@/lib/fiverrLimits";
import { cn } from "@/lib/utils";

type Step = {
  id: string;
  title: string;
  fiverrField: string;
  fieldKey?: FiverrFieldKey;
  value: string;
  isTags?: boolean;
  tags?: string[];
  multiline?: boolean;
  helper?: string;
};

export const FiverrPasteWizard = ({ profile, gig }: { profile: any; gig: any }) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const steps: Step[] = [
    // Profile
    { id: "display_name", title: "Profile → Display Name", fiverrField: "Settings → Personal Info → Display Name", fieldKey: "display_name", value: profile?.display_name || "" },
    { id: "profile_title", title: "Profile → Title", fiverrField: "Settings → Personal Info → Professional Title", fieldKey: "profile_title", value: profile?.profile_title || "" },
    { id: "short_bio", title: "Profile → Tagline (short bio)", fiverrField: "Settings → Personal Info → Description (short)", fieldKey: "short_bio", value: profile?.short_bio || "", multiline: true },
    { id: "about", title: "Profile → About / Description", fiverrField: "Settings → Personal Info → Description", fieldKey: "about", value: profile?.about || "", multiline: true },
    // Gig overview
    { id: "gig_title", title: "Gig → Overview → Gig Title", fiverrField: "Create a Gig → Overview → Gig Title", fieldKey: "gig_title", value: gig?.gig_title || "", helper: "Must start with 'I will'." },
    {
      id: "category",
      title: "Gig → Overview → Category",
      fiverrField: "Create a Gig → Overview → Category & Sub-category",
      value: gig?.category ? `${gig.category.category} > ${gig.category.subcategory} > ${gig.category.service_type}` : "",
      helper: "Pick these exact options in Fiverr's dropdowns.",
    },
    { id: "tags", title: "Gig → Overview → Search Tags", fiverrField: "Create a Gig → Overview → Search Tags (5 max)", value: (gig?.search_tags || []).join(", "), isTags: true, tags: gig?.search_tags || [] },
    // Pricing
    ...["basic", "standard", "premium"].flatMap((tier): Step[] => {
      const p = gig?.packages?.[tier];
      if (!p) return [];
      return [
        { id: `${tier}_name`, title: `Gig → Pricing → ${tier.toUpperCase()} → Package Name`, fiverrField: `Pricing → ${tier} → Name`, fieldKey: "package_name", value: p.name || "" },
        { id: `${tier}_desc`, title: `Gig → Pricing → ${tier.toUpperCase()} → Description`, fiverrField: `Pricing → ${tier} → Description`, fieldKey: "package_description", value: (p.features || []).join(". ").slice(0, 100), multiline: true, helper: `Price: ${p.price} · ${p.delivery_days}d · ${p.revisions} revisions` },
      ];
    }),
    // Description
    { id: "description", title: "Gig → Description", fiverrField: "Create a Gig → Description & FAQ → Description", fieldKey: "description", value: gig?.description || "", multiline: true },
    // FAQs
    ...((gig?.faqs || []).slice(0, 8).flatMap((f: any, i: number): Step[] => [
      { id: `faq_q_${i}`, title: `Gig → FAQ #${i + 1} → Question`, fiverrField: `FAQ ${i + 1} Question`, fieldKey: "faq_question", value: f.q || "" },
      { id: `faq_a_${i}`, title: `Gig → FAQ #${i + 1} → Answer`, fiverrField: `FAQ ${i + 1} Answer`, fieldKey: "faq_answer", value: f.a || "", multiline: true },
    ])),
    // Requirements
    ...((gig?.buyer_requirements || []).slice(0, 6).map((r: any, i: number): Step => ({
      id: `req_${i}`,
      title: `Gig → Requirements → Question #${i + 1}`,
      fiverrField: `Requirements → ${r.type}${r.required ? " (required)" : ""}`,
      fieldKey: "requirement_question",
      value: r.question || "",
      multiline: true,
      helper: r.options?.length ? `Options: ${r.options.join(" | ")}` : undefined,
    }))),
  ];

  const total = steps.length;
  const current = steps[step];

  const doCopy = (id: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopied(id);
    toast.success("Copied — paste into Fiverr");
    setTimeout(() => setCopied(null), 1500);
  };

  if (!current) return null;

  const tagValidations = current.isTags ? validateSearchTags(current.tags || []) : [];
  const tagsValid = tagValidations.every((v) => v.status !== "error") && (current.tags || []).length <= 5;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setStep(0); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:bg-primary/10">
          <ClipboardList className="w-4 h-4 mr-1" />Copy for Fiverr
        </Button>
      </DialogTrigger>
      <DialogContent className="surface-card max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Fiverr Paste Wizard
            <Badge variant="outline" className="font-mono ml-2">Step {step + 1} / {total}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-secondary transition-all" style={{ width: `${((step + 1) / total) * 100}%` }} />
          </div>

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary mb-1">Where to paste in Fiverr</div>
            <div className="text-sm font-medium flex items-center gap-2">
              <ExternalLink className="w-3.5 h-3.5 text-primary shrink-0" />
              {current.fiverrField}
            </div>
            {current.helper && <div className="text-xs text-muted-foreground mt-1.5">{current.helper}</div>}
          </div>

          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">{current.title}</div>
            {current.isTags ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {(current.tags || []).map((t, i) => {
                    const v = tagValidations[i];
                    return (
                      <Badge key={i} className={cn(
                        "font-mono cursor-pointer",
                        v.status === "error" ? "bg-destructive/15 text-destructive border-destructive/40" :
                        v.status === "warn" ? "bg-warning/15 text-warning border-warning/40" :
                        "bg-success/10 text-success border-success/30"
                      )} onClick={() => doCopy(`tag-${i}`, t)} title={v.message}>
                        {t} <span className="opacity-60 ml-1">{t.length}/20</span>
                      </Badge>
                    );
                  })}
                </div>
                {(current.tags || []).length > 5 && (
                  <div className="text-xs text-destructive font-mono">⚠ Fiverr only allows 5 tags. Drop the weakest {(current.tags || []).length - 5}.</div>
                )}
                {!tagsValid && <div className="text-xs text-destructive font-mono">⚠ Fix tags above before pasting.</div>}
              </div>
            ) : (
              <pre className={cn(
                "text-sm bg-background/60 rounded-md p-3 border border-border max-h-64 overflow-auto",
                current.multiline ? "whitespace-pre-wrap font-sans" : "font-sans whitespace-pre-wrap"
              )}>{current.value || <span className="text-muted-foreground italic">empty — skip this field in Fiverr</span>}</pre>
            )}
          </div>

          {current.fieldKey && !current.isTags && current.value && (
            <FiverrFieldMeter fieldKey={current.fieldKey} value={current.value} />
          )}

          <div className="flex items-center gap-2">
            <Button
              className="flex-1 bg-gradient-to-r from-primary to-secondary text-primary-foreground"
              onClick={() => doCopy(current.id, current.isTags ? (current.tags || []).slice(0, 5).join(", ") : current.value)}
              disabled={!current.value}
            >
              {copied === current.id ? <><Check className="w-4 h-4 mr-1" />Copied</> : <><Copy className="w-4 h-4 mr-1" />Copy this field</>}
            </Button>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-border">
            <Button variant="ghost" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              <ChevronLeft className="w-4 h-4 mr-1" />Back
            </Button>
            <div className="text-xs text-muted-foreground font-mono">{step + 1} of {total}</div>
            <Button variant="ghost" size="sm" onClick={() => setStep((s) => Math.min(total - 1, s + 1))} disabled={step === total - 1}>
              Next<ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
