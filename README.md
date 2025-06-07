# image-processor

## 概要

Node.js + Sharp を使った**画像一括変換・リサイズ CLI ツール**です。
指定ディレクトリ内の画像を自動で検索し、指定フォーマット（例: WebP）へ変換・リサイズして出力します。

## 特徴

- 複数拡張子（png/jpg/jpeg/webp/avif）を一括で変換
- 変換先フォーマット・画質・リサイズ設定をカスタマイズ可能
- サブディレクトリも含めて自動探索
- Promise.all による高速な並列処理
- 変換後の圧縮率・進捗ログをカラー表示

## 使い方

1. npm のインストール

```
npm install
```

2. 画像 ファイルを src フォルダに置く

3. 必要に応じて、「image-processor.js」の設定（#DEFAULT_CONFIG）を変更

   初期設定では、次のようになっています。

   - 入力型式：png、jpg、jpeg、webp、avif
   - 出力型式：webp
   - アスペクト比を維持し、縦横 3840px 以内に収まるサイズに圧縮（拡大はしない）

4. 実行

```
npm run exe
```

5. dist フォルダに出力されます

```
[23:46:47] 📁 出力ディレクトリを作成: dist
[23:46:47] ✓ src/2b5d0dbc.png を WEBP 形式に変換: dist/2b5d0dbc.webp (圧縮率: 98.7%)
```
