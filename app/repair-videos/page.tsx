"use client";
import { useEffect, useMemo, useState } from "react";

type Video = { caption?: string | null; group_title?: string | null; content_type?: string | null; url?: string | null };
type Snapshot = {
  roNumber: number; customerName: string; vehicle: string; videos: Video[];
  businessName: string; businessAddress?: string; businessPhone?: string; businessEmail?: string; logoUrl?: string | null;
  primaryColor?: string; accentColor?: string; secondaryColor?: string;
};

export default function RepairVideosPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [message, setMessage] = useState("Loading your videos…");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    if (!token) { setMessage("This video link is invalid."); return; }
    fetch(`/.netlify/functions/repair-videos?token=${encodeURIComponent(token)}`).then(async (response) => {
      const body = await response.json() as { snapshot?: Snapshot; error?: string };
      if (!response.ok || !body.snapshot) throw new Error(body.error || "Videos not found.");
      setSnapshot(body.snapshot); setMessage("");
    }).catch((error: Error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    const root = document.documentElement;
    if (snapshot.primaryColor) root.style.setProperty("--blue", snapshot.primaryColor);
    if (snapshot.accentColor) root.style.setProperty("--red", snapshot.accentColor);
    if (snapshot.secondaryColor) root.style.setProperty("--navy", snapshot.secondaryColor);
  }, [snapshot]);

  // Group clips under the service they were recorded for, keeping the order they were sent in.
  const sections = useMemo(() => {
    const result: Array<{ title: string; videos: Video[] }> = [];
    for (const video of snapshot?.videos ?? []) {
      const title = video.group_title || "Repair video";
      const existing = result.find((section) => section.title === title);
      if (existing) existing.videos.push(video); else result.push({ title, videos: [video] });
    }
    return result;
  }, [snapshot]);

  return <main className="approval-shell"><article className="approval-card document-page">
    {!snapshot ? <div className="notice">{message}</div> : <>
      <header className="document-header">
        <div>
          {snapshot.logoUrl ? <img className="document-logo" src={snapshot.logoUrl} alt={snapshot.businessName} /> : <h2 className="document-logo-text">{snapshot.businessName}</h2>}
          {snapshot.businessAddress && <p>{snapshot.businessAddress}</p>}
          <p>{[snapshot.businessPhone, snapshot.businessEmail].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="document-title"><h1>Repair videos</h1><p>{snapshot.vehicle}</p><strong>RO #{String(snapshot.roNumber).padStart(4, "0")}</strong></div>
      </header>
      <p className="approval-recommendation">Hi {snapshot.customerName}, here are the videos our technician recorded while working on your vehicle.</p>
      {sections.length === 0 && <div className="notice">There are no videos on this repair order.</div>}
      {sections.map((section) => <section key={section.title} className="approval-service">
        <div className="approval-service-heading"><div><h3>{section.title}</h3></div></div>
        <div className="estimate-video-grid">{section.videos.map((video, index) => <figure className="estimate-video" key={`${section.title}-${index}`}>
          {video.url
            ? <video src={video.url} controls playsInline preload="metadata" />
            : <div className="notice">This video isn't available right now.</div>}
          {video.caption && <figcaption>{video.caption}</figcaption>}
        </figure>)}</div>
      </section>)}
    </>}
  </article></main>;
}
