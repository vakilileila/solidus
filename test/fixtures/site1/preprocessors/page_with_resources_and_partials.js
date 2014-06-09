module.exports.resources = {
  "page-resource": "https://solid.us/basic/1"
};

module.exports.process = function( context ){
  context.preprocessedBy = context.preprocessedBy || []
  context.preprocessedBy.push('page_with_resources_and_partials.js')
  return context;
};