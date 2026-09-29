import { imageSize } from "npm:image-size@2.0.4";
import jpeg, { init as initJpeg } from "npm:@jsquash/jpeg@1.6.0/decode.js";
import png, { init as initPng } from "npm:@jsquash/png@3.1.1/decode.js";
import webp, { init as initWebp } from "npm:@jsquash/webp@1.5.0/decode.js";
import { PROOF_MAX_BYTES } from "../_shared/prescreening.ts";

const decoders = {
  jpg: { mime: "image/jpeg", decode: jpeg, init: initJpeg, file: "jpeg" },
  png: { mime: "image/png", decode: png, init: initPng, file: "png" },
  webp: { mime: "image/webp", decode: webp, init: initWebp, file: "webp" },
};
const initialized = new Map<string, Promise<void>>();

/** Bound decoded allocation before invoking a codec in the 256 MB Edge worker. */
export async function verifyProofImage(bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > PROOF_MAX_BYTES) throw new Error("proof_size_invalid");
  let dimensions;
  try { dimensions = imageSize(bytes); } catch { throw new Error("proof_image_invalid"); }
  const type = dimensions.type;
  if (type !== "jpg" && type !== "png" && type !== "webp") throw new Error("proof_type_invalid");
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 20_000_000) {
    throw new Error("proof_dimensions_too_large");
  }
  const decoder = decoders[type];
  if (!initialized.has(type)) {
    const setup = async () => {
      const wasm = await Deno.readFile(new URL(`./codecs/${decoder.file}.wasm`, import.meta.url));
      await decoder.init(await WebAssembly.compile(wasm));
    };
    initialized.set(type, setup().catch(error => { initialized.delete(type); throw error; }));
  }
  await initialized.get(type);
  try {
    const decoded = await decoder.decode(bytes.slice().buffer);
    if (!decoded.width || !decoded.height || decoded.width * decoded.height !== dimensions.width * dimensions.height) {
      throw new Error("dimensions_mismatch");
    }
  } catch { throw new Error("proof_image_invalid"); }
  return decoder.mime;
}
