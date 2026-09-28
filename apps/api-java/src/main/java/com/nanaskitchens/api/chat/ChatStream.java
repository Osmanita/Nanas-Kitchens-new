package com.nanaskitchens.api.chat;

import com.google.genai.errors.ApiException;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import tools.jackson.databind.json.JsonMapper;

/** Bounds the entire tool conversation, including blocking SDK connection/retry work. */
final class ChatStream {
    private static final Logger log = LoggerFactory.getLogger(ChatStream.class);
    private final JsonMapper json;
    private final Duration deadline;

    ChatStream(JsonMapper json, Duration deadline) {
        this.json = json;
        this.deadline = deadline;
    }

    Flux<String> events(Supplier<Flux<String>> response, String audience) {
        return Flux.defer(() -> {
            long started = System.nanoTime();
            // Gemini's synchronous streaming iterator blocks during subscription and reads.
            // Isolate it so the deadline and MVC's response writer can still run.
            Flux<String> content = Flux.defer(response)
                    .subscribeOn(Schedulers.boundedElastic())
                    .filter(delta -> !delta.isEmpty())
                    .switchIfEmpty(Flux.error(new IllegalStateException("EMPTY_RESPONSE")))
                    .takeUntilOther(Mono.delay(deadline)
                            .flatMap(ignored -> Mono.error(new TimeoutException())))
                    .map(delta -> event("text", delta))
                    .onErrorResume(error -> {
                        String code = errorCode(error);
                        // Provider exceptions can contain keys/prompts. Log only safe metadata.
                        log.warn("Chat failed: audience={}, code={}, elapsedMs={}", audience, code,
                                (System.nanoTime() - started) / 1_000_000);
                        return Mono.just(json.writeValueAsString(Map.of(
                                "type", "error", "code", code, "delta", message(code))));
                    });
            // Flush headers immediately; neither proxy nor browser waits for the SDK to connect.
            return Flux.concat(Mono.just(event("status", "started")), content,
                    Mono.just(event("done", null)));
        });
    }

    private String event(String type, String delta) {
        return json.writeValueAsString(delta == null ? Map.of("type", type) : Map.of("type", type, "delta", delta));
    }

    static String errorCode(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof TimeoutException || cause instanceof java.net.SocketTimeoutException) return "CHAT_TIMEOUT";
            if (cause instanceof ApiException api) {
                if (api.code() == 429) return "CHAT_RATE_LIMITED";
                if (api.code() >= 500) return "CHAT_BUSY";
            }
        }
        return "CHAT_UNAVAILABLE";
    }

    private static String message(String code) {
        return switch (code) {
            case "CHAT_TIMEOUT" -> "Nana took too long to respond. Please try again or use the menus directly.";
            case "CHAT_RATE_LIMITED" -> "Nana has reached the AI service's request limit. Try again shortly or use the menus directly.";
            case "CHAT_BUSY" -> "Nana's AI service is busy right now. Please try again or use the menus directly.";
            default -> "Nana couldn’t reply just now. Please try again or use the menus directly.";
        };
    }
}
