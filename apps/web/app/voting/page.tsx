"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ensureSession, Session } from "../../lib/api";
import { money } from "../../lib/cart";
import {
  getLocation,
  saveLocation,
  subscribeLocation,
  PickedLocation,
} from "../../lib/location";
import {
  kitchenDay,
  MenuPoll,
  pickupDay,
  pollRequest,
  qualifyingOptions,
} from "../../lib/polls";
import { EmptyState, PageIntro } from "../components/PageKit";
import LocationPickerModal from "../components/LocationPickerModal";
import styles from "../marketplace.module.css";
import s from "./voting.module.css";

export default function VotingPage() {
  const [session, setSession] = useState<Session | null | undefined>();
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [picker, setPicker] = useState(false);
  const [tab, setTab] = useState("nearby");
  const [polls, setPolls] = useState<MenuPoll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const seller = session?.role === "seller";

  useEffect(() => {
    ensureSession()
      .then(setSession)
      .catch(() => setSession(null));
    setLocation(getLocation());
    if (new URLSearchParams(window.location.search).get("tab") === "preorders")
      setTab("preorders");
    return subscribeLocation(() => setLocation(getLocation()));
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!session) return;
      setLoading(true);
      setError("");
      try {
        const path = seller
          ? "/polls/mine"
          : tab === "preorders"
            ? "/polls/preorders"
            : location
              ? `/polls/nearby?lat=${location.lat}&lng=${location.lng}`
              : null;
        const data = path ? await pollRequest<MenuPoll[]>(path) : [];
        if (!signal?.aborted) setPolls(data);
      } catch (e) {
        if (!signal?.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Could not load polls. Please try again.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [session, seller, tab, location],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  const update = (poll: MenuPoll) =>
    setPolls((all) => all.map((p) => (p.id === poll.id ? poll : p)));
  return (
    <main className={styles.page}>
      <PageIntro
        eyebrow="Made together · enjoyed tomorrow"
        title={seller ? "What’s cooking tomorrow?" : "Have a say in tomorrow."}
        description={
          seller
            ? "Let your neighbors help plan the menu. See real demand before you cook."
            : "Vote for a dish, reserve your portions, and give a neighborhood cook a head start."
        }
      >
        {seller ? (
          <button
            className={styles.button}
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? "Close form" : "Create tomorrow’s poll"}
          </button>
        ) : (
          session?.role === "buyer" && (
            <button
              className={`${styles.secondary} ${s.location}`}
              onClick={() => setPicker(true)}
            >
              <span>
                {location
                  ? `Near ${location.label}`
                  : "Choose your neighborhood"}
              </span>{" "}
              ↓
            </button>
          )
        )}
      </PageIntro>
      {session === undefined ? (
        <p role="status">Opening your neighborhood…</p>
      ) : !session ? (
        <EmptyState
          title="A seat at the neighborhood table."
          action={
            <Link className={styles.button} href="/login?next=%2Fvoting">
              Log in to vote
            </Link>
          }
        >
          Log in as a buyer to vote and reserve tomorrow’s meal. Polls are shown
          within 10 miles of your chosen location.
        </EmptyState>
      ) : !seller && session.role !== "buyer" ? (
        <p>This page is for buyers and kitchen owners.</p>
      ) : (
        <div className={s.layout}>
          <div>
            {!seller && (
              <div className={s.tabs} aria-label="Voting views">
                <button
                  aria-pressed={tab === "nearby"}
                  onClick={() => setTab("nearby")}
                >
                  Nearby polls
                </button>
                <button
                  aria-pressed={tab === "preorders"}
                  onClick={() => setTab("preorders")}
                >
                  My pre-orders
                </button>
              </div>
            )}
            {seller && creating && (
              <CreatePoll
                onCreated={() => {
                  setCreating(false);
                  void load();
                }}
              />
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}{" "}
                <button className={styles.textLink} onClick={() => void load()}>
                  Try again
                </button>
              </div>
            )}
            {loading && !polls.length && (
              <p role="status">Finding tomorrow’s menus…</p>
            )}
            {!loading && !error && !polls.length && (
              <EmptyState
                title={
                  seller
                    ? "Tomorrow starts with a question."
                    : tab === "preorders"
                      ? "Your next meal starts here."
                      : !location
                        ? "Find your neighborhood."
                        : "No polls nearby just yet."
                }
                action={
                  !seller && (
                    <button
                      className={styles.secondary}
                      onClick={() =>
                        tab === "preorders" ? setTab("nearby") : setPicker(true)
                      }
                    >
                      {tab === "preorders"
                        ? "Explore nearby polls"
                        : "Choose location"}
                    </button>
                  )
                }
              >
                {seller
                  ? "Choose two to six dishes from your menu library, set a pickup time, and invite your neighbors to choose."
                  : tab === "preorders"
                    ? "Once you vote and reserve portions, you can follow your pre-order here."
                    : !location
                      ? "Choose a location to see polls from kitchens within 10 miles."
                      : "When a nearby cook asks what to prepare, their poll will appear here."}
              </EmptyState>
            )}
            <div className={s.list}>
              {polls.map((poll) => (
                <PollCard
                  key={poll.id}
                  poll={poll}
                  seller={seller}
                  location={location}
                  onUpdate={update}
                />
              ))}
            </div>
          </div>
          <aside className={s.aside}>
            <h2>
              A little planning.
              <br />A lovely meal.
            </h2>
            <ol>
              <li>
                <strong>Choose tomorrow’s dish</strong>One vote per neighbor.
                Each vote also reserves the portions you choose.
              </li>
              <li>
                <strong>Let the cook decide</strong>The top-voted dish wins.
                Other dishes with enough portion requests can be cooked too.
                Tied winners are included.
              </li>
              <li>
                <strong>Pay when it’s confirmed</strong>No charge when voting.
                Once the cook finalizes the menu, open My pre-orders to pay.
                Your pickup address appears after payment.
              </li>
            </ol>
            <p className={s.meta}>
              Pickup only for pre-orders. Times are local to the kitchen. Unpaid
              reservations expire at their pickup time.
            </p>
          </aside>
        </div>
      )}
      <LocationPickerModal
        open={picker}
        onClose={() => setPicker(false)}
        onConfirm={(loc) => {
          saveLocation(loc);
          setPicker(false);
        }}
      />
    </main>
  );
}

function PollCard({
  poll,
  seller,
  location,
  onUpdate,
}: {
  poll: MenuPoll;
  seller: boolean;
  location: PickedLocation | null;
  onUpdate: (poll: MenuPoll) => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(poll.myVote);
  const [qty, setQty] = useState(1);
  const [time, setTime] = useState(poll.readyTimes[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"finalize" | "cancel" | null>(null);
  const own = poll.preorder;
  const closed = poll.closed || Date.parse(poll.closesAt) <= Date.now();
  const canVote = !seller && !closed && !own;
  const qualifying = poll.finalized
    ? poll.cookingOptions
    : qualifyingOptions(poll);
  const available =
    selected === null
      ? 0
      : Math.min(20, poll.capacity - poll.portions[selected]);

  async function act(action: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      if (action === "checkout") {
        const result = await pollRequest<{ orderId: string }>(
          `/polls/${poll.id}/checkout`,
          body,
        );
        router.push(`/orders/${result.orderId}`);
      } else {
        onUpdate(
          await pollRequest<MenuPoll>(`/polls/${poll.id}/${action}`, body),
        );
        setConfirm(null);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={s.card}>
      <div className={s.heading}>
        <Link href={`/kitchens/${poll.kitchenId}`}>{poll.kitchenName}</Link>
        <span className={s.badge}>
          {poll.finalized
            ? "Menu confirmed"
            : closed
              ? "Awaiting the cook"
              : "Voting open"}
        </span>
      </div>
      <h2>{poll.question}</h2>
      <p className={s.meta}>
        <strong>Pickup {pickupDay(poll.serviceDate, poll.timeZone)}</strong> ·{" "}
        {poll.readyTimes.join(" / ")}
        <br />
        Kitchen time · {poll.timeZone.replaceAll("_", " ")}
      </p>
      <fieldset className={s.options} disabled={busy}>
        <legend>
          {canVote
            ? "Choose one dish to vote & pre-order"
            : `${poll.totalVotes} neighbor${poll.totalVotes === 1 ? "" : "s"} voted`}
        </legend>
        {poll.options.map((name, i) => (
          <label
            className={s.option}
            key={i}
            data-selected={(own ? poll.myVote : selected) === i}
          >
            <div className={s.optionLine}>
              {canVote && (
                <input
                  type="radio"
                  name={`dish-${poll.id}`}
                  checked={selected === i}
                  disabled={poll.portions[i] >= poll.capacity}
                  onChange={() => {
                    setSelected(i);
                    setQty(1);
                  }}
                />
              )}
              <strong>{name}</strong>
              <span>{money(poll.prices[i])}</span>
            </div>
            <div className={s.bar}>
              <span
                style={{
                  width: `${poll.totalVotes ? (poll.tallies[i] / poll.totalVotes) * 100 : 0}%`,
                }}
              />
            </div>
            <small>
              {poll.tallies[i]} votes · {poll.portions[i]} portions requested
              {poll.finalized
                ? ` · ${qualifying.includes(i) ? "On the menu" : "Not cooking this time"}`
                : ` · ${Math.max(0, poll.capacity - poll.portions[i])} left to reserve`}
            </small>
          </label>
        ))}
      </fieldset>
      <p className={s.meta}>
        The leading dish (including ties) will be cooked. Other dishes need{" "}
        {poll.minimumPortions} portions requested. Up to {poll.capacity}{" "}
        portions per dish.
      </p>
      {!poll.finalized && (
        <p className={s.meta}>
          Voting closes{" "}
          {new Date(poll.closesAt).toLocaleString("en-US", {
            timeZone: poll.timeZone,
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          (kitchen time).
        </p>
      )}
      {canVote && (
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (location && selected !== null)
              void act("vote", {
                optionIndex: selected,
                qty,
                readyTime: time,
                lat: location.lat,
                lng: location.lng,
              });
          }}
        >
          <div className={s.row}>
            <label>
              Portions
              <input
                type="number"
                min={1}
                max={Math.max(1, available)}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                required
              />
            </label>
            <label>
              Pickup time
              <select value={time} onChange={(e) => setTime(e.target.value)}>
                {poll.readyTimes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <div className={s.total}>
            <span>Pay later, if confirmed</span>
            <strong>
              {selected === null
                ? "Choose a dish"
                : money(poll.prices[selected] * qty)}
            </strong>
          </div>
          <button
            className={styles.button}
            disabled={
              busy ||
              selected === null ||
              !location ||
              qty < 1 ||
              qty > available ||
              !Number.isInteger(qty)
            }
          >
            {busy ? "Reserving…" : "Vote & reserve portions"}
          </button>
          <p className={s.meta}>
            No charge when you vote. Your vote is final; you can cancel your
            reservation before starting payment.
          </p>
        </form>
      )}
      {own && (
        <div className={s.notice} role="status">
          <strong>
            {
              {
                awaiting_result: "Your pre-order is received.",
                ready_for_payment: "Your dish is on the confirmed menu.",
                not_cooking: "This dish won’t be cooked this time.",
                cancelled: "Your pre-order is cancelled.",
                ordered: "Your order is ready to view.",
                expired: "This reservation has expired.",
              }[own.status]
            }
          </strong>
          <p>
            {own.qty} × {poll.options[poll.myVote!]} · {money(own.totalCents)}
            <br />
            Pickup {pickupDay(poll.serviceDate, poll.timeZone)} at{" "}
            {own.readyTime} (kitchen time).
          </p>
          {own.status === "awaiting_result" && (
            <p>
              Waiting for the cook to confirm the menu. We’ll notify you here
              when payment opens. Nothing has been charged.
            </p>
          )}
          {own.status === "ready_for_payment" && (
            <>
              <p>
                Your portions are held. Complete payment to confirm pickup and
                see the address.
              </p>
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => void act("checkout")}
              >
                {busy
                  ? "Opening order…"
                  : `Review & pay ${money(own.totalCents)}`}
              </button>
            </>
          )}
          {["not_cooking", "cancelled", "expired"].includes(own.status) && (
            <p>Nothing was charged for this reservation.</p>
          )}
          {own.status === "ordered" && own.orderId && (
            <Link className={styles.button} href={`/orders/${own.orderId}`}>
              View order & payment
            </Link>
          )}
          {["awaiting_result", "ready_for_payment"].includes(own.status) && (
            <p>
              <button
                className={styles.textLink}
                disabled={busy}
                onClick={() => setConfirm("cancel")}
              >
                Cancel pre-order
              </button>
            </p>
          )}
        </div>
      )}
      {seller && !poll.finalized && (
        <div className={s.summary}>
          <strong>Based on current demand</strong>
          <p>
            {qualifying.length
              ? qualifying.map((i) => poll.options[i]).join(" · ")
              : "No dishes have been requested yet."}
          </p>
          <button
            className={styles.button}
            disabled={busy}
            onClick={() => setConfirm("finalize")}
          >
            Close voting & confirm menu
          </button>
        </div>
      )}
      {confirm && (
        <div className={s.summary}>
          <p>
            {confirm === "finalize"
              ? `Confirm this menu for ${poll.serviceDate}? Voting will close, qualifying dishes will be published, and neighbors will be notified to pay.${qualifying.length ? "" : " No dishes qualify; this will close the poll without publishing food."}`
              : "Cancel your reserved portions? Your vote can’t be replaced in this poll."}
          </p>
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={busy}
              onClick={() => void act(confirm)}
            >
              {busy
                ? "Saving…"
                : confirm === "finalize"
                  ? "Confirm tomorrow’s menu"
                  : "Yes, cancel pre-order"}
            </button>
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Go back
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

interface Dish {
  id: string;
  name: string;
  priceCents: number;
}
function CreatePoll({ onCreated }: { onCreated: () => void }) {
  const [kitchen, setKitchen] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [zone, setZone] = useState("America/New_York");
  const [question, setQuestion] = useState(
    "What should I cook for you tomorrow?",
  );
  const [deadline, setDeadline] = useState(`${kitchenDay(zone)}T23:59`);
  const [times, setTimes] = useState("17:00, 18:00");
  const [minimum, setMinimum] = useState(3);
  const [capacity, setCapacity] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const day = kitchenDay(zone, 1);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const k = await pollRequest<{ id: string; name: string } | null>(
          "/kitchens/mine",
        );
        if (cancelled) return;
        setKitchen(k);
        if (k) {
          const list = await pollRequest<Dish[]>(`/kitchens/${k.id}/dishes`);
          if (!cancelled) setDishes(list);
        }
      } catch {
        if (!cancelled)
          setError(
            "Could not load your kitchen. Close the form and try again.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!kitchen) return;
    setBusy(true);
    setError("");
    try {
      const readyTimes = times
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (
        !readyTimes.length ||
        readyTimes.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))
      )
        throw new Error(
          "Enter pickup times as HH:mm, separated by commas (for example 17:00, 18:00).",
        );
      await pollRequest(`/kitchens/${kitchen.id}/polls`, {
        question,
        dishIds: selected,
        serviceDate: day,
        timeZone: zone,
        closesAt: deadline,
        readyTimes,
        minimumPortions: minimum,
        capacity,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish the poll.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.card} style={{ marginBottom: 28 }}>
      <h2>Ask your neighbors.</h2>
      <p className={s.meta}>
        Pickup on {pickupDay(day, zone)}. Prices come from your dish library and
        stay fixed for these pre-orders.
      </p>
      {loading ? (
        <p>Loading your dishes…</p>
      ) : !kitchen || dishes.length < 2 ? (
        <p>
          Add a kitchen and at least two priced dishes in{" "}
          <Link href="/seller/menu">My menu</Link> first.
        </p>
      ) : (
        <form className={s.form} onSubmit={create}>
          <label>
            Your question
            <input
              maxLength={200}
              required
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <fieldset className={s.options}>
            <legend>Choose 2–6 dishes</legend>
            <div className={s.dishChecks}>
              {dishes.map((dish) => (
                <label key={dish.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(dish.id)}
                    disabled={
                      dish.priceCents < 1 ||
                      (selected.length >= 6 && !selected.includes(dish.id))
                    }
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, dish.id]
                          : ids.filter((id) => id !== dish.id),
                      )
                    }
                  />
                  <span>{dish.name}</span>
                  {money(dish.priceCents)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className={s.row}>
            <label>
              Kitchen time zone
              <select
                value={zone}
                onChange={(e) => {
                  setZone(e.target.value);
                  setDeadline(`${kitchenDay(e.target.value)}T23:59`);
                }}
              >
                {[
                  "America/New_York",
                  "America/Chicago",
                  "America/Denver",
                  "America/Los_Angeles",
                  "Europe/Istanbul",
                ].map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Voting closes (kitchen time)
              <input
                type="datetime-local"
                required
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
          </div>
          <label>
            Tomorrow’s pickup times
            <input
              required
              placeholder="17:00, 18:00"
              value={times}
              onChange={(e) => setTimes(e.target.value)}
            />
          </label>
          <div className={s.row}>
            <label>
              Minimum portions for other dishes
              <input
                type="number"
                required
                min={1}
                max={capacity}
                value={minimum}
                onChange={(e) => setMinimum(Number(e.target.value))}
              />
            </label>
            <label>
              Capacity per dish
              <input
                type="number"
                required
                min={minimum}
                max={1000}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
              />
            </label>
          </div>
          <p className={s.meta}>
            Visible to registered buyers within 10 miles. The highest-voted dish
            and any tied winners are included; other dishes qualify when they
            reach your minimum. You’ll confirm the final menu before payment
            opens.
          </p>
          <button
            className={styles.button}
            disabled={busy || selected.length < 2}
          >
            {busy ? "Publishing…" : "Publish tomorrow’s poll"}
          </button>
        </form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
