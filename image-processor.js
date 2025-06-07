import { mkdir, stat, rm } from "fs/promises";
import path from "path";

import colors from "ansi-colors";
import logger from "fancy-log";
import globule from "globule";
import sharp from "sharp";

class ImageProcessor {
  static #DEFAULT_CONFIG = {
    sourceDirectory: "src",
    outputDirectory: "dist",
    filenameSuffix: "@2x",
    resizeConfig: {
      width: 3840,
      height: 3840,
      fit: "inside",
      position: "center",
      withoutEnlargement: true,
    },
    conversionFormats: {
      png: {
        webp: { quality: 80 },
        // avif: { quality: 60 },
      },
      jpg: {
        webp: { quality: 80 },
        // avif: { quality: 60 },
      },
      jpeg: {
        webp: { quality: 80 },
        // avif: { quality: 60 },
      },
      webp: {
        webp: { quality: 80 },
        // avif: { quality: 60 },
      },
      avif: {
        webp: { quality: 80 },
        // avif: { quality: 60 },
      },
    },
  };

  #config;

  constructor(config) {
    this.#config = config;
  }

  static async create(customConfig = {}) {
    const config = {
      ...ImageProcessor.#DEFAULT_CONFIG,
      ...customConfig,
    };
    await rm(config.outputDirectory, { recursive: true, force: true }).catch(
      () => {}
    );
    const processor = new ImageProcessor(config);
    await processor.#initialize();
    return processor;
  }

  async #initialize() {
    const targetImages = this.#findTargetImages();
    const promises = [];
    for (const sourcePath of targetImages) {
      const imageInfo = this.#parseImagePath(sourcePath);
      if (!imageInfo) {
        logger(colors.red(`無効な画像パス: ${sourcePath}`));
        continue;
      }
      const formatSettings =
        this.#config.conversionFormats[imageInfo.extension];
      if (!formatSettings) continue;
      for (const [format, settings] of Object.entries(formatSettings)) {
        promises.push(this.#convertToFormat(sourcePath, format, settings));
      }
    }
    await Promise.all(promises);
  }

  #findTargetImages() {
    const extensions = Object.keys(this.#config.conversionFormats);
    const pattern = `/**/*.{${extensions.join(",")}}`;
    const searchPath = `${this.#config.sourceDirectory}${pattern}`;
    return globule.find(searchPath);
  }

  async #convertToFormat(sourcePath, targetFormat, settings) {
    const outputPath = this.#createOutputPath(sourcePath, targetFormat);
    const outputDir = path.dirname(outputPath);
    await this.#ensureDirectory(outputDir);

    const originalSize = (await stat(sourcePath)).size;

    try {
      const processor = sharp(sourcePath);

      if (typeof processor.keepIccProfile === "function") {
        processor.keepIccProfile();
      }

      if (this.#config.resizeConfig) {
        processor.resize(this.#config.resizeConfig);
      }

      await processor.toFormat(targetFormat, settings).toFile(outputPath);

      const convertedSize = (await stat(outputPath)).size;
      const compressionRatio = (1 - convertedSize / originalSize) * 100;

      logger(
        `✓ ${colors.blue(sourcePath)} を ` +
          `${colors.yellow(targetFormat.toUpperCase())} 形式に変換: ` +
          `${colors.green(outputPath)} ` +
          `(圧縮率: ${colors.cyan(compressionRatio.toFixed(1))}%)`
      );

      return {
        sourcePath,
        outputPath,
        originalSize,
        convertedSize,
        compressionRatio,
        format: targetFormat,
      };
    } catch (error) {
      const errorMessage = `${colors.yellow(
        targetFormat.toUpperCase()
      )} 形式への変換失敗\n${error}`;
      logger(colors.red(errorMessage));
      throw error;
    }
  }

  #createOutputPath(sourcePath, newFormat) {
    const relative = path.relative(this.#config.sourceDirectory, sourcePath);
    const basename = path.basename(relative, path.extname(relative));
    const dirname = path.dirname(relative);
    const suffix = this.#config.filenameSuffix || "";
    return path.join(
      this.#config.outputDirectory,
      dirname,
      `${basename}${suffix}.${newFormat}`
    );
  }

  async #ensureDirectory(dirPath) {
    try {
      await mkdir(dirPath, { recursive: true });
      logger(`📁 出力ディレクトリを作成: ${colors.green(dirPath)}`);
    } catch (error) {
      logger(colors.red(`ディレクトリ作成失敗: ${dirPath}\n${error}`));
      throw error;
    }
  }

  #parseImagePath(imagePath) {
    const extensions = Object.keys(this.#config.conversionFormats).map((e) =>
      e.toLowerCase()
    );
    const ext = path.extname(imagePath).slice(1).toLowerCase();
    if (!extensions.includes(ext)) return null;

    const name = path.basename(imagePath, path.extname(imagePath));
    return { name, extension: ext };
  }
}

export default ImageProcessor;

(async () => {
  try {
    await ImageProcessor.create();
  } catch (err) {
    logger(colors.red("画像処理で致命的なエラーが発生しました"));
    logger(err);
    process.exit(1);
  }
})();
