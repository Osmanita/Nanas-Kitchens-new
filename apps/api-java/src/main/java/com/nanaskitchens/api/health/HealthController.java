package com.nanaskitchens.api.health;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final DataSource dataSource;
    private final RedisConnectionFactory redis;

    public HealthController(DataSource dataSource, RedisConnectionFactory redis) {
        this.dataSource = dataSource;
        this.redis = redis;
    }

    // A dependency outage should remove this target from the load balancer, not restart
    // every task. ECS probes liveness; the ALB probes dependency readiness at /health.
    @GetMapping("/health/live")
    public Map<String, String> live() {
        return Map.of("status", "ok");
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        String db = "down";
        try (Connection connection = dataSource.getConnection()) {
            if (connection.isValid(2)) {
                db = "up";
            }
        } catch (SQLException ignored) {
            // db stays "down"
        }
        String cache = "down";
        try (RedisConnection connection = redis.getConnection()) {
            if ("PONG".equals(connection.ping())) {
                cache = "up";
            }
        } catch (RuntimeException ignored) {
            // Return a bounded, non-sensitive readiness failure.
        }
        boolean ready = "up".equals(db) && "up".equals(cache);
        return ResponseEntity.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("status", ready ? "ok" : "unavailable", "db", db, "redis", cache));
    }
}
