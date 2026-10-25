import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";

MeshoptCompression.Configuration = {
  decoder: { url: new URL("meshopt/meshopt_decoder.js", document.baseURI).href },
};
