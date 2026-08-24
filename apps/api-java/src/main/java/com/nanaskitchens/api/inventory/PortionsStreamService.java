package com.nanaskitchens.api.inventory;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionalEventListener;
import reactor.core.Disposable;
import reactor.core.publisher.ConnectableFlux;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;
import tools.jackson.databind.json.JsonMapper;

/**
 * Story 2.3 AC3 — live portion counts over SSE (/kitchens/{id}/portions/stream).
 * In-process fan-out keyed by kitchenId: events are emitted AFTER_COMMIT so subscribers
 * never see counts from a transaction that later rolls back. Single-instance by design;
 * a multi-instance deployment would swap the sink map for Redis pub/sub (portions:{kitchenId})
 * as sketched in architecture.md.
 */
@Service
public class PortionsStreamService {

    private static final Duration HEARTBEAT = Duration.ofSeconds(15);
    /** Events buffered while the initial snapshot query runs; a handful is plenty. */
    private static final int REPLAY_BUFFER = 32;

    private final JdbcClient db;
    private final JsonMapper jsonMapper;
    private final Map<String, Sinks.Many<String>> sinksByKitchen = new ConcurrentHashMap<>();

    public PortionsStreamService(JdbcClient db, JsonMapper jsonMapper) {
        this.db = db;
        this.jsonMapper = jsonMapper;
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
        byKitchen.forEach((kitchenId, items) -> {
            Sinks.Many<String> sink = sinksByKitchen.get(kitchenId);
            if (sink != null) {
                sink.tryEmitNext(jsonMapper.writeValueAsString(Map.of("type", "portions", "items", items)));
            }
        });
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
