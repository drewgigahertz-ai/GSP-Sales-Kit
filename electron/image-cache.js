const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { net } = require('electron');

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif'
};
const EXTENSION_TYPES = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([type, extension]) => [extension, type]));
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function urlKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex');
}

class ImageCache {
  constructor(directory, fetchImage = (url, options) => net.fetch(url, options)) {
    this.directory = directory;
    this.manifestPath = path.join(directory, 'manifest.json');
    this.manifest = null;
    this.fetchImage = fetchImage;
  }

  async readManifest() {
    if (this.manifest) return this.manifest;
    try {
      this.manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
    } catch {
      this.manifest = {};
    }
    return this.manifest;
  }

  async resolve(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return url;
    const manifest = await this.readManifest();
    const fileName = manifest[urlKey(url)];
    if (!fileName) return url;

    try {
      await fs.access(path.join(this.directory, fileName));
      return `saleskit-image://cache/${fileName}`;
    } catch {
      return url;
    }
  }

  async mapPayload(data) {
    await this.readManifest();
    const map = (value) => {
      if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return value;
      const fileName = this.manifest && this.manifest[urlKey(value)];
      return fileName ? `saleskit-image://cache/${fileName}` : value;
    };
    // Mapping may run twice on the same data (startup shares one download); keep the original address.
    if (!data.applicationLogoSourceUrl) data.applicationLogoSourceUrl = data.applicationLogoUrl;
    data.applicationLogoUrl = map(data.applicationLogoUrl);
    Object.values(data.specsMap || {}).forEach((spec) => { spec.image = map(spec.image); });
    Object.entries(data.skuImageMap || {}).forEach(([key, value]) => { data.skuImageMap[key] = map(value); });
    Object.entries(data.appsLogoMap || {}).forEach(([key, value]) => { data.appsLogoMap[key] = map(value); });
    data.headerLogoUrl = map(data.headerLogoUrl);
    data.bannerLogoUrl = map(data.bannerLogoUrl);
    Object.values(data.appsDataList || []).forEach((app) => { app.icon = map(app.icon); });
    Object.values(data.appUkspData?.applications || []).forEach((app) => { app.icon = map(app.icon); });
    (data.ukspBannerData?.skus || []).forEach((laptop) => {
      Object.entries(laptop.features || {}).forEach(([feature, url]) => {
        laptop.features[feature] = map(url);
      });
    });
    Object.values(data.criteriaSegmentData?.laptops || []).forEach((laptop) => {
      laptop.image = map(laptop.image);
      if (laptop.rawSpecs) laptop.rawSpecs.image = map(laptop.rawSpecs.image);
    });
    return data;
  }

  async sync(urls, onProgress = () => {}) {
    await fs.mkdir(this.directory, { recursive: true });
    const manifest = await this.readManifest();
    const uniqueUrls = [...new Set(urls.filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url)))];
    let completed = 0;
    let cached = 0;
    let downloaded = 0;
    let failed = 0;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < uniqueUrls.length) {
        const url = uniqueUrls[nextIndex++];
        const key = urlKey(url);
        const existing = manifest[key];
        if (existing) {
          try {
            await fs.access(path.join(this.directory, existing));
            cached += 1;
            completed += 1;
            onProgress({ phase: 'images', completed, total: uniqueUrls.length, cached, downloaded, failed });
            continue;
          } catch {
            delete manifest[key];
          }
        }

        try {
          const response = await this.fetchImage(url, { signal: AbortSignal.timeout(25000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          const extension = IMAGE_TYPES[contentType];
          if (!extension) throw new Error('URL did not return a supported image.');

          const buffer = Buffer.from(await response.arrayBuffer());
          if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Image is empty or exceeds 20 MB.');

          const fileName = `${key}.${extension}`;
          const temporaryPath = path.join(this.directory, `${fileName}.tmp`);
          await fs.writeFile(temporaryPath, buffer);
          await fs.rename(temporaryPath, path.join(this.directory, fileName));
          manifest[key] = fileName;
          downloaded += 1;
        } catch (error) {
          failed += 1;
          console.warn('Image cache miss:', url, error.message);
        }

        completed += 1;
        onProgress({ phase: 'images', completed, total: uniqueUrls.length, cached, downloaded, failed });
      }
    };

    onProgress({ phase: 'images', completed: 0, total: uniqueUrls.length, cached, downloaded, failed });
    await Promise.all(Array.from({ length: Math.min(5, uniqueUrls.length) }, worker));
    const temporaryManifest = `${this.manifestPath}.tmp`;
    await fs.writeFile(temporaryManifest, JSON.stringify(manifest), 'utf8');
    await fs.rename(temporaryManifest, this.manifestPath);
    this.manifest = manifest;

    return { total: uniqueUrls.length, cached, downloaded, failed };
  }

  async serve(requestUrl) {
    const url = new URL(requestUrl);
    if (url.hostname !== 'cache') return new Response('Not found', { status: 404 });
    const fileName = path.basename(decodeURIComponent(url.pathname));
    if (!/^[a-f0-9]{64}\.(jpg|png|webp|gif|svg|avif)$/.test(fileName)) {
      return new Response('Not found', { status: 404 });
    }

    const manifest = await this.readManifest();
    if (!Object.values(manifest).includes(fileName)) return new Response('Not found', { status: 404 });
    try {
      const body = await fs.readFile(path.join(this.directory, fileName));
      const extension = path.extname(fileName).slice(1);
      return new Response(body, {
        headers: {
          'Content-Type': EXTENSION_TYPES[extension] || 'application/octet-stream',
          // The Banner page's logo mask loads saved images with CORS.
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  }
}

module.exports = { ImageCache };