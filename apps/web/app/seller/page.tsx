"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ensureSession, Session } from "../../lib/api";
import { money } from "../../lib/cart";
import { kitchenDay, pickupDay } from "../../lib/polls";
import {
  loadSellerSnapshot,
  paidStatuses,
  PortalOrder,
  SellerKitchen,
  SellerSnapshot,
  serviceDateLabel,
  workingStatuses,
} from "../../lib/seller";
import Icon from "../components/Icon";
import { OrderStatus } from "../components/PageKit";
import common from "../marketplace.module.css";
import s from "./portal.module.css";

export default function SellerPortalPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>();
  const [kitchen, setKitchen] = useState<SellerKitchen | null>();
  const [snapshot, setSnapshot] = useState<SellerSnapshot>();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [filter, setFilter] = useState("attention");
  const [bootError, setBootError] = useState(false);
  const [bootRetry, setBootRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState<Date>();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let active = true;
    setBootError(false);
    (async () => {
      try {
        const auth = await ensureSession();
        if (!active) return;
        setSession(auth);
        if (!auth) {
          router.replace("/login?next=/seller");
          return;
        }
        if (auth.role !== "seller") return;
        const response = await apiFetch("/kitchens/mine", {
          signal: controller.signal,
        });
        if (response.status === 404) {
          if (active) setKitchen(null);
          return;
        }
        if (!response.ok) throw new Error("Kitchen unavailable");
        const data = await response.json();
        if (active) setKitchen(data);
      } catch {
        if (active) setBootError(true);
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [router, bootRetry]);

  useEffect(() => {
    if (!kitchen || session?.role !== "seller") return;
    let controller: AbortController | undefined;
    let active = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setRefreshing(true);
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 20000);
      try {
        const data = await loadSellerSnapshot(
          kitchen.id,
          date,
          request.signal,
        );
        if (active) {
          setSnapshot(data);
          setUpdated(new Date());
        }
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (active) setRefreshing(false);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
    };
  }, [kitchen, date, refresh, session?.role]);

  async function accept(order: PortalOrder) {
    setBusyId(order.id);
    setActionError("");
    setNotice("");
    try {
      const response = await apiFetch(`/orders/${order.id}/accept`, {
        method: "POST",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error("Could not accept order");
      setSnapshot(
        (previous) =>
          previous && {
            ...previous,
            orders: previous.orders?.map((o) =>
              o.id === order.id ? { ...o, status: "accepted" } : o,
            ),
          },
      );
      setNotice(
        `Order ${order.id.slice(0, 8)} accepted. You can start preparation from the order board.`,
      );
    } catch {
      setActionError(
        "We couldn’t confirm that change. The order may have been updated already. Refresh its status before trying again.",
      );
    } finally {
      setBusyId(null);
      setRefresh((n) => n + 1);
    }
  }

  if (bootError)
    return (
      <main className={s.page}>
        <h1 className={common.title}>Let’s get your kitchen ready.</h1>
        <div className="form-error" role="alert">
          We couldn’t connect to your kitchen.{" "}
          <button
            className={common.textLink}
            onClick={() => setBootRetry((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      </main>
    );
  if (
    session === undefined ||
    (session?.role === "seller" && kitchen === undefined)
  )
    return (
      <main className={s.page} aria-busy="true">
        <div className={`skeleton ${s.loading}`} />
        <p className={s.subtle} role="status">
          Opening your kitchen workspace…
        </p>
      </main>
    );
  if (!session) return null;
  if (session.role !== "seller")
    return (
      <main className={s.page}>
        <section className={`${s.panel} ${s.setup}`}>
          <span className={s.eyebrow}>Seller portal</span>
          <h1>A workspace for your kitchen.</h1>
          <p className={s.subtle}>
            You’re signed in as a {session.role}. Sign in with your seller
            account to manage a kitchen.
          </p>
          <div className={common.actions}>
            <Link className={common.button} href="/login?next=/seller">
              Use a seller account
            </Link>
            <Link className={common.secondary} href="/orders">
              Back to my orders
            </Link>
          </div>
        </section>
      </main>
    );
  if (!kitchen)
    return (
      <main className={s.page}>
        <section className={`${s.panel} ${s.setup}`}>
          <span className={s.eyebrow}>Welcome to your seller portal</span>
          <h1>Your next chapter starts in your kitchen.</h1>
          <p className={s.subtle}>
            Set up your space, add the dishes you love making, and welcome your
            first neighbors.
          </p>
          <ol className={s.steps}>
            <li>
              <span>1</span>
              <div>
                <strong>Introduce your kitchen</strong>
                <p className={s.subtle}>
                  Add your name, cuisine, and pickup location.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Get ready to cook</strong>
                <p className={s.subtle}>
                  Complete your compliance declaration and add priced dishes.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Open your first menu</strong>
                <p className={s.subtle}>
                  Publish portions and pickup times, or ask neighbors what to
                  cook tomorrow.
                </p>
              </div>
            </li>
          </ol>
          <Link className={common.button} href="/seller/menu">
            Set up my kitchen <Icon name="arrow" />
          </Link>
        </section>
      </main>
    );

  const orders = snapshot?.orders;
  const dayOrders = orders?.filter(
    (o) => o.readySlot.slice(0, 10) === date && paidStatuses.has(o.status),
  );
  const awaiting = orders?.filter((o) => o.status === "confirmed");
  const visibleOrders = (
    filter === "attention"
      ? awaiting
      : dayOrders?.filter((o) => workingStatuses.has(o.status))
  )
    ?.slice()
    .sort((a, b) => a.readySlot.localeCompare(b.readySlot));
  const menu = snapshot?.menus?.find((m) => m.date === date);
  const menuHref = `/seller/menu?date=${date}`;
  const boardHref = `/seller/orders?date=${date}`;
  const portions =
    menu?.items.reduce((sum, item) => sum + item.portionsRemaining, 0) ?? 0;
  const zone = snapshot?.polls?.[0]?.timeZone ?? "America/New_York";
  const tomorrow = kitchenDay(zone, 1);
  const poll = snapshot?.polls?.find((p) => p.serviceDate === tomorrow);
  const earnings = snapshot?.earnings;

  return (
    <main className={s.page}>
      <header className={s.heading}>
        <div className={s.identity}>
          {kitchen.photos[0] ? (
            <img
              className={s.portrait}
              src={kitchen.photos[0]}
              alt={kitchen.name}
            />
          ) : (
            <span className={s.portrait}>
              <Icon name="bowl" width={30} height={30} />
            </span>
          )}
          <div>
            <span className={s.eyebrow}>Seller portal · {kitchen.name}</span>
            <h1>Your kitchen, at a glance.</h1>
            <p className={s.subtle}>
              A little planning for every meal you make.
            </p>
          </div>
        </div>
        <div className={s.tools}>
          <label>
            Service date
            <input
              type="date"
              aria-label="Service date"
              value={date}
              onChange={(e) => {
                if (e.target.value) {
                  setDate(e.target.value);
                  setSnapshot(undefined);
                  setNotice("");
                }
              }}
            />
          </label>
          <button
            className={common.secondary}
            disabled={refreshing}
            onClick={() => setRefresh((n) => n + 1)}
          >
            {refreshing ? "Updating…" : "Refresh"}
          </button>
        </div>
      </header>
      {!kitchen.complianceAttestedAt && (
        <div className={`${common.note} ${s.alert}`}>
          <strong>One step before you publish.</strong>
          <p>
            Complete your kitchen’s compliance declaration to start taking
            orders.
          </p>
          <Link className={common.textLink} href="/seller/menu">
            Complete kitchen setup →
          </Link>
        </div>
      )}
      {!!snapshot?.failed.length && (
        <div className={`form-error ${s.alert}`} role="alert">
          We couldn’t load {snapshot.failed.join(", ")}. The other sections are
          available.{" "}
          <button
            className={common.textLink}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )}
      <section className={s.metrics} aria-label="Kitchen overview">
        <div className={s.metric}>
          <span>Awaiting your response</span>
          <strong>{awaiting?.length ?? "—"}</strong>
          <small>Paid orders to review</small>
        </div>
        <div className={s.metric}>
          <span>Orders · {serviceDateLabel(date)}</span>
          <strong>{dayOrders?.length ?? "—"}</strong>
          <small>
            {dayOrders
              ? `${dayOrders.filter((o) => o.status === "completed").length} completed`
              : "Checking orders"}
          </small>
        </div>
        <div className={s.metric}>
          <span>Portions available</span>
          <strong>{snapshot?.menus ? portions : "—"}</strong>
          <small>
            {menu
              ? `${menu.items.length} dishes · ${menu.status}`
              : snapshot?.menus
                ? "No menu for this date"
                : "Checking menu"}
          </small>
        </div>
        <div className={s.metric}>
          <span>Completed sales · net</span>
          <strong>{earnings ? money(earnings.paid.netCents) : "—"}</strong>
          <small>All time · after commission</small>
        </div>
      </section>
      <div className={s.columns}>
        <div className={s.stack}>
          <section className={s.panel} aria-label="Orders to manage">
            <div className={s.sectionHead}>
              <h2>Keep the kitchen moving</h2>
              <Link className={common.textLink} href={boardHref}>
                Order board →
              </Link>
            </div>
            <p className={s.subtle}>
              Review incoming orders, then follow them through preparation.
            </p>
            <div className={s.tabs} aria-label="Order views">
              <button
                aria-pressed={filter === "attention"}
                onClick={() => setFilter("attention")}
              >
                Needs attention{awaiting ? ` (${awaiting.length})` : ""}
              </button>
              <button
                aria-pressed={filter === "service"}
                onClick={() => setFilter("service")}
              >
                {serviceDateLabel(date)} · in progress
              </button>
            </div>
            {notice && (
              <p className={common.note} role="status">
                {notice}
              </p>
            )}
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            {visibleOrders === undefined ? (
              <p className={s.subtle}>
                {snapshot
                  ? "Orders are temporarily unavailable."
                  : "Loading your orders…"}
              </p>
            ) : visibleOrders.length === 0 ? (
              <div className={s.empty}>
                <span className={s.emptyMark}>
                  <Icon name="bowl" />
                </span>
                <h3>
                  {filter === "attention"
                    ? "You’re all caught up."
                    : "Room for something delicious."}
                </h3>
                <p>
                  {filter === "attention"
                    ? "New paid orders will appear here when a neighbor places an order."
                    : "No meals are in preparation for this service date."}
                </p>
                <Link className={common.textLink} href={menuHref}>
                  Check your menu →
                </Link>
              </div>
            ) : (
              visibleOrders.slice(0, 6).map((order) => (
                <article key={order.id} className={s.order}>
                  <div>
                    <div className={s.orderMeta}>
                      <OrderStatus status={order.status} />
                      <span>
                        {serviceDateLabel(order.readySlot.slice(0, 10))} ·{" "}
                        {order.readySlot.slice(11, 16)}
                      </span>
                    </div>
                    <h3>
                      {order.itemsSummary ??
                        order.items
                          .map((i) => `${i.qty} × ${i.name}`)
                          .join(", ")}
                    </h3>
                    <p>
                      {order.fulfillment === "pickup"
                        ? "Kitchen pickup"
                        : "Delivery"}{" "}
                      · #{order.id.slice(0, 8)}
                    </p>
                    <p>{order.buyerEmail}</p>
                  </div>
                  <div className={s.orderAside}>
                    <strong>{money(order.totalCents)}</strong>
                    {order.status === "confirmed" ? (
                      <button
                        className={common.button}
                        disabled={busyId !== null}
                        onClick={() => void accept(order)}
                        aria-label={`Accept order ${order.id.slice(0, 8)}`}
                      >
                        {busyId === order.id ? "Accepting…" : "Accept order"}
                      </button>
                    ) : (
                      <Link
                        className={common.textLink}
                        href={`/seller/orders?date=${order.readySlot.slice(0, 10)}#order-${order.id}`}
                      >
                        Manage order →
                      </Link>
                    )}
                  </div>
                </article>
              ))
            )}
            {!!visibleOrders && visibleOrders.length > 6 && (
              <p className={s.subtle}>
                Showing the next 6 orders.{" "}
                <Link href={boardHref}>Open the order board</Link> for more.
              </p>
            )}
            {orders && orders.length >= 200 && (
              <p className={s.subtle}>
                Order activity shows your latest 200 orders.
              </p>
            )}
          </section>
          <section className={s.panel} aria-label="Service menu">
            <div className={s.sectionHead}>
              <h2>On the menu · {serviceDateLabel(date)}</h2>
              {menu && (
                <span
                  className={s.status}
                  data-warning={menu.status !== "published"}
                >
                  {menu.status === "published" ? "Published" : "Draft"}
                </span>
              )}
            </div>
            <p className={s.subtle}>
              {menu
                ? "Available portions exclude orders and reserved pre-orders."
                : "Choose what you’re making and how much you can prepare."}
            </p>
            {!snapshot?.menus ? (
              <p className={s.subtle}>
                {snapshot
                  ? "Menu details are temporarily unavailable."
                  : "Loading your menu…"}
              </p>
            ) : !menu || !menu.items.length ? (
              <div className={s.empty}>
                <h3>What’s cooking?</h3>
                <p>
                  Add dishes, portions, and pickup times to open this service
                  date.
                </p>
                <Link className={common.button} href={menuHref}>
                  Build this menu <Icon name="plus" />
                </Link>
              </div>
            ) : (
              <>
                {menu.items.slice(0, 4).map((item) => (
                  <div className={s.menuItem} key={item.id}>
                    {item.dish.photo ? (
                      <img
                        className={s.dishPhoto}
                        src={item.dish.photo}
                        alt={item.dish.name}
                      />
                    ) : (
                      <span className={s.dishPhoto}>
                        <Icon name="bowl" />
                      </span>
                    )}
                    <div>
                      <strong>{item.dish.name}</strong>
                      <small>{money(item.dish.priceCents)} / portion</small>
                    </div>
                    <span className={s.remaining}>
                      {item.portionsRemaining > 0
                        ? `${item.portionsRemaining} left`
                        : "Sold out"}
                      <small>of {item.portionsTotal}</small>
                    </span>
                  </div>
                ))}
                <p className={s.subtle}>
                  {menu.readyWindows
                    .map((w) => `${w.start}–${w.end}`)
                    .join(" · ")}{" "}
                  · kitchen time
                </p>
              </>
            )}
            {menu && (
              <div className={s.planFooter}>
                <Link className={common.textLink} href={menuHref}>
                  Manage menu & portions
                  {menu.items.length > 4
                    ? ` (${menu.items.length} dishes)`
                    : ""}{" "}
                  →
                </Link>
              </div>
            )}
          </section>
        </div>
        <aside className={s.stack}>
          <section className={s.plan} aria-label="Tomorrow's plan">
            <div className={s.planTop}>
              <span>TOMORROW’S TABLE</span>
              <Icon name="leaf" />
            </div>
            {!snapshot?.polls ? (
              <>
                <h2>A plan for tomorrow.</h2>
                <p>
                  {snapshot
                    ? "Polls are temporarily unavailable."
                    : "Checking your neighborhood polls…"}
                </p>
              </>
            ) : poll ? (
              <>
                <h2>{poll.question}</h2>
                <span className={s.status}>
                  {poll.finalized
                    ? "Menu confirmed"
                    : poll.closed
                      ? "Ready for your decision"
                      : "Voting open"}
                </span>
                <p>
                  {poll.totalVotes} neighbors voted ·{" "}
                  {poll.portions.reduce((sum, n) => sum + n, 0)} portions
                  requested.
                </p>
                {poll.options.slice(0, 3).map((name, i) => (
                  <div key={name} className={s.pollOption}>
                    <strong>{name}</strong>
                    <small>{poll.portions[i]} portions</small>
                  </div>
                ))}
                <p>
                  Pickup {pickupDay(poll.serviceDate, poll.timeZone)} ·{" "}
                  {poll.readyTimes.join(" / ")}
                </p>
              </>
            ) : (
              <>
                <h2>Let your neighbors help choose.</h2>
                <p>
                  Ask what they’d love tomorrow. Every vote can reserve
                  portions, so you know how much to cook.
                </p>
                <p>No payment until you confirm the menu.</p>
              </>
            )}
            <div className={s.planFooter}>
              <Link className={common.button} href="/voting">
                {poll
                  ? poll.finalized
                    ? "View tomorrow’s menu"
                    : "Review votes & pre-orders"
                  : "Plan tomorrow’s menu"}{" "}
                <Icon name="arrow" />
              </Link>
            </div>
          </section>
          <section className={s.panel} aria-label="Earnings summary">
            <div className={s.sectionHead}>
              <h2>Made by you. Earned by you.</h2>
            </div>
            <p className={s.subtle}>
              Food sales after platform commission. Delivery fees and tips are
              excluded.
            </p>
            <dl className={s.income}>
              <div>
                <dt>Completed sales</dt>
                <dd>{earnings ? money(earnings.paid.netCents) : "—"}</dd>
              </div>
              <div>
                <dt>Orders in progress</dt>
                <dd>{earnings ? money(earnings.upcoming.netCents) : "—"}</dd>
              </div>
            </dl>
            <Link className={common.textLink} href="/seller/earnings">
              See earnings breakdown →
            </Link>
          </section>
          <Link className={s.profileLink} href={`/kitchens/${kitchen.id}`}>
            <span>
              <strong>Through your neighbors’ eyes</strong>
              <small>Preview your public kitchen page</small>
            </span>
            <Icon name="arrow" />
          </Link>
        </aside>
      </div>
      <footer className={s.footer}>
        <span>
          {updated
            ? `Last checked ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30 seconds`
            : "Connecting to your kitchen"}
        </span>
        <Link className={common.textLink} href="/settings/notifications">
          Notification preferences
        </Link>
      </footer>
    </main>
  );
}
