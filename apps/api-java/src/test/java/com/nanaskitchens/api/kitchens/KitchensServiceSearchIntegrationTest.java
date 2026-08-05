package com.nanaskitchens.api.kitchens;

import static org.assertj.core.api.Assertions.assertThat;

import com.nanaskitchens.api.kitchens.dto.KitchenSearchResult;
import com.nanaskitchens.api.support.IntegrationTest;
import com.nanaskitchens.api.support.TestData;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Regression test for the "midnight trap": KitchensService.search() must compare against
 * UTC "today", not whatever timezone the JDBC session happens to be in — a real bug that
 * shipped and showed every kitchen as sold out for buyers west of UTC (see CLAUDE.md /
 * session history). A container whose clock is deliberately not UTC would catch this even
 * more directly, but pairing the SQL's own UTC date function in the fixture with the
 * service's query is what actually exercises the fix.
 */
class KitchensServiceSearchIntegrationTest extends IntegrationTest {

    @Autowired
    private KitchensService kitchensService;

    @Autowired
    private JdbcClient db;

    @Test
    void portionsLeftTodayReflectsTodaysPublishedMenu() {
        double lat = 40.1578;
        double lng = -83.0752;

        String sellerId = TestData.insertUser(db, "seller", "seller-" + java.util.UUID.randomUUID() + "@test.dev");
        String kitchenId = TestData.insertKitchen(db, sellerId, lat, lng);
        String dishId = TestData.insertDish(db, kitchenId, "Manti", 1200);
        String menuDayId = TestData.insertMenuDayToday(db, kitchenId);
        TestData.insertMenuItem(db, menuDayId, dishId, 7);

        List<KitchenSearchResult> results = kitchensService.search(lat, lng, null);

        KitchenSearchResult found = results.stream()
                .filter(r -> r.id().equals(kitchenId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Seeded kitchen not in search results: " + results));
        assertThat(found.portionsLeftToday()).isEqualTo(7);
        assertThat(found.distanceMiles()).isEqualTo(0.0);
    }

    @Test
    void kitchenWithNoMenuTodayShowsZeroPortionsButStillAppears() {
        double lat = 40.2, lng = -83.2;
        String sellerId = TestData.insertUser(db, "seller", "seller-" + java.util.UUID.randomUUID() + "@test.dev");
        String kitchenId = TestData.insertKitchen(db, sellerId, lat, lng);
        // No MenuDay/MenuItem inserted — kitchen exists but hasn't published anything today.

        List<KitchenSearchResult> results = kitchensService.search(lat, lng, null);

        KitchenSearchResult found = results.stream()
                .filter(r -> r.id().equals(kitchenId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Seeded kitchen not in search results: " + results));
        assertThat(found.portionsLeftToday()).isEqualTo(0);
    }
}
