import { useState } from "react";
import { Loader2, Wand2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const FIVERR_W = 1280;
const FIVERR_H = 769;

// Center-crop + resize any generated image to Fiverr's exact 1280x769 gig size.
const toFiverrSize = (dataUrl: string) =>
  new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = FIVERR_W;
      canvas.height = FIVERR_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unsupported"));
      const targetRatio = FIVERR_W / FIVERR_H;
      const srcRatio = img.width / img.height;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (srcRatio > targetRatio) {
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, FIVERR_W, FIVERR_H);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = dataUrl;
  });

export const ThumbnailGenerator = ({ prompt, style }: { prompt: string; style?: string }) => {
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-thumbnail", { body: { prompt } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const raw = (data as any).image as string;
      const fiverrSized = await toFiverrSize(raw).catch(() => raw);
      setImage(fiverrSized);
      toast.success("Gig thumbnail ready (1280×769)");
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate");
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image;
    a.download = `fiverr-gig-${(style || "thumbnail").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-1280x769.png`;
    a.click();
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />}
          {image ? "Regenerate premium gig image" : "Generate premium gig image"}
        </Button>
        {image && (
          <Button size="sm" variant="outline" onClick={download}>
            <Download className="w-4 h-4 mr-1" />Download 1280×769
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Optimized for Fiverr's recommended gig image size (1280×769) using a top-seller CTR formula: bold headline, clear CTA, trust badge, high-contrast palette.
      </p>
      {image && (
        <img
          src={image}
          alt={style || "Fiverr gig thumbnail 1280x769"}
          width={FIVERR_W}
          height={FIVERR_H}
          className="rounded-md border border-border max-w-md w-full h-auto"
        />
      )}
    </div>
  );
};
