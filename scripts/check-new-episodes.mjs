// scripts/check-new-episodes.mjs
//
// Revisa el feed RSS público del canal de YouTube "LATAM Electrónica"
// y agrega a episodios.json cualquier video nuevo que no esté ya registrado.
//
// No requiere API key de YouTube: usa el feed RSS público que expone
// cualquier canal en https://www.youtube.com/feeds/videos.xml?channel_id=...
//
// Uso: node scripts/check-new-episodes.mjs [ruta-al-json]

import { readFile, writeFile } from "node:fs/promises";

const JSON_PATH = process.argv[2] || "episodios.json";

async function main() {
  const raw = await readFile(JSON_PATH, "utf-8");
  const data = JSON.parse(raw);

  const channelId = data.channelId;
  if (!channelId) {
    throw new Error("No se encontró 'channelId' en el JSON.");
  }

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(feedUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EpisodeChecker/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`No se pudo leer el feed RSS (status ${res.status}).`);
  }
  const xml = await res.text();

  const feedVideos = parseFeed(xml);
  if (feedVideos.length === 0) {
    console.log("El feed no devolvió entradas. Nada que hacer.");
    return;
  }

  const existingIds = new Set(data.episodios.map((e) => e.videoId));
  const nuevos = feedVideos.filter((v) => !existingIds.has(v.videoId));

  if (nuevos.length === 0) {
    console.log("Sin episodios nuevos. episodios.json queda igual.");
    return;
  }

  // Orden cronológico ascendente para que los más viejos se agreguen primero
  nuevos.sort((a, b) => new Date(a.published) - new Date(b.published));

  const nextNumericId = getNextNumericId(data.episodios);
  let counter = nextNumericId;

  for (const video of nuevos) {
    const numFromTitle = extractEpisodeNumber(video.title);
    const num = numFromTitle ?? counter++;
    const id = `ep${String(num).padStart(2, "0")}`;

    data.episodios.push({
      id,
      videoId: video.videoId,
      titulo: video.title,
      artista: "Varios Artistas",
      genero: "EDM / Electrónica", // TODO: revisar y ajustar manualmente
      fechaPublicacion: video.published.slice(0, 10),
      thumbnail: `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`,
      resenaHtml: `<p>TODO: escribir reseña para "${escapeHtml(
        video.title
      )}". Generado automáticamente, pendiente de edición.</p>`,
      fichaArtista: {
        redesSociales: data.youtubeChannelUrl || "",
        plataformasEscucha: "YouTube",
        lanzamientoDestacado: video.title,
      },
    });

    console.log(`Agregado: ${id} -> ${video.title} (${video.videoId})`);
  }

  await writeFile(JSON_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`Listo. Se agregaron ${nuevos.length} episodio(s) nuevo(s).`);

  // Para que el workflow sepa si hubo cambios y deba hacer commit
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, "changed=true\n", { flag: "a" });
  }
}

function parseFeed(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map((match) => {
    const block = match[1];
    const videoId = (block.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    const title = decodeXml(
      (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""
    );
    const published = (block.match(/<published>(.*?)<\/published>/) || [])[1];
    return { videoId, title, published };
  }).filter((v) => v.videoId && v.title && v.published);
}

function extractEpisodeNumber(title) {
  const match = title.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function getNextNumericId(episodios) {
  const nums = episodios
    .map((e) => parseInt(String(e.id).replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function decodeXml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
