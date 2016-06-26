module.exports = function sortComps(model) {
  var self = this;
  Object.keys(this.compositions).forEach(function(compKey) {
    var comp = self.compositions[compKey];
    if (!comp.orderBy || !Array.isArray(model[comp.name])) return;
    var prop = comp.orderBy.property;
    model[comp.name].sort(function(l, r) {
      if (l[prop] < r[prop]) return comp.orderBy.desc ? 1 : -1;
      else if (l[prop] > r[prop]) return comp.orderBy.desc ? -1 : 1;
      else return 0;
    });
  });
  return model;
};
