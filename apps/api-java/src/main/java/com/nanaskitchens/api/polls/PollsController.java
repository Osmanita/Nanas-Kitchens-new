package com.nanaskitchens.api.polls;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class PollsController {
    public record CreatePollRequest(
            @NotBlank @Size(max = 200) String question,
            @NotNull @Size(min = 2, max = 6) List<@NotBlank String> dishIds,
            @NotBlank String serviceDate,
            @NotBlank String timeZone,
            @NotBlank String closesAt,
            @NotNull @Size(min = 1, max = 12) List<@NotNull @Pattern(regexp = "([01]\\d|2[0-3]):[0-5]\\d") String> readyTimes,
            @Min(1) @Max(1000) int minimumPortions,
            @Min(1) @Max(1000) int capacity) {}

    public record VoteRequest(
            @NotNull @Min(0) Integer optionIndex,
            @Min(1) @Max(20) int qty,
            @NotBlank String readyTime,
            @NotNull Double lat,
            @NotNull Double lng) {}

    private final PollsService polls;
    public PollsController(PollsService polls) { this.polls = polls; }

    @PostMapping("/kitchens/{kitchenId}/polls")
    @PreAuthorize("hasRole('SELLER')")
    public Map<String, Object> create(Authentication auth, @PathVariable String kitchenId,
            @Valid @RequestBody CreatePollRequest request) {
        return polls.create(auth.getName(), kitchenId, request);
    }

    @GetMapping("/kitchens/{kitchenId}/polls")
    public List<Map<String, Object>> list(Authentication auth, @PathVariable String kitchenId,
            @RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng) {
        return polls.forKitchen(auth.getName(), kitchenId, lat, lng);
    }

    @GetMapping("/polls/nearby")
    @PreAuthorize("hasRole('BUYER')")
    public List<Map<String, Object>> nearby(Authentication auth, @RequestParam Double lat, @RequestParam Double lng) {
        return polls.nearby(auth.getName(), lat, lng);
    }

    @GetMapping("/polls/mine")
    @PreAuthorize("hasRole('SELLER')")
    public List<Map<String, Object>> mine(Authentication auth) { return polls.mine(auth.getName()); }

    @GetMapping("/polls/preorders")
    @PreAuthorize("hasRole('BUYER')")
    public List<Map<String, Object>> preorders(Authentication auth) { return polls.preorders(auth.getName()); }

    @PostMapping("/polls/{pollId}/vote")
    @PreAuthorize("hasRole('BUYER')")
    public Map<String, Object> vote(Authentication auth, @PathVariable String pollId,
            @Valid @RequestBody VoteRequest request) {
        return polls.vote(auth.getName(), pollId, request);
    }

    @PostMapping({"/polls/{pollId}/finalize", "/polls/{pollId}/close"})
    @PreAuthorize("hasRole('SELLER')")
    public Map<String, Object> finalizeMenu(Authentication auth, @PathVariable String pollId) {
        return polls.finalizeMenu(auth.getName(), pollId);
    }

    @PostMapping("/polls/{pollId}/checkout")
    @PreAuthorize("hasRole('BUYER')")
    public Map<String, Object> checkout(Authentication auth, @PathVariable String pollId) {
        return polls.checkout(auth.getName(), pollId);
    }

    @PostMapping("/polls/{pollId}/cancel")
    @PreAuthorize("hasRole('BUYER')")
    public Map<String, Object> cancel(Authentication auth, @PathVariable String pollId) {
        return polls.cancel(auth.getName(), pollId);
    }
}
