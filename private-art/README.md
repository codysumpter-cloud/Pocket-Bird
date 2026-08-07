# Private art injection point

This directory intentionally contains **no private or purchased art in the public Pocket Buddy repository**.

Private builds may add a `private-art-manifest.json` and its referenced ZIP packs here immediately before desktop packaging. Electron Builder copies this directory into the packaged app's `resources/private-art/` directory.

At runtime Pocket Buddy:

1. reads only `pocket-buddy-private-art-bundle-v1` manifests;
2. requires leaf `.zip` filenames and exact SHA-256 values;
3. verifies every pack before exposing its bytes to the sandboxed renderer;
4. imports each verified pack once through the normal PixelLab/OpenPets importer;
5. shows a persistent integrity error instead of substituting art if verification or import fails.

The portable Windows app can also consume the same manifest from an `Art Packs/` directory beside the portable executable. This makes private test bundles possible without committing the art here.
