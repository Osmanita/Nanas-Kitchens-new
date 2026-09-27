import Link from "next/link";
import { EmptyState, PageIntro } from "./components/PageKit";
import styles from "./marketplace.module.css";

export default function NotFound() {
  return (
    <main className={`${styles.page} ${styles.compact}`}>
      <PageIntro
        eyebrow="Nanas’ Kitchens / 404"
        title="A little off the menu."
      />
      <EmptyState
        title="We couldn’t find this page"
        action={
          <Link href="/" className={styles.button}>
            Back to nearby kitchens
          </Link>
        }
      >
        This link may have moved. There’s still something good cooking in your
        neighborhood.
      </EmptyState>
    </main>
  );
}
