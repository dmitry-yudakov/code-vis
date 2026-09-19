import { MAX_IMMERSIVE_TEXTURE_PIXELS, type ImmersiveInstrumentation } from './immersiveTypes';

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

const immersiveInstrumentation: ImmersiveInstrumentation = {
  sessionActive: false,
  frames: 0,
  logicalTexturePixels: 0,
  liveResources: 0,
};
// A bounded histogram retains the complete physical-acceptance run without keeping one number per
// frame or repeatedly sorting a growing array. Quarter-millisecond buckets preserve useful headset
// precision through one second; longer stalls remain represented by the exact maximum.
const FRAME_TIME_BUCKET_MS = 0.25;
const MAX_BUCKETED_FRAME_MS = 1_000;
const immersiveFrameTimeCounts = new Uint32Array(MAX_BUCKETED_FRAME_MS / FRAME_TIME_BUCKET_MS + 1);

declare global {
  interface Window {
    __CODEAI_SPATIAL_INSTRUMENTATION__?: SpatialInstrumentation;
  }
}

function publish(): void {
  if (typeof window !== 'undefined') {
    window.__CODEAI_SPATIAL_INSTRUMENTATION__ = instrumentation;
    window.__CODEAI_IMMERSIVE_INSTRUMENTATION__ = immersiveInstrumentation;
  }
}

publish();

export function getSpatialInstrumentation(): Readonly<SpatialInstrumentation> {
  return instrumentation;
}

export function recordSpatialFrame(): void {
  instrumentation.frames += 1;
  publish();
}

export function getImmersiveInstrumentation(): Readonly<ImmersiveInstrumentation> {
  return immersiveInstrumentation;
}

export function setImmersiveSessionActive(active: boolean): void {
  if (immersiveInstrumentation.sessionActive === active) return;
  if (!active && immersiveInstrumentation.frames > 0) {
    immersiveInstrumentation.medianFrameMs = framePercentile(0.5);
    immersiveInstrumentation.p95FrameMs = framePercentile(0.95);
  }
  immersiveInstrumentation.sessionActive = active;
  if (active) {
    immersiveInstrumentation.frames = 0;
    immersiveInstrumentation.medianFrameMs = undefined;
    immersiveInstrumentation.p95FrameMs = undefined;
    immersiveInstrumentation.maxFrameMs = undefined;
    immersiveInstrumentation.peakLogicalTexturePixels = immersiveInstrumentation.logicalTexturePixels;
    immersiveInstrumentation.peakLiveResources = immersiveInstrumentation.liveResources;
    immersiveFrameTimeCounts.fill(0);
  }
  publish();
}

function framePercentile(percentile: number): number {
  const target = Math.floor((immersiveInstrumentation.frames - 1) * percentile);
  let cumulative = 0;
  for (let bucket = 0; bucket < immersiveFrameTimeCounts.length; bucket += 1) {
    cumulative += immersiveFrameTimeCounts[bucket];
    if (cumulative > target) {
      if (bucket === immersiveFrameTimeCounts.length - 1
        && (immersiveInstrumentation.maxFrameMs || 0) > MAX_BUCKETED_FRAME_MS) {
        return immersiveInstrumentation.maxFrameMs!;
      }
      return bucket * FRAME_TIME_BUCKET_MS;
    }
  }
  return immersiveInstrumentation.maxFrameMs || 0;
}

export function recordImmersiveFrame(frameMs: number): void {
  if (!immersiveInstrumentation.sessionActive || !Number.isFinite(frameMs) || frameMs <= 0) return;
  immersiveInstrumentation.frames += 1;
  immersiveInstrumentation.maxFrameMs = Math.max(immersiveInstrumentation.maxFrameMs || 0, frameMs);
  const bucket = Math.min(Math.ceil(frameMs / FRAME_TIME_BUCKET_MS), immersiveFrameTimeCounts.length - 1);
  immersiveFrameTimeCounts[bucket] += 1;
  if (immersiveInstrumentation.frames % 30 === 0) {
    immersiveInstrumentation.medianFrameMs = framePercentile(0.5);
    immersiveInstrumentation.p95FrameMs = framePercentile(0.95);
  }
  publish();
}

type ResourceOwner = 'desktop' | 'immersive';

function updateImmersiveResources(resources: number, pixels = 0): void {
  immersiveInstrumentation.liveResources += resources;
  immersiveInstrumentation.logicalTexturePixels += pixels;
  if (immersiveInstrumentation.sessionActive) {
    immersiveInstrumentation.peakLiveResources = Math.max(
      immersiveInstrumentation.peakLiveResources || 0,
      immersiveInstrumentation.liveResources,
    );
    immersiveInstrumentation.peakLogicalTexturePixels = Math.max(
      immersiveInstrumentation.peakLogicalTexturePixels || 0,
      immersiveInstrumentation.logicalTexturePixels,
    );
  }
  publish();
}

export class SpatialResourceLedger {
  private disposed = false;
  private readonly textures = new Map<Disposable, number>();
  private readonly materials = new Set<Disposable>();
  private readonly geometries = new Set<Disposable>();
  private readonly objectUrls = new Map<string, ImageResource | undefined>();

  constructor(private readonly owner: ResourceOwner = 'desktop') {}

  trackTexture<T extends Disposable>(texture: T, pixels: number, mipmapped = false): T {
    if (this.disposed) {
      texture.dispose();
      return texture;
    }
    if (!this.textures.has(texture)) {
      const logicalPixels = mipmapped ? Math.ceil(pixels * 4 / 3) : pixels;
      if (this.owner === 'immersive'
        && immersiveInstrumentation.logicalTexturePixels + logicalPixels > MAX_IMMERSIVE_TEXTURE_PIXELS) {
        texture.dispose();
        throw new Error('Immersive texture allocation exceeded the 5,592,405-pixel budget.');
      }
      this.textures.set(texture, logicalPixels);
      instrumentation.textures += 1;
      instrumentation.logicalTexturePixels += logicalPixels;
      if (this.owner === 'immersive') updateImmersiveResources(1, logicalPixels);
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
      if (this.owner === 'immersive') updateImmersiveResources(1);
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
    if (this.owner === 'immersive') updateImmersiveResources(-1);
    publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [url, image] of this.objectUrls) this.cleanupObjectUrl(url, image);
    instrumentation.objectUrls -= this.objectUrls.size;
    if (this.owner === 'immersive') updateImmersiveResources(-this.objectUrls.size);
    this.objectUrls.clear();
    for (const [texture, pixels] of this.textures) {
      texture.dispose();
      instrumentation.textures -= 1;
      instrumentation.logicalTexturePixels -= pixels;
      if (this.owner === 'immersive') updateImmersiveResources(-1, -pixels);
    }
    this.textures.clear();
    for (const material of this.materials) material.dispose();
    instrumentation.materials -= this.materials.size;
    if (this.owner === 'immersive') updateImmersiveResources(-this.materials.size);
    this.materials.clear();
    for (const geometry of this.geometries) geometry.dispose();
    instrumentation.geometries -= this.geometries.size;
    if (this.owner === 'immersive') updateImmersiveResources(-this.geometries.size);
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
      if (this.owner === 'immersive') updateImmersiveResources(1);
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
