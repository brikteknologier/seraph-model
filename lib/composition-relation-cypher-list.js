module.exports = function cypherComposedRelationList(comps) {
  return Object.keys(comps).map(function(compName) {
    var relName = comps[compName].rel;
    return '`' + relName + '`';
  }).join('|');
}
