const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: './src/scripts/main.js',
  output: {
    path: path.resolve(__dirname, 'docs/assets'),
    publicPath: '/assets/',
    filename: 'main.js',
    chunkFilename: '[name].[contenthash].js'
  },
  plugins: [new MiniCssExtractPlugin({ chunkFilename: '[name].[contenthash].css' })],
  module: {
    rules: [
      {
        test: /\.css$/,
        exclude: /node_modules/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader']
      },
      {
        // Third-party CSS (PhotoSwipe) doesn't need Tailwind.
        test: /\.css$/,
        include: /node_modules/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      }
    ]
  }
};
