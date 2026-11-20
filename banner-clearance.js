// Clearance banner for ageing laptops (Banner page): drawn on a canvas from the laptop's clearance details
// (AGEING BANNER MONITORING, see electron/ageing-monitoring.js): model, part number and specs from LAPTOP DB, the
// discounted cash price, the struck-out BEFORE price, the CLEARANCE SALE burst ("UP TO 50% OFF") and GET FREEBIE with
// its worth and the freebies' pictures joined by "+" (a freebie with no picture shows as a card with its name).
// One drawing serves the screen and Download: it is laid out on 1920×1080 and drawn at 3840×2160.
(function () {
  const W = 1920;
  const H = 1080;
  const SCALE = 2;
  const BLUE = '#1d22ff';
  const RED = '#ff1d25';
  const YELLOW = '#ffe600';
  const INK = '#1b1f2a';
  const FONT = "Outfit, 'Plus Jakarta Sans', Arial, sans-serif";
  const SKEW = Math.tan(14 * Math.PI / 180);
  const SPECS = [['PROCESSOR', 190, 405], ['STORAGE', 605, 405], ['GRAPHICS', 190, 520], ['RESOLUTION', 605, 520], ['MEMORY', 190, 636], ['OS', 605, 636]];

  const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const font = (weight, size) => `${weight} ${size}px ${FONT}`;

  // A box leaning like the banner's tabs (x, y: top-left of the upright box).
  function slanted(g, x, y, w, h) {
    const o = SKEW * h / 2;
    g.beginPath();
    g.moveTo(x + o, y); g.lineTo(x + w + o, y); g.lineTo(x + w - o, y + h); g.lineTo(x - o, y + h);
    g.closePath();
  }
  // The largest font size (from size down) at which text fits width.
  function fitSize(g, text, weight, size, width, spacing = 0) {
    for (; size > 14; size -= 1) {
      g.font = font(weight, size);
      g.letterSpacing = `${spacing * size / 100}px`;
      if (g.measureText(text).width <= width) break;
    }
    return size;
  }
  function centred(g, text, x, y, weight, size, color, width, spacing = 0) {
    const s = width ? fitSize(g, text, weight, size, width, spacing) : size;
    g.font = font(weight, s);
    g.letterSpacing = `${spacing * s / 100}px`;
    g.fillStyle = color;
    g.textAlign = 'center';
    g.fillText(text, x, y);
    g.letterSpacing = '0px';
    return s;
  }

  function background(g) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#ffffff'); sky.addColorStop(0.38, '#f4f9ff'); sky.addColorStop(1, '#d9ebff');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // faint hexagons, fading in towards the bottom
    g.save();
    const fade = g.createLinearGradient(0, 330, 0, H);
    fade.addColorStop(0, 'rgba(185,214,245,0)'); fade.addColorStop(0.45, 'rgba(185,214,245,.7)'); fade.addColorStop(1, 'rgba(185,214,245,.7)');
    g.strokeStyle = fade; g.lineWidth = 2;
    const r = 46, dx = r * Math.sqrt(3);
    for (let row = 0, y = 330; y < H + r; row += 1, y += r * 1.5) {
      for (let x = (row % 2) * dx / 2 - dx; x < W + dx; x += dx) {
        g.beginPath();
        for (let k = 0; k < 6; k += 1) {
          const a = Math.PI / 3 * k + Math.PI / 6;
          g[k ? 'lineTo' : 'moveTo'](x + r * Math.cos(a), y + r * Math.sin(a));
        }
        g.closePath(); g.stroke();
      }
    }
    g.restore();
    // two soft light bands
    g.save();
    for (const [x, alpha] of [[1000, 0.75], [1500, 0.45]]) {
      g.save(); g.translate(x + 210, 540); g.rotate(28 * Math.PI / 180);
      const band = g.createLinearGradient(-210, 0, 210, 0);
      band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.5, `rgba(255,255,255,${alpha})`); band.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = band; g.fillRect(-210, -800, 420, 1600);
      g.restore();
    }
    g.restore();
  }

  function logo(g, image) {
    if (image && image.naturalWidth) {
      const w = 340, h = w * image.naturalHeight / image.naturalWidth;
      g.drawImage(image, 70, 62 + Math.max(0, (52 - h) / 2), w, h);
    } else {
      centred(g, 'GIGAHERTZ', 240, 108, 800, 56, BLUE, 340);
    }
  }

  function titleAndSpecs(g, c) {
    centred(g, (c.model || '').toUpperCase(), 605, 300, 800, 104, BLUE, 900, -2.5);
    centred(g, c.partNumber || '', 605, 362, 500, 40, '#2b2f3a', 860);
    for (const [label, x, y] of SPECS) {
      slanted(g, x, y, 405, 92);
      g.fillStyle = 'rgba(255,255,255,.94)'; g.fill();
      g.lineWidth = 3; g.strokeStyle = BLUE; g.stroke();
      slanted(g, x + 96, y - 14, 212, 36);
      g.fillStyle = BLUE; g.fill();
      centred(g, label, x + 202, y + 12, 700, 23, '#fff');
      centred(g, (c.specs && c.specs[label]) || '—', x + 202, y + 66, 800, 34, BLUE, 335);
    }
  }

  function price(g, c) {
    // "Discounted Price • Cash Price" tab
    g.font = font(800, 28);
    const first = 'Discounted Price • ', second = 'Cash Price';
    const w1 = g.measureText(first).width, w2 = g.measureText(second).width;
    slanted(g, 248, 752, w1 + w2 + 44, 52);
    g.fillStyle = RED; g.fill();
    g.textAlign = 'left';
    g.fillStyle = '#fff'; g.fillText(first, 270, 788);
    g.fillStyle = YELLOW; g.fillText(second, 270 + w1, 788);
    // the price
    g.save();
    g.shadowColor = 'rgba(20,10,120,.25)'; g.shadowBlur = 20; g.shadowOffsetY = 10;
    slanted(g, 228, 798, 690, 172);
    const blue = g.createLinearGradient(228, 0, 918, 0);
    blue.addColorStop(0, '#2a12ff'); blue.addColorStop(1, '#1b06d8');
    g.fillStyle = blue; g.fill();
    g.restore();
    const number = money(c.cash);
    const size = fitSize(g, number, 800, 138, 470, -2);
    g.font = font(800, size); g.letterSpacing = `${-2 * size / 100}px`;
    const nw = g.measureText(number).width;
    g.letterSpacing = '0px';
    g.font = font(800, 44);
    const pw = g.measureText('PHP').width;
    const left = 573 - (pw + 18 + nw) / 2;
    g.fillStyle = '#fff'; g.textAlign = 'left';
    g.fillText('PHP', left, 930);
    g.font = font(800, size); g.letterSpacing = `${-2 * size / 100}px`;
    g.fillText(number, left + pw + 18, 935);
    g.letterSpacing = '0px';
    // BEFORE, struck out
    if (c.before > c.cash) {
      g.font = font(800, 28);
      const bw = g.measureText('BEFORE').width + 40;
      g.font = font(800, 40);
      const old = money(c.before), ow = g.measureText(old).width;
      g.font = font(800, 26);
      const phpw = g.measureText('PHP').width;
      const whiteW = phpw + ow + 56;
      slanted(g, 470 + bw - 4, 958, whiteW, 52);
      g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = RED; g.stroke();
      slanted(g, 470, 958, bw, 52);
      g.fillStyle = RED; g.fill();
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = font(800, 28);
      g.fillText('BEFORE', 490, 994);
      const x0 = 470 + bw + 14;
      g.fillStyle = RED; g.font = font(800, 26); g.fillText('PHP', x0, 994);
      g.font = font(800, 40); g.fillText(old, x0 + phpw + 10, 998);
      g.beginPath(); g.moveTo(x0 + phpw + 4, 990); g.lineTo(x0 + phpw + ow + 18, 976);
      g.lineWidth = 3; g.strokeStyle = RED; g.stroke();
    }
  }

  function burst(g) {
    const cx = 1505, cy = 407, n = 22;
    g.beginPath();
    for (let i = 0; i < n * 2; i += 1) {
      const a = Math.PI * i / n - Math.PI / 2, r = i % 2 ? 0.8369 : 1;
      g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * 316 * r, cy + Math.sin(a) * 276 * r);
    }
    g.closePath(); g.fillStyle = BLUE; g.fill();
    g.save(); g.translate(1505, 300); g.rotate(-2 * Math.PI / 180);
    centred(g, 'CLEARANCE', 0, -6, 800, 76, '#fff', 470, -2);
    // SALE: yellow with a thick blue outline
    g.font = font(800, 236); g.letterSpacing = '-8px'; g.textAlign = 'center';
    g.lineJoin = 'round'; g.lineWidth = 20; g.strokeStyle = BLUE; g.strokeText('SALE', 0, 172);
    g.fillStyle = YELLOW; g.fillText('SALE', 0, 172);
    g.letterSpacing = '0px';
    g.restore();
    // the red ribbon
    g.save(); g.translate(1205, 465);
    const poly = (points, color) => { g.beginPath(); points.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x, y)); g.closePath(); g.fillStyle = color; g.fill(); };
    poly([[40, 148], [120, 148], [104, 170], [52, 170]], '#8a0007');
    poly([[0, 30], [590, 4], [600, 128], [14, 160]], RED);
    poly([[120, 150], [520, 138], [470, 168], [140, 166]], '#c00010');
    g.restore();
    g.save(); g.translate(1518, 548); g.rotate(-4 * Math.PI / 180);
    g.font = font(800, 112); g.letterSpacing = '-4px';
    const pw = g.measureText('50%OFF').width;
    g.letterSpacing = '0px';
    const left = -(pw + 76) / 2;
    g.fillStyle = '#fff'; g.font = font(800, 46); g.textAlign = 'left';
    g.fillText('UP', left, -6); g.fillText('TO', left, 34);
    g.font = font(800, 112); g.letterSpacing = '-4px'; g.fillStyle = YELLOW;
    g.fillText('50%OFF', left + 76, 38);
    g.letterSpacing = '0px';
    g.restore();
  }

  // A product photo without its white border.
  function trimmed(image) {
    const c = document.createElement('canvas');
    const w = c.width = image.naturalWidth, h = c.height = image.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0);
    let data;
    try { data = g.getImageData(0, 0, w, h).data; } catch { return image; }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const k = (y * w + x) * 4;
      if (data[k + 3] > 20 && (data[k] < 235 || data[k + 1] < 235 || data[k + 2] < 235)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return image;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  function wrap(g, text, width) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && g.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  function freebies(g, c, pictures) {
    const list = c.freebies || [];
    if (!list.length) return;
    centred(g, 'GET FREEBIE', 1500, 696, 800, 34, INK);
    if (c.worth) {
      g.font = font(800, 80); g.letterSpacing = '-2px';
      const ww = g.measureText(money(c.worth)).width;
      g.letterSpacing = '0px';
      g.font = font(800, 28);
      const pw = g.measureText('Php').width;
      const left = 1500 - (pw + 6 + ww) / 2;
      g.fillStyle = RED; g.textAlign = 'left';
      g.fillText('Php', left, 742);
      g.font = font(800, 80); g.letterSpacing = '-2px';
      g.fillText(money(c.worth), left + pw + 6, 775);
      g.letterSpacing = '0px';
    }
    const n = list.length;
    const boxH = n >= 3 ? 220 : n === 2 ? 250 : 270;
    const boxW = n >= 3 ? 230 : 330;
    const cardW = n >= 3 ? 220 : 250, cardH = 190;
    const plus = 50;
    // each item's drawn size
    const sizes = list.map((f, i) => {
      const p = pictures[i];
      if (!p) return { w: cardW, h: cardH };
      const s = Math.min(boxW / p.width, boxH / p.height);
      return { w: p.width * s, h: p.height * s };
    });
    const total = sizes.reduce((sum, s) => sum + s.w, 0) + plus * (n - 1);
    const scale = Math.min(1, 820 / total);
    let x = 1475 - total * scale / 2;
    const mid = 918;
    list.forEach((f, i) => {
      const s = { w: sizes[i].w * scale, h: sizes[i].h * scale };
      if (i) {
        centred(g, '+', x + plus * scale / 2, mid + 14, 800, 40, INK);
        x += plus * scale;
      }
      const p = pictures[i];
      if (p) {
        g.save(); g.globalCompositeOperation = 'multiply';
        g.drawImage(p, x, mid - s.h / 2, s.w, s.h);
        g.restore();
      } else {
        const y = mid - s.h / 2, r = 16;
        g.beginPath(); g.roundRect(x, y, s.w, s.h, r);
        g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3; g.strokeStyle = BLUE; g.stroke();
        const size = n >= 3 ? 19 : 22;
        g.font = font(800, size);
        const lines = wrap(g, (f.label || '').toUpperCase(), s.w - 28).slice(0, 5);
        const lineH = size * 1.2;
        lines.forEach((line, k) => centred(g, line, x + s.w / 2, y + s.h / 2 - (lines.length - 1) * lineH / 2 + k * lineH + size * 0.35, 800, size, BLUE));
      }
      x += s.w;
    });
  }

  function load(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => {
        // Not readable for the canvas: shown without trimming (Download then leaves it out).
        const plain = new Image();
        plain.onload = () => { plain.unreadable = true; resolve(plain); };
        plain.onerror = () => resolve(null);
        plain.src = url;
      };
      image.src = url;
    });
  }

  // clearance: { model, partNumber, specs, cash, before, worth, freebies: [{ label, picture }] };
  // urls: { logo, freebies: [url] } (pictures as the page can show them). Draws on canvas (3840×2160).
  // options.readableOnly: pictures the canvas may not read are left out (so the drawing can be saved as a file).
  async function draw(canvas, clearance, urls = {}, options = {}) {
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const usable = (image) => (image && options.readableOnly && image.unreadable ? null : image);
    const [logoImage, ...freebieImages] = (await Promise.all([load(urls.logo), ...(urls.freebies || []).map(load)])).map(usable);
    if (document.fonts && document.fonts.load) {
      await Promise.all([document.fonts.load(font(800, 40)), document.fonts.load(font(700, 20)), document.fonts.load(font(500, 20))]).catch(() => {});
    }
    const g = canvas.getContext('2d');
    g.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    g.textBaseline = 'alphabetic';
    background(g);
    logo(g, logoImage);
    titleAndSpecs(g, clearance);
    price(g, clearance);
    burst(g);
    freebies(g, clearance, (clearance.freebies || []).map((f, i) => (freebieImages[i] ? trimmed(freebieImages[i]) : null)));
    return canvas;
  }

  window.BannerClearance = { draw };
})();
