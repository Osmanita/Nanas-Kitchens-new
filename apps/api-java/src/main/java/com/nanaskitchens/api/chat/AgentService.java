package com.nanaskitchens.api.chat;

import com.nanaskitchens.api.chat.dto.ChatMessage;
import com.nanaskitchens.api.chat.dto.ChatRequest;
import com.nanaskitchens.api.inventory.InventoryService;
import com.nanaskitchens.api.kitchens.KitchensService;
import com.nanaskitchens.api.menus.MenusService;
import com.nanaskitchens.api.orders.OrdersService;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import tools.jackson.databind.json.JsonMapper;

@Service
public class AgentService {

    private final ChatClient chatClient;
    private final ChatClient sellerChatClient;
    private final JsonMapper jsonMapper;
    private final KitchensService kitchensService;
    private final OrdersService ordersService;
    private final InventoryService inventoryService;
    private final MenusService menusService;

    public AgentService(
            ObjectProvider<ChatClient.Builder> chatClientBuilders,
            JsonMapper jsonMapper,
            KitchensService kitchensService,
            OrdersService ordersService,
            InventoryService inventoryService,
            MenusService menusService) {
        // ChatClient.Builder is prototype-scoped and its default request is shared with every client
        // it builds, so each system prompt needs its own builder instance.
        this.chatClient = chatClientBuilders.getObject().defaultSystem(SystemPrompt.TEXT).build();
        this.sellerChatClient =
                chatClientBuilders.getObject().defaultSystem(SellerSystemPrompt.TEXT).build();
        this.jsonMapper = jsonMapper;
        this.kitchensService = kitchensService;
        this.ordersService = ordersService;
        this.inventoryService = inventoryService;
        this.menusService = menusService;
    }

    /**
     * Runs the agentic tool-use loop and streams SSE events: {"type":"text","delta":"..."} then
     * {"type":"done"} — same shape the NestJS AgentService emitted, so existing web/mobile clients
     * don't need to change.
     */
    public Flux<String> streamChat(
            List<ChatMessage> messages, String buyerId, ChatRequest.Location location) {
        KitchenOrderTools tools =
                new KitchenOrderTools(kitchensService, ordersService, inventoryService, jsonMapper, buyerId);

        List<Message> history = messages.stream()
                .<Message>map(m -> "assistant".equals(m.role())
                        ? new AssistantMessage(m.content())
                        : new UserMessage(m.content()))
                .toList();
        if (location != null && location.isUsable()) {
            history = java.util.stream.Stream.concat(
                    java.util.stream.Stream.of(new UserMessage(
                            "[Private location context: the buyer granted browser location permission. "
                                    + "Use lat=" + location.lat() + ", lng=" + location.lng()
                                    + " with searchKitchens. Do not ask for location or show these coordinates.]")),
                    history.stream()).toList();
        }

        Flux<String> textDeltas = chatClient
                .prompt()
                .messages(history)
                .tools(tools)
                .stream()
                .content()
                .map(delta -> toEvent("text", delta));

        return textDeltas.concatWith(Mono.just(toEvent("done", null)));
    }

    /** Seller-side menu builder: same SSE shape, seller tools and prompt instead of the ordering ones. */
    public Flux<String> streamSellerChat(List<ChatMessage> messages, String sellerId) {
        SellerMenuTools tools = new SellerMenuTools(kitchensService, menusService, jsonMapper, sellerId);

        // Menu days are keyed on the UTC date, so the model must not guess "today" from its own clock.
        List<Message> history = java.util.stream.Stream.concat(
                        java.util.stream.Stream.of(new UserMessage("[Context: today's date is "
                                + LocalDate.now(ZoneOffset.UTC)
                                + " (UTC). Use it whenever the seller says today.]")),
                        messages.stream()
                                .<Message>map(m -> "assistant".equals(m.role())
                                        ? new AssistantMessage(m.content())
                                        : new UserMessage(m.content())))
                .toList();

        return sellerChatClient
                .prompt()
                .messages(history)
                .tools(tools)
                .stream()
                .content()
                .map(delta -> toEvent("text", delta))
                .concatWith(Mono.just(toEvent("done", null)));
    }

    private String toEvent(String type, String delta) {
        Map<String, Object> payload = delta == null ? Map.of("type", type) : Map.of("type", type, "delta", delta);
        return jsonMapper.writeValueAsString(payload);
    }
}
