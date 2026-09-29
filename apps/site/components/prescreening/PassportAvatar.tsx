import styles from "./screening.module.css";

export function PassportAvatar({ name, managed = false }: { name: string; managed?: boolean }) {
  const initials = name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("");
  return <span aria-hidden="true" className={`${styles.avatar} ${managed ? styles.managed : ""}`}>{initials}</span>;
}
