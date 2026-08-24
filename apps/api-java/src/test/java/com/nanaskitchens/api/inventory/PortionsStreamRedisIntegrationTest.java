package com.nanaskitchens.api.inventory;

import static org.assertj.core.api.Assertions.assertThat;

import com.nanaskitchens.api.support.IntegrationTest;
import com.nanaskitchens.api.support.TestData;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.jdbc.core.simple.JdbcClient;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;
import tools.jackson.databind.json.JsonMapper;

/**
 * The point of moving the portions fan-out onto Redis: a sale served by one task has to reach a
 * browser holding an SSE stream on a DIFFERENT task. The old in-process sink map could not do
 * that, and the failure was invisible — the stream stayed open and kept showing a count that
 * was already wrong, so nothing in a single-instance test could ever have caught it.
 *
 * <p>So this test runs two instances against one Redis: the Spring-managed bean stands in for
 * task A, a second one built by hand for task B. Everything else — the database, the channel,
 * the message — is real.
 */
class PortionsStreamRedisIntegrationTest extends IntegrationTest {

    @Autowired
    private PortionsStreamService taskA;

    @Autowired
    private ReactiveStringRedisTemplate redis;

    @Autowired
    private JdbcClient db;

    @Autowired
    private JsonMapper jsonMapper;

    private PortionsStreamService taskB;

    @AfterEach
    void stopTaskB() {
        if (taskB != null) {
            taskB.unsubscribe();
            taskB = null;
        }
    }

    private record Fixture(String kitchenId, String menuItemId) {
    }

    private Fixture seedPublishedMenu(int portions) {
        String sellerId = TestData.insertUser(db, "seller", "seller-" + UUID.randomUUID() + "@test.dev");
        String kitchenId = TestData.insertKitchen(db, sellerId, 40.1578, -83.0752);
        String dishId = TestData.insertDish(db, kitchenId, "Manti", 1200);
        String menuDayId = TestData.insertMenuDayToday(db, kitchenId);
        return new Fixture(kitchenId, TestData.insertMenuItem(db, menuDayId, dishId, portions));
    }

    /** Data lines only — the stream also carries comment-only heartbeat frames. */
    private Flux<String> portionsEvents(PortionsStreamService task, String kitchenId) {
        return task.stream(kitchenId)
                .filter(event -> "portions".equals(event.event()))
                .map(ServerSentEvent::data);
    }

    private PortionsStreamService startTaskB() throws Exception {
        PortionsStreamService instance = new PortionsStreamService(db, jsonMapper, redis);
        // Redis pub/sub keeps no backlog: publishing before the PSUBSCRIBE lands just loses the
        // message. Wait for the subscription rather than sleeping and hoping.
        instance.subscriptionEstablished().get(10, TimeUnit.SECONDS);
        return instance;
    }

    @Test
    void aSaleOnOneInstanceReachesAStreamHeldByAnother() throws Exception {
        Fixture f = seedPublishedMenu(10);
        taskB = startTaskB();

        StepVerifier.create(portionsEvents(taskB, f.kitchenId()))
                // First frame is task B's own snapshot of the current state.
                .assertNext(json -> assertThat(json).contains("\"portionsRemaining\":10"))
                // Now task A serves an order and announces it. Nothing in this call touches
                // task B directly; the only path between them is the Redis channel.
                .then(() -> {
                    db.sql("""
                            UPDATE "MenuItem" SET "portionsRemaining" = "portionsRemaining" - 3
                            WHERE id = :id
                            """)
                            .param("id", f.menuItemId())
                            .update();
                    taskA.onPortionsChanged(new PortionsChanged(List.of(f.menuItemId())));
                })
                .assertNext(json -> {
                    assertThat(json).contains("\"portionsRemaining\":7");
                    assertThat(json).contains(f.menuItemId());
                })
                .thenCancel()
                .verify(Duration.ofSeconds(15));
    }

    @Test
    void anInstanceWithNoSubscriberForThatKitchenIgnoresTheMessage() throws Exception {
        Fixture watched = seedPublishedMenu(10);
        Fixture other = seedPublishedMenu(10);
        taskB = startTaskB();

        StepVerifier.create(portionsEvents(taskB, watched.kitchenId()))
                .assertNext(json -> assertThat(json).contains("\"portionsRemaining\":10"))
                .then(() -> {
                    // A sale at a DIFFERENT kitchen. The pattern subscription receives it, but it
                    // must not be fanned out to this kitchen's subscribers.
                    db.sql("UPDATE \"MenuItem\" SET \"portionsRemaining\" = 1 WHERE id = :id")
                            .param("id", other.menuItemId())
                            .update();
                    taskA.onPortionsChanged(new PortionsChanged(List.of(other.menuItemId())));
                })
                .expectNoEvent(Duration.ofSeconds(2))
                .thenCancel()
                .verify(Duration.ofSeconds(15));
    }
}
