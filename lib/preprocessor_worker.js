module.exports = function(preprocessors_path, view, context, cb) {
  try {
    cb(null, require(preprocessors_path)[view]().process(context));
  } catch (err) {
    cb(err, null);
  }
};
