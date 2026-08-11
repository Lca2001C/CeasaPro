import devices from "./ios-splash-devices.json";

export interface IosSplashLink {
  media: string;
  href: string;
}

/**
 * Links `apple-touch-startup-image` para iOS (a Metadata API do Next não os gera).
 * Fonte única de devices: `ios-splash-devices.json` — o mesmo arquivo alimenta o
 * gerador de imagens (`scripts/generate-icons.mjs`), então os nomes sempre batem.
 * Para cada device geramos retrato e paisagem (só muda `orientation` + a imagem).
 */
export const iosSplashLinks: IosSplashLink[] = devices.flatMap(({ w, h, dpr }) => {
  const base = `screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr})`;
  const pw = w * dpr;
  const ph = h * dpr;
  return [
    {
      media: `${base} and (orientation: portrait)`,
      href: `/splash/apple-splash-${pw}-${ph}.png`,
    },
    {
      media: `${base} and (orientation: landscape)`,
      href: `/splash/apple-splash-${ph}-${pw}.png`,
    },
  ];
});
