"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import styles from "./SellerNav.module.css";

const links = [
  ["/seller", "Overview"],
  ["/seller/orders", "Orders"],
  ["/voting", "Tomorrow’s menu"],
  ["/seller/menu", "Menu & portions"],
  ["/seller/kitchen", "Kitchen profile"],
  ["/seller/earnings", "Earnings"],
];

export default function SellerNav() {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const reveal = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      nav.scrollLeft +=
        active.getBoundingClientRect().left -
        nav.getBoundingClientRect().left -
        (nav.clientWidth - active.offsetWidth) / 2;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname]);
  return (
    <div className={styles.shell}>
      <div className={styles.inner}>
        <span className={styles.label}>Kitchen workspace</span>
        <nav ref={ref} className={styles.nav} aria-label="Seller navigation">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname === href ||
                (href === "/seller/menu" && pathname === "/seller/menu-chat")
                  ? "page"
                  : undefined
              }
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
