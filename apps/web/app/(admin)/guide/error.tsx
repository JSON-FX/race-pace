"use client";

import { FileVideo } from "lucide-react";
import { Button } from "@/components/fieldnotes/button";
import "@/components/guide/guide.css";

export default function GuideError({ reset }: { reset: () => void }) {
  return <div className="gd-root gd-main"><header className="gd-header"><h1>Guide</h1></header><div className="gd-empty"><FileVideo /><h2>Guides couldn’t load</h2><p>Check your connection, then try again.</p><Button onClick={reset}>Try again</Button></div></div>;
}
