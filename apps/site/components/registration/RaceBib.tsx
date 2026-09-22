import type { ReactNode } from "react";
import { CalendarDays, Check, MapPin } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { Card } from "@/components/ui/card";
import styles from "./RaceBib.module.css";

const STEPS = ["Details", "Kit", "Confirm", "Pay"] as const;

export function RaceBib({
  step, eventName, categoryLabel, distanceKm, dateLabel, organizer, place,
  amount, amountLabel, note, children,
}: {
  step: 1 | 2 | 3 | 4;
  eventName: string;
  categoryLabel: string;
  distanceKm?: number | null;
  dateLabel?: string | null;
  organizer?: string | null;
  place?: string | null;
  amount: number | null;
  amountLabel: string;
  note: string;
  children: ReactNode;
}) {
  const distance = distanceKm == null ? null : `${distanceKm.toLocaleString("en-PH", { maximumFractionDigits: 3 })} km`;
  const numericCategory = distanceKm != null && Number(categoryLabel.trim()) === distanceKm;
  const categoryDescription = numericCategory ? "Individual entry" : categoryLabel;
  const raceMeta = [distance, dateLabel, organizer].filter(Boolean).join(" · ");

  return <div className={styles.page}>
    <section className={styles.masthead} aria-label="Race registration">
      <div className={styles.mastheadInner}>
        <div className={styles.mastheadCopy}>
          <p className={styles.mastheadEyebrow}>{eventName}</p>
          <h1>Your place at the start.</h1>
          {raceMeta ? <p className={styles.mastheadMeta}>{raceMeta}</p> : null}
        </div>
        {distanceKm != null ? <div className={styles.distanceMark} aria-hidden="true">
          {distanceKm.toLocaleString("en-PH", { maximumFractionDigits: 3 })}
          <small>KM / {numericCategory ? "Race distance" : categoryLabel}</small>
        </div> : null}
      </div>
    </section>

    <div className={styles.workspace}>
      <nav className={styles.stepper} aria-label="Registration progress">
        <ol>{STEPS.map((label, index) => {
          const number = index + 1;
          const done = number < step;
          return <li key={label} className={done ? styles.done : undefined}>
            <span className={styles.stepContent} aria-current={number === step ? "step" : undefined}>
              <span className={number === step ? styles.currentNumber : styles.stepNumber}>
                {done ? <Check size={17} strokeWidth={2.4} aria-hidden="true" /> : String(number).padStart(2, "0")}
              </span>
              <span className={styles.stepLabel}>{label}</span>
            </span>
          </li>;
        })}</ol>
      </nav>

      <Card className={styles.panel}>
        <div className={styles.panelTopline}><span>Registration / single entry</span><span>Step {String(step).padStart(2, "0")} of 04</span></div>
        {children}
      </Card>

      <aside className={styles.summary} aria-label="Race and price summary">
        <div className={styles.summaryTop}><span>Your race pass</span><span className={styles.summaryIcon}><MapPin size={15} aria-hidden="true" /></span></div>
        <h2>{eventName}</h2>
        <p className={styles.summaryCategory}>{[distance, categoryDescription].filter(Boolean).join(" · ")}</p>
        {dateLabel || place ? <div className={styles.summaryMeta}>
          {dateLabel ? <p><CalendarDays size={15} aria-hidden="true" />{dateLabel}</p> : null}
          {place ? <p><MapPin size={15} aria-hidden="true" />{place}</p> : null}
        </div> : null}
        <div className={styles.summaryTotal}><span>{amountLabel}</span><strong>{amount == null ? "Shown at checkout" : formatPeso(amount)}</strong></div>
        <p className={styles.summaryNote}>{note}</p>
      </aside>
    </div>
  </div>;
}

export function RaceBibHeading({ step, title, description, icon }: {
  step: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return <div className={styles.sectionHeading}>
    <span className={styles.sectionIcon}>{icon}</span>
    <div>
      <p className={styles.eyebrow}>{String(step).padStart(2, "0")} / {STEPS[step - 1]}</p>
      <h2>{title}</h2>
      <p className={styles.sectionDescription}>{description}</p>
    </div>
  </div>;
}
