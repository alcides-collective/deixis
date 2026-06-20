// wawoff2 ships no type declarations; declare the minimal surface we use.
declare module "wawoff2" {
  /** Compress an OTF/TTF buffer into WOFF2 bytes. */
  export function compress(input: Uint8Array): Promise<Uint8Array>;
  /** Decompress WOFF2 bytes back into OTF/TTF. */
  export function decompress(input: Uint8Array): Promise<Uint8Array>;
}
