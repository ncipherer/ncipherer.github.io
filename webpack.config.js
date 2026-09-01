const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");
const ImageMinimizerPlugin = require("image-minimizer-webpack-plugin");
const fs = require("fs");

module.exports = (env, argv) => {
  const publicPath = "/";

  return {
    entry: "./src/main.ts",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].[contenthash].js",
      clean: true,
      publicPath: publicPath,
    },

    module: {
      rules: [
        {
          test: /\.json$/,
          type: "asset/source",
        },
        {
          test: /\.ts$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, "css-loader"],
        },
        {
          test: /\.md$/,
          type: "asset/source",
        },
        {
          test: /\.(png|jpe?g|gif|svg|webp|avif)$/i,
          type: "asset/resource",
          parser: {
            dataUrlCondition: {
              maxSize: 8 * 1024,
            },
          },
        },
      ],
    },
    optimization: {
      // TerserPlugin (JS) is webpack's default; CSS needs to be added. Without
      // this the stylesheet shipped unminified at ~170 KiB.
      minimize: argv.mode === "production",
      minimizer: [
        `...`,
        new CssMinimizerPlugin(),
        // Re-encode the artwork in src/data/pics in place. These images ship
        // as-is otherwise (one was a 528 KiB webp).
        //
        // Deliberately no `generator`/webp preset here: it rewrote the copied
        // assets to a `.webp` name, so the markdown's `/data/pics/x.png`
        // references 404'd on the live site while the .webp files sat
        // unreferenced. The markdown is the source of truth for the path, so
        // the pipeline keeps each file's original format.
        // One configuration per input family, each with only the plugin that
        // matches it. Two rules matter here:
        //   - imageminGenerate returns a result for every plugin that can read
        //     the input, and the plugin emits under the *generated* extension.
        //     Listing imagemin-webp alongside imagemin-pngquant therefore turned
        //     every copied .png into a .webp, so `/data/pics/x.png` — the path
        //     the markdown asks for — stopped existing and the images 404'd.
        //   - webp inputs matched nothing here and shipped untouched (one was
        //     541 KiB), so they get their own rule. A .webp in and a .webp out
        //     means no rename, and the file finally gets compressed.
        new ImageMinimizerPlugin({
          test: /\.(png|jpe?g|gif)$/i,
          minimizer: {
            implementation: ImageMinimizerPlugin.imageminGenerate,
            options: {
              plugins: [
                ["imagemin-mozjpeg", { quality: 78 }],
                ["imagemin-pngquant", { quality: [0.6, 0.8] }],
              ],
            },
          },
        }),
        new ImageMinimizerPlugin({
          test: /\.webp$/i,
          minimizer: {
            implementation: ImageMinimizerPlugin.imageminGenerate,
            options: {
              plugins: [["imagemin-webp", { quality: 72 }]],
            },
          },
        }),
      ],
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: 10,
          },
          d3: {
            test: /[\\/]node_modules[\\/]d3(-.*)?$/,
            name: 'd3-vendor',
            chunks: 'all',
            priority: 20,
          },
          markdown: {
            test: /[\\/]node_modules[\\/]marked[\\/]/,
            name: 'markdown-vendor',
            chunks: 'all',
            priority: 20,
          },
        },
      },
      runtimeChunk: 'single',
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    devServer: {
      static: {
        directory: path.join(__dirname, "dist"),
      },
      historyApiFallback: true,
      hot: true,
      port: 3000,
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: "index.html",
      }),
      new MiniCssExtractPlugin({
        filename: "[name].[contenthash].css",
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "src/data",
            to: "data",
            // Everything in src/data is published, and every entry in
            // notes.json has a file that actually ships (npm test enforces
            // both). Only OS cruft and draft folders are kept out of /data.
            globOptions: {
              ignore: ["**/.DS_Store", "**/drafts/**"],
            },
          },
          { from: "public" },
        ],
      }),
    ],
    performance: argv.mode === 'production' ? {
      maxAssetSize: 600 * 1024,
      maxEntrypointSize: 400 * 1024,
      hints: "warning",
    } : {
      hints: false,
    },
  };
};
