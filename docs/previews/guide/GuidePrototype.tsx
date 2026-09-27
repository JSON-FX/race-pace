import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, ClipboardList, CreditCard, FileVideo, LayoutDashboard, Menu, PackageCheck, Play, Plus, QrCode, Search, Settings, ShieldCheck, Upload, Users, X } from "lucide-react";
import { Button, Field } from "@race-pace/ui";
import { Input } from "@race-pace/ui/ui/input";
import { Textarea } from "@race-pace/ui/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@race-pace/ui/ui/dialog";
import "@/libraries/shadcn.css";
import "./guide.css";

const assets = `${import.meta.env.BASE_URL}fieldnotes/guide-assets/`;
const topics = ["All guides", "Getting started", "Events", "Registrations", "Payments", "Race day", "Team & settings"];
export const choices = [
  { name: "Video Library", summary: "Recognizable thumbnails, topic filters, and a clear place to start.", fit: "Best all-round choice", tradeoff: "Uses more vertical space than a list." },
  { name: "Topic Index", summary: "A calm reference page, organized around the admin sections you already know.", fit: "Best for browsing by section", tradeoff: "Less emphasis on video artwork." },
  { name: "Watch Desk", summary: "A video player and searchable lesson list share one workspace.", fit: "Best for watching several guides", tradeoff: "Player takes space before you choose a guide." },
  { name: "Task Finder", summary: "Start with what you need to do, then open the matching walkthrough.", fit: "Best for new org admins", tradeoff: "Requires maintaining useful task groupings." },
  { name: "Compact List", summary: "A fast, searchable video directory with titles and descriptions upfront.", fit: "Best for frequent reference", tradeoff: "Less visual than a thumbnail library." },
];
type Guide = { id: string; title: string; description: string; topic: string; minutes: string; image?: string; video?: string; draft?: boolean; uploaded?: boolean };
const initialGuides: Guide[] = [
  { id: "event-to-ticket", title: "From new event to race ticket", description: "Create an event, prepare registration, and follow the runner journey through payment to a QR ticket.", topic: "Getting started", minutes: "8:43", image: "admin.webp", video: `${assets}event-to-ticket.mp4` },
  { id: "event", title: "Create and publish your event", description: "Set race details, add categories and capacity, then review your event before opening registration.", topic: "Events", minutes: "4:20", image: "events.webp" },
  { id: "slots", title: "Set categories and available slots", description: "Understand event capacity and allocate places across your race distances.", topic: "Events", minutes: "2:45", image: "capacity.webp" },
  { id: "registrations", title: "Find and manage registrations", description: "Search for runners, filter registration status, and inspect a runner’s registration details.", topic: "Registrations", minutes: "3:15" },
  { id: "payments", title: "Understand payment statuses", description: "Read payment records and understand pending, paid, and refunded registrations.", topic: "Payments", minutes: "3:50" },
  { id: "check-in", title: "Check in runners on race day", description: "Find a runner, scan a QR ticket, and confirm check-in at your event.", topic: "Race day", minutes: "2:30" },
  { id: "race-kits", title: "Release race kits", description: "Look up a registration and record a race kit release for the correct runner.", topic: "Race day", minutes: "2:10" },
  { id: "team", title: "Invite your team and set roles", description: "Choose who can help manage your organization and what each team member can access.", topic: "Team & settings", minutes: "3:05" },
];
const iconFor = (topic: string) => topic === "Events" ? CalendarDays : topic === "Registrations" ? ClipboardList : topic === "Payments" ? CreditCard : topic === "Race day" ? QrCode : topic === "Team & settings" ? Users : BookOpen;

function Thumbnail({ guide, compact = false }: { guide: Guide; compact?: boolean }) {
  const Icon = iconFor(guide.topic);
  return <div className={`gd-thumb ${compact ? "gd-thumb-small" : ""}`}>
    {guide.image ? <img src={`${assets}${guide.image}`} alt="" loading="lazy" width="1920" height="1080" /> : <div className="gd-recording"><Icon /><span>{guide.topic}</span><strong>{guide.title}</strong><small>Recording placeholder</small></div>}
    <span className="gd-play" aria-hidden="true"><Play fill="currentColor" /></span>
    {!compact && <span className="gd-duration">{guide.minutes}</span>}
  </div>;
}

function Player({ guide }: { guide: Guide }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [guide.id]);
  return guide.video && !failed ? <div className="gd-player">
    <video key={guide.video} controls preload="metadata" playsInline poster={guide.image ? `${assets}${guide.image}` : undefined} onError={() => setFailed(true)} aria-label={guide.title}>
      <source src={guide.video} />
      {guide.id === "event-to-ticket" && <track kind="captions" src={`${assets}guide.vtt`} srcLang="en" label="English" default />}
    </video>
  </div> : <div className="gd-player gd-player-empty"><FileVideo /><h3>{failed ? "Video couldn’t load" : "Recording placeholder"}</h3><p>{failed ? "Try loading this video again." : "This lesson demonstrates the layout. Upload a video in Super admin preview to try playback."}</p>{failed && <Button onClick={() => setFailed(false)}>Retry video</Button>}</div>;
}

export function GuidePrototype({ initialChoice = 0, initialRole = "org", initialState = "ready" }: { initialChoice?: number; initialRole?: "org" | "super"; initialState?: "ready" | "empty" | "loading" | "error" }) {
  const [choice, setChoice] = useState(initialChoice);
  const [role, setRole] = useState(initialRole);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("All guides");
  const [sort, setSort] = useState("recommended");
  const [guides, setGuides] = useState<Guide[]>(initialGuides);
  const [selected, setSelected] = useState(initialGuides[0]);
  const [watch, setWatch] = useState<Guide | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<Guide | null>(null);
  const [manage, setManage] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, setState] = useState(initialState);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [notice, setNotice] = useState("");
  const urls = useRef<string[]>([]);
  const search = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const isSuper = role === "super";
  const available = guides.filter(g => !g.draft || (isSuper && manage));
  const filtered = available.filter(g => (topic === "All guides" || g.topic === topic) && `${g.title} ${g.description} ${g.topic}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b) => sort === "az" ? a.title.localeCompare(b.title) : sort === "shortest" ? duration(a.minutes)-duration(b.minutes) : 0);
  const featured = guides.find(g => g.id === "event-to-ticket" && !g.draft);
  const activeGuide = filtered.find(g => g.id === selected.id) ?? filtered[0];
  function duration(time: string) { const [m,s] = time.split(":").map(Number); return m*60+s; }
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.guidePrototype = "true";
    return () => { delete root.dataset.guidePrototype; urls.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  useEffect(() => { if (!isSuper) { setManage(false); setUploadOpen(false); setEditing(null); } }, [isSuper]);
  useEffect(() => {
    if (state !== "loading") return;
    const timer = window.setTimeout(() => setState("ready"), 900);
    return () => window.clearTimeout(timer);
  }, [state]);
  function resetFilters() { setQuery(""); setTopic("All guides"); }
  function openGuide(g: Guide) { setSelected(g); if (choice !== 2) setWatch(g); }
  function openUpload(g: Guide | null = null) { setEditing(g); setFile(null); setFileError(""); setUploadOpen(true); }
  function chooseFile(next: File | null) {
    setFileError(""); setFile(null);
    if (!next) return;
    if (!["video/mp4", "video/webm"].includes(next.type)) { setFileError("Choose an MP4 or WebM video."); return; }
    if (next.size > 500 * 1024 * 1024) { setFileError("Video must be smaller than 500 MB. Choose a smaller file."); return; }
    setFile(next);
  }
  function saveGuide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isSuper) return;
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!title || !description) { setFileError("Add a title and description before continuing."); return; }
    if (!editing && !file) { setFileError("Choose a video before continuing."); return; }
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const draft = submitter?.value === "draft";
    const video = file ? URL.createObjectURL(file) : editing?.video;
    if (file && video) urls.current.push(video);
    const guide: Guide = { ...editing, id: editing?.id ?? crypto.randomUUID(), title, description, topic: String(form.get("topic")), minutes: editing?.minutes ?? "0:00", video, draft, uploaded: true, image: file ? undefined : editing?.image };
    if (video && file) {
      const metadata = document.createElement("video");
      metadata.preload = "metadata"; metadata.src = video;
      metadata.onloadedmetadata = () => { const seconds = Math.round(metadata.duration); if (Number.isFinite(seconds)) setGuides(all => all.map(g => g.id === guide.id ? { ...g, minutes: `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}` } : g)); metadata.removeAttribute("src"); metadata.load(); };
    }
    setGuides(all => editing ? all.map(g => g.id === editing.id ? guide : g) : [guide, ...all]);
    setUploadOpen(false); setEditing(null); setState("ready"); resetFilters();
    setNotice(draft ? "Draft saved in this preview. Org admins cannot see it." : "Guide published in this preview. Switch to Org admin to see it.");
    if (selected.id === guide.id) setSelected(guide);
  }
  const filters = <div className="gd-tools">
    <div className="gd-search"><Search aria-hidden="true" /><Input ref={search} type="search" aria-label="Search guides" placeholder="Search by title, topic, or description…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="gd-clear" onClick={() => { setQuery(""); search.current?.focus(); }} aria-label="Clear search"><X /></button>}</div>
    <label className="gd-sort"><span className="gd-sr">Sort guides</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="recommended">Recommended</option><option value="az">Title A–Z</option><option value="shortest">Shortest first</option></select><ChevronDown /></label>
  </div>;
  const topicFilters = <div className="gd-topics" aria-label="Filter by topic">{topics.map(t => <button key={t} aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>)}</div>;
  const count = <p className="gd-count" role="status">{filtered.length} {filtered.length === 1 ? "guide" : "guides"}{topic !== "All guides" ? ` in ${topic}` : " available"}{query ? ` matching “${query}”` : ""}</p>;
  const listRow = (g: Guide, image = true) => <button key={g.id} className="gd-list-row" onClick={() => openGuide(g)}>{image && <Thumbnail guide={g} compact />}<div className="gd-row-copy"><span className="gd-topic-label">{g.topic}</span><h3>{g.title}</h3><p>{g.description}</p></div><span className="gd-row-duration">{g.minutes}</span><Play className="gd-row-play" aria-hidden="true" /></button>;
  const empty = <div className="gd-empty"><Search /><h2>{state === "empty" ? "Guides are on their way" : "No matching guides"}</h2><p>{state === "empty" ? "Video guides published by Race Pace will appear here." : "Try a shorter search, another topic, or clear your filters."}</p>{state !== "empty" && <Button variant="outline" onClick={resetFilters}>Clear filters</Button>}{state === "empty" && isSuper && <Button onClick={() => openUpload()}>Upload first guide</Button>}</div>;
  const sidebarContent = <>
<div className="gd-brand"><img src={`${assets}logo.png`} width="40" height="22" alt="" /><div><strong>Race Pace</strong><span>Organization admin</span></div><button className="gd-mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X /></button></div>
        <nav aria-label="Admin navigation">{[[LayoutDashboard,"Dashboard"],[CalendarDays,"Events"],[ClipboardList,"Registrations"],[CreditCard,"Payments"],[PackageCheck,"Race kits"],[QrCode,"Check-in"],[Users,"Team"],[Settings,"Settings"],[BookOpen,"Guide"]].map(([Icon,label]) => { const I=Icon as typeof BookOpen; return <button key={String(label)} className={label === "Guide" ? "gd-nav-active" : ""} aria-current={label === "Guide" ? "page" : undefined} onClick={() => {setMenuOpen(false);if(label !== "Guide")setNotice(`${label} is outside this Guide design preview.`);}}><I /><span>{String(label)}</span>{label === "Guide" && <ChevronRight />}</button>;})}</nav>
        <div className="gd-sidebar-foot"><div className="gd-avatar">RP</div><div><strong>Preview account</strong><span>{isSuper ? "Super admin" : "Org admin"}</span></div></div>
  </>;
  return <div className="gd-root">
    <a className="gd-skip" href="#guide-content">Skip to guides</a>
    <div className="gd-proposal-bar"><span><strong>Guide</strong> / Design proposal</span><div><label>Preview as <select aria-label="Preview role" value={role} onChange={e => setRole(e.target.value as "org" | "super")}><option value="org">Org admin</option><option value="super">Super admin</option></select></label><label className="gd-state-control"><span className="gd-sr">Preview state</span><select aria-label="Preview state" value={state} onChange={e => setState(e.target.value as typeof state)}><option value="ready">Ready</option><option value="loading">Loading</option><option value="empty">Empty library</option><option value="error">Load error</option></select></label></div></div>
    <nav className="gd-choice-nav" aria-label="Design choices">{choices.map((c,i) => <button key={c.name} aria-pressed={choice === i} onClick={() => {setChoice(i);setManage(false);resetFilters();setNotice("");}}><span>{i+1}</span>{c.name}{i === 0 && <small>Recommended</small>}</button>)}</nav>
    <div className="gd-shell">
      <aside className="gd-sidebar">{sidebarContent}</aside>
      <main id="guide-content" className={`gd-main gd-choice-${choice}`} tabIndex={-1}>
        <div className="gd-context"><button ref={menuTrigger} className="gd-mobile-menu" aria-label="Open admin navigation" onClick={() => setMenuOpen(true)}><Menu /></button><span>Organization <ChevronRight /> Guide</span><span className="gd-shared"><ShieldCheck /> From Race Pace</span></div>
        <header className="gd-header"><div><h1>Guide</h1><p>Know your way around. Run your race with confidence.</p></div>{isSuper && <div className="gd-actions"><Button variant="outline" onClick={() => {setManage(!manage);resetFilters();}}>{manage ? "Browse guides" : "Manage guides"}</Button><Button onClick={() => openUpload()}><Plus />Upload video</Button></div>}</header>
        <div className="gd-design-note"><strong>{choices[choice].name}</strong><span>{choices[choice].summary}</span></div>
        {notice && <div className="gd-notice" role="status"><Check /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification"><X /></button></div>}
        {filters}
        {choice !== 1 && topicFilters}
        {state === "loading" ? <div className="gd-loading" role="status"><FileVideo /><p>Loading video guides…</p><div /><div /><div /></div> : state === "error" ? <div className="gd-empty"><FileVideo /><h2>Guides couldn’t load</h2><p>Check your connection, then try again.</p><Button onClick={() => setState("loading")}>Try again</Button></div> : state === "empty" || !filtered.length ? empty : manage && isSuper ? <section className="gd-management"><div className="gd-section-title"><h2>Manage guides</h2>{count}</div><p>Published guides are visible to org admins. Drafts are visible only to super admins.</p>{filtered.map(g => <div key={g.id} className="gd-manage-row"><FileVideo /><div><h3>{g.title}</h3><p>{g.topic} · {g.draft ? "Draft" : "Published"}</p></div><Button variant="outline" onClick={() => openUpload(g)}>Edit guide</Button></div>)}</section> : <>
          {choice === 0 && <>
            {!query && topic === "All guides" && featured && <section className="gd-feature"><button className="gd-feature-image" onClick={() => openGuide(featured)} aria-label={`Watch ${featured.title}`}><Thumbnail guide={featured} /></button><div className="gd-feature-copy"><span className="gd-topic-label">{featured.topic}</span><h2>{featured.title}</h2><p>{featured.description}</p><Button onClick={() => openGuide(featured)}><Play />Watch walkthrough <span>{featured.minutes}</span></Button></div></section>}
            <div className="gd-section-title"><h2>{query ? "Search results" : "Browse video guides"}</h2>{count}</div><div className="gd-video-grid">{filtered.map(g => <button className="gd-video-card" key={g.id} onClick={() => openGuide(g)}><Thumbnail guide={g} /><span className="gd-topic-label">{g.topic}</span><h3>{g.title}</h3><p>{g.description}</p></button>)}</div>
          </>}
          {choice === 1 && <div className="gd-index"><aside><h2>Topics</h2>{topics.map(t => <button key={t} aria-pressed={topic === t} onClick={() => setTopic(t)}><span>{t}</span><span>{available.filter(g => t === "All guides" || g.topic === t).length}</span></button>)}</aside><section><div className="gd-section-title"><h2>{topic === "All guides" ? "Find your way around" : topic}</h2>{count}</div>{topics.slice(1).filter(t => filtered.some(g => g.topic === t)).map(t => {const I=iconFor(t);return <section className="gd-index-section" key={t}><h2><I />{t}</h2>{filtered.filter(g => g.topic === t).map(g => listRow(g,false))}</section>;})}</section></div>}
          {choice === 2 && <div className="gd-watch-desk"><section><Player guide={activeGuide} /><div className="gd-watch-copy"><span className="gd-topic-label">{activeGuide.topic} · {activeGuide.minutes}</span><h2>{activeGuide.title}</h2><p>{activeGuide.description}</p><div className="gd-recording-note">{activeGuide.video ? "Local video preview" : "Illustrative lesson; recording not supplied"}</div></div></section><aside><div className="gd-section-title"><h2>Video guides</h2>{count}</div>{filtered.map(g => <button key={g.id} className={`gd-queue-row ${activeGuide.id === g.id ? "gd-queue-active" : ""}`} aria-pressed={activeGuide.id === g.id} onClick={() => setSelected(g)}><Thumbnail guide={g} compact /><div><h3>{g.title}</h3><span>{g.topic} · {g.minutes}</span></div><Play /></button>)}</aside></div>}
          {choice === 3 && <section className="gd-task-finder"><div className="gd-section-title"><h2>{query ? "Matching walkthroughs" : "What do you need to do?"}</h2>{count}</div>{query || topic !== "All guides" ? filtered.map(g => listRow(g)) : <><div className="gd-task-lead"><div><h2>Get an event ready.</h2><p>Build the event, set your distances, and open registration.</p><Button variant="outline" onClick={() => {setTopic("Events");search.current?.focus();}}>Show event guides <ArrowRight /></Button></div><div>{filtered.filter(g => g.topic === "Events").map(g => listRow(g,false))}</div></div><div className="gd-task-groups">{[{title:"Manage your runners",description:"Registration records and payment questions.",topics:["Registrations","Payments"]},{title:"Prepare for race day",description:"Check-in and race kit release.",topics:["Race day"]},{title:"Set up your organization",description:"The full workflow, team access, and settings.",topics:["Getting started","Team & settings"]}].map(group => <section key={group.title}><h2>{group.title}</h2><p>{group.description}</p>{filtered.filter(g => group.topics.includes(g.topic)).map(g => listRow(g,false))}</section>)}</div></>}</section>}
          {choice === 4 && <section className="gd-directory"><div className="gd-section-title"><h2>All video guides</h2>{count}</div><div className="gd-directory-head"><span>Video & description</span><span>Duration</span></div>{filtered.map(g => listRow(g))}</section>}
        </>}
        <footer className="gd-footer"><BookOpen /><span>Guides from Race Pace, available to every organization.</span></footer>
        <div className="gd-preview-footer">Local design proposal · Sample titles and durations, except existing 8:43 walkthrough. Uploads stay in this browser until reload.</div>
      </main>
    </div>
    <Dialog open={menuOpen} onOpenChange={setMenuOpen}><DialogContent className="gd-dialog gd-mobile-nav-dialog" showCloseButton={false} onCloseAutoFocus={e => {e.preventDefault();menuTrigger.current?.focus();}}><DialogHeader className="gd-sr"><DialogTitle>Admin navigation</DialogTitle><DialogDescription>Choose an admin section or close navigation.</DialogDescription></DialogHeader><div className="gd-sidebar gd-sidebar-open">{sidebarContent}</div></DialogContent></Dialog>
    <Dialog open={Boolean(watch)} onOpenChange={open => {if(!open)setWatch(null);}}><DialogContent className="gd-dialog gd-watch-dialog"><DialogHeader><DialogTitle>{watch?.title}</DialogTitle><DialogDescription>{watch?.description}</DialogDescription></DialogHeader>{watch && <><Player guide={watch} /><p className="gd-recording-note">{watch.video ? "Local video preview" : "Illustrative lesson; recording not supplied"}</p><div className="gd-related"><h3>More in {watch.topic}</h3>{guides.filter(g => !g.draft && g.topic === watch.topic && g.id !== watch.id).map(g => <button key={g.id} onClick={() => setWatch(g)}>{g.title}<ChevronRight /></button>)}</div></>}</DialogContent></Dialog>
    <Dialog open={uploadOpen && isSuper} onOpenChange={open => {setUploadOpen(open);if(!open){setEditing(null);setFile(null);setFileError("");}}}><DialogContent className="gd-dialog gd-upload-dialog" onOpenAutoFocus={e => {e.preventDefault();titleInput.current?.focus();}}><DialogHeader><DialogTitle>{editing ? "Edit guide" : "Upload video guide"}</DialogTitle><DialogDescription>{editing ? "Update the title, description, or video." : "Add a video to help org admins navigate Race Pace."}</DialogDescription></DialogHeader><form onSubmit={saveGuide} key={editing?.id ?? "new"}>
      <Field className="gd-field" label="Title" ref={titleInput} name="title" maxLength={120} required defaultValue={editing?.title} placeholder="e.g. Create and publish your event" />
      <label className="gd-field">Description<Textarea name="description" maxLength={2000} required rows={3} defaultValue={editing?.description} placeholder="What will org admins learn in this video?" /></label>
      <label className="gd-field">Topic<select name="topic" defaultValue={editing?.topic ?? "Getting started"}>{topics.slice(1).map(t => <option key={t}>{t}</option>)}</select></label>
      <label className="gd-upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault();chooseFile(e.dataTransfer.files[0] ?? null);}}><Upload /><strong>{file ? file.name : editing ? "Choose a replacement video (optional)" : "Choose a video or drop it here"}</strong><span>MP4 or WebM · Up to 500 MB</span><Input type="file" accept="video/mp4,video/webm" aria-label="Video file" onChange={e => chooseFile(e.target.files?.[0] ?? null)} /></label>
      {fileError && <p className="gd-form-error" role="alert">{fileError}</p>}
      <p className="gd-upload-note"><ShieldCheck />Only super admins can publish guides. Org admins can search and watch published videos.</p>
      <p className="gd-recording-note">Prototype: files and changes stay in memory until reload. Nothing uploads to Race Pace.</p>
      <div className="gd-form-actions"><Button type="button" variant="ghost" onClick={() => setUploadOpen(false)}>Cancel</Button><Button type="submit" name="action" value="draft" variant="outline" disabled={!editing && !file}>Save draft</Button><Button type="submit" name="action" value="publish" disabled={!editing && !file}>{editing ? "Publish changes" : "Publish guide"}</Button></div>
    </form></DialogContent></Dialog>
  </div>;
}
