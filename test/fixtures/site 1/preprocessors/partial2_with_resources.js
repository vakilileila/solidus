module.exports.resources = {
  "partial2-resource": "https://solid.us/basic/2"
};

module.exports.process = function( context ){
  context.preprocessedBy = context.preprocessedBy || []
  context.preprocessedBy.push('partial2_with_resources.js')
  return context;
};