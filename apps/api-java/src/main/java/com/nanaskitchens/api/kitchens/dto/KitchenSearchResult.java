package com.nanaskitchens.api.kitchens.dto;

/** Mirrors KitchenSearchResult in packages/core (NFR3: one shape across REST/MCP/agent). */
public record KitchenSearchResult(
        String id,
        String name,
        String cuisineTag,
        double distanceMiles,
        Double ratingAvg,
        int ratingCount,
        Integer hygieneScore,
        int portionsLeftToday,
        /** Cover image: kitchen's own photo, else the freshest dish photo (cards look tasty, not flags). */
        String photo,
        /** Seller-written blurb (e.g. "Home-style Turkish classics: manti, dolma, fresh pide.") —
         * lets the chat agent describe a kitchen without inventing menu details it hasn't fetched. */
        String description) {
}
