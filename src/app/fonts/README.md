# Bundled application fonts

The root layout uses these local WOFF2 files so development and production builds do not need
Google Fonts access. They retain the existing font families, variable weights and Archivo width
axis, with all upstream glyphs (including non-Latin text). Each family includes its upstream SIL
Open Font License and copyright notice.

Downloaded from the official Google Fonts repository on 2026-11-15. The SHA-256 values below
identify the original TTF downloads. Converted to WOFF2 with fontTools 4.68.0 without
changing outlines. Inter's optical-size axis is fixed at its default 14, matching the previous
Google Fonts request, which selected only the weight axis. No build-time conversion is needed.

| Bundled file | Upstream source | License | Original TTF SHA-256 |
| --- | --- | --- | --- |
| Geist.woff2 | [Google Fonts](https://github.com/google/fonts/blob/main/ofl/geist/Geist%5Bwght%5D.ttf) | [geist-OFL.txt](geist-OFL.txt) | `73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659` |
| GeistMono.woff2 | [Google Fonts](https://github.com/google/fonts/blob/main/ofl/geistmono/GeistMono%5Bwght%5D.ttf) | [geistmono-OFL.txt](geistmono-OFL.txt) | `d00e590b8eb3a59acc329b2d044fd143ae935090b7da33199ebee27cc7de8196` |
| Archivo.woff2 | [Google Fonts](https://github.com/google/fonts/blob/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf) | [archivo-OFL.txt](archivo-OFL.txt) | `0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053` |
| Inter.woff2 | [Google Fonts](https://github.com/google/fonts/blob/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf) | [inter-OFL.txt](inter-OFL.txt) | `29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031` |

When updating, retain the licenses and source hashes. Convert upstream TTFs with
`fonttools ttLib.woff2 compress INPUT.ttf -o OUTPUT.woff2`; first fix Inter's optical size with
`fonttools varLib.instancer INPUT.ttf opsz=14 -o Inter.ttf`. Keep the layout's font variables,
weight/stretch declarations, fallback families and preload choices aligned with the assets.
Keep `adjustFontFallback: false`: synthesized `local(Arial)` faces fail font loading on hosts
without Arial when immersive rendering requests the full CSS fallback stack.
