import { TTFLoader } from '@pmndrs/uikit';
import { UIKIT_ATLAS_CHARSET } from '../src/features/shell/immersive/uikitFontPolicy';

declare global {
  interface Window {
    generateCodeAiUikitFonts(): Promise<Record<string, unknown>>;
  }
}

window.generateCodeAiUikitFonts = async () => {
  const loader = new TTFLoader();
  const common = { charset: UIKIT_ATLAS_CHARSET, fontSize: 40, textureSize: [2048, 2048] as [number, number], fieldRange: 4, padding: 4, fixOverlaps: true };
  const [inter400, inter600, geistMono400] = await Promise.all([
    loader.loadAsync({ ...common, url: '/Inter-Regular.ttf' }),
    loader.loadAsync({ ...common, url: '/Inter-SemiBold.ttf' }),
    loader.loadAsync({ ...common, url: '/GeistMono-Regular.ttf' }),
  ]);
  return { inter400, inter600, geistMono400 };
};
