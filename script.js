"use strict";

/* ===================================================================
   Sprite Sheet Editor Pro
   Separated into index.html + style.css + script.js
   Features: unpack, add, delete, replace sprites, repack with code
   =================================================================== */

let spriteData = {};
let _pendingFile = null;
let _replaceTarget = null;

/* ===================================================================
   UTILITY
   =================================================================== */

function standardizeRect(rectData) {
  if (!rectData) return [0, 0, 0, 0];
  if (Array.isArray(rectData)) return rectData;
  if (typeof rectData === 'string') {
    const matches = rectData.match(/-?\d+(\.\d+)?/g);
    return matches ? matches.map(Number) : [0, 0, 0, 0];
  }
  if (typeof rectData === 'object') {
    return [rectData.x || 0, rectData.y || 0, rectData.w || 0, rectData.h || 0];
  }
  return [0, 0, 0, 0];
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ===================================================================
   PLIST PARSER
   =================================================================== */

function parsePlistToJSON(xmlStr) {
  const cleanXml = xmlStr.replace(/<!DOCTYPE[^>]*>/gi, '');
  const doc = new DOMParser().parseFromString(cleanXml, 'text/xml');

  if (doc.querySelector('parsererror'))
    throw new Error('El archivo .plist está corrupto.');

  function parseNode(node) {
    if (!node) return null;
    const tag = node.nodeName.toLowerCase();

    if (tag === 'dict') {
      const obj = {};
      const keys = Array.from(node.children).filter(c =>
        c.nodeName.toLowerCase() === 'key'
      );
      keys.forEach(k => {
        obj[k.textContent] = parseNode(k.nextElementSibling);
      });
      return obj;
    }
    if (tag === 'array')
      return Array.from(node.children).map(parseNode);
    if (tag === 'string') return node.textContent;
    if (tag === 'true') return true;
    if (tag === 'false') return false;
    if (tag === 'integer' || tag === 'real') return Number(node.textContent);
    return null;
  }

  const dictNode = doc.getElementsByTagName('dict')[0];
  if (!dictNode) throw new Error('Estructura Plist inválida.');
  return parseNode(dictNode);
}

/* ===================================================================
   FNF XML PARSER (Friday Night Funkin' format)
   =================================================================== */

function parseFNFXML(xmlStr) {
  const cleanXml = xmlStr.replace(/<!DOCTYPE[^>]*>/gi, '');
  const doc = new DOMParser().parseFromString(cleanXml, 'text/xml');

  if (doc.querySelector('parsererror'))
    throw new Error('El archivo XML está corrupto.');

  const atlas = doc.querySelector('TextureAtlas');
  if (!atlas)
    throw new Error('Formato XML inválido: no se encontró TextureAtlas.');

  const imagePath = atlas.getAttribute('imagePath') || '';
  const subTextures = atlas.querySelectorAll('SubTexture');

  const frames = {};
  for (const st of subTextures) {
    const name = st.getAttribute('name');
    const x = parseFloat(st.getAttribute('x')) || 0;
    const y = parseFloat(st.getAttribute('y')) || 0;
    const w = parseFloat(st.getAttribute('width')) || 0;
    const h = parseFloat(st.getAttribute('height')) || 0;
    const rotated = st.getAttribute('rotated') === 'true';

    if (w === 0 || h === 0) continue;

    frames[name] = {
      rect: [x, y, w, h],
      rotated,
    };
  }

  return { frames, imagePath };
}

/* ===================================================================
   UNPACK
   =================================================================== */

function unpack() {
  const imgFile = document.getElementById('imageLoader').files[0];
  const dataFile = document.getElementById('dataLoader').files[0];
  const output = document.getElementById('output');

  if (!imgFile || !dataFile) {
    alert('Subí ambos archivos.');
    return;
  }

  output.innerHTML = '<p class="loading-msg">Procesando...</p>';
  document.getElementById('manageSection').style.display = 'none';

  const readerData = new FileReader();

  readerData.onload = function (e) {
    try {
      let framesData = {};

      if (dataFile.name.toLowerCase().endsWith('.plist')) {
        const plistData = parsePlistToJSON(e.target.result);
        if (!plistData || !plistData.frames)
          throw new Error('No se encontraron frames en el Plist.');

        for (const key in plistData.frames) {
          const f = plistData.frames[key];
          framesData[key] = {
            rect: standardizeRect(f.textureRect || f.frame),
            rotated: f.textureRotated || f.rotated || false,
          };
        }
      } else if (dataFile.name.toLowerCase().endsWith('.xml')) {
        const fnfData = parseFNFXML(e.target.result);
        if (!fnfData || Object.keys(fnfData.frames).length === 0)
          throw new Error('No se encontraron frames en el XML.');

        framesData = fnfData.frames;
      } else {
        const jsonData = JSON.parse(e.target.result);
        let framesSource = null;

        if (jsonData.frames) {
          framesSource = jsonData.frames;
        } else if (
          jsonData.textures &&
          Array.isArray(jsonData.textures) &&
          jsonData.textures[0].frames
        ) {
          framesSource = jsonData.textures[0].frames;
        }

        if (!framesSource)
          throw new Error('No se encontró la lista de imágenes en el JSON.');

        if (Array.isArray(framesSource)) {
          framesSource.forEach(f => {
            const key = f.filename || f.name;
            framesData[key] = {
              rect: standardizeRect(f.frame || f.textureRect),
              rotated: f.rotated || f.textureRotated || false,
            };
          });
        } else {
          for (const key in framesSource) {
            const f = framesSource[key];
            framesData[key] = {
              rect: standardizeRect(f.frame || f.textureRect),
              rotated: f.rotated || f.textureRotated || false,
            };
          }
        }
      }

      const readerImg = new FileReader();
      readerImg.onload = function (eImg) {
        const img = new Image();
        img.onload = function () {
          for (const name in framesData) {
            const f = framesData[name];
            const [x, y, origW, origH] = f.rect;
            const isRotated = f.rotated;

            if (origW === 0 || origH === 0) continue;

            const sheetW = isRotated ? origH : origW;
            const sheetH = isRotated ? origW : origH;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = origW;
            canvas.height = origH;

            ctx.save();
            if (isRotated) {
              ctx.translate(canvas.width / 2, canvas.height / 2);
              ctx.rotate((-90 * Math.PI) / 180);
              ctx.drawImage(
                img, x, y, sheetW, sheetH,
                -sheetW / 2, -sheetH / 2, sheetW, sheetH
              );
            } else {
              ctx.drawImage(img, x, y, sheetW, sheetH, 0, 0, sheetW, sheetH);
            }
            ctx.restore();

            spriteData[name] = {
              canvas,
              dataURL: canvas.toDataURL(),
              width: origW,
              height: origH,
            };
          }

          renderGallery();
          document.getElementById('manageSection').style.display = '';
        };
        img.onerror = () => {
          throw new Error('La imagen PNG no se pudo cargar.');
        };
        img.src = eImg.target.result;
      };
      readerImg.readAsDataURL(imgFile);
    } catch (error) {
      output.className = '';
      output.innerHTML =
        '<p class="error-msg">ERROR: ' + escapeHtml(error.message) + '</p>';
    }
  };

  readerData.onerror = () => {
    output.className = '';
    output.innerHTML = '<p class="error-msg">ERROR del sistema al leer archivo.</p>';
  };
  readerData.readAsText(dataFile);
}

/* ===================================================================
   GALLERY RENDERING
   =================================================================== */

function renderGallery() {
  const output = document.getElementById('output');
  const names = Object.keys(spriteData);

  document.getElementById('spriteCount').textContent =
    names.length + ' sprite' + (names.length !== 1 ? 's' : '');

  if (names.length === 0) {
    output.className = '';
    output.innerHTML =
      '<div class="empty-state"><p>Sin sprites todavía</p></div>';
    return;
  }

  output.className = 'gallery';

  let html = '';
  for (const name of names) {
    const s = spriteData[name];
    const en = escapeHtml(name);
    html +=
      '<div class="sprite-card" data-name="' + en + '">' +
        '<div class="thumb-wrap">' +
          '<img src="' + s.dataURL + '" alt="' + en + '" loading="lazy">' +
        '</div>' +
        '<div class="sprite-name" title="' + en + '">' + en + '</div>' +
        '<div class="card-actions">' +
          '<button class="replace-btn" data-action="replace"> Cambiar</button>' +
          '<button class="delete-btn" data-action="delete"> Eliminar</button>' +
          '<a class="dl-btn" download="' + en + '" href="' + s.dataURL + '">Descargar</a>' +
        '</div>' +
      '</div>';
  }

  output.innerHTML = html;
}

/* ---- Event delegation (named for self-capture) ---- */

function _onCardClick(e) {
  const action = e.target.dataset.action;
  if (!action) return;

  const card = e.target.closest('.sprite-card');
  if (!card) return;

  const name = card.dataset.name;
  if (action === 'delete') deleteSprite(name);
  else if (action === 'replace') openReplaceSprite(name);
}

document.addEventListener('click', _onCardClick);

/* ===================================================================
   SPRITE MANAGEMENT
   =================================================================== */

function openAddSprite() {
  _replaceTarget = null;
  const inp = document.getElementById('hiddenFileInput');
  inp.accept = 'image/png,image/gif,image/jpeg';
  inp.value = '';
  inp.click();
}

function openReplaceSprite(name) {
  _replaceTarget = name;
  const inp = document.getElementById('hiddenFileInput');
  inp.accept = 'image/png,image/gif,image/jpeg';
  inp.value = '';
  inp.click();
}

function _onFileInputChange(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (ev) {
    _pendingFile = { dataURL: ev.target.result, file };

    if (_replaceTarget) {
      replaceSprite(_replaceTarget, ev.target.result);
      _replaceTarget = null;
      _pendingFile = null;
    } else {
      showModal('Nuevo Sprite', ev.target.result, file.name);
    }
  };
  reader.readAsDataURL(file);
}

document.getElementById('hiddenFileInput').addEventListener('change', _onFileInputChange);

function replaceSprite(name, dataURL) {
  const img = new Image();
  img.onload = function () {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    spriteData[name] = {
      canvas,
      dataURL: canvas.toDataURL(),
      width: img.width,
      height: img.height,
    };
    renderGallery();
  };
  img.src = dataURL;
}

function deleteSprite(name) {
  if (!confirm(' Eliminar "' + name + '"?')) return;
  delete spriteData[name];
  renderGallery();
}

/* ===================================================================
   MODAL
   =================================================================== */

function showModal(title, previewURL, defaultName) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalPreview').src = previewURL;
  document.getElementById('modalName').value =
    defaultName.replace(/\.[^.]+$/, '') + '.png';
  document.getElementById('modalError').textContent = '';
  document.getElementById('modalOverlay').style.display = '';
  document.getElementById('modalName').focus();
  document.getElementById('modalName').select();
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  _pendingFile = null;
}

function confirmModal() {
  let name = document.getElementById('modalName').value.trim();
  const errEl = document.getElementById('modalError');

  if (!name) {
    errEl.textContent = 'El nombre no puede estar vacío.';
    return;
  }

  if (!/\.\w+$/.test(name)) name += '.png';

  if (spriteData[name]) {
    errEl.textContent = 'Ya existe un sprite con ese nombre.';
    return;
  }

  errEl.textContent = '';
  document.getElementById('modalOverlay').style.display = 'none';

  if (_pendingFile) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      spriteData[name] = {
        canvas,
        dataURL: canvas.toDataURL(),
        width: img.width,
        height: img.height,
      };

      _pendingFile = null;
      renderGallery();
    };
    img.src = _pendingFile.dataURL;
  }
}

/* ===================================================================
   SPRITE SHEET PACKER
   =================================================================== */

function createSpriteSheet(sprites, padding) {
  padding = padding || 2;
  const names = Object.keys(sprites);
  if (names.length === 0) return null;

  const items = names.map(name => ({
    name,
    canvas: sprites[name].canvas,
    w: sprites[name].canvas.width,
    h: sprites[name].canvas.height,
  }));

  // Sort by height descending for better packing
  items.sort((a, b) => b.h - a.h || b.w - a.w);

  const totalArea = items.reduce(
    (sum, item) => sum + (item.w + padding) * (item.h + padding),
    0
  );
  let sheetW = Math.max(32, Math.ceil(Math.sqrt(totalArea) * 1.1));

  let best = null;

  // Try a few widths to get reasonable packing
  for (let attempt = 0; attempt < 5; attempt++) {
    let x = padding,
      y = padding,
      rowH = 0;
    const placed = [];

    for (const item of items) {
      const iw = item.w + padding;
      const ih = item.h + padding;

      if (x + iw > sheetW && rowH > 0) {
        x = padding;
        y += rowH;
        rowH = 0;
      }

      if (x + iw > sheetW) {
        sheetW = x + iw + padding;
      }

      placed.push({ name: item.name, dx: x, dy: y, w: item.w, h: item.h });
      x += iw;
      rowH = Math.max(rowH, ih);
    }

    const sheetH = y + rowH + padding;
    const used = items.reduce((s, i) => s + i.w * i.h, 0);
    const eff = used / (sheetW * sheetH);

    if (!best || eff > best.efficiency) {
      best = { placed, width: sheetW, height: sheetH, efficiency: eff };
    }

    sheetW = Math.ceil(sheetW * 1.25);
  }

  // Draw atlas
  const atlas = document.createElement('canvas');
  atlas.width = best.width;
  atlas.height = best.height;
  const ctx = atlas.getContext('2d');
  ctx.clearRect(0, 0, best.width, best.height);

  const frames = {};
  for (const p of best.placed) {
    ctx.drawImage(sprites[p.name].canvas, p.dx, p.dy);
    frames[p.name] = {
      frame: { x: p.dx, y: p.dy, w: p.w, h: p.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: p.w, h: p.h },
      sourceSize: { w: p.w, h: p.h },
    };
  }

  return {
    canvas: atlas,
    frames,
    width: best.width,
    height: best.height,
    placed: best.placed,
  };
}

/* ===================================================================
   REPACK
   =================================================================== */

function repack() {
  const names = Object.keys(spriteData);
  if (names.length === 0) {
    alert('No hay sprites para empaquetar.');
    return;
  }

  const btn = document.getElementById('btnRepack');
  const origText = btn.textContent;
  btn.textContent = ' Generando...';
  btn.disabled = true;

  try {
    const result = createSpriteSheet(spriteData, 2);
    if (!result) { btn.textContent = origText; btn.disabled = false; return; }

    const zip = new JSZip();

    const pngBase64 = result.canvas.toDataURL('image/png').split(',')[1];
    zip.file('spritesheet.png', pngBase64, { base64: true });

    const meta = {
      image: 'spritesheet.png',
      size: { w: result.width, h: result.height },
      format: 'RGBA8888',
      scale: '1',
      app: 'SpriteSheetEditor',
    };

    const outFrames = {};
    for (const p of result.placed) {
      outFrames[p.name] = result.frames[p.name];
    }

    zip.file(
      'sprites.json',
      JSON.stringify({ frames: outFrames, meta }, null, 2)
    );

    zip.generateAsync({ type: 'blob' }).then(function(content) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = 'spritesheet_reempacado.zip';
      link.click();
      btn.textContent = origText;
      btn.disabled = false;
    }).catch(function(err) {
      alert('Error al generar el ZIP: ' + err);
      btn.textContent = origText;
      btn.disabled = false;
    });
  } catch (err) {
    alert('Error al generar el ZIP: ' + err);
    btn.textContent = origText;
    btn.disabled = false;
  }
}
