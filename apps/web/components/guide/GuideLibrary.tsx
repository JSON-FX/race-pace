"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CalendarDays, Check, ChevronDown, ClipboardList, CreditCard, FileVideo, Play, Plus, QrCode, Search, ShieldCheck, Upload, Users, X } from "lucide-react";
import { Button } from "@/components/fieldnotes/button";
import { Field } from "@/components/fieldnotes/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { filterGuides, guideDuration, guideFileError, GUIDE_TOPICS, type GuideVideo } from "@/lib/guides";
import { guidePlaybackAction, saveGuideAction } from "@/lib/actions/guides";
import { uploadGuideVideo, type UploadedGuide } from "@/lib/guide-upload";
import "./guide.css";

const topics = ["All guides", ...GUIDE_TOPICS];
const iconFor = (topic: string) => topic === "Events" ? CalendarDays : topic === "Registrations" ? ClipboardList : topic === "Payments" ? CreditCard : topic === "Race day" ? QrCode : topic === "Team & settings" ? Users : BookOpen;

function Thumbnail({ guide }: { guide: GuideVideo }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [guide.thumbnailUrl]);
  const Icon = iconFor(guide.topic);
  return <div className="gd-thumb">
    {guide.thumbnailUrl && !failed ? <img src={guide.thumbnailUrl} onError={() => setFailed(true)} alt="" loading="lazy" width="960" height="540" />
      : <div className="gd-recording"><Icon /><span>{guide.topic}</span><strong>{guide.title}</strong></div>}
    <span className="gd-play" aria-hidden="true"><Play fill="currentColor" /></span>
    <span className="gd-duration">{guideDuration(guide.duration_seconds)}</span>
  </div>;
}

function Player({ guide }: { guide: GuideVideo }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setUrl(undefined); setError("");
    guidePlaybackAction(guide.id).then(result => {
      if (!active) return;
      if (result.url) setUrl(result.url);
      else setError(result.error ?? "Video couldn’t load. Try again.");
    }).catch(() => { if (active) setError("Video couldn’t load. Check your connection, then try again."); });
    return () => { active = false; };
  }, [guide.id, attempt]);
  return url && !error ? <div className="gd-player"><video key={url} controls preload="metadata" playsInline poster={guide.thumbnailUrl}
    src={url} aria-label={guide.title} onError={() => setError("Video couldn’t load. Try again, or ask a super admin to replace the recording.")} /></div>
    : <div className="gd-player gd-player-empty" role="status"><FileVideo /><h3>{error ? "Video couldn’t load" : "Loading video…"}</h3>
      {error && <><p>{error}</p><Button onClick={() => setAttempt(a => a + 1)}>Retry video</Button></>}</div>;
}

function GuideUpload({ guide, onSaved, onClose, restoreFocus }: { guide: GuideVideo | null; onSaved: (published: boolean) => void; onClose: () => void; restoreFocus: () => void }) {
  const [id] = useState(() => guide?.id ?? crypto.randomUUID());
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [fileIssue, setFileIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const uploaded = useRef<UploadedGuide | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (fileIssue) { setError(fileIssue); return; }
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const published = submitter?.value === "published";
    if (!guide && !file && !uploaded.current) { setError("Choose a video before continuing."); return; }
    setBusy(true); setError("");
    try {
      if (file && !uploaded.current) uploaded.current = await uploadGuideVideo(id, file, setPhase);
      const media = uploaded.current ?? guide;
      if (!media) throw new Error("Choose a video before continuing.");
      setPhase("Saving guide…");
      const result = await saveGuideAction({ id, title: String(form.get("title")), description: String(form.get("description")),
        topic: String(form.get("topic")), storage_path: media.storage_path, thumbnail_path: media.thumbnail_path,
        duration_seconds: media.duration_seconds, is_published: published });
      if (!result.ok) { setError(result.error ?? "Guide could not be saved. Try again."); return; }
      onSaved(published);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Guide could not be saved. Try again."); }
    finally { setBusy(false); setPhase(""); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="gd-dialog gd-upload-dialog" showCloseButton={!busy}
    onCloseAutoFocus={e => { e.preventDefault(); restoreFocus(); }}
    onOpenAutoFocus={e => { e.preventDefault(); titleInput.current?.focus(); }} onEscapeKeyDown={e => { if (busy) e.preventDefault(); }}
    onInteractOutside={e => e.preventDefault()}>
    <DialogHeader><DialogTitle>{guide ? "Edit guide" : "Upload a video guide"}</DialogTitle>
      <DialogDescription>Help org admins find a quick answer. Add a clear title, description, and topic.</DialogDescription></DialogHeader>
    <form onSubmit={save} aria-busy={busy}>
      <fieldset disabled={busy}>
        <Field ref={titleInput} className="gd-field" name="title" label="Title" required maxLength={160} defaultValue={guide?.title} placeholder="e.g. Create and publish your event" />
        <label className="gd-field">Description<Textarea name="description" required maxLength={2000} rows={3} defaultValue={guide?.description} placeholder="What will an org admin learn?" /></label>
        <label className="gd-field">Topic<select name="topic" defaultValue={guide?.topic ?? GUIDE_TOPICS[0]}>{GUIDE_TOPICS.map(t => <option key={t}>{t}</option>)}</select></label>
        <label className="gd-upload-zone"><Upload /><strong>{file ? file.name : guide ? "Replace video (optional)" : "Choose your video"}</strong><span>MP4 or WebM · Up to 50 MiB · Up to four hours</span>
          <Input type="file" aria-label="Video file" accept="video/mp4,video/webm" aria-describedby={error ? "guide-upload-error" : undefined}
            onChange={e => { const next = e.target.files?.[0] ?? null; const invalid = next ? guideFileError(next) : null;
              setError(invalid ?? ""); setFileIssue(invalid ?? ""); setFile(invalid ? null : next); uploaded.current = null; }} /></label>
        <p className="gd-upload-note"><ShieldCheck />Drafts are visible only to super admins. Published guides are shared with all org admins.</p>
        {error && <p id="guide-upload-error" className="gd-form-error" role="alert">{error}</p>}
        <div className="gd-form-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="outline" value="draft">Save draft</Button><Button type="submit" value="published">{guide?.is_published ? "Save changes" : "Publish guide"}</Button></div>
      </fieldset>
      {busy && <p className="gd-upload-note" role="status">{phase}</p>}
    </form>
  </DialogContent></Dialog>;
}

export function GuideLibrary({ guides, isSuperAdmin }: { guides: GuideVideo[]; isSuperAdmin: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("All guides");
  const [sort, setSort] = useState("recommended");
  const [manage, setManage] = useState(false);
  const [watchId, setWatchId] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ guide: GuideVideo | null } | null>(null);
  const [notice, setNotice] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const available = guides.filter(g => g.is_published || (isSuperAdmin && manage));
  const filtered = filterGuides(available, query, topic, sort);
  const featured = guides.find(g => g.is_published);
  const watch = available.find(g => g.id === watchId);
  // Refresh signed thumbnail URLs for a long-lived admin tab.
  useEffect(() => { const timer = window.setInterval(() => router.refresh(), 50 * 60 * 1000); return () => window.clearInterval(timer); }, [router]);
  function resetFilters() { setQuery(""); setTopic("All guides"); }
  function openWatch(id: string) { opener.current = document.activeElement as HTMLElement; setWatchId(id); }
  function openUpload(guide: GuideVideo | null) { opener.current = document.activeElement as HTMLElement; setUpload({ guide }); }
  function restoreFocus() { opener.current?.focus(); }
  return <div className="gd-root gd-main">
    <header className="gd-header"><div><h1>Guide</h1><p>Know your way around. Run your race with confidence.</p></div>
      {isSuperAdmin && <div className="gd-actions"><Button variant="outline" onClick={() => { setManage(!manage); resetFilters(); }}>{manage ? "Browse guides" : "Manage guides"}</Button><Button onClick={() => openUpload(null)}><Plus />Upload video</Button></div>}</header>
    {notice && <div className="gd-notice" role="status"><Check /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification"><X /></button></div>}
    <div className="gd-tools"><div className="gd-search"><Search aria-hidden="true" /><Input ref={search} type="search" aria-label="Search guides" placeholder="Search by title, topic, or description…" value={query} onChange={e => setQuery(e.target.value)} />
      {query && <button className="gd-clear" onClick={() => { setQuery(""); search.current?.focus(); }} aria-label="Clear search"><X /></button>}</div>
      <label className="gd-sort"><span className="gd-sr">Sort guides</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">Recommended</option><option value="az">Title A–Z</option><option value="shortest">Shortest first</option></select><ChevronDown /></label></div>
    <div className="gd-topics" aria-label="Filter by topic">{topics.map(t => <button key={t} aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>)}</div>
    {!filtered.length ? <div className="gd-empty"><Search /><h2>{!available.length ? "Guides are on their way" : "No matching guides"}</h2>
      <p>{!available.length ? "Video guides published by Race Pace will appear here." : "Try a shorter search, another topic, or clear your filters."}</p>
      {!!available.length && <Button variant="outline" onClick={resetFilters}>Clear filters</Button>}
      {!available.length && isSuperAdmin && <Button onClick={() => openUpload(null)}>Upload first guide</Button>}</div>
      : manage && isSuperAdmin ? <section className="gd-management"><div className="gd-section-title"><h2>Manage guides</h2><p className="gd-count" role="status">{filtered.length} guides</p></div>
        <p>Published guides are visible to org admins. Drafts are visible only to super admins.</p>
        {filtered.map(g => <div key={g.id} className="gd-manage-row"><FileVideo /><div><h3>{g.title}</h3><p>{g.topic} · {g.is_published ? "Published" : "Draft"}</p></div><Button variant="outline" onClick={() => openUpload(g)}>Edit guide</Button></div>)}</section>
        : <>
          {!query.trim() && topic === "All guides" && featured && <section className="gd-feature"><button className="gd-feature-image" onClick={() => openWatch(featured.id)} aria-label={`Watch ${featured.title}`}><Thumbnail guide={featured} /></button>
            <div className="gd-feature-copy"><span className="gd-topic-label">{featured.topic}</span><h2>{featured.title}</h2><p>{featured.description}</p><Button onClick={() => openWatch(featured.id)}><Play />Watch walkthrough <span>{guideDuration(featured.duration_seconds)}</span></Button></div></section>}
          <div className="gd-section-title"><h2>{query ? "Search results" : "Browse video guides"}</h2><p className="gd-count" role="status">{filtered.length} {filtered.length === 1 ? "guide" : "guides"}{topic !== "All guides" ? ` in ${topic}` : " available"}{query ? ` matching “${query}”` : ""}</p></div>
          <div className="gd-video-grid">{filtered.map(g => <button className="gd-video-card" key={g.id} onClick={() => openWatch(g.id)}><Thumbnail guide={g} /><span className="gd-topic-label">{g.topic}</span><h3>{g.title}</h3><p>{g.description}</p></button>)}</div>
        </>}
    <footer className="gd-footer"><ShieldCheck />Guides from Race Pace. Available to every organization admin.</footer>
    <Dialog open={!!watch} onOpenChange={open => { if (!open) setWatchId(null); }}><DialogContent className="gd-dialog gd-watch-dialog" onCloseAutoFocus={e => { e.preventDefault(); restoreFocus(); }}>
      {watch && <><DialogHeader><DialogTitle>{watch.title}</DialogTitle><DialogDescription>{watch.topic} · {guideDuration(watch.duration_seconds)}</DialogDescription></DialogHeader>
        <Player guide={watch} /><p className="gd-watch-description">{watch.description}</p>
        {available.some(g => g.topic === watch.topic && g.id !== watch.id && g.is_published) && <div className="gd-related"><h3>More in {watch.topic}</h3>
          {available.filter(g => g.topic === watch.topic && g.id !== watch.id && g.is_published).slice(0, 3).map(g => <button key={g.id} onClick={() => setWatchId(g.id)}>{g.title}<Play aria-hidden="true" /></button>)}</div>}</>}
    </DialogContent></Dialog>
    {upload && isSuperAdmin && <GuideUpload guide={upload.guide} restoreFocus={restoreFocus} onClose={() => setUpload(null)} onSaved={published => {
      setUpload(null); setNotice(published ? "Guide published. Org admins can now watch it." : "Draft saved. Only super admins can see it.");
      if (!published) setManage(true); resetFilters(); router.refresh();
    }} />}
  </div>;
}
