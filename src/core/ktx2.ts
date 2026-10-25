import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import "@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader";

const base = new URL("ktx2/", document.baseURI).href;
KhronosTextureContainer2.URLConfig = {
  jsDecoderModule: `${base}babylon.ktx2Decoder.js`,
  wasmUASTCToASTC: `${base}uastc_astc.wasm`,
  wasmUASTCToBC7: `${base}uastc_bc7.wasm`,
  wasmUASTCToRGBA_UNORM: `${base}uastc_rgba8_unorm_v2.wasm`,
  wasmUASTCToRGBA_SRGB: `${base}uastc_rgba8_srgb_v2.wasm`,
  wasmUASTCToR8_UNORM: `${base}uastc_r8_unorm.wasm`,
  wasmUASTCToRG8_UNORM: `${base}uastc_rg8_unorm.wasm`,
  jsMSCTranscoder: `${base}msc_basis_transcoder.js`,
  wasmMSCTranscoder: `${base}msc_basis_transcoder.wasm`,
  wasmZSTDDecoder: `${base}zstddec.wasm`,
};

KhronosTextureContainer2.DefaultDecoderOptions.useRGBAIfOnlyBC1BC3AvailableWhenUASTC = false;
