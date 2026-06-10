import { useState } from "react";
import { Loader2, Wand2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const ThumbnailGenerator = ({ prompt, style }: { prompt: string; style?: string }) => {
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-thumbnail", { body: { prompt } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setImage((data as any).image);
      toast.success("Thumbnail generated");
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
    a.download = `thumbnail-${(style || "fiverr").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    a.click();
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex gap-2">
        <Button size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />}
          {image ? "Regenerate image" : "Generate image"}
        </Button>
        {image && (
          <Button size="sm" variant="outline" onClick={download}>
            <Download className="w-4 h-4 mr-1" />Download
          </Button>
        )}
      </div>
      {image && (
        <img src={image} alt={style || "Generated thumbnail"} className="rounded-md border border-border max-w-md w-full" />
      )}
    </div>
  );
};
