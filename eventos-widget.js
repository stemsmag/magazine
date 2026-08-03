/**
 * eventos-widget.js
 * ------------------
 * Inserta los últimos N eventos de events.json dentro de cualquier
 * columna/contenedor de otra página del mismo sitio (ej. la portada STEMS).
 *
 * USO:
 * 1. En el HTML de la portada, coloca un contenedor donde quieres la columna:
 *      <div id="eventos-column"></div>
 *
 * 2. Incluye este script antes de cerrar </body>:
 *      <script src="ruta/a/calendario-musical/eventos-widget.js"></script>
 *      <script>
 *        renderEventosWidget({
 *          containerId: 'eventos-column',
 *          jsonPath: 'ruta/a/calendario-musical/events.json',
 *          calendarPath: 'ruta/a/calendario-musical/index.html', // link "ver todos"
 *          count: 4
 *        });
 *      </script>
 *
 * RUTAS:
 * - Si ambos sitios viven en el MISMO repo (misma URL de GitHub Pages),
 *   usa una ruta relativa normal, ej: '../calendario-musical/events.json'.
 * - Si son repos/sitios de GitHub Pages DISTINTOS, usa la URL completa:
 *   'https://tuusuario.github.io/calendario-musical/events.json'
 *   (GitHub Pages sirve los archivos con CORS abierto, así que el fetch
 *   entre dominios distintos funciona sin configuración extra).
 */

const TYPE_LABEL = {toque:'Toque', single:'Sencillo', album:'Álbum', video:'Video oficial', promo:'Promo'};
const TYPE_ACCENT = {toque:'--magenta', single:'--teal', album:'--amber', video:'--orange', promo:'--cream-dim'};

async function renderEventosWidget(opts){
  const {
    containerId,
    jsonPath = 'events.json',
    calendarPath = 'index.html',
    count = 4
  } = opts;

  const container = document.getElementById(containerId);
  if(!container){
    console.error(`eventos-widget: no se encontró #${containerId}`);
    return;
  }

  container.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted,#B49A7A);">Cargando eventos…</div>`;

  let events = [];
  try{
    const res = await fetch(jsonPath + '?_=' + Date.now());
    const data = await res.json();
    events = data.events || [];
  }catch(err){
    console.error('eventos-widget: no se pudo cargar', jsonPath, err);
    container.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted,#B49A7A);">No se pudieron cargar los eventos.</div>`;
    return;
  }

  // Últimos N ingresados = los últimos elementos del arreglo del JSON.
  // (Convención: nuevos eventos se agregan al final de events.json)
  const latest = events.slice(-count).reverse();

  if(!latest.length){
    container.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted,#B49A7A);">Sin eventos por ahora.</div>`;
    return;
  }

  const fmt = new Intl.DateTimeFormat('es-ES', {day:'2-digit', month:'short'});

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${latest.map(e => {
        const dateObj = new Date(e.date + 'T00:00:00');
        const accent = `var(${TYPE_ACCENT[e.type] || '--cream-dim'})`;
        return `
        <a href="${calendarPath}" style="
          display:flex; gap:12px; align-items:center; text-decoration:none;
          background:var(--card,#062C42); border:1px solid var(--line,rgba(244,232,211,.14));
          border-left:3px solid ${accent}; border-radius:8px; padding:10px 12px;
        ">
          ${e.image ? `<img src="${e.image}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;flex:0 0 44px;background:var(--brown-light,#052A3D);" onerror="this.style.display='none'">` : ''}
          <div style="min-width:0;">
            <div style="font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:${accent};margin-bottom:2px;">
              ${TYPE_LABEL[e.type] || e.type} · ${fmt.format(dateObj)}
            </div>
            <div style="font-family:'Inter',sans-serif;font-size:13px;font-weight:600;color:var(--cream,#F4E8D3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(e.title)}
            </div>
          </div>
        </a>`;
      }).join('')}
    </div>
    <a href="${calendarPath}" style="
      display:inline-block; margin-top:14px; font-family:'JetBrains Mono',monospace;
      font-size:11px; letter-spacing:.05em; color:var(--teal,#2FB6A8);
    ">Ver calendario completo →</a>
  `;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
