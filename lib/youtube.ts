export function getYouTubeEmbedUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else if (/^\/(embed|shorts)\//.test(url.pathname)) id = url.pathname.split("/")[2];
  }
  return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}
