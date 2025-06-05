/**
 * @fileoverview 画像フォーマット変換処理を行うクラス
 * 画像のフォーマット変換、サイズ変更、メタデータ保持、
 * 変換効率の分析機能を提供します。
 */

import { existsSync, promises as fsPromises, mkdirSync, statSync } from "fs";

import colors from "ansi-colors";
import logger from "fancy-log";
import globule from "globule";
import pLimit from "p-limit";
import prettyBytes from "pretty-bytes";
import sharp from "sharp";

/**
 * 画像処理の結果を表す型
 * @typedef {Object} ConversionResult
 * @property {string} sourcePath - 元画像パス
 * @property {string} outputPath - 出力画像パス
 * @property {number} originalSize - 元のファイルサイズ
 * @property {number} convertedSize - 変換後のファイルサイズ
 * @property {number} compressionRatio - 圧縮率
 * @property {Object} metadata - 画像のメタデータ
 */

/**
 * 画像処理オプションの型定義
 * @typedef {Object} ImageProcessorOptions
 * @property {string} sourceDirectory - 元画像が格納されているディレクトリパス
 * @property {string} outputDirectory - 変換後の画像を出力するディレクトリパス
 * @property {Object} outputSettings - 出力に関する設定
 * @property {boolean} outputSettings.keepIccProfile - ICCプロファイルを保持するかどうか
 * @property {boolean} outputSettings.keepMetadata - メタデータを保持するかどうか
 * @property {string[]} outputSettings.keepMetadataKeys - 保持するメタデータのキー
 * @property {Object} resizeConfig - リサイズに関する設定
 * @property {number} resizeConfig.width - 幅
 * @property {number} resizeConfig.height - 高さ
 * @property {string} resizeConfig.fit - フィット方式 ('inside' | 'outside' | 'cover' | 'contain')
 * @property {string} resizeConfig.position - 位置
 * @property {boolean} resizeConfig.preventEnlargement - 元サイズより大きくしない
 * @property {Object} conversionFormats - 変換対象のフォーマット設定
 * @property {number} maxConcurrency - 同時処理数
 * @property {boolean} generateReport - 変換レポートを生成するかどうか
 */

class ImageProcessor {
  static #DEFAULT_CONFIG = {
    sourceDirectory: "src",
    outputDirectory: "dist",
    outputSettings: {
      keepIccProfile: true,
      keepMetadata: false,
      keepMetadataKeys: [
        "exif",
        "iptc",
        "xmp",
        "orientation",
        "copyright",
        "rating",
      ],
    },
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
    maxConcurrency: 5,
    generateReport: true,
  };

  #config;
  #conversionResults = [];

  /**
   * @constructor
   * @param {Partial<ImageProcessorOptions>} customConfig - カスタム設定（オプション）
   */
  constructor(customConfig = {}) {
    this.#config = {
      ...ImageProcessor.#DEFAULT_CONFIG,
      ...customConfig,
    };

    this.#initialize().catch((error) => {
      logger(colors.red(`初期化エラー: ${error.message}`));
      throw error;
    });
  }

  /**
   * 画像処理の初期化を行います
   * @private
   */
  async #initialize() {
    const targetImages = this.#findTargetImages();
    await this.#processImages(targetImages);
    if (this.#config.generateReport) {
      await this.#generateConversionReport();
    }
  }

  /**
   * 対象画像の一括処理を行います
   * @private
   * @param {string[]} imagePaths - 処理対象の画像パス配列
   */
  async #processImages(imagePaths) {
    if (imagePaths.length === 0) {
      logger(colors.yellow("⚠ 処理対象の画像が見つかりませんでした"));
      return;
    }

    logger(colors.cyan(`🔍 ${imagePaths.length}個の画像を処理します`));

    const concurrencyLimit = pLimit(this.#config.maxConcurrency);
    const processingTasks = imagePaths.flatMap((imagePath) =>
      concurrencyLimit(() => this.#convertImage(imagePath))
    );

    try {
      await Promise.all(processingTasks);
      logger(colors.green("✨ すべての画像処理が完了しました"));
    } catch (error) {
      logger(
        colors.red(`❌ 画像処理中にエラーが発生しました: ${error.message}`)
      );
      throw error;
    }
  }

  /**
   * 個別の画像変換処理を行います
   * @private
   * @param {string} imagePath - 処理対象の画像パス
   */
  async #convertImage(imagePath) {
    const imageInfo = this.#parseImagePath(imagePath);
    if (!imageInfo) {
      throw new Error(`無効な画像パス: ${imagePath}`);
    }

    try {
      await this.#ensureOutputDirectory(imagePath);
      const formatSettings =
        this.#config.conversionFormats[imageInfo.extension];
      const originalMetadata = await this.#extractMetadata(imagePath);
      const originalSize = statSync(imagePath).size;

      const conversionResults = await Promise.all(
        Object.entries(formatSettings).map(async ([format, settings]) => {
          const result = await this.#convertToFormat(
            imagePath,
            format,
            settings,
            originalMetadata
          );
          return {
            ...result,
            originalSize,
            metadata: originalMetadata,
          };
        })
      );

      this.#conversionResults.push(...conversionResults);
    } catch (error) {
      logger(colors.red(`❌ ${imagePath} の処理に失敗: ${error.message}`));
      throw error;
    }
  }

  /**
   * 画像のメタデータを抽出します
   * @private
   * @param {string} imagePath - 画像パス
   * @returns {Promise<Object>} メタデータオブジェクト
   */
  async #extractMetadata(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata();
      return this.#config.outputSettings.keepMetadata
        ? this.#filterMetadata(metadata)
        : {};
    } catch (error) {
      logger(colors.yellow(`⚠ メタデータの抽出に失敗: ${imagePath}`));
      return {};
    }
  }

  /**
   * メタデータをフィルタリングします
   * @private
   * @param {Object} metadata - 元のメタデータ
   * @returns {Object} フィルタリングされたメタデータ
   */
  #filterMetadata(metadata) {
    const { keepMetadataKeys } = this.#config.outputSettings;
    return Object.fromEntries(
      Object.entries(metadata).filter(([key]) => keepMetadataKeys.includes(key))
    );
  }

  /**
   * 指定フォーマットへの変換を実行します
   * @private
   * @param {string} sourcePath - 元画像パス
   * @param {string} targetFormat - 変換後フォーマット
   * @param {Object} settings - 変換設定
   * @param {Object} metadata - 保持するメタデータ
   * @returns {Promise<ConversionResult>} 変換結果
   */
  async #convertToFormat(sourcePath, targetFormat, settings, metadata) {
    const outputPath = this.#createOutputPath(sourcePath, targetFormat);
    const originalSize = statSync(sourcePath).size;

    try {
      const processor = sharp(sourcePath);

      if (this.#config.outputSettings.keepIccProfile) {
        processor.keepIccProfile();
      }

      if (this.#config.outputSettings.keepMetadata) {
        // メタデータの保持処理
        Object.entries(metadata).forEach(([key, value]) => {
          if (processor[`set${key.charAt(0).toUpperCase() + key.slice(1)}`]) {
            processor[`set${key.charAt(0).toUpperCase() + key.slice(1)}`](
              value
            );
          }
        });
      }

      if (this.#config.resizeConfig) {
        processor.resize(this.#config.resizeConfig);
      }

      await processor.toFormat(targetFormat, settings).toFile(outputPath);

      const convertedSize = statSync(outputPath).size;
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
        metadata,
      };
    } catch (error) {
      const errorMessage = `${colors.yellow(
        targetFormat.toUpperCase()
      )} 形式への変換失敗\n${error}`;
      logger(colors.red(errorMessage));
      throw new Error(errorMessage);
    }
  }

  /**
   * 変換レポートを生成します
   * @private
   */
  async #generateConversionReport() {
    if (this.#conversionResults.length === 0) return;

    const reportPath = `${this.#config.outputDirectory}/conversion-report.json`;
    const totalOriginalSize = this.#conversionResults.reduce(
      (sum, result) => sum + result.originalSize,
      0
    );
    const totalConvertedSize = this.#conversionResults.reduce(
      (sum, result) => sum + result.convertedSize,
      0
    );

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalImages: this.#conversionResults.length,
        totalOriginalSize: prettyBytes(totalOriginalSize),
        totalConvertedSize: prettyBytes(totalConvertedSize),
        averageCompressionRatio:
          (
            this.#conversionResults.reduce(
              (sum, result) => sum + result.compressionRatio,
              0
            ) / this.#conversionResults.length
          ).toFixed(1) + "%",
      },
      details: this.#conversionResults.map((result) => ({
        ...result,
        originalSize: prettyBytes(result.originalSize),
        convertedSize: prettyBytes(result.convertedSize),
        compressionRatio: result.compressionRatio.toFixed(1) + "%",
      })),
    };

    try {
      await fsPromises.writeFile(reportPath, JSON.stringify(report, null, 2));
      logger(colors.green(`📊 変換レポートを生成しました: ${reportPath}`));
    } catch (error) {
      logger(colors.red(`❌ レポート生成に失敗しました: ${error.message}`));
    }
  }

  /**
   * 出力ディレクトリの存在確認と作成を行います
   * @private
   * @param {string} imagePath - 処理対象の画像パス
   */
  async #ensureOutputDirectory(imagePath) {
    const pathPattern = new RegExp(`^${this.#config.sourceDirectory}/(.*/)?`);
    const match = imagePath.match(pathPattern);

    if (!match) {
      throw new Error(`無効なソースディレクトリ構造: ${imagePath}`);
    }

    const subPath = match[1] || "";
    const outputDir = `${this.#config.outputDirectory}/${subPath}`;

    if (!existsSync(outputDir)) {
      try {
        mkdirSync(outputDir, { recursive: true });
        logger(`📁 出力ディレクトリを作成: ${colors.green(outputDir)}`);
      } catch (error) {
        const errorMessage = `ディレクトリ作成失敗 ${colors.yellow(
          outputDir
        )}\n${error}`;
        logger(colors.red(errorMessage));
        throw new Error(errorMessage);
      }
    }
  }

  /**
   * 処理対象の画像パスを収集します
   * @private
   * @returns {string[]} 画像パスの配列
   */
  #findTargetImages() {
    const extensions = Object.keys(this.#config.conversionFormats);
    const pattern = `/**/*.{${extensions.join(",")}}`;
    const searchPath = `${this.#config.sourceDirectory}${pattern}`;
    return globule.find(searchPath);
  }

  /**
   * 画像パスから情報を抽出します
   * @private
   * @param {string} imagePath - 画像パス
   * @returns {{ name: string, extension: string } | null} 画像情報
   */
  #parseImagePath(imagePath) {
    const extensions = Object.keys(this.#config.conversionFormats);
    const pattern = new RegExp(
      `\\/([^\\/]+)\\.(${extensions.join("|")})$`,
      "i"
    );
    const match = imagePath.match(pattern);

    return match
      ? {
          name: match[1],
          extension: match[2].toLowerCase(),
        }
      : null;
  }

  /**
   * 出力パスを生成します
   * @private
   * @param {string} sourcePath - 元画像パス
   * @param {string} newFormat - 新しいフォーマット
   * @returns {string} 出力パス
   */
  #createOutputPath(sourcePath, newFormat) {
    const lastDot = sourcePath.lastIndexOf(".");
    const lastSlash = Math.max(
      sourcePath.lastIndexOf("/"),
      sourcePath.lastIndexOf("\\")
    );

    let outputPath = sourcePath.replace(
      this.#config.sourceDirectory,
      this.#config.outputDirectory
    );

    outputPath =
      lastDot === -1 || lastSlash > lastDot
        ? outputPath
        : outputPath.slice(0, lastDot + 1);

    return `${outputPath}.${newFormat}`;
  }
}

export default ImageProcessor;

new ImageProcessor();
