"use client";

export function LegacySite({ src, title }: { src: string; title: string }) {
  return <main className="site-frame"><iframe src={src} title={title} /></main>;
}
