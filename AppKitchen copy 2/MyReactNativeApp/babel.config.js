// Required for Expo / Metro to transform the app consistently (Fast Refresh, cache).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
