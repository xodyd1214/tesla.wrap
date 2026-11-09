# 2024 Tesla Model 3 Highland

The preview mesh is based on **2024 Tesla Model 3** by [RBLXSupercars](https://sketchfab.com/RBLXSupercars). It is licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The embedded metadata links to the [original model](https://sketchfab.com/3d-models/2024-tesla-model-3-fd22be415215453693d67e33aa7812d0). The download listing was uploaded by [brandonleong28](https://sketchfab.com/3d-models/tesla-model-3-2024-36c52f3f89f6439c90310f14e8ff33f2).

The mesh comes from the [Tesla Studio conversion](https://github.com/aditano/tesla-studio/tree/main/public/models/highland), which applies lossless mesh compression and separates the source textures. Wrap Studio separates the paint and trim surfaces from this mesh into `highland-wrap.glb` and adds two UV sets for the [Tesla templates](https://github.com/teslamotors/custom-wraps), Standard / Premium in `TEXCOORD_0` and Performance in `TEXCOORD_1`. Both trims use the same body geometry.

To rebuild the paint asset, serve the project directory and run the following in the browser console at the editor page. Save the download as `assets/models/highland-wrap.glb`.

```js
const { bakeHighlandWrap } = await import('./scripts/highland-uv.mjs')
const url = URL.createObjectURL(new Blob([await bakeHighlandWrap()]))
const link = Object.assign(document.createElement('a'), { href: url, download: 'highland-wrap.glb' })
link.click()
```

# 2021 Tesla Model Y

The preview uses [Tesla Model Y 2021](https://sketchfab.com/3d-models/tesla-model-y-2021-c0a86cac582d4b33aba0fb1b1912d970) by [763468712](https://sketchfab.com/763468712), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). The original attribution is in [model-y-LICENSE.txt](model-y-LICENSE.txt).

Wrap Studio uses the original Sketchfab GLB for all 17 paint islands and nine cabin glass surfaces, including the panoramic roof. Lamps, wheels, and interior come from the [Tina 3D Tesla adaptation](https://github.com/Tina2088/tina-3d-tesla/tree/main/public/models). The original paint and glass meshes were separated by connected surface, aligned with the adapted model, and compressed with Meshopt without reducing their triangle count. Wrap Studio adjusts the preview glass and light materials and maps the paint islands approximately to Tesla's original Model Y wrap template.

# Original Tesla Model 3

The attached [TeslaHub community GLB](https://github.com/Olrik-WP/TeslaHub/blob/main/src/TeslaHub.Web/public/community-models/community-m3-rigged.glb) embeds attribution to [Tesla White car.](https://sketchfab.com/3d-models/tesla-white-car-2a4ee44439dc4b1b98f452a9ff427116) by [aarajesh](https://sketchfab.com/aarajesh), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Wrap Studio converted the geometry from Draco to Meshopt compression and maps the exterior to Tesla's original Model 3 wrap template.

# 2025 Tesla Model Y Juniper

The preview uses [2025 Tesla Model Y](https://sketchfab.com/3d-models/2025-tesla-model-y-619601e7800d418da5922c4fa7833f74) by [BloxBloger](https://sketchfab.com/BloxBloger), licensed for noncommercial use under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). The attached GLB matches the [Tesla Studio conversion](https://github.com/aditano/tesla-studio/blob/main/public/models/juniper/CREDITS.md), which normalized the axes and scale, assigned materials, and compressed the mesh. Wrap Studio uses the same GLB for the three Juniper trims and maps it approximately to each trim's Tesla wrap template.

Wrap Studio is an independent project. Tesla and its vehicle names are trademarks of Tesla, Inc.
