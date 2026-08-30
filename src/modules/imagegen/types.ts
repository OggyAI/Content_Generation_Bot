/**
 * Image-generation provider seam (Master Brief Part 8/9).
 * Lets the visuals stage stay agnostic about WHERE images come from:
 *   - ReplicateProvider  → fully automated REST API (default)
 *   - HiggsfieldProvider → manifest mode for interactive MCP fulfilment
 */

export interface GenRequest {
  prompt:               string;
  negative?:            string;
  referenceImagePaths?: string[];  // reference sheets of every lead in the scene (POV + side), for on-model gen
  outputDir:            string;
  filename:             string;
}

export interface GenResult {
  imagePath: string;    // "" when pending (manifest mode)
  costUsd:   number;
  cached:    boolean;
  provider:  string;
  model:     string;
  pending?:  boolean;   // true when the image must be fulfilled interactively
}

export interface ImageProvider {
  readonly name: string;
  /** Background plate or any character-free still (text-to-image). */
  generateBackground(req: GenRequest): Promise<GenResult>;
  /** A scene featuring a detailed character — uses referenceImagePath if present. */
  generateCharacterScene(req: GenRequest): Promise<GenResult>;
}
