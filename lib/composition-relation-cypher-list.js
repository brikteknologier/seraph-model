module.exports = function cypherComposedRelationList(comps) {
  return comps.map(function(comp) {
    return '`' + comp.rel + '`';
  }).join('|');
}
