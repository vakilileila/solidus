const TIMEOUT = 5 * 1000;

module.exports = function(preprocessors_path, view, context, cb) {
  var preprocess_timeout = setTimeout(function() {
    console.log('process committing suicide');
    process.exit();
  }, TIMEOUT);

  var error;
  try {
    var preprocessors = require(preprocessors_path);
    context = preprocessors[view]().process(context);
  } catch (err) {
    error = err;
  }

  clearTimeout(preprocess_timeout);
  error ? cb(error, null) : cb(null, context);
};
