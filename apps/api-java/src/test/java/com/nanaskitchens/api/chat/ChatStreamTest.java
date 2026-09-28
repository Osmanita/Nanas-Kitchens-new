package com.nanaskitchens.api.chat;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.genai.errors.ApiException;
import com.nanaskitchens.api.chat.dto.ChatMessage;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;
import tools.jackson.databind.json.JsonMapper;

class ChatStreamTest {
    private final JsonMapper json = JsonMapper.builder().build();

    @Test
    void flushesStatusAndTimesOutEvenWhenProviderSubscriptionBlocks() {
        CountDownLatch release = new CountDownLatch(1);
        ChatStream stream = new ChatStream(json, Duration.ofMillis(150));
        try {
            StepVerifier.create(stream.events(() -> {
                        try { release.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                        return Flux.never();
                    }, "buyer"))
                    .expectNextMatches(event -> event.contains("started"))
                    .expectNextMatches(event -> event.contains("CHAT_TIMEOUT"))
                    .expectNextMatches(event -> event.contains("done"))
                    .expectComplete().verify(Duration.ofSeconds(3));
        } finally {
            release.countDown();
        }
    }

    @Test
    void totalDeadlineCannotBeExtendedByAnEndlessTrickleOfTokens() {
        StepVerifier.withVirtualTime(() -> new ChatStream(json, Duration.ofSeconds(35))
                        .events(() -> Flux.interval(Duration.ofSeconds(10)).map(i -> "hello"), "seller"))
                .expectNextMatches(event -> event.contains("started"))
                .thenAwait(Duration.ofSeconds(30))
                .expectNextMatches(event -> event.contains("hello"))
                .expectNextMatches(event -> event.contains("hello"))
                .expectNextMatches(event -> event.contains("hello"))
                .thenAwait(Duration.ofSeconds(5))
                .expectNextMatches(event -> event.contains("CHAT_TIMEOUT"))
                .expectNextMatches(event -> event.contains("done"))
                .expectComplete().verify(Duration.ofSeconds(3));
    }

    @Test
    void exposesSafeErrorCodeAndNeverReplaysToolsAfterPartialOutput() {
        AtomicInteger runs = new AtomicInteger();
        ChatStream stream = new ChatStream(json, Duration.ofSeconds(2));
        List<String> events = stream.events(() -> {
                    runs.incrementAndGet();
                    return Flux.concat(Flux.just("Saved"), Flux.error(new RuntimeException("secret prompt",
                            new ApiException(503, "UNAVAILABLE", "private-api-key"))));
                }, "seller").collectList().block(Duration.ofSeconds(3));
        assertThat(runs.get()).isEqualTo(1);
        assertThat(events).anyMatch(event -> event.contains("Saved"));
        assertThat(events).anyMatch(event -> event.contains("CHAT_BUSY"));
        assertThat(String.join("", events)).doesNotContain("secret prompt", "private-api-key");
    }

    @Test
    void emptyProviderReplyIsAnErrorInsteadOfASilentSuccess() {
        List<String> events = new ChatStream(json, Duration.ofSeconds(2))
                .events(() -> Flux.just(""), "buyer").collectList().block(Duration.ofSeconds(3));
        assertThat(events).hasSize(3);
        assertThat(events.get(1)).contains("CHAT_UNAVAILABLE");
        assertThat(ChatStream.errorCode(new ApiException(429, "RESOURCE_EXHAUSTED", "quota")))
                .isEqualTo("CHAT_RATE_LIMITED");
    }

    @Test
    void historyRetainsWholeRecentCardDataAndLatestQuestionWithinBudget() {
        List<ChatMessage> history = new ArrayList<>();
        for (int i = 0; i < 30; i++) history.add(new ChatMessage(i % 2 == 0 ? "user" : "assistant", "old " + i));
        history.add(new ChatMessage("user", "menu"));
        ChatMessage card = new ChatMessage("assistant", "[App card data: {\"menuItemId\":\"m1\"}]");
        history.add(card);
        ChatMessage latest = new ChatMessage("user", "Which dish is vegetarian?");
        history.add(latest);
        List<ChatMessage> recent = AgentService.recentHistory(history);
        assertThat(recent.size()).isLessThanOrEqualTo(20);
        assertThat(recent.getFirst().role()).isEqualTo("user");
        assertThat(recent.subList(recent.size() - 2, recent.size())).containsExactly(card, latest);
        assertThat(AgentService.recentHistory(List.of(
                new ChatMessage("user", "x".repeat(60_000)), card, latest))).containsExactly(latest);
    }
}
