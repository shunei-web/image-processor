import path from "path";
import colors from "ansi-colors";
import logger from "fancy-log";
import globule from "globule";
import { mkdir, stat } from "fs/promises";
import sharp from "sharp";

class ImageProcessor {
  static #DEFAULT_CONFIG = {
    sourceDirectory: "src",
    outputDirectory: "dist",
    resizeConfig: {
      width: 1920,
      height: 1920,
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
    },
  };

  #config;

  constructor(customConfig = {}) {
    this.#config = {
      ...ImageProcessor.#DEFAULT_CONFIG,
      ...customConfig,
    };
    console.log(this.#config);

    this.#initialize();
  }

  async #initialize() {
    const targetImages = this.#findTargetImages();
    const promises = [];
    for (const sourcePath of targetImages) {
      const imageInfo = this.#parseImagePath(sourcePath);
      if (!imageInfo) {
        throw new Error(`無効な画像パス: ${sourcePath}`);
      }
      const formatSettings =
        this.#config.conversionFormats[imageInfo.extension];
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

      processor.keepIccProfile();

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
      throw new Error(errorMessage);
    }
  }

  #createOutputPath(sourcePath, newFormat) {
    const relative = path.relative(this.#config.sourceDirectory, sourcePath);
    const basename = path.basename(relative, path.extname(relative));
    const dirname = path.dirname(relative);
    return path.join(
      this.#config.outputDirectory,
      dirname,
      `${basename}.${newFormat}`
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

new ImageProcessor();
