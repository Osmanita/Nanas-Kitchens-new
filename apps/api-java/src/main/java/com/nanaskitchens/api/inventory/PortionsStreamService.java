package com.nanaskitchens.api.inventory;

import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionalEventListener;
import reactor.core.Disposable;
import reactor.core.publisher.ConnectableFlux;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;
import reactor.util.retry.Retry;
import tools.jackson.databind.json.JsonMapper;

/**
 * Story 2.3 AC3 — live portion counts over SSE (/kitchens/{id}/portions/stream).
 *
 * <p>Events are emitted AFTER_COMMIT so subscribers never see counts from a transaction that
 * later rolls back, and they travel over Redis pub/sub on {@code portions:{kitchenId}}. That
 * channel is the whole point: the fan-out used to be a plain in-process map, so a sale served
 * by one task never reached a browser connected to another — the live counter did not go
 * stale visibly, it silently kept showing a number that was already wrong, which is worse.
 *
 * <p>The local sink map is still here, but it is now a per-instance fan-out layer rather than
 * the source of truth: one pattern subscription receives every kitchen's messages and hands
 * them to whichever subscribers this instance happens to be holding. Publishers do not shortcut
 * to their own sinks — every instance, including the one that made the sale, learns about it
 * the same way, so there is no path that works on a single task and breaks on two.
 */
@Service
public class PortionsStreamService {

    private static final Logger log = LoggerFactory.getLogger(PortionsStreamService.class);

    private static final Duration HEARTBEAT = Duration.ofSeconds(15);
    /** Events buffered while the initial snapshot query runs; a handful is plenty. */
    private static final int REPLAY_BUFFER = 32;

    static final String CHANNEL_PREFIX = "portions:";
    private static final String CHANNEL_PATTERN = CHANNEL_PREFIX + "*";

    private final JdbcClient db;
    private final JsonMapper jsonMapper;
    private final ReactiveStringRedisTemplate redis;
    private final Map<String, Sinks.Many<String>> sinksByKitchen = new ConcurrentHashMap<>();
    private final CompletableFuture<Void> subscribed = new CompletableFuture<>();
    private volatile Disposable subscription;

    public PortionsStreamService(JdbcClient db, JsonMapper jsonMapper, ReactiveStringRedisTemplate redis) {
        this.db = db;
        this.jsonMapper = jsonMapper;
        this.redis = redis;
        this.subscription = subscribeToRedis();
    }

    /**
     * One pattern subscription for the whole instance. Retries forever with a backoff rather
     * than dying: a dropped Redis connection must not permanently deafen this task, because
     * nothing else would report it — the SSE streams would stay open and simply stop updating.
     */
    private Disposable subscribeToRedis() {
        // listenToPatternLater, not listenToPattern: it reports when the PSUBSCRIBE has actually
        // been registered. Anything published before that point is simply not delivered — Redis
        // pub/sub has no backlog — so "the stream exists" and "the stream will receive" are two
        // different moments and only the second one is safe to rely on.
        return redis.listenToPatternLater(CHANNEL_PATTERN)
                .doOnNext(messages -> {
                    log.info("Subscribed to Redis pattern {}", CHANNEL_PATTERN);
                    subscribed.complete(null);
                })
                .flatMapMany(messages -> messages)
                .doOnError(e -> log.error("Portions pub/sub dropped, retrying: {}", e.toString()))
                .retryWhen(Retry.backoff(Long.MAX_VALUE, Duration.ofSeconds(1))
                        .maxBackoff(Duration.ofSeconds(30)))
                .subscribe(message -> {
                    String kitchenId = message.getChannel().substring(CHANNEL_PREFIX.length());
                    Sinks.Many<String> sink = sinksByKitchen.get(kitchenId);
                    if (sink != null) {
                        sink.tryEmitNext(message.getMessage());
                    }
                });
    }

    /**
     * Completes once this instance's pattern subscription is live. Exposed so callers that must
     * not miss the first message can wait for it rather than sleeping and hoping.
     */
    public CompletableFuture<Void> subscriptionEstablished() {
        return subscribed;
    }

    @PreDestroy
    void unsubscribe() {
        Disposable current = subscription;
        if (current != null) {
            current.dispose();
        }
    }

    /** Initial snapshot of today's published menu, then live updates; heartbeat keeps proxies open. */
    public Flux<ServerSentEvent<String>> stream(String kitchenId) {
        Sinks.Many<String> sink = sinksByKitchen.computeIfAbsent(
                kitchenId, k -> Sinks.many().multicast().directBestEffort());
        // concatWith() only subscribes to the sink once the snapshot has been emitted, and the
        // sink is directBestEffort — so any update landing between "snapshot query ran" and
        // "subscriber attached" had no subscriber and was dropped, leaving the client showing a
        // count that is silently stale until the next change. Connect to the live stream FIRST
        // and let replay() hold whatever arrives while the snapshot query is still running.
        // A replayed event that the snapshot already reflects just repeats the same counts.
        Flux<ServerSentEvent<String>> data = Flux.defer(() -> {
            ConnectableFlux<String> live = sink.asFlux().replay(REPLAY_BUFFER);
            Disposable connection = live.connect();
            String snapshot;
            try {
                snapshot = snapshotJson(kitchenId);
            } catch (RuntimeException e) {
                connection.dispose();
                throw e;
            }
            return Flux.concat(Flux.just(snapshot), live)
                    .doFinally(signal -> connection.dispose());
        }).map(json -> ServerSentEvent.builder(json).event("portions").build());
        Flux<ServerSentEvent<String>> heartbeat = Flux.interval(HEARTBEAT)
                .map(i -> ServerSentEvent.<String>builder().comment("heartbeat").build());
        return Flux.merge(data, heartbeat);
    }

    @TransactionalEventListener
    public void onPortionsChanged(PortionsChanged event) {
        if (event.menuItemIds().isEmpty()) {
            return;
        }
        record Row(String kitchenId, String menuItemId, int remaining, int total) {
        }
        List<Row> rows = db.sql("""
                SELECT md."kitchenId", mi.id, mi."portionsRemaining", mi."portionsTotal"
                FROM "MenuItem" mi JOIN "MenuDay" md ON md.id = mi."menuDayId"
                WHERE mi.id IN (:ids)
                """)
                .param("ids", event.menuItemIds())
                .query((rs, n) -> new Row(rs.getString("kitchenId"), rs.getString("id"),
                        rs.getInt("portionsRemaining"), rs.getInt("portionsTotal")))
                .list();
        Map<String, List<Map<String, Object>>> byKitchen = new LinkedHashMap<>();
        for (Row row : rows) {
            byKitchen.computeIfAbsent(row.kitchenId(), k -> new ArrayList<>())
                    .add(itemPayload(row.menuItemId(), row.remaining(), row.total()));
        }
        byKitchen.forEach((kitchenId, items) -> publish(kitchenId,
                jsonMapper.writeValueAsString(Map.of("type", "portions", "items", items))));
    }

    /**
     * Blocks on the publish deliberately. This runs after commit on the ordering thread, and a
     * fire-and-forget subscribe() here would swallow a Redis outage entirely: the sale would
     * succeed, every connected browser would keep its old count, and nothing anywhere would say
     * so. Failing loudly costs an already-committed order nothing and gets logged.
     */
    private void publish(String kitchenId, String json) {
        try {
            redis.convertAndSend(CHANNEL_PREFIX + kitchenId, json)
                    .block(Duration.ofSeconds(2));
        } catch (RuntimeException e) {
            log.error("Could not publish portions for kitchen {} — connected clients will hold a "
                    + "stale count until their next reconnect: {}", kitchenId, e.toString());
        }
    }

    private String snapshotJson(String kitchenId) {
        List<Map<String, Object>> items = db.sql("""
                SELECT mi.id, mi."portionsRemaining", mi."portionsTotal"
                FROM "MenuItem" mi JOIN "MenuDay" md ON md.id = mi."menuDayId"
                WHERE md."kitchenId" = :kitchenId AND md.status = 'published'
                  AND md.date = (now() AT TIME ZONE 'UTC')::date
                """)
                .param("kitchenId", kitchenId)
                .query((rs, n) -> itemPayload(
                        rs.getString("id"), rs.getInt("portionsRemaining"), rs.getInt("portionsTotal")))
                .list();
        return jsonMapper.writeValueAsString(Map.of("type", "portions", "items", items));
    }

    private static Map<String, Object> itemPayload(String id, int remaining, int total) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("id", id);
        payload.put("portionsRemaining", remaining);
        payload.put("portionsTotal", total);
        return payload;
    }
}
