export const CHAT_TIMEOUT_MS = 40_000;

export class ChatStreamError extends Error {}

/** Consume the app's SSE protocol, ending on done even when a proxy keeps the socket open. */
export async function readChatStream(response: Response, onText: (delta: string) => void) {
  if (!response.body) throw new ChatStreamError("Nana returned no reply. Please try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let hasText = false;
  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return false;
    const event = JSON.parse(line.slice(5).trim());
    if (event.type === "error") {
      throw new ChatStreamError(typeof event.delta === "string" ? event.delta : "Nana couldn’t reply. Please try again.");
    }
    if (event.type === "text" && typeof event.delta === "string") {
      hasText ||= event.delta.trim().length > 0;
      onText(event.delta);
    }
    if (event.type === "done") {
      if (!hasText) throw new ChatStreamError("Nana returned no reply. Please try again.");
      return true;
    }
    return false;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (handleLine(line)) return;
      if (done) {
        if (buffer && handleLine(buffer)) return;
        // Partial JSON/menu replies must not appear to be successful completions.
        throw new ChatStreamError("The connection was interrupted. Please try again.");
      }
    }
  } finally {
    // Do not wait on a remote cancellation acknowledgement to unlock the composer.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function chatFailureMessage(error: unknown) {
  if (error instanceof ChatStreamError) return error.message;
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
    return "Nana took too long to respond. Please try again or browse the kitchens directly.";
  }
  return "The connection was interrupted. Try again when you’re ready.";
}

/** Only simple discovery requests qualify; dietary, order and follow-up questions still use AI. */
export function nearbyKitchenQuery(text: string): { cuisine?: string } | null {
  const query = text.trim().toLocaleLowerCase("tr-TR").replace(/[?!.]+$/g, "").trim();
  if (["find turkish food near me", "türk yemekleri var mı", "turk yemekleri var mi",
    "yakınımda türk yemekleri", "yakinimda turk yemekleri", "türk mutfağı", "turk mutfagi"].includes(query)) {
    return { cuisine: "turkish" };
  }
  if (["what's cooking near me today", "yakınımda ne var", "yakinimda ne var",
    "bugün ne var", "bugun ne var", "mutfakları göster", "mutfaklari goster"].includes(query)) return {};
  return null;
}
