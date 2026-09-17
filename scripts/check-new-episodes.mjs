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

// El título debe mencionar tanto "Latam/Latinoamericano" como "Electrónica"
// (en cualquier orden) para considerarse parte de la serie. Ajusta estas
// expresiones si cambia el naming de tus episodios.
const SERIES_KEYWORDS_REGION = /latam|latino\s*americ/i;
const SERIES_KEYWORDS_GENERO = /electr[oó]nic/i;

// Duración máxima (en segundos) para considerar un video "Short".
// YouTube define Shorts como videos de 3 minutos o menos.
const SHORT_MAX_SECONDS = 180;

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

  const candidatos = feedVideos.filter((v) => {
    if (existingIds.has(v.videoId)) return false;
    if (!isSeriesTitle(v.title)) {
      console.log(`Omitido (no parece de la serie): "${v.title}" (${v.videoId})`);
      return false;
    }
    return true;
  });

  const nuevos = [];
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (apiKey && candidatos.length > 0) {
    const durations = await getDurationsSeconds(
      candidatos.map((v) => v.videoId),
      apiKey
    );
    for (const video of candidatos) {
      const seconds = durations[video.videoId];
      if (seconds !== undefined && seconds <= SHORT_MAX_SECONDS) {
        console.log(
          `Omitido (Short, ${seconds}s): "${video.title}" (${video.videoId})`
        );
        continue;
      }
      nuevos.push(video);
    }
  } else {
    if (candidatos.length > 0) {
      console.warn(
        "YOUTUBE_API_KEY no configurada: usando detección de Shorts menos confiable (redirect). Considera agregar el secret YOUTUBE_API_KEY."
      );
    }
    for (const video of candidatos) {
      if (await isShort(video.videoId)) {
        console.log(`Omitido (es un Short): "${video.title}" (${video.videoId})`);
        continue;
      }
      nuevos.push(video);
    }
  }

  if (nuevos.length === 0) {
    console.log("Sin episodios nuevos que cumplan los filtros. episodios.json queda igual.");
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

// Consulta la duración real de cada video vía YouTube Data API v3.
// Devuelve un mapa { videoId: segundos }. Requiere una API key gratuita
// (Google Cloud Console -> habilitar "YouTube Data API v3" -> credenciales).
async function getDurationsSeconds(videoIds, apiKey) {
  const ids = videoIds.join(",");
  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fallo al consultar YouTube Data API (status ${res.status}): ${body}`);
  }
  const json = await res.json();
  const result = {};
  for (const item of json.items || []) {
    result[item.id] = parseIsoDuration(item.contentDetails.duration);
  }
  return result;
}

function parseIsoDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (parseInt(h || 0, 10) * 3600) + (parseInt(m || 0, 10) * 60) + parseInt(s || 0, 10);
}

function isSeriesTitle(title) {
  return SERIES_KEYWORDS_REGION.test(title) && SERIES_KEYWORDS_GENERO.test(title);
}

// Truco sin API key: al pedir /shorts/<id>, YouTube responde 200 y se queda
// en esa página si el video SÍ es un Short; si es un video normal, redirige
// (30x) hacia /watch?v=<id>. Si la verificación falla por red, no se excluye
// el video (mejor un falso positivo revisable que perder un episodio real).
async function isShort(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; EpisodeChecker/1.0)" },
    });
    if (res.status >= 300 && res.status < 400) return false; // redirigido a /watch -> no es Short
    if (res.status === 200) return true; // se quedó en /shorts -> sí es Short
    console.warn(`Status inesperado (${res.status}) verificando Short para ${videoId}; se incluye por defecto.`);
    return false;
  } catch (err) {
    console.warn(`No se pudo verificar Short para ${videoId} (${err.message}); se incluye por defecto.`);
    return false;
  }
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
