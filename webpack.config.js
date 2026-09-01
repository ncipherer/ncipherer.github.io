const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");
const fs = require("fs");

// Load .env file if present (no external dependency needed)
const envPath = path.resolve(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .forEach((line) => {
      const [key, ...rest] = line.split("=");
      if (key && rest.length) {
        const val = rest.join("=").trim().replace(/^"|"$/g, "");
        process.env[key.trim()] = val;
      }
    });
}

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
      new webpack.DefinePlugin({
        "process.env.TMDB_API_KEY": JSON.stringify(process.env.TMDB_API_KEY || ""),
        "process.env.OMDB_API_KEY": JSON.stringify(process.env.OMDB_API_KEY || ""),
      }),
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
            // Private WIP drafts stay in the repo (and in notes.json) but are
            // not shipped to the public /data folder. Add them back here if
            // they're ever published properly.
            globOptions: {
              ignore: [
                "**/hey-there.md",
                "**/i-just-wanna-see.md",
                "**/looking-back.md",
              ],
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
