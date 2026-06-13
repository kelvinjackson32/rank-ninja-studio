import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus, Send, Trash2, Pencil, Image as ImageIcon, X, MessageSquare,
  Loader2, RefreshCw, Copy, Check, ChevronLeft
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Thread = { id: string; title: string; updated_at: string };
type ImgRef = { path: string; mime: string; url?: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; images: ImgRef[]; created_at: string };

const Chat = () => {
  const { user } = useAuth();
  const { threadId } = useParams();
  const nav = useNavigate();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [deleteThreadId, setDeleteThreadId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Load threads
  const loadThreads = async () => {
    const { data } = await supabase
      .from("chat_threads")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false });
    setThreads((data as Thread[]) || []);
  };
  useEffect(() => { if (user) loadThreads(); }, [user]);

  // Bootstrap: if no threadId in URL, pick most recent or create
  useEffect(() => {
    if (!user || threadId) return;
    (async () => {
      const { data } = await supabase
        .from("chat_threads").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (data?.id) nav(`/app/chat/${data.id}`, { replace: true });
      else {
        const { data: created } = await supabase.from("chat_threads")
          .insert({ user_id: user.id, title: "New chat" }).select("id").maybeSingle();
        if (created?.id) nav(`/app/chat/${created.id}`, { replace: true });
      }
    })();
  }, [user, threadId, nav]);

  // Load messages for current thread
  useEffect(() => {
    if (!threadId) { setMessages([]); return; }
    (async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id,role,content,images,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      const list = (data as any[] || []).map(m => ({ ...m, images: (m.images || []) as ImgRef[] })) as Msg[];
      // Resolve signed urls for previews
      for (const m of list) {
        if (m.images?.length) {
          const paths = m.images.map(i => i.path);
          const { data: signed } = await supabase.storage.from("chat-uploads").createSignedUrls(paths, 3600);
          signed?.forEach((s, idx) => { if (s.signedUrl) m.images[idx].url = s.signedUrl; });
        }
      }
      setMessages(list);
      setTimeout(() => { taRef.current?.focus(); scrollRef.current?.scrollTo({ top: 1e9 }); }, 50);
    })();
  }, [threadId]);

  // Auto-scroll
  useEffect(() => { scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [messages, sending]);

  const newThread = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("chat_threads")
      .insert({ user_id: user.id, title: "New chat" }).select("id").maybeSingle();
    if (error || !data) { toast.error(error?.message || "Failed"); return; }
    await loadThreads();
    nav(`/app/chat/${data.id}`);
    setShowSidebar(false);
  };

  const renameThread = async (id: string) => {
    const title = renameText.trim() || "Untitled";
    await supabase.from("chat_threads").update({ title }).eq("id", id);
    setRenamingId(null);
    loadThreads();
  };

  const deleteThread = async (id: string) => {
    await supabase.from("chat_threads").delete().eq("id", id);
    setDeleteThreadId(null);
    if (threadId === id) nav("/app/chat", { replace: true });
    loadThreads();
  };

  const uploadFiles = async (files: File[]): Promise<ImgRef[]> => {
    if (!user) return [];
    const refs: ImgRef[] = [];
    for (const f of files) {
      const path = `${user.id}/${threadId}/${crypto.randomUUID()}-${f.name.replace(/[^a-z0-9.\-_]/gi, "_")}`;
      const { error } = await supabase.storage.from("chat-uploads").upload(path, f, { contentType: f.type, upsert: false });
      if (error) { toast.error(`Upload failed: ${error.message}`); continue; }
      refs.push({ path, mime: f.type || "image/jpeg" });
    }
    return refs;
  };

  const callAI = async (allMsgs: Msg[]) => {
    const payload = allMsgs.map(m => ({
      role: m.role,
      content: m.content,
      images: m.images?.map(i => ({ path: i.path, mime: i.mime })) || [],
    }));
    const { data, error } = await supabase.functions.invoke("chat-gemini", {
      body: { threadId, messages: payload },
    });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return (data as any).text as string;
  };

  const send = async (overrideText?: string, overrideFiles?: File[]) => {
    if (!threadId || sending) return;
    const text = (overrideText ?? input).trim();
    const files = overrideFiles ?? pendingFiles;
    if (!text && files.length === 0) return;

    setSending(true);
    try {
      const imgRefs = files.length ? await uploadFiles(files) : [];
      // Sign for preview
      for (const r of imgRefs) {
        const { data: s } = await supabase.storage.from("chat-uploads").createSignedUrl(r.path, 3600);
        if (s?.signedUrl) r.url = s.signedUrl;
      }
      const { data: inserted } = await supabase.from("chat_messages")
        .insert({ thread_id: threadId, user_id: user!.id, role: "user", content: text, images: imgRefs.map(r => ({ path: r.path, mime: r.mime })) })
        .select("id,created_at").maybeSingle();
      const userMsg: Msg = {
        id: inserted!.id, role: "user", content: text, images: imgRefs, created_at: inserted!.created_at,
      };
      const next = [...messages, userMsg];
      setMessages(next);
      setInput("");
      setPendingFiles([]);

      const reply = await callAI(next);
      // Refresh from DB to get the assistant row id
      const { data: latest } = await supabase.from("chat_messages")
        .select("id,role,content,images,created_at")
        .eq("thread_id", threadId).order("created_at", { ascending: true });
      const list = (latest as any[] || []).map(m => ({ ...m, images: (m.images || []) as ImgRef[] })) as Msg[];
      for (const m of list) {
        if (m.images?.length) {
          const paths = m.images.map(i => i.path);
          const { data: signed } = await supabase.storage.from("chat-uploads").createSignedUrls(paths, 3600);
          signed?.forEach((s, idx) => { if (s.signedUrl) m.images[idx].url = s.signedUrl; });
        }
      }
      setMessages(list);
      loadThreads();
    } catch (e: any) {
      toast.error(e.message || "Failed to send");
    } finally {
      setSending(false);
      setTimeout(() => taRef.current?.focus(), 50);
    }
  };

  const deleteMsg = async (id: string) => {
    await supabase.from("chat_messages").delete().eq("id", id);
    setMessages(messages.filter(m => m.id !== id));
  };

  const saveEdit = async (id: string) => {
    await supabase.from("chat_messages").update({ content: editText }).eq("id", id);
    setMessages(messages.map(m => m.id === id ? { ...m, content: editText } : m));
    setEditingId(null);
  };

  const resend = async (id: string) => {
    const idx = messages.findIndex(m => m.id === id);
    if (idx < 0) return;
    const m = messages[idx];
    // Delete this user msg + any messages after it, then re-send
    const toDelete = messages.slice(idx).map(x => x.id);
    await supabase.from("chat_messages").delete().in("id", toDelete);
    setMessages(messages.slice(0, idx));
    await send(m.content, []);
  };

  const copyMsg = (m: Msg) => {
    navigator.clipboard.writeText(m.content);
    setCopiedId(m.id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPendingFiles(prev => [...prev, ...files]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const activeThread = useMemo(() => threads.find(t => t.id === threadId), [threads, threadId]);

  const Sidebar = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <Button onClick={newThread} className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground">
          <Plus className="w-4 h-4 mr-1" /> New Chat
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {threads.length === 0 && (
            <div className="text-xs text-muted-foreground p-4 text-center">No chats yet</div>
          )}
          {threads.map(t => (
            <div key={t.id} className={cn(
              "group rounded-md text-sm flex items-center gap-1 px-2 py-1.5 hover:bg-muted/60 transition",
              threadId === t.id && "bg-primary/10 border border-primary/30"
            )}>
              {renamingId === t.id ? (
                <Input
                  autoFocus value={renameText}
                  onChange={e => setRenameText(e.target.value)}
                  onBlur={() => renameThread(t.id)}
                  onKeyDown={e => { if (e.key === "Enter") renameThread(t.id); if (e.key === "Escape") setRenamingId(null); }}
                  className="h-7 text-sm"
                />
              ) : (
                <>
                  <button
                    onClick={() => { nav(`/app/chat/${t.id}`); setShowSidebar(false); }}
                    className="flex-1 text-left truncate min-w-0 font-semibold"
                  >
                    <MessageSquare className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5 opacity-60" />
                    {t.title}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setRenamingId(t.id); setRenameText(t.title); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-primary" aria-label="Rename">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setDeleteThreadId(t.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive" aria-label="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-49px)] md:h-screen">
        {/* Threads sidebar - desktop */}
        <aside className="hidden lg:flex w-72 border-r border-border bg-card/30">
          {Sidebar}
        </aside>
        {/* Mobile drawer */}
        {showSidebar && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-background/80" onClick={() => setShowSidebar(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-72 bg-card border-r border-border">
              {Sidebar}
            </aside>
          </div>
        )}

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-background/60 backdrop-blur">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setShowSidebar(true)}>
              <ChevronLeft className="w-4 h-4 rotate-180" />
            </Button>
            <div className="font-bold text-base flex-1 truncate">{activeThread?.title || "AI Chat"}</div>
            <Button size="sm" variant="outline" onClick={newThread}><Plus className="w-3.5 h-3.5 mr-1" /> New</Button>
          </div>

          <ScrollArea className="flex-1" ref={scrollRef as any}>
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {messages.length === 0 && !sending && (
                <div className="text-center py-20">
                  <div className="text-2xl font-bold mb-2">Ask anything. Drop any images.</div>
                  <p className="text-muted-foreground">Powered by your own Gemini key — unlimited and free.</p>
                </div>
              )}
              {messages.map(m => (
                <div key={m.id} className={cn("group", m.role === "user" ? "flex justify-end" : "")}>
                  <div className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-card border border-border"
                  )}>
                    {m.images?.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {m.images.map((img, i) => (
                          <a key={i} href={img.url} target="_blank" rel="noreferrer">
                            <img src={img.url} alt="" className="max-h-48 rounded-lg border border-border/40" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    )}
                    {editingId === m.id ? (
                      <div className="space-y-2">
                        <Textarea value={editText} onChange={e => setEditText(e.target.value)} className="bg-background text-foreground" rows={3} />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEdit(m.id)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : m.role === "assistant" ? (
                      <div className="prose prose-invert prose-sm max-w-none font-medium prose-strong:font-bold prose-headings:font-bold prose-p:leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "*(empty)*"}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                    )}
                  </div>
                  {editingId !== m.id && (
                    <div className={cn(
                      "flex gap-1 opacity-0 group-hover:opacity-100 transition self-end mb-1",
                      m.role === "user" ? "order-first mr-2" : "ml-2"
                    )}>
                      <button onClick={() => copyMsg(m)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Copy">
                        {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      {m.role === "user" && (
                        <>
                          <button onClick={() => { setEditingId(m.id); setEditText(m.content); }} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => resend(m.id)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" title="Resend">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      <button onClick={() => deleteMsg(m.id)} className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Composer */}
          <div className="border-t border-border bg-background/80 backdrop-blur p-3">
            <div className="max-w-3xl mx-auto">
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="relative">
                      <img src={URL.createObjectURL(f)} alt="" className="h-16 w-16 object-cover rounded-md border border-border" />
                      <button onClick={() => setPendingFiles(pendingFiles.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFilePick} />
                <Button variant="outline" size="icon" onClick={() => fileRef.current?.click()} title="Attach images" disabled={sending}>
                  <ImageIcon className="w-4 h-4" />
                </Button>
                <Textarea
                  ref={taRef}
                  value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
                  placeholder="Type your message… (Shift+Enter for new line)"
                  rows={1} className="flex-1 resize-none max-h-40 font-medium text-base"
                  disabled={sending}
                />
                <Button onClick={() => send()} disabled={sending || (!input.trim() && pendingFiles.length === 0)}
                  className="bg-gradient-to-r from-primary to-secondary text-primary-foreground">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Uses your own Gemini key — no Lovable credits used.
              </p>
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={!!deleteThreadId} onOpenChange={(o) => !o && setDeleteThreadId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>All messages and uploaded images will be permanently removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteThreadId && deleteThread(deleteThreadId)} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};

export default Chat;
