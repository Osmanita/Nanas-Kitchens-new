package com.nanaskitchens.api.chat;

import com.nanaskitchens.api.chat.dto.ChatRequest;
import com.nanaskitchens.api.chat.stt.SttProvider;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;

@RestController
@RequestMapping("/chat")
public class ChatController {

    /** ≤60 s of opus/aac comfortably fits — anything bigger is not a voice message. */
    private static final long MAX_AUDIO_BYTES = 5 * 1024 * 1024;
    private static final Set<String> AUDIO_TYPES =
            Set.of("audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg");

    private final AgentService agentService;
    private final SttProvider stt;

    public ChatController(AgentService agentService, SttProvider stt) {
        this.agentService = agentService;
        this.stt = stt;
    }

    /**
     * POST /chat/stream
     * Accepts conversation history, streams SSE agent response. Auth: valid JWT required.
     */
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> stream(@Valid @RequestBody ChatRequest request, Authentication authentication) {
        return agentService.streamChat(request.messages(), authentication.getName(), request.location());
    }

    /**
     * POST /chat/seller/stream — conversational menu builder for kitchen owners. Same SSE contract
     * as /chat/stream; the agent gets the seller's own kitchen and menu tools.
     */
    @PostMapping(value = "/seller/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("hasRole('SELLER')")
    public Flux<String> streamSeller(@Valid @RequestBody ChatRequest request, Authentication authentication) {
        return agentService.streamSellerChat(request.messages(), authentication.getName());
    }

    /**
     * POST /chat/transcribe — Story 5.3 (FR13): voice message → transcript. The client
     * feeds the transcript through the exact same /chat/stream path as typed text; low
     * confidence is surfaced so the UI asks the buyer to review first (Story 5.2 AC4).
     */
    @PostMapping("/transcribe")
    public Map<String, Object> transcribe(@RequestParam("audio") MultipartFile audio) throws IOException {
        String contentType = audio.getContentType() == null ? "" : audio.getContentType().split(";")[0];
        if (!AUDIO_TYPES.contains(contentType)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_AUDIO_TYPE");
        }
        if (audio.getSize() == 0 || audio.getSize() > MAX_AUDIO_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "AUDIO_TOO_LARGE");
        }
        SttProvider.Transcription result = stt.transcribe(audio.getBytes(), contentType);
        return Map.of("transcript", result.text(), "confidence", result.confidence());
    }
}
