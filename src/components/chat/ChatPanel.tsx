import { useEffect, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import { Camera, ImagePlus, Loader2, Send } from "lucide-react";
import Markdown, { type Components } from "react-markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { downscaleToBase64 } from "@/lib/image";
import type { DiagnosisMessage, DiagnosisResponse } from "@/types";

const aiComponents: Components = {
  p({ children }) {
    return <p className="mb-1.5 last:mb-0">{children}</p>;
  },
  strong({ children }) {
    return <strong className="font-semibold text-white">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic opacity-90">{children}</em>;
  },
  ul({ children }) {
    return <ul className="my-1.5 ml-4 list-disc space-y-0.5">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-1.5 ml-4 list-decimal space-y-0.5">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-snug">{children}</li>;
  },
  // Untrusted model output: render links as inert text (no navigable href →
  // no phishing) and drop images entirely (no src → no zero-click beacon).
  a({ children }) {
    return <span className="underline decoration-dotted">{children}</span>;
  },
  img() {
    return null;
  },
};

const ALLOWED_TYPES = "image/png,image/jpeg,image/webp";
// Server ceiling is 10 TOTAL messages (user + model). The client sends the
// full history each turn, so block once we'd exceed that on the next post.
const MAX_MESSAGES = 10;
const REQUEST_TIMEOUT_MS = 35_000;

type SendStatus = "idle" | "sending";

interface ImageData {
  base64: string;
  mimeType: string;
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<DiagnosisMessage[]>([]);
  const [pendingReply, setPendingReply] = useState(false);
  const [image, setImage] = useState<ImageData | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingReply]);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPhotoPreview(url);

    try {
      const downscaled = await downscaleToBase64(file);
      setImage(downscaled);
    } catch {
      toast.error("Couldn't process the image.");
      setPhotoPreview(null);
      setImage(null);
    }
    e.target.value = "";
  }

  function autoResizeTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function handleSend() {
    if (!image || !draft.trim() || sendStatus === "sending" || sendingRef.current || atTurnCap) return;
    sendingRef.current = true;

    const userMessage: DiagnosisMessage = { role: "user", content: draft.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setPendingReply(true);
    setSendStatus("sending");

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, image }),
        signal: controller.signal,
      });

      const data = (await res.json()) as DiagnosisResponse;

      if (data.status === "ok") {
        setMessages((prev) => [...prev, { role: "model", content: data.reply }]);
      } else {
        setMessages(nextMessages.slice(0, -1));
        setDraft(userMessage.content);
        toast.error("AI is unavailable. Please try again in a moment.");
      }
    } catch {
      setMessages(nextMessages.slice(0, -1));
      setDraft(userMessage.content);
      toast.error("Connection error. Check your internet and try again.");
    } finally {
      clearTimeout(timer);
      sendingRef.current = false;
      setPendingReply(false);
      setSendStatus("idle");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const atTurnCap = messages.length >= MAX_MESSAGES;
  const hasImage = image !== null;
  const canSend = hasImage && draft.trim().length > 0 && sendStatus === "idle" && !atTurnCap;
  const lastMessage = messages.at(-1);
  const liveAnnouncement = pendingReply
    ? "Generating response…"
    : lastMessage?.role === "model"
      ? lastMessage.content
      : "";

  return (
    <div className="flex flex-col gap-4">
      <Toaster richColors position="bottom-right" />

      {/* Scoped live region: announces only the pending state + newest reply */}
      <div aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Photo picker / preview */}
      <div className="space-y-2">
        <label
          htmlFor="chat-photo"
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center text-sm transition-colors",
            "border-white/20 text-blue-100/60 hover:bg-white/10",
          )}
        >
          {photoPreview ? (
            <img
              src={photoPreview}
              alt="Selected plant photo"
              className="h-32 w-32 rounded-lg object-cover shadow-sm"
            />
          ) : (
            <>
              <ImagePlus className="size-6" />
              <span>Add a plant photo (PNG, JPEG, or WebP)</span>
            </>
          )}
          {photoPreview && <span className="text-primary text-xs font-medium">Change photo</span>}
          <input id="chat-photo" type="file" accept={ALLOWED_TYPES} className="hidden" onChange={handlePhotoChange} />
        </label>

        <label
          htmlFor="chat-photo-camera"
          className={cn(
            "flex cursor-pointer items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
            "border-white/20 bg-white/10 text-white/80 hover:bg-white/20",
          )}
        >
          <Camera className="size-4" />
          Take a photo
        </label>
        <input
          id="chat-photo-camera"
          type="file"
          accept={ALLOWED_TYPES}
          capture="environment"
          className="hidden"
          onChange={handlePhotoChange}
        />
      </div>

      {/* Transcript */}
      {(messages.length > 0 || pendingReply) && (
        <ScrollArea className="h-80 rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  msg.role === "user" ? "ml-auto bg-purple-600/60 text-white" : "bg-white/10 text-blue-100",
                )}
              >
                {msg.role === "model" ? <Markdown components={aiComponents}>{msg.content}</Markdown> : msg.content}
              </div>
            ))}
            {pendingReply && (
              <div className="max-w-[85%] space-y-2 rounded-lg bg-white/10 px-3 py-3">
                <Skeleton className="h-3 w-full bg-white/20" />
                <Skeleton className="h-3 w-4/5 bg-white/20" />
                <Skeleton className="h-3 w-3/5 bg-white/20" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}

      {/* Turn cap notice */}
      {atTurnCap && (
        <p className="text-center text-xs text-amber-300/80">
          Conversation limit reached. Refresh the page to start a new one.
        </p>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          placeholder={!hasImage ? "Add a plant photo first…" : "Describe the symptoms or ask a question…"}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoResizeTextarea(e.target);
          }}
          onKeyDown={handleKeyDown}
          disabled={!hasImage || sendStatus === "sending" || atTurnCap}
          className="min-h-[60px] resize-none border-white/20 bg-white/10 text-white placeholder:text-blue-100/40 focus-visible:ring-purple-400/50"
          rows={2}
        />
        <Button
          size="icon"
          onClick={() => void handleSend()}
          disabled={!canSend}
          aria-label="Send message"
          className="mb-0.5 shrink-0"
        >
          {sendStatus === "sending" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>

      {!hasImage && messages.length === 0 && (
        <p className="text-center text-xs text-blue-100/50">Add a plant photo to start the AI diagnosis</p>
      )}
    </div>
  );
}
