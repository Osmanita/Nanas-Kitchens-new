package com.nanaskitchens.api.polls;

import com.nanaskitchens.api.menus.MenusService;
import com.nanaskitchens.api.menus.dto.CreateMenuDayRequest;
import com.nanaskitchens.api.menus.dto.ReadyWindow;
import com.nanaskitchens.api.notifications.NotificationsService;
import com.nanaskitchens.api.orders.OrdersService;
import com.nanaskitchens.api.orders.dto.CreateOrderRequest;
import com.nanaskitchens.api.orders.dto.OrderDetailResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** One registered neighbor, one vote and one unpaid pickup reservation per dated poll.
 * Every mutation locks the poll first, then its reservations. No payment is captured here. */
@Service
public class PollsService {
    private static final double RADIUS_METERS = 10 * 1609.344;
    private final JdbcClient db;
    private final MenusService menus;
    private final OrdersService orders;
    private final NotificationsService notifications;

    public PollsService(JdbcClient db, MenusService menus, OrdersService orders, NotificationsService notifications) {
        this.db = db; this.menus = menus; this.orders = orders; this.notifications = notifications;
    }

    record Poll(String id, String kitchenId, String kitchenName, String sellerId, LocalDate day,
            String zone, String[] names, String[] dishes, Integer[] prices, String[] times,
            int minimum, int capacity, String menuDayId, Instant closes, Instant finalized,
            Integer[] cooking, String question) {}
    record Vote(String id, String buyer, int option, int qty, String time, String status, String item, String order) {}

    @Transactional
    public Map<String, Object> create(String seller, String kitchenId, PollsController.CreatePollRequest request) {
        ZoneId zone;
        LocalDate day;
        Instant closes;
        try {
            zone = ZoneId.of(request.timeZone());
            day = LocalDate.parse(request.serviceDate());
            closes = LocalDateTime.parse(request.closesAt()).atZone(zone).toInstant();
        } catch (RuntimeException e) { throw bad("INVALID_POLL_DATES"); }
        if (!day.equals(LocalDate.now(zone).plusDays(1))) throw bad("POLL_MUST_BE_FOR_TOMORROW");
        List<String> times;
        try {
            times = request.readyTimes().stream().map(t -> LocalTime.parse(t).toString()).distinct().sorted().toList();
            if (times.isEmpty() || times.stream().anyMatch(t -> t.length() != 5)) throw bad("INVALID_PICKUP_TIMES");
        } catch (RuntimeException e) { throw bad("INVALID_PICKUP_TIMES"); }
        if (!closes.isAfter(Instant.now()) || !closes.isBefore(day.atTime(LocalTime.parse(times.getFirst())).atZone(zone).toInstant())) {
            throw bad("INVALID_VOTING_DEADLINE");
        }
        if (request.minimumPortions() > request.capacity()) throw bad("MINIMUM_EXCEEDS_CAPACITY");
        List<String> ids = request.dishIds().stream().distinct().toList();
        if (ids.size() != request.dishIds().size() || ids.size() < 2) throw bad("NEED_DISTINCT_DISHES");
        var owned = menus.listDishes(seller, kitchenId);
        List<String> names = new ArrayList<>(); List<Integer> prices = new ArrayList<>();
        for (String id : ids) {
            var dish = owned.stream().filter(d -> d.id().equals(id)).findFirst().orElseThrow(() -> bad("DISH_NOT_OWNED"));
            if (dish.priceCents() < 1) throw bad("DISH_NEEDS_PRICE");
            names.add(dish.name()); prices.add(dish.priceCents());
        }
        // Reserve a draft day up front so the demo rollover cannot replace tomorrow's plan.
        if (times.stream().anyMatch(t -> LocalTime.parse(t).isAfter(LocalTime.of(23, 54)))) throw bad("INVALID_PICKUP_TIMES");
        var windows = times.stream().map(t -> new ReadyWindow(t, LocalTime.parse(t).plusMinutes(5).toString(), 5)).toList();
        var menu = menus.createMenuDay(seller, kitchenId, new CreateMenuDayRequest(day.toString(), windows,
                ids.stream().map(id -> new CreateMenuDayRequest.Item(id, request.capacity())).toList()));
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO "Poll" (id, "kitchenId", question, options, "closesAt", "serviceDate", "timeZone",
                    "readyTimes", "dishIds", prices, "minimumPortions", capacity, "menuDayId")
                VALUES (:id, :kitchen, :question, :names, :closes, :day, :zone, :times, :dishes, :prices, :minimum, :capacity, :menu)
                """)
                .param("id", id).param("kitchen", kitchenId).param("question", request.question().trim())
                .param("names", names.toArray(String[]::new)).param("closes", LocalDateTime.ofInstant(closes, ZoneOffset.UTC))
                .param("day", day).param("zone", zone.getId()).param("times", times.toArray(String[]::new))
                .param("dishes", ids.toArray(String[]::new)).param("prices", prices.toArray(Integer[]::new))
                .param("minimum", request.minimumPortions()).param("capacity", request.capacity()).param("menu", menu.id()).update();
        return view(read(id, false), null);
    }

    public List<Map<String, Object>> mine(String seller) {
        return db.sql("""
                SELECT p.id FROM "Poll" p JOIN "Kitchen" k ON k.id = p."kitchenId"
                WHERE k."sellerId" = :seller AND p."serviceDate" IS NOT NULL ORDER BY p."createdAt" DESC LIMIT 30
                """).param("seller", seller).query(String.class).list().stream().map(id -> view(read(id, false), null)).toList();
    }

    public List<Map<String, Object>> nearby(String buyer, Double lat, Double lng) {
        coordinates(lat, lng);
        return db.sql("""
                SELECT p.id FROM "Poll" p JOIN "Kitchen" k ON k.id = p."kitchenId"
                WHERE p."serviceDate" >= (now() AT TIME ZONE 'UTC')::date - 1
                AND ST_DWithin(k.geo, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)
                ORDER BY p."serviceDate", p."createdAt" DESC LIMIT 100
                """).param("lat", lat).param("lng", lng).param("radius", RADIUS_METERS).query(String.class).list().stream()
                .map(id -> read(id, false)).filter(p -> pickup(p, p.times()[p.times().length - 1]).isAfter(Instant.now()))
                .map(p -> view(p, buyer)).toList();
    }

    public List<Map<String, Object>> forKitchen(String user, String kitchenId, Double lat, Double lng) {
        boolean owner = db.sql("SELECT count(*) FROM \"Kitchen\" WHERE id = :id AND \"sellerId\" = :user")
                .param("id", kitchenId).param("user", user).query(Integer.class).single() > 0;
        if (owner) return mine(user).stream().filter(p -> kitchenId.equals(p.get("kitchenId"))).toList();
        return nearby(user, lat, lng).stream().filter(p -> kitchenId.equals(p.get("kitchenId"))).toList();
    }

    @Transactional
    public Map<String, Object> vote(String buyer, String id, PollsController.VoteRequest request) {
        Poll p = read(id, true);
        requireNearby(p.kitchenId(), request.lat(), request.lng());
        if (p.finalized() != null || !p.closes().isAfter(Instant.now())) throw bad("POLL_CLOSED");
        if (request.optionIndex() < 0 || request.optionIndex() >= p.names().length) throw bad("OPTION_OUT_OF_RANGE");
        if (!Arrays.asList(p.times()).contains(request.readyTime())) throw bad("INVALID_PICKUP_TIME");
        var prior = votes(id).stream().filter(v -> v.buyer().equals(buyer)).findFirst();
        if (prior.isPresent()) {
            Vote v = prior.get();
            if (v.option() == request.optionIndex() && v.qty() == request.qty() && Objects.equals(v.time(), request.readyTime())
                    && !Set.of("cancelled", "expired").contains(v.status())) return view(p, buyer);
            throw conflict("ALREADY_VOTED");
        }
        int reserved = votes(id).stream().filter(v -> v.option() == request.optionIndex() && counts(v)).mapToInt(Vote::qty).sum();
        if (reserved + request.qty() > p.capacity()) throw conflict("POLL_PORTIONS_FULL");
        db.sql("""
                INSERT INTO "PollVote" (id, "pollId", "buyerId", "optionIndex", qty, "readyTime", status)
                VALUES (:id, :poll, :buyer, :option, :qty, :time, 'awaiting_result')
                """).param("id", UUID.randomUUID().toString()).param("poll", id).param("buyer", buyer)
                .param("option", request.optionIndex()).param("qty", request.qty()).param("time", request.readyTime()).update();
        return view(p, buyer);
    }

    /** The cook deliberately commits the menu. Top-voted ties cook; other dishes cook if
     * their requested portions reach the cook's declared minimum. Retrying is a no-op. */
    @Transactional
    public Map<String, Object> finalizeMenu(String seller, String id) {
        Poll p = read(id, true); owner(p, seller);
        if (p.finalized() != null) return view(p, null);
        if (!pickup(p, p.times()[0]).isAfter(Instant.now())) throw bad("PICKUP_TIME_PASSED");
        boolean attested = db.sql("SELECT \"complianceAttestedAt\" IS NOT NULL FROM \"Kitchen\" WHERE id = :id")
                .param("id", p.kitchenId()).query(Boolean.class).single();
        if (!attested) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "PUBLISH_REQUIRES_ATTESTATION");
        List<Vote> all = votes(id); int[] tallies = tallies(p, all, false); int[] portions = tallies(p, all, true);
        int maximum = Arrays.stream(tallies).max().orElse(0); List<Integer> cooking = new ArrayList<>();
        for (int i = 0; i < tallies.length; i++) if (tallies[i] > 0 && (tallies[i] == maximum || portions[i] >= p.minimum())) cooking.add(i);
        for (int i = 0; i < p.dishes().length; i++) {
            String item = db.sql("SELECT id FROM \"MenuItem\" WHERE \"menuDayId\" = :menu AND \"dishId\" = :dish")
                    .param("menu", p.menuDayId()).param("dish", p.dishes()[i]).query(String.class).single();
            if (cooking.contains(i)) {
                db.sql("UPDATE \"MenuItem\" SET \"portionsRemaining\" = :remaining WHERE id = :id")
                        .param("remaining", p.capacity() - portions[i]).param("id", item).update();
                db.sql("UPDATE \"PollVote\" SET status = 'ready_for_payment', \"menuItemId\" = :item WHERE \"pollId\" = :poll AND \"optionIndex\" = :option AND status = 'awaiting_result'")
                        .param("item", item).param("poll", id).param("option", i).update();
            } else {
                db.sql("UPDATE \"PollVote\" SET status = 'not_cooking' WHERE \"pollId\" = :poll AND \"optionIndex\" = :option AND status = 'awaiting_result'")
                        .param("poll", id).param("option", i).update();
                db.sql("DELETE FROM \"MenuItem\" WHERE id = :id").param("id", item).update();
            }
        }
        if (!cooking.isEmpty()) db.sql("UPDATE \"MenuDay\" SET status = 'published' WHERE id = :id").param("id", p.menuDayId()).update();
        db.sql("UPDATE \"Poll\" SET \"finalizedAt\" = (now() AT TIME ZONE 'UTC'), \"closesAt\" = LEAST(\"closesAt\", now() AT TIME ZONE 'UTC'), \"cookingOptions\" = :cooking WHERE id = :id")
                .param("id", id).param("cooking", cooking.toArray(Integer[]::new)).update();
        for (Vote v : all) if (v.status().equals("awaiting_result")) {
            boolean selected = cooking.contains(v.option());
            notifications.notify(v.buyer(), "poll_result", selected ? "Your pre-order is ready to confirm" : "Pre-order update",
                    selected ? p.names()[v.option()] + " will be prepared on " + p.day() + ". Complete payment for your " + v.time() + " pickup."
                            : p.names()[v.option()] + " did not receive enough demand. Your pre-order is closed; nothing was charged.",
                    Map.of("pollId", id, "kitchenId", p.kitchenId()));
        }
        return view(read(id, false), null);
    }

    public List<Map<String, Object>> preorders(String buyer) {
        return db.sql("SELECT \"pollId\" FROM \"PollVote\" WHERE \"buyerId\" = :buyer AND status <> 'vote_only' ORDER BY \"createdAt\" DESC LIMIT 60")
                .param("buyer", buyer).query(String.class).list().stream().map(id -> view(read(id, false), buyer)).toList();
    }

    @Transactional
    public Map<String, Object> checkout(String buyer, String id) {
        Poll p = read(id, true);
        Vote v = ownVote(id, buyer);
        if (v.order() != null) return Map.of("orderId", v.order());
        if (!v.status().equals("ready_for_payment")) throw conflict("PREORDER_NOT_READY");
        if (!pickup(p, v.time()).isAfter(Instant.now())) throw conflict("PREORDER_EXPIRED");
        // Transfer the held portion to the normal order transaction. A provider failure
        // rolls back this release and leaves the original reservation intact.
        db.sql("UPDATE \"MenuItem\" SET \"portionsRemaining\" = \"portionsRemaining\" + :qty WHERE id = :id")
                .param("qty", v.qty()).param("id", v.item()).update();
        var result = orders.placePreorder(buyer, new CreateOrderRequest(p.kitchenId(), p.menuDayId(),
                List.of(new CreateOrderRequest.Item(v.item(), v.qty())), p.day() + "T" + v.time(), "pickup", null, 0, true), p.prices()[v.option()], v.id());
        String orderId = result.containsKey("orderId") ? (String) result.get("orderId") : ((OrderDetailResponse) result.get("order")).id();
        db.sql("UPDATE \"PollVote\" SET status = 'ordered', \"orderId\" = :order WHERE id = :id")
                .param("order", orderId).param("id", v.id()).update();
        return Map.of("orderId", orderId);
    }

    @Transactional
    public Map<String, Object> cancel(String buyer, String id) {
        Poll p = read(id, true); Vote v = ownVote(id, buyer);
        if (v.status().equals("cancelled")) return view(p, buyer);
        if (!Set.of("awaiting_result", "ready_for_payment").contains(v.status())) throw conflict("PREORDER_NOT_CANCELLABLE");
        release(v, "cancelled"); return view(p, buyer);
    }

    /** Called individually by the sweep job: one poll's locks never block another. */
    @Transactional
    public void expire(String id) {
        Poll p = read(id, true);
        for (Vote v : votes(id)) if (Set.of("awaiting_result", "ready_for_payment").contains(v.status())
                && !pickup(p, v.time()).isAfter(Instant.now())) release(v, "expired");
    }

    private void release(Vote v, String status) {
        if (v.status().equals("ready_for_payment")) db.sql("UPDATE \"MenuItem\" SET \"portionsRemaining\" = \"portionsRemaining\" + :qty WHERE id = :id")
                .param("qty", v.qty()).param("id", v.item()).update();
        db.sql("UPDATE \"PollVote\" SET status = :status WHERE id = :id").param("status", status).param("id", v.id()).update();
    }

    private Vote ownVote(String id, String buyer) {
        return votes(id).stream().filter(v -> v.buyer().equals(buyer)).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "PREORDER_NOT_FOUND"));
    }
    private List<Vote> votes(String id) {
        return db.sql("SELECT * FROM \"PollVote\" WHERE \"pollId\" = :id").param("id", id)
                .query((rs, n) -> new Vote(rs.getString("id"), rs.getString("buyerId"), rs.getInt("optionIndex"), rs.getInt("qty"),
                        rs.getString("readyTime"), rs.getString("status"), rs.getString("menuItemId"), rs.getString("orderId"))).list();
    }
    private Poll read(String id, boolean lock) {
        return db.sql("""
                SELECT p.*, k.name AS kitchen_name, k."sellerId" FROM "Poll" p JOIN "Kitchen" k ON k.id = p."kitchenId"
                WHERE p.id = :id AND p."serviceDate" IS NOT NULL
                """ + (lock ? " FOR UPDATE OF p" : "")).param("id", id)
                .query((r, n) -> new Poll(r.getString("id"), r.getString("kitchenId"), r.getString("kitchen_name"), r.getString("sellerId"),
                        r.getDate("serviceDate").toLocalDate(), r.getString("timeZone"), (String[]) r.getArray("options").getArray(),
                        (String[]) r.getArray("dishIds").getArray(), (Integer[]) r.getArray("prices").getArray(), (String[]) r.getArray("readyTimes").getArray(),
                        r.getInt("minimumPortions"), r.getInt("capacity"), r.getString("menuDayId"), instant(r, "closesAt"), instant(r, "finalizedAt"),
                        (Integer[]) r.getArray("cookingOptions").getArray(), r.getString("question")))
                .optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "POLL_NOT_FOUND"));
    }
    private Map<String, Object> view(Poll p, String buyer) {
        List<Vote> all = votes(p.id()); int[] tallies = tallies(p, all, false); int[] portions = tallies(p, all, true);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", p.id()); result.put("kitchenId", p.kitchenId()); result.put("kitchenName", p.kitchenName());
        result.put("question", p.question()); result.put("options", p.names()); result.put("prices", p.prices());
        result.put("serviceDate", p.day()); result.put("timeZone", p.zone()); result.put("readyTimes", p.times());
        result.put("minimumPortions", p.minimum()); result.put("capacity", p.capacity()); result.put("tallies", tallies);
        result.put("portions", portions); result.put("totalVotes", Arrays.stream(tallies).sum()); result.put("closesAt", p.closes());
        result.put("closed", p.finalized() != null || !p.closes().isAfter(Instant.now()));
        result.put("finalized", p.finalized() != null); result.put("cookingOptions", p.cooking());
        result.put("myVote", null); result.put("preorder", null);
        all.stream().filter(v -> v.buyer().equals(buyer)).findFirst().ifPresent(v -> {
            result.put("myVote", v.option()); Map<String, Object> own = new LinkedHashMap<>();
            own.put("qty", v.qty()); own.put("readyTime", v.time()); own.put("status", v.status()); own.put("orderId", v.order());
            own.put("totalCents", p.prices()[v.option()] * v.qty()); result.put("preorder", own);
        });
        return result;
    }
    private static boolean counts(Vote v) { return !Set.of("cancelled", "expired", "vote_only").contains(v.status()); }
    private static int[] tallies(Poll p, List<Vote> votes, boolean quantities) {
        int[] result = new int[p.names().length];
        for (Vote v : votes) if (counts(v)) result[v.option()] += quantities ? v.qty() : 1;
        return result;
    }
    private static Instant instant(ResultSet r, String name) throws SQLException {
        var timestamp = r.getTimestamp(name);
        return timestamp == null ? null : timestamp.toLocalDateTime().toInstant(ZoneOffset.UTC);
    }
    private static Instant pickup(Poll p, String time) { return p.day().atTime(LocalTime.parse(time)).atZone(ZoneId.of(p.zone())).toInstant(); }
    private static void owner(Poll p, String seller) {
        if (!p.sellerId().equals(seller)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }
    private static void coordinates(Double lat, Double lng) {
        if (lat == null || lng == null || !Double.isFinite(lat) || !Double.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw bad("LOCATION_REQUIRED");
    }
    private void requireNearby(String kitchen, Double lat, Double lng) {
        coordinates(lat, lng);
        boolean nearby = db.sql("SELECT COALESCE(ST_DWithin(geo, ST_SetSRID(ST_MakePoint(:lng, :lat),4326)::geography, :radius), false) FROM \"Kitchen\" WHERE id = :id")
                .param("id", kitchen).param("lat", lat).param("lng", lng).param("radius", RADIUS_METERS).query(Boolean.class).single();
        if (!nearby) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "OUTSIDE_POLL_AREA");
    }
    private static ResponseStatusException bad(String code) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, code); }
    private static ResponseStatusException conflict(String code) { return new ResponseStatusException(HttpStatus.CONFLICT, code); }
}
