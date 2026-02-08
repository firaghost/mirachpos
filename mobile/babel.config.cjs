module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '@/components': './src/components',
            '@/screens': './src/screens',
            '@/lib': './src/lib',
            '@/state': './src/state',
            '@/hooks': './src/hooks',
            '@/theme': './src/theme',
            '@/admin': './src/admin',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
    ],
  };
};
