import type { Metadata } from "next";
import { Archivo, Archivo_Narrow } from "next/font/google";
import { HorizonScene } from "./HorizonScene";
import styles from "./coming-soon.module.css";

export const metadata: Metadata = {
  title: "Coming soon",
  description: "Discover races. Bring your people. Make every start count.",
  robots: { index: false, follow: false, noarchive: true },
};

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"] });
const archivoNarrow = Archivo_Narrow({ subsets: ["latin"], weight: ["600", "700"] });

export default function ComingSoonPage() {
  return (
    <main className={`${styles.page} ${archivo.className}`}>
      <HorizonScene />
      <header className={styles.header}>
        <div className={styles.brand}>
          <img src="/topnav-logo.png" width="76" height="40" alt="" />
          <span>Race Pace</span>
        </div>
        <span className={`${styles.headerNote} ${archivoNarrow.className}`}>MADE FOR WHAT&apos;S OUT THERE</span>
      </header>

      <div className={styles.body}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>COMING SOON</p>
          <h1>Find your next<br /><em>start line.</em></h1>
          <p className={styles.support}>Discover races. Bring your people. Make every start count.</p>
          <p className={styles.availability}>The Race Pace platform is getting ready. Registration is not open yet.</p>
          <div className={styles.contact}>
            <span>Organizing an event?</span>
            <a href="mailto:support.racepace@gmail.com">Get in touch</a>
          </div>
        </div>
      </div>

      <footer className={`${styles.footer} ${archivoNarrow.className}`}>
        <span>THE JOURNEY STARTS HERE</span>
        <span>RACEPACE.COM.PH</span>
      </footer>
    </main>
  );
}
