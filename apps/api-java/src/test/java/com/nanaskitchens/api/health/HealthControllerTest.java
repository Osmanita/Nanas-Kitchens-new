package com.nanaskitchens.api.health;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.HttpStatus;

class HealthControllerTest {
    private final DataSource db = mock(DataSource.class);
    private final RedisConnectionFactory redis = mock(RedisConnectionFactory.class);
    private final HealthController controller = new HealthController(db, redis);

    private void healthyDependencies() throws SQLException {
        Connection connection = mock(Connection.class);
        when(db.getConnection()).thenReturn(connection);
        when(connection.isValid(2)).thenReturn(true);
        RedisConnection cache = mock(RedisConnection.class);
        when(redis.getConnection()).thenReturn(cache);
        when(cache.ping()).thenReturn("PONG");
    }

    @Test
    void livenessDoesNotRestartTasksDuringADependencyOutage() {
        assertThat(controller.live()).containsEntry("status", "ok");
        verifyNoInteractions(db, redis);
    }

    @Test
    void readyOnlyWhenDatabaseAndRedisRespond() throws SQLException {
        healthyDependencies();
        var response = controller.health();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).containsEntry("db", "up").containsEntry("redis", "up");
        verify(db.getConnection()).close();
        verify(redis.getConnection()).close();
    }

    @Test
    void databaseFailureReturns503WithoutExposingConnectionDetails() throws SQLException {
        healthyDependencies();
        when(db.getConnection()).thenThrow(new SQLException("private connection details"));
        var response = controller.health();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getBody()).containsEntry("db", "down").doesNotContainKey("error");
    }

    @Test
    void redisFailureRemovesTargetFromTraffic() throws SQLException {
        healthyDependencies();
        when(redis.getConnection()).thenThrow(new IllegalStateException("Redis unavailable"));
        var response = controller.health();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getBody()).containsEntry("redis", "down");
    }

    @Test
    void invalidDatabaseConnectionIsNotHealthy() throws SQLException {
        healthyDependencies();
        when(db.getConnection().isValid(2)).thenReturn(false);
        assertThat(controller.health().getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }
}
