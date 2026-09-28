package com.nanaskitchens.api.chat;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.google.genai.types.HttpRetryOptions;
import java.io.IOException;
import org.springframework.ai.model.google.genai.autoconfigure.chat.GoogleGenAiConnectionProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.Assert;
import org.springframework.util.StringUtils;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "spring.ai.model.chat", havingValue = "google-genai", matchIfMissing = true)
public class GeminiClientConfiguration {
    @Bean
    Client googleGenAiClient(GoogleGenAiConnectionProperties properties) throws IOException {
        Client.Builder builder = Client.builder();
        boolean hasKey = StringUtils.hasText(properties.getApiKey());
        if (properties.isVertexAi() || !hasKey && StringUtils.hasText(properties.getProjectId())) {
            Assert.hasText(properties.getProjectId(), "Vertex AI requires a project ID");
            Assert.hasText(properties.getLocation(), "Vertex AI requires a location");
            builder.vertexAI(true).project(properties.getProjectId()).location(properties.getLocation());
            if (properties.getCredentialsUri() != null) {
                try (var input = properties.getCredentialsUri().getInputStream()) {
                    builder.credentials(GoogleCredentials.fromStream(input));
                }
            }
        } else {
            Assert.isTrue(hasKey, "Gemini API key must be configured");
            builder.apiKey(properties.getApiKey());
        }
        // Spring AI's retry settings do not govern the Gemini SDK's streaming HTTP retries.
        // Retry only the provider request, never replay a conversation that may have run a write tool.
        return builder
                .httpOptions(HttpOptions.builder()
                        .timeout(12_000)
                        .retryOptions(HttpRetryOptions.builder().attempts(2)
                                .initialDelay(0.5).maxDelay(1.0)
                                .httpStatusCodes(408, 429, 500, 502, 503, 504).build())
                        .build())
                .build();
    }
}
