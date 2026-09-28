package com.nanaskitchens.api.chat;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nanaskitchens.api.chat.stt.SttProvider;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import reactor.core.publisher.Flux;

class ChatControllerTest {
    @Test
    void bothChatEndpointsPreserveSseInsteadOfAllowingProxyCompression() throws Exception {
        AgentService agent = mock(AgentService.class);
        Flux<String> events = Flux.just("{\"type\":\"status\"}", "{\"type\":\"done\"}");
        when(agent.streamChat(anyList(), eq("test-user"))).thenReturn(events);
        when(agent.streamSellerChat(anyList(), eq("test-user"))).thenReturn(events);
        var mvc = MockMvcBuilders.standaloneSetup(new ChatController(agent, mock(SttProvider.class))).build();
        for (String endpoint : new String[] {"/chat/stream", "/chat/seller/stream"}) {
            var result = mvc.perform(post(endpoint)
                            .principal(new UsernamePasswordAuthenticationToken("test-user", null))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"))
                    .andExpect(request().asyncStarted()).andReturn();
            result.getAsyncResult(3000);
            mvc.perform(asyncDispatch(result))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "private, no-store, no-transform"))
                    .andExpect(header().string("X-Accel-Buffering", "no"))
                    .andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_EVENT_STREAM))
                    .andExpect(content().string(org.hamcrest.Matchers.containsString("data:{\"type\":\"done\"}")));
        }
    }
}
