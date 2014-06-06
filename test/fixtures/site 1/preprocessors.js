module.exports = {
  'caching.hbs': function() {
    return {
      resources: {
        "cache1": "https://solid.us/cache/1",
        "cache2": "https://solid.us/cache/2"
      }
    };
  },

  'index.hbs': function() {
    return require('./preprocessors/index.js')
  },

  'page_with_resources_and_partials.hbs': function() {
    return require('./preprocessors/page_with_resources_and_partials.js')
  },

  'partial1_with_resources.hbs': function() {
    return require('./preprocessors/partial1_with_resources.js')
  },

  'partial2_with_resources.hbs': function() {
    return require('./preprocessors/partial2_with_resources.js')
  }
};
