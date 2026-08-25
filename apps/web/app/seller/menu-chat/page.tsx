"use client";

/** Conversational menu builder — the seller describes today's cooking and the agent turns it
 * into dishes, a dated draft menu, and a publish. Same SSE contract as the buyer chat; the
 * draft and published cards arrive as fenced json blocks inside the assistant text. */
import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, getSession, Session } from "../../../lib/api";
import { renderRich } from "../../../lib/rich-text";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface DraftItem {
  name: string;
  description?: string | null;
  priceCents: number;
  portionsTotal: number;
  dietaryTags?: string[] | null;
  isNew?: boolean;
}

interface MenuDraftCard {
  type: "menuDraft";
  kitchenName?: string;
  date: string;
  readyWindows: { start: string; end: string; slotMinutes: number }[];
  items: DraftItem[];
}

interface MenuPublishedCard {
  type: "menuPublished";
  menuDayId: string;
  date: string;
  itemCount: number;
  portionsTotal: number;
}

const SUGGESTIONS = [
  "Today I'm making 12 portions of lahmacun at $9",
  "Add sarma and mercimek çorbası to tomorrow's menu",
  "What's on my menu today?",
];

function cents(n: number) {
  return `$${(n / 100).toFixed(2)}`;
}

export default function SellerMenuChatPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState<MenuDraftCard | null>(null);
  const [published, setPublished] = useState<MenuPublishedCard | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const current = getSession();
    if (!current) {
      router.replace("/login");
      return;
    }
    setSession(current);
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // When the assistant finishes: send anything typed meanwhile, keep focus in the box.
  useEffect(() => {
    if (streaming) return;
    inputRef.current?.focus();
    if (queued) {
      const text = queued;
      setQueued(null);
      send(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  async function send(text: string) {
    if (!text.trim() || streaming) return;
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setStreaming(true);
    setDraft(null);
    setPublished(null);

    let assistantText = "";
    const addChunk = (delta: string) => {
      assistantText += delta;
      setMessages([...next, { role: "assistant", content: assistantText }]);
    };

    try {
      const res = await apiFetch(`/chat/seller/stream`, {
        method: "POST",
        body: JSON.stringify({ messages: next }),
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        setMessages([
          ...next,
          { role: "assistant", content: "This assistant is for kitchen owners. Sign in as a seller to use it." },
        ]);
        return;
      }
      if (!res.ok) {
        setMessages([
          ...next,
          { role: "assistant", content: `Something went wrong (HTTP ${res.status}). Please try again.` },
        ]);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5).trim());
          if (payload.type === "text") addChunk(payload.delta);
          else if (payload.type === "done") break;
        }
      }

      const blockMatch = assistantText.match(/```json\n([\s\S]*?)\n```/);
      if (blockMatch) {
        try {
          const parsed = JSON.parse(blockMatch[1]);
          let handled = false;
          if (parsed.type === "menuDraft" && Array.isArray(parsed.items)) {
            setDraft(parsed);
            handled = true;
          } else if (parsed.type === "menuPublished") {
            setPublished(parsed);
            handled = true;
          }
          // The card renders the data; don't also show the raw JSON in the bubble.
          if (handled) assistantText = assistantText.replace(blockMatch[0], "").trim();
        } catch {
          // Not a card, just a fenced code block in the reply — leave the bubble as it is.
        }
      }

      setMessages([...next, { role: "assistant", content: assistantText }]);
    } catch {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: assistantText
            ? assistantText + "\n\n[connection interrupted]"
            : "Connection error. Please try again.",
        },
      ]);
    } finally {
      setStreaming(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    if (streaming) {
      setQueued(input.trim());
      setInput("");
      return;
    }
    send(input);
  }

  if (session === undefined) return null; // deciding
  if (session === null) return null; // redirecting to /login

  if (session.role !== "seller") {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div className="form-error" role="alert">
          This page is for sellers. You are signed in as a {session.role}.
        </div>
        <Link href="/">&lsaquo; Back home</Link>
      </main>
    );
  }

  const lastMessage = messages[messages.length - 1];
  const showTyping = streaming && (!lastMessage || lastMessage.role === "user" || !lastMessage.content);
  const draftPortions = draft?.items.reduce((sum, it) => sum + it.portionsTotal, 0) ?? 0;

  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100dvh",
        maxWidth: 760,
        margin: "0 auto",
        padding: "14px 16px 0",
        position: "relative",
      }}
    >
      <div className="hero-glow" aria-hidden="true" style={{ opacity: 0.6 }} />

      <header className="island-nav" style={{ maxWidth: 520, margin: "0 auto", width: "100%" }}>
        <Link href="/seller/menu" style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em" }}>
          Menu assistant
        </Link>
        <Link href="/seller/menu" className="btn btn-ghost" style={{ padding: "7px 16px", fontSize: 13.5 }}>
          Manual editor
        </Link>
      </header>

      <div role="log" aria-live="polite" style={{ flex: 1, overflowY: "auto", padding: "24px 2px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", marginTop: "13vh" }}>
            <div className="halo-orb stagger" style={{ "--i": 0 } as React.CSSProperties}>
              N
            </div>
            <h1
              className="stagger"
              style={
                {
                  "--i": 1,
                  fontSize: "clamp(26px, 4vw, 34px)",
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  margin: "0 0 10px",
                } as React.CSSProperties
              }
            >
              What are you <span className="hero-em">cooking</span> today?
            </h1>
            <p
              className="stagger"
              style={{ "--i": 2, color: "var(--text-2)", fontSize: 15.5, margin: "0 0 32px" } as React.CSSProperties}
            >
              Describe the dishes, prices and portions — I&rsquo;ll build and publish the menu.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  className="chip stagger"
                  style={{ "--i": 3 + i } as React.CSSProperties}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className="fade-up"
            style={{
              marginBottom: 16,
              display: "flex",
              gap: 10,
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            {m.role === "assistant" && <div className="avatar-orb">N</div>}
            <div className={`bubble ${m.role === "user" ? "bubble-user" : "bubble-assistant"}`}>
              {renderRich(m.content)}
            </div>
          </div>
        ))}

        {showTyping && (
          <div className="fade-up" style={{ display: "flex", gap: 10, justifyContent: "flex-start", marginBottom: 16 }}>
            <div className="avatar-orb">N</div>
            <div
              className="bubble bubble-assistant"
              style={{ display: "flex", gap: 5, alignItems: "center", padding: "15px 18px" }}
              aria-label="Assistant is typing"
            >
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

        {/* Draft menu card — review before anything is written to the kitchen */}
        {draft && (
          <div role="dialog" aria-labelledby="draft-heading" className="fade-up shell" style={{ margin: "14px 0" }}>
            {/* body carries the marketplace text colour; the chat surface needs the chat one. */}
            <div className="shell-core" style={{ padding: "18px 20px", color: "var(--text)" }}>
              <h2 id="draft-heading" style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 700 }}>
                Draft menu &mdash; {draft.date}
              </h2>
              <p style={{ margin: "0 0 10px", color: "var(--text-2)", fontSize: 13.5 }}>
                {draft.kitchenName ? `${draft.kitchenName} · ` : ""}
                Ready{" "}
                {draft.readyWindows.map((w) => `${w.start}–${w.end}`).join(", ")}
              </p>

              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                {draft.items.map((it, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {it.name}
                        {it.isNew && (
                          <span className="kcal" style={{ marginLeft: 8 }}>
                            new dish
                          </span>
                        )}
                      </div>
                      {it.description && (
                        <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2, lineHeight: 1.45 }}>
                          {it.description}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        {(it.dietaryTags ?? []).map((tag) => (
                          <span key={tag} className="kcal" style={{ textTransform: "capitalize" }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{cents(it.priceCents)}</div>
                      <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{it.portionsTotal} portions</div>
                    </div>
                  </div>
                ))}
              </div>

              <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--text-2)" }}>
                {draft.items.length} dish{draft.items.length === 1 ? "" : "es"}, {draftPortions} portions total.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  onClick={() => send("Yes, save this menu as a draft.")}
                  disabled={streaming}
                  className="btn btn-primary"
                  style={{ padding: "10px 22px" }}
                >
                  Save menu
                </button>
                <button
                  onClick={() => send("Save it and publish it right away.")}
                  disabled={streaming}
                  className="btn btn-ghost"
                  style={{ padding: "9px 18px" }}
                >
                  Save &amp; publish
                </button>
                <button onClick={() => setDraft(null)} className="btn btn-ghost" style={{ padding: "9px 18px" }}>
                  Keep editing
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Published confirmation */}
        {published && (
          <div className="fade-up shell" style={{ margin: "14px 0" }}>
            <div className="shell-core" style={{ padding: "18px 20px", color: "var(--text)" }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>
                Published for {published.date}
              </h2>
              <p style={{ margin: "0 0 12px", color: "var(--text-2)", fontSize: 14 }}>
                {published.itemCount} dish{published.itemCount === 1 ? "" : "es"} and {published.portionsTotal}{" "}
                portions are now live for buyers nearby.
              </p>
              <Link href="/seller/menu" className="btn btn-primary" style={{ padding: "10px 22px" }}>
                Open the menu editor
              </Link>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div style={{ marginTop: "auto" }}>
        {queued && (
          <p aria-live="polite" style={{ fontSize: 13, color: "var(--text-3)", margin: "0 0 6px", paddingLeft: 22 }}>
            Will send when the assistant finishes: &ldquo;{queued}&rdquo;
          </p>
        )}
        <form onSubmit={onSubmit} className="chat-dock" style={{ marginBottom: 14 }}>
          <input
            ref={inputRef}
            aria-label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            placeholder="Tell me what you're cooking, the price and how many portions"
          />
          <button type="submit" disabled={!input.trim()} aria-label="Send" className="send-orb">
            &#8599;
          </button>
        </form>
      </div>
    </main>
  );
}
