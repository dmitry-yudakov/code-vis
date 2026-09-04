export interface SpatialInstrumentation {
  moduleEvaluations: number;
  frames: number;
  objectUrls: number;
  textures: number;
  materials: number;
  geometries: number;
  logicalTexturePixels: number;
}

interface Disposable {
  dispose(): void;
}

interface ImageResource {
  onload: ((this: GlobalEventHandlers, ev: Event) => unknown) | null;
  onerror: OnErrorEventHandler | null;
  src: string;
}

const instrumentation: SpatialInstrumentation = {
  moduleEvaluations: 1,
  frames: 0,
  objectUrls: 0,
  textures: 0,
  materials: 0,
  geometries: 0,
  logicalTexturePixels: 0,
};

declare global {
  interface Window {
    __CODEAI_SPATIAL_INSTRUMENTATION__?: SpatialInstrumentation;
  }
}

function publish(): void {
  if (typeof window !== 'undefined') window.__CODEAI_SPATIAL_INSTRUMENTATION__ = instrumentation;
}

publish();

export function getSpatialInstrumentation(): Readonly<SpatialInstrumentation> {
  return instrumentation;
}

export function recordSpatialFrame(): void {
  instrumentation.frames += 1;
  publish();
}

export class SpatialResourceLedger {
  private disposed = false;
  private readonly textures = new Map<Disposable, number>();
  private readonly materials = new Set<Disposable>();
  private readonly geometries = new Set<Disposable>();
  private readonly objectUrls = new Map<string, ImageResource | undefined>();

  trackTexture<T extends Disposable>(texture: T, pixels: number): T {
    if (this.disposed) {
      texture.dispose();
      return texture;
    }
    if (!this.textures.has(texture)) {
      this.textures.set(texture, pixels);
      instrumentation.textures += 1;
      instrumentation.logicalTexturePixels += pixels;
      publish();
    }
    return texture;
  }

  trackMaterial<T extends Disposable>(material: T): T {
    return this.trackDisposable(material, this.materials, 'materials');
  }

  trackGeometry<T extends Disposable>(geometry: T): T {
    return this.trackDisposable(geometry, this.geometries, 'geometries');
  }

  trackObjectUrl(url: string, image?: ImageResource): string {
    if (this.disposed) {
      this.cleanupObjectUrl(url, image);
      return url;
    }
    if (!this.objectUrls.has(url)) {
      this.objectUrls.set(url, image);
      instrumentation.objectUrls += 1;
      publish();
    }
    return url;
  }

  releaseObjectUrl(url: string): void {
    if (!this.objectUrls.has(url)) return;
    const image = this.objectUrls.get(url);
    this.objectUrls.delete(url);
    this.cleanupObjectUrl(url, image);
    instrumentation.objectUrls -= 1;
    publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [url, image] of this.objectUrls) this.cleanupObjectUrl(url, image);
    instrumentation.objectUrls -= this.objectUrls.size;
    this.objectUrls.clear();
    for (const [texture, pixels] of this.textures) {
      texture.dispose();
      instrumentation.textures -= 1;
      instrumentation.logicalTexturePixels -= pixels;
    }
    this.textures.clear();
    for (const material of this.materials) material.dispose();
    instrumentation.materials -= this.materials.size;
    this.materials.clear();
    for (const geometry of this.geometries) geometry.dispose();
    instrumentation.geometries -= this.geometries.size;
    this.geometries.clear();
    publish();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  private trackDisposable<T extends Disposable>(resource: T, resources: Set<Disposable>, key: 'materials' | 'geometries'): T {
    if (this.disposed) {
      resource.dispose();
      return resource;
    }
    if (!resources.has(resource)) {
      resources.add(resource);
      instrumentation[key] += 1;
      publish();
    }
    return resource;
  }

  private cleanupObjectUrl(url: string, image?: ImageResource): void {
    if (image) {
      image.onload = null;
      image.onerror = null;
      image.src = '';
    }
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  }
}
