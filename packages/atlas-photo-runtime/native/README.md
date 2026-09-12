# Native HEVC adapter build

The C++ Node-API source is loaded only by the disposable worker. Build it for the
actual server OS/architecture. Generated `native/build/` files are ignored and
must be included deliberately in the application's reviewed deployment artifact.
The source and build script support macOS/Linux, but only macOS arm64 was executed
in this batch. There is no claimed Linux or production build acceptance.

Required inputs are **libheif 1.23.2**, built-in **libde265 1.1.1**, a C++17 compiler
and Node headers supporting Node-API 8. Use an installed/deployment-provided
libheif prefix with matching headers and shared libraries. Configure libheif with
`WITH_LIBDE265=ON` and `WITH_LIBDE265_PLUGIN=OFF` when building that dependency;
the adapter deliberately uses the built-in decoder and never discovers plugin
paths from application credentials/environment. Its runtime version/decoder-name
checks reject other versions. No global installation occurs in the build script.

```sh
node packages/atlas-photo-runtime/scripts/build-native.mjs \
  /reviewed/libheif/include /reviewed/libheif/lib /reviewed/node/include/node
node --test packages/atlas-photo-runtime/test/*.test.mjs packages/atlas-photo-core/test/*.test.mjs
```

Arguments are explicit directories; they are passed as compiler argument arrays
without a shell. `CXX` optionally names the compiler executable. The shared-library
rpath uses the supplied library directory, which must exist in the target runtime.
No live fetching/building occurs during photo intake. Build and package the addon
and its reviewed shared libraries ahead of deployment. Record their SHA-256 values
with the deployment artifact. The generated `build.json` binds the addon and its
source, compiler flags, platform and architecture; it is build evidence, not an
untrusted-input memory sandbox.

The local proof used Codex's already-installed native shared libraries, not a
new installation. Matching official headers were obtained from the
[libheif v1.23.2 source archive](https://github.com/strukturag/libheif/archive/refs/tags/v1.23.2.tar.gz),
SHA-256 `1405ed070421459b569ff49deab109b7f1a30a447e72a9b20a4154f774634a44`.
For this header-only local build, `heif_version.h` was generated from the archive's
unchanged template with version 1.23.2 and an empty plugin directory. Normal
installed libheif development headers already include the generated file.
External evidence records the complete source archive, dependency hashes and the
exact local compiler invocation. No native binary or third-party header is
committed in this package. Preserve libheif/libde265 license/source obligations
when packaging their shared libraries.

The supported subset and refusals are specified in the package README. ICC/P3,
Exif and HDR/gain-map handling remain missing phone-intake work. The caller's
outer process/container memory and disk limits remain necessary: `maxPixels`,
`maxRasterBytes`, per-library block limits and a reaped deadline do not measure
or hard-limit every native temporary allocation.
