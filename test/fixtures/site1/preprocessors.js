var index = require('./preprocessors/index.js');

module.exports = {
  'caching.hbs': function() {
    // No process function
    return {
      resources: {
        "cache1": "https://solid.us/cache/1",
        "cache2": "https://solid.us/cache/2"
      }
    };
  },

  'index.hbs': function() {
    // External preprocessor loaded in module
    return index;
  },

  'page_with_resources_and_partials.hbs': function() {
    // External preprocessor loaded in preprocessor
    return require('./preprocessors/page_with_resources_and_partials.js');
  },

  'partial1_with_resources.hbs': function() {
    return {
      resources: {
        "page-resource": "https://solid.us/invalid",
        "partial1-resource": "https://solid.us/basic/2"
      },
      process: function(context) {
        // External preprocessor loaded in process function
        var preprocessor = require('./preprocessors/partial1_with_resources.js');
        return preprocessor.process(context);
      }
    };
  },

  'partial2_with_resources.hbs': function() {
    return {
      resources: {
        "partial2-resource": "https://solid.us/basic/2"
      },
      process: function(context) {
        // No external preprocessor
        context.preprocessedBy = context.preprocessedBy || [];
        context.preprocessedBy.push('partial2_with_resources');
        return context;
      }
    };
  }
};
