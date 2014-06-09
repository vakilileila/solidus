module.exports.resources = {
  "page-resource": "https://solid.us/invalid",
  "partial1-resource": "https://solid.us/basic/2"
};

module.exports.process = function( context ){
  context.preprocessedBy = context.preprocessedBy || []
  context.preprocessedBy.push('partial1_with_resources.js')
  return context;
};