package com.nanaskitchens.api.polls;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class PreorderExpiryJob {
    private static final Logger log = LoggerFactory.getLogger(PreorderExpiryJob.class);
    private final JdbcClient db;
    private final PollsService polls;
    public PreorderExpiryJob(JdbcClient db, PollsService polls) { this.db = db; this.polls = polls; }

    @Scheduled(initialDelay = 60000, fixedDelay = 60000)
    public void releaseExpired() {
        var ids = db.sql("""
                SELECT DISTINCT p.id FROM "Poll" p JOIN "PollVote" v ON v."pollId" = p.id
                WHERE v.status IN ('awaiting_result', 'ready_for_payment')
                AND (p."serviceDate" + v."readyTime"::time) AT TIME ZONE p."timeZone" <= now()
                """).query(String.class).list();
        for (String id : ids) {
            try { polls.expire(id); }
            catch (RuntimeException e) { log.warn("Could not expire pre-orders for poll {}", id, e); }
        }
    }
}
