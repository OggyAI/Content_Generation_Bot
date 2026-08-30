import { ImageProvider } from "./types";
import { ReplicateProvider } from "./replicate-provider";
import { HiggsfieldProvider } from "./higgsfield-provider";
import { config } from "../../config/defaults";

export * from "./types";

/** Select the image-generation backbone based on IMAGE_BACKBONE config. */
export function getImageProvider(): ImageProvider {
  switch (config.imageBackbone) {
    case "higgsfield": return new HiggsfieldProvider();
    case "replicate":
    default:           return new ReplicateProvider();
  }
}
