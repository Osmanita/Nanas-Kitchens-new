"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../lib/api";
import {
  getLocation,
  saveLocation,
  type PickedLocation,
} from "../../lib/location";
import { renderRich } from "../../lib/rich-text";
import LocationPickerModal from "../components/LocationPickerModal";
import PaymentStep, { type PendingPayment } from "../components/PaymentStep";
import Icon from "../components/Icon";
import styles from "./chat.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface OrderSummary {
  confirmed: false;
  summary: {
    kitchenName?: string;
    items: { name: string; qty: number; priceCents: number }[];
    totalCents: number;
    readySlot: string;
    fulfillment: string;
    deliveryAddress?: string;
  };
  // raw draft stored so we can re-submit with confirm=true
  draft: Record<string, unknown>;
}

interface MenuCard {
  type: "menu";
  kitchenName: string;
  kitchenId: string;
  menuDayId: string;
  items: {
    menuItemId: string;
    name: string;
    description?: string | null;
    photo?: string | null;
    calories?: number | null;
    priceCents: number;
    portionsLeft?: number | null;
    dietaryTags?: string[] | null;
  }[];
}

interface KitchenListCard {
  type: "kitchens";
  items: {
    id: string;
    name: string;
    cuisineTag: string;
    distanceMiles: number;
    portionsLeftToday: number;
    photo?: string | null;
    description?: string | null;
    ratingAvg?: number | null;
    ratingCount?: number | null;
  }[];
}

interface ConfirmedOrder {
  id: string;
  readySlot?: string;
  trackingUrl?: string | null;
}

const SUGGESTIONS = [
  { title: "A taste of home", text: "Find Turkish food near me", icon: "bowl" },
  {
    title: "Something fresh",
    text: "Find vegetarian dishes near me",
    icon: "leaf",
  },
  {
    title: "Let’s see what’s cooking",
    text: "What's cooking near me today?",
    icon: "arrow",
  },
] as const;

function cents(n: number) {
  return `$${(n / 100).toFixed(2)}`;
}

/** Story 5.2 AC4 — transcripts below this confidence are staged for review, not auto-sent. */
const CONFIDENCE_THRESHOLD = 0.85;
const MAX_RECORDING_SECONDS = 60;

/**
 * The agent is instructed to wrap structured cards in a JSON fence, but providers can vary
 * whitespace and line endings. Keep the card path forgiving: try fenced JSON first, then a
 * single raw object so a valid response never falls through as a wall of JSON text.
 */
function extractStructuredBlock(
  text: string,
): { raw: string; parsed: Record<string, unknown> } | null {
  const candidates: { raw: string; body: string }[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push({ raw: fenced[0], body: fenced[1] });

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push({
      raw: text.slice(firstBrace, lastBrace + 1),
      body: text.slice(firstBrace, lastBrace + 1),
    });
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate.body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          raw: candidate.raw,
          parsed: parsed as Record<string, unknown>,
        };
      }
    } catch {
      // This may be ordinary prose containing braces. Try the next candidate.
    }
  }
  return null;
}

/** Renders ISO datetimes in locale format; falls back to the raw text ("18:00", "ASAP"). */
function fmtSlot(value: string) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toLocaleString();
}

/** Shows a resilient delivery preview: the map is an enhancement, while the address card
 * remains useful when a browser blocks geocoding or the OpenStreetMap embed. */
function AddressMap({ address }: { address: string }) {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    setCoords(null);
    setFailed(false);
    setMapLoaded(false);
    // Same tiered fallback as the server: drop leading tokens until a variant resolves.
    const tokens = address.trim().replace(/[,;]+/g, " ").split(/\s+/);
    const candidates: string[] = [];
    for (let drop = 0; drop <= Math.min(3, tokens.length - 2); drop++) {
      const candidate = tokens.slice(drop).join(" ");
      if (candidate) candidates.push(candidate);
    }
    (async () => {
      for (const candidate of candidates) {
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(candidate)}`,
            { headers: { accept: "application/json" }, signal: controller.signal },
          );
          if (!r.ok) break;
          const d = await r.json();
          if (!alive) return;
          if (Array.isArray(d) && d[0]) {
            setCoords({ lat: +d[0].lat, lon: +d[0].lon });
            return;
          }
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (!alive) return;
      }
      if (alive) setFailed(true);
    })();
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [address]);

  const mapUrl = coords
    ? `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lon}#map=15/${coords.lat}/${coords.lon}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
  const d = 0.004;
  const bbox = coords
    ? `${coords.lon - d},${coords.lat - d},${coords.lon + d},${coords.lat + d}`
    : null;
  return (
    <div className={styles.addressPreview}>
      {coords && !failed && bbox && (
        <iframe
          title="Delivery drop-off location"
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${coords.lat}%2C${coords.lon}`}
          className={`${styles.addressFrame} ${mapLoaded ? styles.addressFrameVisible : ""}`}
          onLoad={() => setMapLoaded(true)}
          onError={() => setFailed(true)}
          loading="lazy"
        />
      )}
      {!mapLoaded || failed || !coords ? (
        <div className={styles.addressFallback} aria-label="Delivery address preview">
          <div className={styles.addressMapGraphic} aria-hidden="true">
            <span className={styles.addressMapRoad} />
            <span className={styles.addressMapRoadAlt} />
            <span className={styles.addressPin}>●</span>
          </div>
        </div>
      ) : null}
      <div className={styles.addressDetails}>
        <div>
          <span>{failed ? "Map preview unavailable" : "Delivery location"}</span>
          <strong>{address}</strong>
        </div>
        <a href={mapUrl} target="_blank" rel="noreferrer">
          Open map
        </a>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [failure, setFailure] = useState<{
    text: string;
    history: Message[];
    message: string;
  } | null>(null);
  const [pendingSummary, setPendingSummary] = useState<OrderSummary | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [pendingMenu, setPendingMenu] = useState<MenuCard | null>(null);
  const [pendingKitchens, setPendingKitchens] =
    useState<KitchenListCard | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrder | null>(
    null,
  );
  // Set when POST /orders answers requiresPayment (the real Stripe provider): the order is
  // placed but pending, so the card below has to settle it before anything is "confirmed".
  const [pendingPayment, setPendingPayment] = useState<
    (PendingPayment & { totalCents: number }) | null
  >(null);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [queued, setQueued] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const conversationRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  // Separate from the browse-location picker above: this one edits the delivery address on
  // a pending order, and isn't US-restricted — a buyer's real address can be anywhere.
  const [deliveryPickerOpen, setDeliveryPickerOpen] = useState(false);

  function confirmLocation(loc: PickedLocation) {
    saveLocation(loc);
    setLocation(loc);
    setLocationPickerOpen(false);
  }

  // One effect, not two: reading location here and handing it straight to send() as an
  // override avoids a same-tick race where a separate "load location" effect's setState
  // hasn't re-rendered yet by the time an auto-send effect fires (see send()'s doc comment).
  useEffect(() => {
    const savedLocation = getLocation();
    setLocation(savedLocation);

    // Home hands off the buyer's first message via sessionStorage (page.tsx's goToChat) so
    // arriving here immediately continues the conversation instead of an empty screen.
    const pending = sessionStorage.getItem("pendingChatMessage");
    if (pending) {
      sessionStorage.removeItem("pendingChatMessage");
      send(pending, savedLocation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pane = conversationRef.current;
    if (pane && followConversationRef.current)
      pane.scrollTop = pane.scrollHeight;
  }, [messages, pendingKitchens, pendingMenu, failure]);

  useEffect(() => {
    const pane = conversationRef.current;
    const card = pendingKitchens
      ? resultsRef.current
      : pendingMenu
        ? menuRef.current
        : null;
    if (pane && card && followConversationRef.current) {
      // Show the beginning of new results, not the bottom of a long kitchen list.
      pane.scrollTop +=
        card.getBoundingClientRect().top -
        pane.getBoundingClientRect().top -
        80;
    }
  }, [pendingKitchens, pendingMenu]);

  useEffect(() => () => clearInterval(recordTimerRef.current), []);

  // When the assistant finishes: send anything the user typed meanwhile, keep focus in the box.
  useEffect(() => {
    if (streaming) return;
    inputRef.current?.focus();
    if (queued && !failure) {
      const text = queued;
      setQueued(null);
      send(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  // locationOverride lets the mount-time auto-send (home → chat handoff) pass a freshly
  // read location straight through — the `location` state var from the OTHER mount effect
  // is still null at that point (setState there hasn't re-rendered yet), so relying on the
  // closure alone silently dropped the hint on that very first message.
  async function send(
    text: string,
    locationOverride?: PickedLocation | null,
    history: Message[] = messages,
  ) {
    if (!text.trim() || streaming) return;
    const next: Message[] = [...history, { role: "user", content: text }];
    setFailure(null);
    followConversationRef.current = true;
    setMessages(next);
    setInput("");
    setStreaming(true);
    setPendingMenu(null);
    setPendingKitchens(null);
    setPicked({});

    let assistantText = "";
    const addChunk = (delta: string) => {
      assistantText += delta;
      setMessages([...next, { role: "assistant", content: assistantText }]);
    };

    try {
      // The picked location (Home page or this page's own picker) rides along as a hidden
      // suffix on the outgoing user turn only — the visible bubble stays just what was typed,
      // but the agent sees it every turn and never needs to ask (SystemPrompt rule 6).
      const effectiveLocation =
        locationOverride !== undefined ? locationOverride : location;
      const payloadMessages = effectiveLocation
        ? next.map((m, i) =>
            i === next.length - 1
              ? {
                  ...m,
                  content: `${m.content}\n\n[buyer's selected browse location: ${effectiveLocation.label} (lat ${effectiveLocation.lat}, lng ${effectiveLocation.lng})]`,
                }
              : m,
          )
        : next;

      // apiFetch refreshes the access token and retries once on 401 (15-min expiry).
      const res = await apiFetch(`/chat/stream`, {
        method: "POST",
        body: JSON.stringify({ messages: payloadMessages }),
      });

      if (res.status === 401 || res.status === 403) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        setFailure({
          text,
          history,
          message:
            "Nana couldn’t reply just now. Please try your message again.",
        });
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
          // NestJS wrote "data: {...}", Spring MVC writes "data:{...}" — accept both.
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5).trim());
          if (payload.type === "text") addChunk(payload.delta);
          else if (payload.type === "done") break;
        }
      }

      // Structured card blocks embedded in assistant text (menu picker / order summary).
      const structured = extractStructuredBlock(assistantText);
      if (structured) {
        const parsed = structured.parsed;
        let handled = false;
        if (parsed.type === "menu" && Array.isArray(parsed.items)) {
          setPendingMenu(parsed as unknown as MenuCard);
          setPendingKitchens(null);
          handled = true;
        } else if (parsed.type === "kitchens" && Array.isArray(parsed.items)) {
          setPendingKitchens(parsed as unknown as KitchenListCard);
          handled = true;
        } else if (parsed.confirmed === false && parsed.summary) {
          setPendingSummary(parsed as unknown as OrderSummary);
          handled = true;
        }
        // The card renders the data; don't also show the raw JSON in the bubble.
        if (handled)
          assistantText = assistantText.replace(structured.raw, "").trim();
      }

      setMessages([...next, { role: "assistant", content: assistantText }]);
    } catch {
      setFailure({
        text,
        history,
        message: "The connection was interrupted. Try again when you’re ready.",
      });
    } finally {
      setStreaming(false);
    }
  }

  function changeDeliveryAddress(loc: PickedLocation) {
    setPendingSummary((prev) =>
      prev
        ? {
            ...prev,
            summary: { ...prev.summary, deliveryAddress: loc.label },
            draft: { ...prev.draft, deliveryAddress: loc.label },
          }
        : prev,
    );
    setDeliveryPickerOpen(false);
  }

  async function confirmOrder() {
    // The card stays on screen for the whole round trip (pendingSummary is only cleared
    // after the await), so without this guard a second click posts a second order - another
    // charge and another stock decrement. The checkout page already gates itself this way.
    if (!pendingSummary || confirming) return;
    setConfirming(true);
    try {
      await postConfirmedOrder();
    } finally {
      setConfirming(false);
    }
  }

  async function postConfirmedOrder() {
    if (!pendingSummary) return;
    const draft = { ...pendingSummary.draft, confirm: true };
    const res = await apiFetch(`/orders`, {
      method: "POST",
      body: JSON.stringify(draft),
    });
    const body = await res.json();
    setPendingSummary(null);
    if (!res.ok) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${body.message}` },
      ]);
      return;
    }
    if (body.requiresPayment) {
      // Story 3.4: the order exists but is still 'pending' — it holds the portions and nothing
      // has been charged. There is no `order` object in this reply, so announcing "confirmed"
      // here also produced a /orders/undefined link. Hand the buyer the PaymentElement instead;
      // the payment_intent.succeeded webhook is what flips the order to confirmed.
      setPendingPayment({
        orderId: body.orderId,
        clientSecret: body.payment.clientSecret,
        publishableKey: body.payment.publishableKey,
        totalCents: pendingSummary.summary.totalCents,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Your portions are reserved. Enter your card below to complete the order — " +
            "nothing is charged until you pay.",
        },
      ]);
      return;
    }
    // POST /orders answers {confirmed: true, order: {...}} on success; the order card (below)
    // renders the id as a link and, once the kitchen marks it ready, the tracking link too.
    const order = body.order;
    setConfirmedOrder({
      id: order.id,
      readySlot: order.readySlot,
      trackingUrl: order.deliveryJob?.trackingUrl ?? null,
    });
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "Order confirmed! 🎉 Here are the details:",
      },
    ]);
  }

  function addPickedToOrder() {
    if (!pendingMenu) return;
    const selected = pendingMenu.items.filter(
      (it) => (picked[it.menuItemId] ?? 0) > 0,
    );
    if (selected.length === 0) return;
    const parts = selected.map((it) => `${picked[it.menuItemId]} x ${it.name}`);
    const menuItemIds = selected.map((it) => it.menuItemId).join("|");
    const text = `I'd like ${parts.join(", ")} from ${pendingMenu.kitchenName}. [menuItemIds: ${menuItemIds}]`;
    setPendingMenu(null);
    setPicked({});
    send(text);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    if (streaming) {
      // Queue it; the effect above fires it as soon as the assistant finishes.
      setQueued(input.trim());
      setInput("");
      return;
    }
    send(input);
  }

  /** Story 5.3 (FR13) — record ≤60 s, transcribe server-side, then feed the transcript
   * through the exact same send() path as typed text. Low confidence stages the text in
   * the input for review instead of auto-sending (Story 5.2 AC4). */
  async function startRecording() {
    setVoiceNotice(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceNotice("Microphone unavailable — check the browser permission.");
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recordTimerRef.current);
      setRecording(false);
      setRecordSeconds(0);
      transcribe(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setRecordSeconds(0);
    recordTimerRef.current = setInterval(() => {
      setRecordSeconds((s) => {
        if (s + 1 >= MAX_RECORDING_SECONDS) recorderRef.current?.stop();
        return s + 1;
      });
    }, 1000);
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    try {
      const data = new FormData();
      data.append("audio", blob, "voice.webm");
      const res = await apiFetch(`/chat/transcribe`, {
        method: "POST",
        body: data,
      });
      if (!res.ok) {
        setVoiceNotice(
          "Could not transcribe that — try again or type instead.",
        );
        return;
      }
      const body: { transcript: string; confidence: number } = await res.json();
      if (!body.transcript.trim()) {
        setVoiceNotice("I didn't catch anything — try again a little louder.");
        return;
      }
      if (body.confidence >= CONFIDENCE_THRESHOLD) {
        // Same queue rule as typed text: never lost if the assistant is mid-stream.
        if (streaming) setQueued(body.transcript);
        else send(body.transcript);
      } else {
        setInput(body.transcript);
        setVoiceNotice(
          "I'm not sure I heard that right — check the text below, then send.",
        );
      }
    } finally {
      setTranscribing(false);
    }
  }

  const lastMessage = messages[messages.length - 1];
  const showTyping =
    streaming &&
    (!lastMessage || lastMessage.role === "user" || !lastMessage.content);

  function newConversation() {
    setMessages([]);
    setPendingKitchens(null);
    setPendingMenu(null);
    setPendingSummary(null);
    setConfirmedOrder(null);
    setFailure(null);
    setPicked({});
    setQueued(null);
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <main className={styles.page}>
      <LocationPickerModal
        open={locationPickerOpen}
        onClose={() => setLocationPickerOpen(false)}
        onConfirm={confirmLocation}
      />

      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <span className={styles.assistantMark}>
            <Icon name="bowl" />
          </span>
          <div>
            <h1>Nana&rsquo;s table</h1>
            <p>Your guide to good home cooking</p>
          </div>
        </div>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            onClick={() => setLocationPickerOpen(true)}
            className={styles.location}
            title={location?.label ?? "Choose a location"}
            aria-label={`Change browse location${location ? `: ${location.label}` : ""}`}
          >
            <Icon name="pin" width="17" height="17" />
            <span>
              <small>Browsing near</small>
              <strong>
                {location ? location.label.split(",")[0] : "Choose location"}
              </strong>
            </span>
            <Icon name="chevron" width="16" height="16" />
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={newConversation}
              className={styles.newChat}
              disabled={
                streaming ||
                recording ||
                transcribing ||
                confirming ||
                !!pendingPayment
              }
              aria-label="Start a new conversation"
              title="New conversation"
            >
              <Icon name="plus" />
            </button>
          )}
        </div>
      </header>

      <div
        ref={conversationRef}
        className={styles.conversation}
        onScroll={(e) => {
          const pane = e.currentTarget;
          followConversationRef.current =
            pane.scrollHeight - pane.scrollTop - pane.clientHeight < 100;
        }}
      >
        {messages.length === 0 && (
          <section className={styles.welcome} aria-labelledby="welcome-heading">
            <div className={styles.welcomeIntro}>
              <p className={styles.eyebrow}>
                From a neighbor&rsquo;s kitchen, with love
              </p>
              <h2 id="welcome-heading">
                What sounds
                <br />
                <em>good today?</em>
              </h2>
              <p className={styles.welcomeCopy}>
                A familiar dish. A new favorite. Tell Nana what you&rsquo;re
                craving, and find the home cooks making it nearby.
              </p>
              <span className={styles.welcomeNote}>
                <Icon name="bowl" width="16" height="16" /> Find a kitchen. Pick
                your dishes. Make yourself at home.
              </span>
            </div>
            <div className={styles.suggestions}>
              <p>A little inspiration</p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  className={styles.suggestion}
                  onClick={() => send(s.text)}
                >
                  <span className={styles.suggestionIcon}>
                    <Icon name={s.icon} />
                  </span>
                  <span>
                    <strong>{s.title}</strong>
                    <small>{s.text}</small>
                  </span>
                  <Icon name="arrow" width="17" height="17" />
                </button>
              ))}
            </div>
          </section>
        )}

        <div
          role="log"
          aria-label="Conversation with Nana"
          aria-live="polite"
          aria-busy={streaming}
        >
          {messages.map((m, i) => {
            // Structured results become cards once complete; don't flash their JSON during streaming.
            const visibleContent =
              streaming && i === messages.length - 1 && m.role === "assistant"
                ? m.content.replace(/```json[\s\S]*?(?:```|$)/g, "").trim()
                : m.content;
            if (!visibleContent) return null;
            return (
              <div
                key={i}
                className={`${styles.message} ${m.role === "user" ? styles.userMessage : styles.assistantMessage}`}
              >
                {m.role === "assistant" && (
                  <span className={styles.messageAvatar} aria-hidden="true">
                    N
                  </span>
                )}
                <div className={styles.messageBody}>
                  <span className={styles.messageAuthor}>
                    {m.role === "user" ? "You" : "Nana"}
                  </span>
                  <div className={styles.messageContent}>
                    {renderRich(visibleContent)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {streaming && (
          <div className={styles.typing} role="status">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span>
              {showTyping ? "Nana is thinking…" : "Finding the good stuff…"}
            </span>
          </div>
        )}

        {failure && (
          <div className={styles.error} role="alert">
            <p>{failure.message}</p>
            <button
              type="button"
              onClick={() => send(failure.text, undefined, failure.history)}
              disabled={streaming}
            >
              Try again <Icon name="arrow" width="16" height="16" />
            </button>
          </div>
        )}

        {/* Kitchen list card: a photo grid instead of a numbered text list */}
        {pendingKitchens && (
          <section
            ref={resultsRef}
            className={styles.results}
            aria-labelledby="kitchens-heading"
          >
            <div className={styles.resultsHeading}>
              <div>
                <p className={styles.eyebrow}>Meet the home cooks</p>
                <h2 id="kitchens-heading">A kitchen for every craving</h2>
              </div>
              <span>
                {pendingKitchens.items.length} kitchen
                {pendingKitchens.items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className={styles.kitchenList}>
              {pendingKitchens.items.map((k) => {
                const soldOut = k.portionsLeftToday === 0;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => send(`Show me the menu for ${k.name}`)}
                    disabled={soldOut || streaming}
                    className={styles.kitchen}
                    aria-label={`View menu for ${k.name}${soldOut ? ", sold out today" : ""}`}
                  >
                    {k.photo ? (
                      <img
                        src={k.photo}
                        alt={k.name}
                        className={styles.kitchenPhoto}
                        loading="lazy"
                      />
                    ) : (
                      <span className={styles.kitchenPhoto}>
                        <Icon name="bowl" width="28" height="28" />
                      </span>
                    )}
                    <span className={styles.kitchenInfo}>
                      <span className={styles.kitchenMeta}>
                        <span>
                          {k.cuisineTag[0]?.toUpperCase() +
                            k.cuisineTag.slice(1)}{" "}
                          home cooking
                        </span>
                        {k.ratingAvg != null && (
                          <span className={styles.rating}>
                            &#9733; {k.ratingAvg.toFixed(1)}
                            {k.ratingCount != null && ` (${k.ratingCount})`}
                          </span>
                        )}
                      </span>
                      <strong className={styles.kitchenName}>{k.name}</strong>
                      {k.description && (
                        <span className={styles.kitchenDescription}>
                          {k.description}
                        </span>
                      )}
                      <span className={styles.availability}>
                        {soldOut
                          ? "Sold out today"
                          : `${k.portionsLeftToday} portions available`}
                      </span>
                    </span>
                    <span className={styles.viewMenu}>
                      View menu <Icon name="arrow" width="18" height="18" />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Order confirmed card: links straight to the order detail page instead of a raw id */}
        {confirmedOrder && (
          <div className="fade-up shell" style={{ margin: "14px 0" }}>
            <div
              className="shell-core"
              style={{ padding: 20, textAlign: "center" }}
            >
              <div style={{ fontSize: 32 }}>🎉</div>
              <h2
                style={{ margin: "6px 0 4px", fontSize: 17, fontWeight: 700 }}
              >
                Order confirmed!
              </h2>
              {confirmedOrder.readySlot && (
                <p
                  style={{
                    margin: "0 0 14px",
                    color: "var(--text-2)",
                    fontSize: 14,
                  }}
                >
                  Ready {fmtSlot(confirmedOrder.readySlot)}
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                <Link
                  href={`/orders/${confirmedOrder.id}`}
                  className="btn btn-primary"
                  style={{ padding: "10px 22px" }}
                >
                  View order
                </Link>
                {confirmedOrder.trackingUrl && (
                  <a
                    href={confirmedOrder.trackingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost"
                    style={{
                      padding: "9px 18px",
                      borderRadius: 999,
                      display: "inline-flex",
                      alignItems: "center",
                      textDecoration: "none",
                    }}
                  >
                    Track delivery
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmedOrder(null)}
                  className="btn-ghost"
                  style={{ padding: "9px 18px" }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Card payment for a placed-but-unpaid order (real Stripe provider only). Paying
            redirects to /orders/{id}; the order stays pending until the webhook lands. */}
        {pendingPayment && (
          <div className="fade-up" style={{ margin: "14px 0" }}>
            <PaymentStep
              payment={pendingPayment}
              totalCents={pendingPayment.totalCents}
            />
          </div>
        )}

        {/* Dish picker card: photos, ingredients, calories, quantity steppers */}
        {pendingMenu && (
          <div
            ref={menuRef}
            className="fade-up shell"
            style={{ margin: "14px 0" }}
          >
            <div className="shell-core" style={{ padding: "18px 20px" }}>
              <h2 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 700 }}>
                {pendingMenu.kitchenName}
              </h2>
              <p
                style={{
                  margin: "0 0 6px",
                  color: "var(--text-2)",
                  fontSize: 13.5,
                }}
              >
                Pick your dishes, then add them to the order.
              </p>
              {pendingMenu.items.map((it) => {
                const q = picked[it.menuItemId] ?? 0;
                const max = it.portionsLeft ?? 99;
                return (
                  <div key={it.menuItemId} className="dish-row">
                    {it.photo ? (
                      <img
                        src={it.photo}
                        alt={it.name}
                        className="dish-photo"
                      />
                    ) : (
                      <div className="dish-photo" />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {it.name}
                      </div>
                      {it.description && (
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--text-2)",
                            marginTop: 2,
                            lineHeight: 1.45,
                          }}
                        >
                          {it.description}
                        </div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginTop: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 14 }}>
                          {cents(it.priceCents)}
                        </span>
                        {typeof it.calories === "number" && (
                          <span className="kcal">~{it.calories} kcal</span>
                        )}
                        {typeof it.portionsLeft === "number" && (
                          <span
                            style={{ fontSize: 12.5, color: "var(--text-3)" }}
                          >
                            {it.portionsLeft} left
                          </span>
                        )}
                        {(it.dietaryTags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="kcal"
                            style={{ textTransform: "capitalize" }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div
                      className="stepper"
                      aria-label={`Quantity for ${it.name}`}
                    >
                      <button
                        type="button"
                        disabled={q === 0}
                        onClick={() =>
                          setPicked({
                            ...picked,
                            [it.menuItemId]: Math.max(0, q - 1),
                          })
                        }
                        aria-label={`Remove one ${it.name}`}
                      >
                        &minus;
                      </button>
                      <span className="qty">{q}</span>
                      <button
                        type="button"
                        disabled={q >= max}
                        onClick={() =>
                          setPicked({ ...picked, [it.menuItemId]: q + 1 })
                        }
                        aria-label={`Add one ${it.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
              {(() => {
                const count = Object.values(picked).reduce((a, b) => a + b, 0);
                const total = pendingMenu.items.reduce(
                  (sum, it) =>
                    sum + (picked[it.menuItemId] ?? 0) * it.priceCents,
                  0,
                );
                return (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 14,
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 14.5, color: "var(--text-2)" }}>
                      {count > 0 ? (
                        <>
                          {count} item{count === 1 ? "" : "s"},{" "}
                          <strong style={{ color: "var(--text)" }}>
                            {cents(total)}
                          </strong>
                        </>
                      ) : (
                        "Nothing picked yet"
                      )}
                    </span>
                    <button
                      onClick={addPickedToOrder}
                      disabled={count === 0 || streaming}
                      className="btn btn-primary"
                      style={{ padding: "10px 22px" }}
                    >
                      Add to order
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Order confirmation card (FR15) */}
        {pendingSummary && (
          <div
            role="dialog"
            aria-labelledby="summary-heading"
            className="fade-up shell"
            style={{ margin: "14px 0" }}
          >
            <div className="shell-core" style={{ padding: 20 }}>
              <h2
                id="summary-heading"
                style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}
              >
                Order summary
              </h2>
              {pendingSummary.summary.kitchenName && (
                <p
                  style={{
                    margin: "0 0 12px",
                    color: "var(--text-2)",
                    fontSize: 14,
                  }}
                >
                  {pendingSummary.summary.kitchenName}
                </p>
              )}
              <div
                style={{
                  borderTop: "1px solid var(--line)",
                  padding: "12px 0",
                  margin: "8px 0",
                }}
              >
                {pendingSummary.summary.items.map((it, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 15,
                      padding: "4px 0",
                    }}
                  >
                    <span>
                      {it.qty} &times; {it.name}
                    </span>
                    <span style={{ fontWeight: 600 }}>
                      {cents(it.priceCents * it.qty)}
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 15,
                  fontWeight: 700,
                  padding: "4px 0 2px",
                }}
              >
                <span>Total</span>
                <span>{cents(pendingSummary.summary.totalCents)}</span>
              </div>
              <p
                style={{
                  margin: "10px 0 2px",
                  fontSize: 14,
                  color: "var(--text-2)",
                }}
              >
                Ready {fmtSlot(pendingSummary.summary.readySlot)}
                {", "}
                {pendingSummary.summary.fulfillment}
              </p>
              {pendingSummary.summary.deliveryAddress && (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 10,
                      marginTop: 8,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 14.5 }}>
                      <strong>Deliver to:</strong>{" "}
                      {pendingSummary.summary.deliveryAddress}
                    </p>
                    <button
                      type="button"
                      onClick={() => setDeliveryPickerOpen(true)}
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        padding: "7px 16px",
                        flexShrink: 0,
                        border: "1.5px solid var(--accent)",
                        background: "var(--accent-soft)",
                        color: "var(--accent-strong)",
                        borderRadius: 999,
                        cursor: "pointer",
                      }}
                    >
                      📍 Change address
                    </button>
                  </div>
                  <AddressMap
                    address={pendingSummary.summary.deliveryAddress}
                  />
                  <LocationPickerModal
                    open={deliveryPickerOpen}
                    onClose={() => setDeliveryPickerOpen(false)}
                    onConfirm={changeDeliveryAddress}
                    restrictToUS={false}
                  />
                </>
              )}
              <p style={{ margin: "16px 0 0", fontSize: 15, fontWeight: 600 }}>
                Do you confirm this order?
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  onClick={confirmOrder}
                  disabled={confirming}
                  aria-busy={confirming}
                  className="btn btn-primary"
                  style={{ padding: "10px 22px" }}
                >
                  {confirming ? "Placing order…" : "Confirm order"}
                </button>
                <button
                  onClick={() => setPendingSummary(null)}
                  disabled={confirming}
                  className="btn btn-ghost"
                  style={{ padding: "9px 18px" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={styles.composerArea}>
        {queued && (
          <p aria-live="polite" className={styles.queued}>
            {failure ? "Queued for after your retry" : "Next up"}: &ldquo;
            {queued}&rdquo;
          </p>
        )}
        {voiceNotice && (
          <p
            role="status"
            style={{
              fontSize: 13,
              color: "#92400e",
              background: "#fef3c7",
              borderRadius: 10,
              padding: "6px 12px",
              margin: "0 0 6px",
            }}
          >
            {voiceNotice}
          </p>
        )}
        <form onSubmit={onSubmit} className={styles.composer}>
          <input
            ref={inputRef}
            aria-label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            placeholder={
              recording
                ? "Listening…"
                : transcribing
                  ? "Transcribing…"
                  : "What are you craving? Ask Nana…"
            }
          />
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={transcribing}
            aria-label={recording ? "Stop recording" : "Record a voice message"}
            aria-pressed={recording}
            className={styles.voiceButton}
            title={recording ? "Stop recording" : "Use your voice"}
          >
            <Icon name={recording ? "stop" : "mic"} />
            {recording && (
              <span>0:{String(recordSeconds).padStart(2, "0")}</span>
            )}
          </button>
          <button
            type="submit"
            disabled={!input.trim() || recording || transcribing}
            aria-label="Send"
            className={styles.sendButton}
          >
            <Icon name="send" />
          </button>
        </form>
        <p className={styles.composerHint}>
          <span>A little conversation. A lovely meal.</span>
          <span>Enter to send</span>
        </p>
      </div>
    </main>
  );
}
