import { PhotoItem } from "../types/photo";

export class PhotoService {
  private static instance: PhotoService;

  private constructor() {}

  public static getInstance(): PhotoService {
    if (!PhotoService.instance) {
      PhotoService.instance = new PhotoService();
    }
    return PhotoService.instance;
  }

  public getPhotos(): PhotoItem[] {
    try {
      // Automatically load all images located in src/data/pics/home
      const imageContext = (require as any).context(
        "../data/pics/home",
        false,
        /\.(jpe?g|png|webp|gif|svg|avif)$/i
      );

      const keys: string[] = imageContext.keys();
      return keys.map((key: string, idx: number) => {
        const cleanKey = key.replace(/^\.\//, "");
        const mod = imageContext(key);
        const srcUrl = typeof mod === "string" ? mod : (mod?.default || `/data/pics/home/${cleanKey}`);
        const nameWithoutExt = cleanKey.replace(/\.[^/.]+$/, "");
        const formattedTitle = nameWithoutExt
          .split(/[-_]/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");

        return {
          id: String(idx + 1),
          src: srcUrl,
          alt: formattedTitle || `Photo ${idx + 1}`,
        };
      });
    } catch (error) {
      console.warn("Could not load photos from home directory:", error);
      return [];
    }
  }
}
