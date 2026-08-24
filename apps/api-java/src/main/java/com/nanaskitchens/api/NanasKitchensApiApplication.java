package com.nanaskitchens.api;

import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling // Story 3.4: PendingPaymentSweeper releases abandoned pending orders
public class NanasKitchensApiApplication {
    public static void main(String[] args) {
        // The whole app treats UTC as its clock (see CLAUDE.md: never CURRENT_DATE, always
        // "(now() AT TIME ZONE 'UTC')::date"), but every timestamp column is TIMESTAMP(3)
        // WITHOUT time zone and several are filled by the database itself — "createdAt"
        // DEFAULT CURRENT_TIMESTAMP, plus the now() writes in refundedAt/readAt/closesAt.
        // Those land in the JDBC SESSION's timezone, and pgjdbc sets that from the JVM
        // default: on a UTC+3 developer machine the same row was written +3h ahead of the
        // UTC dates the queries compare it against. That is why the seller earnings chart
        // dropped a day's payouts for the first hours of every UTC day, and why the review
        // window was measured against a skewed createdAt. Pinning the JVM makes the writes,
        // the reads (Timestamp.toInstant()) and the queries agree, and matches what the
        // Prisma writer already stores. Must run before the context — and therefore any
        // connection — is created.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        SpringApplication.run(NanasKitchensApiApplication.class, args);
    }
}
